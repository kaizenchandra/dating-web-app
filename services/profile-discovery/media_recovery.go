package main

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
	"net/http"
	"strings"
	"time"
)

func mediaOwner(key string) (string, bool) {
	parts := strings.Split(key, "/")
	if len(parts) != 2 || !strings.HasSuffix(parts[1], ".jpg") {
		return "", false
	}
	owner, err := uuid.Parse(parts[0])
	if err != nil || owner.String() != parts[0] {
		return "", false
	}
	object, err := uuid.Parse(strings.TrimSuffix(parts[1], ".jpg"))
	if err != nil || object.String()+".jpg" != parts[1] {
		return "", false
	}
	return owner.String(), true
}

// Each scan processes at most 200 keys and persists its cursor. Unknown key
// formats are deliberately not deleted. Upload and deletion keys are immutable.
func reconcileMedia() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	var locked bool
	if tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(731803)").Scan(&locked) != nil || !locked {
		return
	}
	var cursor string
	if tx.QueryRow(ctx, "SELECT cursor FROM media_reconciliation WHERE singleton=true FOR UPDATE").Scan(&cursor) != nil {
		return
	}
	scanned, queued := 0, 0
	next := ""
	scanError := ""
	for object := range store.ListObjects(ctx, bucket, minio.ListObjectsOptions{Recursive: true, StartAfter: cursor, MaxKeys: 200}) {
		if object.Err != nil {
			scanError = "storage listing unavailable"
			break
		}
		scanned++
		if _, ok := mediaOwner(object.Key); ok {
			result, e := tx.Exec(ctx, `INSERT INTO object_cleanup(object_key,next_attempt_at)
    SELECT $1,now()+interval '1 hour' WHERE NOT EXISTS(SELECT 1 FROM profiles WHERE photo_key=$1)
    ON CONFLICT DO NOTHING`, object.Key)
			if e != nil {
				return
			}
			queued += int(result.RowsAffected())
		}
		if scanned >= 200 {
			next = object.Key
			break
		}
	}
	if scanError != "" {
		next = cursor
	}
	if _, err = tx.Exec(ctx, "UPDATE media_reconciliation SET cursor=$1,last_scan_at=now(),last_scan_error=nullif($2,''),scanned=$3,queued=$4 WHERE singleton=true", next, scanError, scanned, queued); err == nil {
		tx.Commit(ctx)
	}
}

func cleanupObjects() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	rows, err := pool.Query(ctx, "SELECT object_key FROM object_cleanup WHERE attempts<10 AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 20")
	if err != nil {
		return
	}
	keys := []string{}
	for rows.Next() {
		var key string
		if rows.Scan(&key) != nil {
			rows.Close()
			return
		}
		keys = append(keys, key)
	}
	rows.Close()
	if rows.Err() != nil {
		return
	}
	for _, key := range keys {
		cleanupObject(ctx, key)
	}
}
func cleanupObject(ctx context.Context, key string) {
	owner, ok := mediaOwner(key)
	if !ok {
		pool.Exec(ctx, "UPDATE object_cleanup SET attempts=10,last_error='unrecognized object key' WHERE object_key=$1", key)
		return
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	// Same owner-row lock as capture replacement and account deletion; never act
	// on a stale snapshot while a capture commit is still being resolved.
	if _, err = tx.Exec(ctx, "SET LOCAL lock_timeout='1s'"); err != nil {
		return
	}
	var live *string
	err = tx.QueryRow(ctx, "SELECT photo_key FROM profiles WHERE account_id=$1 FOR UPDATE", owner).Scan(&live)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return
	}
	var attempts int
	err = tx.QueryRow(ctx, "SELECT attempts FROM object_cleanup WHERE object_key=$1 AND attempts<10 AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED", key).Scan(&attempts)
	if err != nil {
		return
	}
	if live == nil || *live != key {
		if err = store.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{}); err != nil {
			_, err = tx.Exec(ctx, "UPDATE object_cleanup SET attempts=attempts+1,last_error='storage unavailable',next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)) WHERE object_key=$1", key)
			if err == nil {
				tx.Commit(ctx)
			}
			return
		}
	}
	if _, err = tx.Exec(ctx, "DELETE FROM object_cleanup WHERE object_key=$1", key); err == nil {
		tx.Commit(ctx)
	}
}
func mediaRecoveryRoute(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/internal/media/status" {
		return false
	}
	if r.Method != "GET" {
		fail(w, 405, "METHOD_NOT_ALLOWED", "Use GET.")
		return true
	}
	var pending, failed, scanned, queued int
	var last *time.Time
	var failure *string
	err := pool.QueryRow(r.Context(), `SELECT (SELECT count(*) FROM object_cleanup WHERE attempts<10),
 (SELECT count(*) FROM object_cleanup WHERE attempts>=10),last_scan_at,last_scan_error,scanned,queued FROM media_reconciliation WHERE singleton=true`).Scan(&pending, &failed, &last, &failure, &scanned, &queued)
	if err != nil {
		fail(w, 503, "MEDIA_STATUS_UNAVAILABLE", "Media recovery status is unavailable.")
	} else {
		reply(w, 200, map[string]any{"pending": pending, "failed": failed, "lastScanAt": last, "lastScanError": failure, "scanned": scanned, "queued": queued})
	}
	return true
}
