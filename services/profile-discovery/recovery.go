package main

import (
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

func operatorRecovery(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/internal/recovery" {
		return false
	}
	if r.Method == "GET" {
		rows, err := pool.Query(r.Context(), "SELECT id,attempts,created_at,last_error FROM object_cleanup WHERE attempts>=10 ORDER BY created_at LIMIT 50")
		if err != nil {
			fail(w, 503, "RECOVERY_UNAVAILABLE", "Please retry.")
			return true
		}
		defer rows.Close()
		jobs := []map[string]any{}
		for rows.Next() {
			var id string
			var attempts int
			var created time.Time
			var last *string
			if rows.Scan(&id, &attempts, &created, &last) != nil {
				fail(w, 503, "RECOVERY_UNAVAILABLE", "Please retry.")
				return true
			}
			jobs = append(jobs, map[string]any{"id": id, "service": "profile-discovery", "kind": "photo cleanup", "attempts": attempts, "createdAt": created, "lastError": last})
		}
		if rows.Err() != nil {
			fail(w, 503, "RECOVERY_UNAVAILABLE", "Please retry.")
			return true
		}
		reply(w, 200, map[string]any{"jobs": jobs})
		return true
	}
	if r.Method != "POST" {
		fail(w, 405, "METHOD_NOT_ALLOWED", "Use GET or POST.")
		return true
	}
	var input struct {
		RequestID string `json:"requestId"`
		JobID     string `json:"jobId"`
	}
	if !decode(w, r, &input) {
		return true
	}
	if _, err := uuid.Parse(input.RequestID); err != nil {
		fail(w, 422, "INVALID_ID", "Invalid recovery request.")
		return true
	}
	if _, err := uuid.Parse(input.JobID); err != nil {
		fail(w, 422, "INVALID_ID", "Invalid recovery job.")
		return true
	}
	tx, err := pool.Begin(r.Context())
	if err != nil {
		fail(w, 503, "RECOVERY_UNAVAILABLE", "Please retry.")
		return true
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtext($1))", input.RequestID); err != nil {
		fail(w, 503, "RECOVERY_UNAVAILABLE", "Please retry.")
		return true
	}
	var previous string
	err = tx.QueryRow(r.Context(), "SELECT job_id FROM recovery_receipts WHERE request_id=$1", input.RequestID).Scan(&previous)
	if err == nil {
		if previous != input.JobID {
			fail(w, 409, "IDEMPOTENCY_CONFLICT", "Recovery request ID conflict.")
			return true
		}
	} else if errors.Is(err, pgx.ErrNoRows) {
		result, e := tx.Exec(r.Context(), "UPDATE object_cleanup SET attempts=0,next_attempt_at=now(),last_error=NULL WHERE id=$1 AND attempts>=10", input.JobID)
		if e != nil {
			fail(w, 503, "RECOVERY_UNAVAILABLE", "Please retry.")
			return true
		}
		if result.RowsAffected() == 0 {
			fail(w, 409, "JOB_NOT_EXHAUSTED", "This job is no longer awaiting recovery.")
			return true
		}
		if _, err = tx.Exec(r.Context(), "INSERT INTO recovery_receipts(request_id,job_id) VALUES($1,$2)", input.RequestID, input.JobID); err != nil {
			fail(w, 503, "RECOVERY_UNAVAILABLE", "Please retry.")
			return true
		}
	} else {
		fail(w, 503, "RECOVERY_UNAVAILABLE", "Please retry.")
		return true
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "RECOVERY_UNAVAILABLE", "Please retry with the same request ID.")
		return true
	}
	reply(w, 200, map[string]bool{"ok": true})
	return true
}
