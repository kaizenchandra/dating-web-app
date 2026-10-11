package main

import (
	"encoding/json"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"net/http"
)

func privacyRoutes(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/internal/privacy/delete" && r.URL.Path != "/internal/privacy/export" {
		return false
	}
	id := r.URL.Query().Get("accountId")
	if _, err := uuid.Parse(id); err != nil {
		fail(w, 422, "INVALID_ID", "Invalid account.")
		return true
	}
	ctx := r.Context()
	if r.URL.Path == "/internal/privacy/export" && r.Method == "GET" {
		var data []byte
		err := pool.QueryRow(ctx, "SELECT coalesce(jsonb_agg(jsonb_build_object('profile',data,'photoStatus',photo_status,'photoSource',photo_source,'discoveryFeedback',(SELECT coalesce(jsonb_agg(jsonb_build_object('targetId',target_id,'reason',reason,'createdAt',created_at)),'[]'::jsonb) FROM discovery_feedback WHERE account_id=$1))),'[]'::jsonb) FROM profiles WHERE account_id=$1", id).Scan(&data)
		if err != nil {
			fail(w, 503, "EXPORT_UNAVAILABLE", "Please retry.")
		} else {
			reply(w, 200, json.RawMessage(data))
		}
		return true
	}
	if r.Method != "POST" {
		fail(w, 405, "METHOD_NOT_ALLOWED", "Unsupported action.")
		return true
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		fail(w, 503, "DELETE_UNAVAILABLE", "Please retry.")
		return true
	}
	defer tx.Rollback(ctx)
	var key *string
	err = tx.QueryRow(ctx, "SELECT photo_key FROM profiles WHERE account_id=$1 FOR UPDATE", id).Scan(&key)
	if err == nil && key != nil {
		if store.RemoveObject(ctx, bucket, *key, minio.RemoveObjectOptions{}) != nil {
			fail(w, 503, "DELETE_UNAVAILABLE", "Storage unavailable.")
			return true
		}
	}
	for object := range store.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: id + "/", Recursive: true}) {
		if object.Err != nil || store.RemoveObject(ctx, bucket, object.Key, minio.RemoveObjectOptions{}) != nil {
			fail(w, 503, "DELETE_UNAVAILABLE", "Storage unavailable.")
			return true
		}
	}
	if _, err = tx.Exec(ctx, "DELETE FROM object_cleanup WHERE object_key LIKE $1", id+"/%"); err != nil {
		fail(w, 503, "DELETE_UNAVAILABLE", "Please retry.")
		return true
	}
	if _, err = tx.Exec(ctx, "DELETE FROM profiles WHERE account_id=$1", id); err == nil {
		_, err = tx.Exec(ctx, "DELETE FROM capture_sessions WHERE account_id=$1", id)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		fail(w, 503, "DELETE_UNAVAILABLE", "Please retry.")
	} else {
		reply(w, 200, map[string]bool{"ok": true})
	}
	return true
}
