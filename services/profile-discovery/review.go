package main

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
	"io"
	"net/http"
	"time"
)

func decidePhoto(ctx context.Context, id, decision string) (bool, error) {
	outcome, err := applyPhotoDecision(ctx, id, decision, "", "", "")
	return outcome == "applied", err
}
func applyPhotoDecision(ctx context.Context, id, decision, version, decisionID, hash string) (string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	// Lock the subject first, shared with photo replacement and deletion.
	var subject string
	err = tx.QueryRow(ctx, "SELECT account_id FROM profiles WHERE account_id=$1 FOR UPDATE", id).Scan(&subject)
	if errors.Is(err, pgx.ErrNoRows) {
		return "stale", nil
	}
	if err != nil {
		return "", err
	}
	if decisionID != "" {
		var previous string
		err = tx.QueryRow(ctx, "SELECT payload_hash FROM review_receipts WHERE decision_id=$1", decisionID).Scan(&previous)
		if err == nil {
			if previous != hash {
				return "conflict", nil
			}
			return "applied", nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	result, err := tx.Exec(ctx, "UPDATE profiles SET photo_status=$1,photo_source='local' WHERE account_id=$2 AND photo_status='pending' AND (nullif($3,'')::uuid IS NULL OR photo_review_version=nullif($3,'')::uuid)", decision, id, version)
	if err != nil {
		return "", err
	}
	if result.RowsAffected() == 0 {
		return "stale", nil
	}
	if decisionID != "" {
		if _, err = tx.Exec(ctx, "INSERT INTO review_receipts(decision_id,account_id,payload_hash) VALUES($1,$2,$3)", decisionID, id, hash); err != nil {
			return "", err
		}
	}
	return "applied", tx.Commit(ctx)
}
func reviewRoutes(w http.ResponseWriter, r *http.Request, local bool) bool {
	if r.URL.Path == "/internal/reviews/photo" && r.Method == "GET" {
		id := r.URL.Query().Get("accountId")
		if _, err := uuid.Parse(id); err != nil {
			fail(w, 422, "INVALID_ID", "Invalid account.")
			return true
		}
		var key *string
		if err := pool.QueryRow(r.Context(), "SELECT photo_key FROM profiles WHERE account_id=$1", id).Scan(&key); err != nil || key == nil {
			fail(w, 404, "PHOTO_NOT_FOUND", "Photo unavailable.")
			return true
		}
		object, err := store.GetObject(r.Context(), bucket, *key, minio.GetObjectOptions{})
		if err != nil {
			fail(w, 503, "PHOTO_UNAVAILABLE", "Please retry.")
			return true
		}
		defer object.Close()
		if _, err = object.Stat(); err != nil {
			fail(w, 404, "PHOTO_NOT_FOUND", "Photo unavailable.")
			return true
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		io.Copy(w, object)
		return true
	}

	if r.URL.Path == "/internal/reviews" && r.Method == "GET" {
		rows, err := pool.Query(r.Context(), "SELECT account_id,data->>'displayName',photo_updated_at,photo_review_version FROM profiles WHERE photo_status='pending' ORDER BY photo_updated_at LIMIT 100")
		if err != nil {
			fail(w, 503, "REVIEWS_UNAVAILABLE", "Please retry.")
			return true
		}
		defer rows.Close()
		reviews := []map[string]any{}
		for rows.Next() {
			var id, name, version string
			var updated time.Time
			if rows.Scan(&id, &name, &updated, &version) != nil {
				fail(w, 503, "REVIEWS_UNAVAILABLE", "Please retry.")
				return true
			}
			reviews = append(reviews, map[string]any{"accountId": id, "name": name, "kind": "photo", "source": "camera", "updatedAt": updated, "reviewVersion": version})
		}
		reply(w, 200, map[string]any{"reviews": reviews})
		return true
	}
	if r.URL.Path == "/internal/reviews/decision" && r.Method == "POST" {
		if !local {
			fail(w, 403, "PROVIDER_REQUIRED", "Production photo review requires configured liveness and moderation.")
			return true
		}
		var input struct {
			AccountID     string `json:"accountId"`
			Kind          string `json:"kind"`
			Decision      string `json:"decision"`
			Reason        string `json:"reason"`
			ReviewVersion string `json:"reviewVersion"`
			DecisionID    string `json:"decisionId"`
		}
		if !decode(w, r, &input) {
			return true
		}
		if _, err := uuid.Parse(input.AccountID); err != nil || input.Kind != "photo" || (input.Decision != "approved" && input.Decision != "rejected") || len(input.Reason) < 3 || !bounded(input.Reason, 500) {
			fail(w, 422, "INVALID_DECISION", "Check the review decision.")
			return true
		}
		if _, err := uuid.Parse(input.ReviewVersion); err != nil {
			fail(w, 422, "INVALID_VERSION", "Refresh the review queue.")
			return true
		}
		if _, err := uuid.Parse(input.DecisionID); err != nil {
			fail(w, 422, "INVALID_DECISION_ID", "Send a valid decision ID.")
			return true
		}
		outcome, err := applyPhotoDecision(r.Context(), input.AccountID, input.Decision, input.ReviewVersion, input.DecisionID, digest(input.AccountID+"\x00"+input.Decision+"\x00"+input.ReviewVersion+"\x00"+input.Reason))
		if err != nil {
			fail(w, 503, "REVIEW_FAILED", "Please retry.")
			return true
		}
		if outcome == "conflict" {
			fail(w, 409, "IDEMPOTENCY_CONFLICT", "This decision ID belongs to another request.")
			return true
		}
		if outcome != "applied" {
			fail(w, 409, "REVIEW_NOT_PENDING", "This submission was replaced or is no longer pending.")
			return true
		}
		reply(w, 200, map[string]bool{"ok": true})
		return true
	}
	return false
}
