package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

type Match struct {
	ID       string `json:"id"`
	FirstID  string `json:"firstId"`
	SecondID string `json:"secondId"`
}

func authorizedMatch(ctx context.Context, actor, id string) (Match, bool) {
	var m Match
	var blocked bool
	err := pool.QueryRow(ctx, "SELECT m.id,m.lo,m.hi,r.lo_block OR r.hi_block FROM matches m JOIN relationships r ON r.lo=m.lo AND r.hi=m.hi WHERE m.id=$1 AND m.active AND (m.lo=$2 OR m.hi=$2)", id, actor).Scan(&m.ID, &m.FirstID, &m.SecondID, &blocked)
	return m, err == nil && !blocked && eligible(ctx, m.FirstID) && eligible(ctx, m.SecondID)
}
func communicationRoutes(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/internal/match" && r.URL.Path != "/internal/guard-message" {
		return false
	}
	if r.URL.Path == "/internal/match" {
		actor, id := r.URL.Query().Get("actor"), r.URL.Query().Get("id")
		if !uuidPattern.MatchString(actor) || !uuidPattern.MatchString(id) {
			fail(w, 400, "INVALID_ID", "Invalid conversation.")
			return true
		}
		m, ok := authorizedMatch(r.Context(), actor, id)
		if !ok {
			fail(w, 403, "MATCH_UNAVAILABLE", "This conversation is no longer available.")
			return true
		}
		reply(w, 200, m)
		return true
	}
	var input struct {
		ActorID         string `json:"actorId"`
		ConversationID  string `json:"conversationId"`
		ClientMessageID string `json:"clientMessageId"`
		Text            string `json:"text"`
		ImageID         string `json:"imageId"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || !uuidPattern.MatchString(input.ActorID) || !uuidPattern.MatchString(input.ConversationID) || !uuidPattern.MatchString(input.ClientMessageID) || (len([]rune(input.Text)) < 1 && input.ImageID == "") || (input.ImageID != "" && !uuidPattern.MatchString(input.ImageID)) || len([]rune(input.Text)) > 2000 {
		fail(w, 422, "INVALID_MESSAGE", "Check the message.")
		return true
	}
	m, ok := authorizedMatch(r.Context(), input.ActorID, input.ConversationID)
	if !ok {
		fail(w, 403, "MATCH_UNAVAILABLE", "This conversation is no longer available.")
		return true
	}
	// Hold the authoritative pair lock through the bounded durable write. Block/unmatch
	// takes this same lock, so normal concurrent transitions have a defined order.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := pool.Begin(ctx)
	if err != nil {
		fail(w, 503, "SAFETY_UNAVAILABLE", "Please retry.")
		return true
	}
	defer tx.Rollback(ctx)
	var blocked bool
	if tx.QueryRow(ctx, "SELECT lo_block OR hi_block FROM relationships WHERE lo=$1 AND hi=$2 FOR UPDATE", m.FirstID, m.SecondID).Scan(&blocked) != nil || blocked {
		fail(w, 403, "MATCH_UNAVAILABLE", "This conversation is unavailable.")
		return true
	}
	var active bool
	if tx.QueryRow(ctx, "SELECT active FROM matches WHERE id=$1", m.ID).Scan(&active) != nil || !active {
		fail(w, 403, "MATCH_UNAVAILABLE", "This conversation is unavailable.")
		return true
	}
	recipient := m.SecondID
	if input.ActorID == m.SecondID {
		recipient = m.FirstID
	}
	payloadMap := map[string]any{"conversationId": m.ID, "actorId": input.ActorID, "recipientId": recipient, "firstId": m.FirstID, "secondId": m.SecondID, "clientMessageId": input.ClientMessageID, "text": input.Text, "expiresAt": time.Now().Add(2 * time.Second).UnixMilli()}
	if input.ImageID != "" {
		payloadMap["imageId"] = input.ImageID
	}
	payload, _ := json.Marshal(payloadMap)
	req, _ := http.NewRequestWithContext(ctx, "POST", "http://communication:4000/internal/commit-message", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+serviceToken("communication"))
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		fail(w, 503, "MESSAGE_UNCONFIRMED", "Send was not confirmed. Retry with the same message ID.")
		return true
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 16384))
	if err != nil {
		fail(w, 503, "MESSAGE_UNCONFIRMED", "Retry with the same message ID.")
		return true
	}
	if tx.Commit(ctx) != nil {
		fail(w, 503, "MESSAGE_UNCONFIRMED", "Retry with the same message ID.")
		return true
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.StatusCode)
	w.Write(raw)
	return true
}
func dispatchEvents() {
	for range time.Tick(time.Second) {
		func() {
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			defer cancel()
			tx, err := pool.Begin(ctx)
			if err != nil {
				return
			}
			defer tx.Rollback(ctx)
			var id, kind, aggregate string
			var payload json.RawMessage
			var created time.Time
			var attempts int
			err = tx.QueryRow(ctx, "SELECT id,type,aggregate_id,payload,created_at,attempts FROM outbox WHERE delivered_at IS NULL AND attempts<10 AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1").Scan(&id, &kind, &aggregate, &payload, &created, &attempts)
			if err != nil {
				return
			}
			var result map[string]any
			event := map[string]any{"id": id, "version": 1, "type": kind, "aggregateId": aggregate, "aggregateVersion": 1, "occurredAt": created, "correlationId": id, "payload": payload}
			err = internal(ctx, "communication", "/internal/events", "POST", "", event, &result)
			if err == nil {
				tx.Exec(ctx, "UPDATE outbox SET delivered_at=now(),last_error=NULL WHERE id=$1", id)
			} else {
				delay := time.Duration(1<<min(attempts, 8)) * time.Second
				tx.Exec(ctx, "UPDATE outbox SET attempts=attempts+1,last_error='consumer unavailable',next_attempt_at=$2 WHERE id=$1", id, time.Now().Add(delay))
			}
			tx.Commit(ctx)
		}()
	}
}
