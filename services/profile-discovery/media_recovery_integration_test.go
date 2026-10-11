//go:build integration

package main

import (
	"bytes"
	"context"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"image"
	"image/jpeg"
	"os"
	"testing"
	"time"
)

func TestRecoveryAgainstPostgresAndPrivateStorage(t *testing.T) {
	if os.Getenv("APP_ENV") != "local" {
		t.Fatal("local fixtures only")
	}
	ctx := context.Background()
	var err error
	pool, err = pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store, err = minio.New(os.Getenv("S3_ENDPOINT"), &minio.Options{Creds: credentials.NewStaticV4(os.Getenv("S3_ACCESS_KEY"), os.Getenv("S3_SECRET_KEY"), "")})
	if err != nil {
		t.Fatal(err)
	}
	owner := uuid.NewString()
	current := owner + "/" + uuid.NewString() + ".jpg"
	orphan := owner + "/" + uuid.NewString() + ".jpg"
	var content bytes.Buffer
	if err = jpeg.Encode(&content, image.NewRGBA(image.Rect(0, 0, 120, 120)), nil); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{current, orphan} {
		if _, err = store.PutObject(ctx, bucket, key, bytes.NewReader(content.Bytes()), int64(content.Len()), minio.PutObjectOptions{ContentType: "image/jpeg"}); err != nil {
			t.Fatal(err)
		}
		defer store.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
		defer pool.Exec(ctx, "DELETE FROM object_cleanup WHERE object_key=$1", key)
	}
	if _, err = pool.Exec(ctx, "INSERT INTO profiles(account_id,data,photo_key) VALUES($1,'{}',$2)", owner, current); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, "DELETE FROM profiles WHERE account_id=$1", owner)
	// Simulate a crash after object creation and an uncertain commit with a live key.
	if _, err = pool.Exec(ctx, "INSERT INTO object_cleanup(object_key) VALUES($1)", current); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, "UPDATE media_reconciliation SET cursor='' WHERE singleton=true"); err != nil {
		t.Fatal(err)
	}
	reconcileMedia()
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM object_cleanup WHERE object_key=$1 AND next_attempt_at>now()+interval '55 minutes'", orphan).Scan(&count); err != nil || count != 1 {
		t.Fatal("orphan not durably queued with grace", err, count)
	}
	cleanupObjects()
	if _, err = store.StatObject(ctx, bucket, current, minio.StatObjectOptions{}); err != nil {
		t.Fatal("live committed photo deleted", err)
	}
	if _, err = store.StatObject(ctx, bucket, orphan, minio.StatObjectOptions{}); err != nil {
		t.Fatal("orphan deleted before grace", err)
	}
	if _, err = pool.Exec(ctx, "UPDATE object_cleanup SET next_attempt_at=now()-interval '1 second' WHERE object_key=$1", orphan); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT account_id FROM profiles WHERE account_id=$1 FOR UPDATE", owner); err != nil {
		t.Fatal(err)
	}
	cleanupObject(ctx, orphan)
	if _, err = store.StatObject(ctx, bucket, orphan, minio.StatObjectOptions{}); err != nil {
		t.Fatal("cleanup ignored active capture transaction", err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	cleanupObject(ctx, orphan)
	if _, err = store.StatObject(ctx, bucket, orphan, minio.StatObjectOptions{}); minio.ToErrorResponse(err).Code != "NoSuchKey" {
		t.Fatal("orphan was not removed", err)
	}
	if _, err = store.StatObject(ctx, bucket, current, minio.StatObjectOptions{}); err != nil {
		t.Fatal("current photo missing", err)
	}
	// Exhaustion is durable and visible; no unbounded automatic retry.
	if _, err = pool.Exec(ctx, "INSERT INTO object_cleanup(object_key,attempts,next_attempt_at) VALUES($1,10,$2)", orphan, time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	cleanupObject(ctx, orphan)
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM object_cleanup WHERE object_key=$1 AND attempts=10", orphan).Scan(&count); err != nil || count != 1 {
		t.Fatal("exhausted failure disappeared", err)
	}
}
