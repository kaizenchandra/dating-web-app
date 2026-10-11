package main

import (
	"github.com/google/uuid"
	"net/http"
)

func feedbackRoutes(w http.ResponseWriter, r *http.Request, a Identity) bool {
	if r.URL.Path != "/api/v1/discovery/feedback" {
		return false
	}
	if r.Method == "GET" {
		rows, err := pool.Query(r.Context(), "SELECT reason,count(*) FROM discovery_feedback WHERE account_id=$1 GROUP BY reason ORDER BY reason", a.ID)
		if err != nil {
			fail(w, 503, "FEEDBACK_UNAVAILABLE", "Your discovery choices could not be loaded. Please retry.")
			return true
		}
		defer rows.Close()
		type counter struct {
			Reason string `json:"reason"`
			Count  int    `json:"count"`
		}
		reasons := []counter{}
		total := 0
		for rows.Next() {
			var c counter
			if rows.Scan(&c.Reason, &c.Count) != nil {
				fail(w, 503, "FEEDBACK_UNAVAILABLE", "Please retry.")
				return true
			}
			total += c.Count
			reasons = append(reasons, c)
		}
		if rows.Err() != nil {
			fail(w, 503, "FEEDBACK_UNAVAILABLE", "Please retry.")
			return true
		}
		reply(w, 200, map[string]any{"total": total, "reasons": reasons})
		return true
	}
	if r.Method != "POST" {
		fail(w, 405, "METHOD_NOT_ALLOWED", "Use GET or POST.")
		return true
	}
	var input struct {
		Action   string `json:"action"`
		TargetID string `json:"targetId"`
		Reason   string `json:"reason"`
	}
	if !decode(w, r, &input) {
		return true
	}
	valid := input.Action == "reset" && input.TargetID == "" && input.Reason == ""
	if input.Action == "restore" || input.Action == "hide" {
		_, err := uuid.Parse(input.TargetID)
		valid = err == nil && input.TargetID != a.ID && ((input.Action == "restore" && input.Reason == "") || (input.Action == "hide" && (input.Reason == "intent" || input.Reason == "distance" || input.Reason == "interests" || input.Reason == "not_for_me")))
	}
	if !valid {
		fail(w, 422, "INVALID_FEEDBACK", "Choose a valid discovery action and reason.")
		return true
	}
	if input.Action == "hide" {
		_, _, _, eligible := loadCandidate(r.Context(), a.ID)
		if !eligible {
			fail(w, 403, "DATING_INELIGIBLE", "Complete your profile and verification first.")
			return true
		}
		var access struct {
			Blocked bool `json:"blocked"`
			Matched bool `json:"matched"`
		}
		if !serviceCall(r.Context(), "connections", "/internal/access?actor="+a.ID+"&target="+input.TargetID, "GET", nil, &access) {
			fail(w, 503, "SAFETY_UNAVAILABLE", "Profile access could not be checked.")
			return true
		}
		_, p, _, ok := loadCandidate(r.Context(), input.TargetID)
		if !ok || access.Blocked || p.Incognito {
			fail(w, 403, "PROFILE_UNAVAILABLE", "This profile is unavailable.")
			return true
		}
	}
	tx, err := pool.Begin(r.Context())
	if err != nil {
		fail(w, 503, "FEEDBACK_UNAVAILABLE", "Please retry.")
		return true
	}
	defer tx.Rollback(r.Context())
	// Serialize choices/reset against owner deletion. Target FK handles concurrent target deletion.
	var id string
	err = tx.QueryRow(r.Context(), "SELECT account_id FROM profiles WHERE account_id=$1 FOR UPDATE", a.ID).Scan(&id)
	if err != nil {
		fail(w, 403, "PROFILE_UNAVAILABLE", "Your profile is unavailable.")
		return true
	}
	switch input.Action {
	case "hide":
		_, err = tx.Exec(r.Context(), "INSERT INTO discovery_feedback(account_id,target_id,reason) VALUES($1,$2,$3) ON CONFLICT(account_id,target_id) DO UPDATE SET reason=excluded.reason", a.ID, input.TargetID, input.Reason)
	case "restore":
		_, err = tx.Exec(r.Context(), "DELETE FROM discovery_feedback WHERE account_id=$1 AND target_id=$2", a.ID, input.TargetID)
	case "reset":
		_, err = tx.Exec(r.Context(), "DELETE FROM discovery_feedback WHERE account_id=$1", a.ID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		fail(w, 503, "FEEDBACK_UNAVAILABLE", "Your choice could not be saved. Please retry.")
	} else {
		reply(w, 200, map[string]bool{"ok": true})
	}
	return true
}
