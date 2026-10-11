package main

import (
	"encoding/json"
	"net/http"
	"regexp"
)

func privacyRoutes(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/internal/privacy/delete" && r.URL.Path != "/internal/privacy/export" {
		return false
	}
	id := r.URL.Query().Get("accountId")
	if !regexp.MustCompile(`^[0-9a-f-]{36}$`).MatchString(id) {
		fail(w, 422, "INVALID_ID", "Invalid account.")
		return true
	}
	ctx := r.Context()
	if r.URL.Path == "/internal/privacy/export" && r.Method == "GET" {
		var data []byte
		err := pool.QueryRow(ctx, "SELECT coalesce(jsonb_agg(jsonb_build_object('targetId',CASE WHEN lo=$1 THEN hi ELSE lo END,'action',CASE WHEN lo=$1 THEN lo_action ELSE hi_action END,'introduction',CASE WHEN lo=$1 THEN lo_intro ELSE hi_intro END,'blocked',CASE WHEN lo=$1 THEN lo_block ELSE hi_block END)),'[]'::jsonb) FROM relationships WHERE lo=$1 OR hi=$1", id).Scan(&data)
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
	for _, q := range []string{"DELETE FROM connection_usage WHERE account_id=$1 OR target_id=$1", "DELETE FROM outbox WHERE aggregate_id IN (SELECT id FROM matches WHERE lo=$1 OR hi=$1)", "DELETE FROM matches WHERE lo=$1 OR hi=$1", "DELETE FROM relationships WHERE lo=$1 OR hi=$1"} {
		if _, err = tx.Exec(ctx, q, id); err != nil {
			break
		}
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
