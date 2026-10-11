package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("randomness unavailable")
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func pair(a, b string) (string, string) {
	if a < b {
		return a, b
	}
	return b, a
}

type Actor struct {
	ID               string `json:"id"`
	IdentityApproved bool   `json:"identityApproved"`
}
type Eligibility struct {
	IntroductionPolicy string `json:"introductionPolicy"`
	Eligible           bool   `json:"eligible"`
}
type Action struct {
	SuperLike    bool   `json:"superLike"`
	TargetID     string `json:"targetId"`
	Action       string `json:"action"`
	Introduction string `json:"introduction"`
	Content      string `json:"content"`
}

func eligible(ctx context.Context, id string) bool {
	var e Eligibility
	return internal(ctx, "profile-discovery", "/internal/eligibility?id="+id, "GET", "", nil, &e) == nil && e.Eligible
}
func routes(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/internal/blocks" {
		id := r.URL.Query().Get("id")
		if !uuidPattern.MatchString(id) {
			fail(w, 422, "INVALID_ID", "Invalid account.")
			return
		}
		rows, err := pool.Query(r.Context(), "SELECT CASE WHEN lo=$1 THEN hi ELSE lo END FROM relationships WHERE (lo=$1 OR hi=$1) AND (lo_block OR hi_block)", id)
		if err != nil {
			fail(w, 503, "SAFETY_UNAVAILABLE", "Safety check unavailable.")
			return
		}
		defer rows.Close()
		ids := []string{}
		for rows.Next() {
			var other string
			if rows.Scan(&other) != nil {
				fail(w, 503, "SAFETY_UNAVAILABLE", "Safety check unavailable.")
				return
			}
			ids = append(ids, other)
		}
		if rows.Err() != nil {
			fail(w, 503, "SAFETY_UNAVAILABLE", "Safety check unavailable.")
			return
		}
		reply(w, 200, map[string]any{"ids": ids})
		return
	}

	if r.URL.Path == "/internal/exclusions" {
		id := r.URL.Query().Get("id")
		if !uuidPattern.MatchString(id) {
			fail(w, 400, "INVALID_ID", "Invalid account.")
			return
		}
		rows, err := pool.Query(r.Context(), "SELECT lo,hi,lo_action,hi_action,lo_block,hi_block FROM relationships WHERE lo=$1 OR hi=$1", id)
		if err != nil {
			fail(w, 503, "RELATIONSHIPS_UNAVAILABLE", "Please retry.")
			return
		}
		defer rows.Close()
		excluded := []string{}
		for rows.Next() {
			var lo, hi, la, ha string
			var lb, hb bool
			if rows.Scan(&lo, &hi, &la, &ha, &lb, &hb) != nil {
				fail(w, 503, "SAFETY_UNAVAILABLE", "Safety check unavailable.")
				return
			}
			target, action := hi, la
			if id == hi {
				target, action = lo, ha
			}
			if lb || hb || action != "none" {
				excluded = append(excluded, target)
			}
		}
		if rows.Err() != nil {
			fail(w, 503, "SAFETY_UNAVAILABLE", "Safety check unavailable.")
			return
		}
		reply(w, 200, map[string]any{"ids": excluded})
		return
	}
	if r.URL.Path == "/internal/access" {
		a, b := r.URL.Query().Get("actor"), r.URL.Query().Get("target")
		if !uuidPattern.MatchString(a) || !uuidPattern.MatchString(b) {
			fail(w, 400, "INVALID_ID", "Invalid account.")
			return
		}
		lo, hi := pair(a, b)
		var blocked, matched bool
		err := pool.QueryRow(r.Context(), "SELECT coalesce((SELECT lo_block OR hi_block FROM relationships WHERE lo=$1 AND hi=$2),false),EXISTS(SELECT 1 FROM matches WHERE lo=$1 AND hi=$2 AND active)", lo, hi).Scan(&blocked, &matched)
		if err != nil {
			fail(w, 503, "RELATIONSHIPS_UNAVAILABLE", "Please retry.")
			return
		}
		reply(w, 200, map[string]bool{"blocked": blocked, "matched": matched})
		return
	}
	var a Actor
	if internal(r.Context(), "identity", "/internal/identity/me", "GET", r.Header.Get("Cookie"), nil, &a) != nil {
		fail(w, 401, "SESSION_REQUIRED", "Sign in again to continue.")
		return
	}
	if r.URL.Path == "/api/v1/connections/allowance" && r.Method == "GET" {
		allowance(w, r, a)
		return
	}
	if r.URL.Path == "/api/v1/connections" && r.Method == "GET" {
		if !a.IdentityApproved || !eligible(r.Context(), a.ID) {
			fail(w, 403, "DATING_INELIGIBLE", "Complete verification and profile first.")
			return
		}
		list(w, r, a)
		return
	}
	if r.URL.Path != "/api/v1/connections/action" || r.Method != "POST" {
		fail(w, 404, "NOT_FOUND", "This route does not exist.")
		return
	}
	var input Action
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF || !uuidPattern.MatchString(input.TargetID) || input.TargetID == a.ID || len([]rune(input.Introduction)) > 500 || !strings.Contains("|like|pass|undo|block|unblock|unmatch|", "|"+input.Action+"|") {
		fail(w, 422, "INVALID_ACTION", "Check the relationship action.")
		return
	}
	input.Introduction = strings.TrimSpace(input.Introduction)
	if input.Action != "like" && (input.SuperLike || input.Introduction != "") {
		fail(w, 422, "INVALID_ACTION", "Introductions and super likes require a like.")
		return
	}
	if input.Content == "" {
		input.Content = "profile"
	}
	if input.Content != "profile" && input.Content != "bio" && input.Content != "prompt" {
		fail(w, 422, "INVALID_CONTENT", "Choose a profile, bio or prompt.")
		return
	}
	if input.Action == "like" || input.Action == "pass" || input.Action == "undo" {
		if !a.IdentityApproved || !eligible(r.Context(), a.ID) || !eligible(r.Context(), input.TargetID) {
			fail(w, 403, "DATING_INELIGIBLE", "Both accounts must meet dating eligibility. Complete verification and your profile first.")
			return
		}
	}
	var benefits Entitlement
	if input.Action == "like" && (input.SuperLike || input.Introduction != "") {
		var err error
		benefits, err = entitlement(r.Context(), a.ID)
		if err != nil {
			fail(w, 503, "ENTITLEMENT_UNAVAILABLE", "Membership could not be checked. Please retry.")
			return
		}
	}
	lo, hi := pair(a.ID, input.TargetID)
	tx, err := pool.Begin(r.Context())
	if err != nil {
		fail(w, 503, "CONNECTION_UNAVAILABLE", "Please retry.")
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,7319))", a.ID); err != nil {
		fail(w, 503, "CONNECTION_UNAVAILABLE", "Please retry.")
		return
	}
	if _, err = tx.Exec(r.Context(), "INSERT INTO relationships(lo,hi) VALUES($1,$2) ON CONFLICT DO NOTHING", lo, hi); err != nil {
		fail(w, 503, "CONNECTION_UNAVAILABLE", "Please retry.")
		return
	}
	var la, ha, li, hintro, lc, hc string
	var lb, hb, ls, hs bool
	if tx.QueryRow(r.Context(), "SELECT lo_action,hi_action,lo_intro,hi_intro,lo_content,hi_content,lo_block,hi_block,lo_super,hi_super FROM relationships WHERE lo=$1 AND hi=$2 FOR UPDATE", lo, hi).Scan(&la, &ha, &li, &hintro, &lc, &hc, &lb, &hb, &ls, &hs) != nil {
		fail(w, 503, "CONNECTION_UNAVAILABLE", "Please retry.")
		return
	}
	mine, intro, content, blocked, super := &la, &li, &lc, &lb, &ls
	if a.ID == hi {
		mine, intro, content, blocked, super = &ha, &hintro, &hc, &hb, &hs
	}
	if (lb || hb) && input.Action != "block" && input.Action != "unblock" {
		fail(w, 403, "CONNECTION_UNAVAILABLE", "This connection is unavailable.")
		return
	}
	var matchID *string
	tx.QueryRow(r.Context(), "SELECT id FROM matches WHERE lo=$1 AND hi=$2 AND active", lo, hi).Scan(&matchID)
	switch input.Action {
	case "block":
		*blocked = true
	case "unblock":
		*blocked = false
	case "like":
		if input.Introduction != "" && matchID == nil {
			var recipient Eligibility
			if internal(r.Context(), "profile-discovery", "/internal/eligibility?id="+input.TargetID, "GET", "", nil, &recipient) != nil {
				fail(w, 503, "INTRODUCTION_PERMISSION_UNAVAILABLE", "Their introduction preference could not be checked. Please retry.")
				return
			}
			if !recipient.Eligible || recipient.IntroductionPolicy != "everyone" {
				fail(w, 403, "INTRODUCTION_NOT_ALLOWED", "This person accepts text only after matching. Send an interest without a message.")
				return
			}
		}
		if *intro != "" && input.Introduction != "" && *intro != input.Introduction {
			fail(w, 409, "INTRODUCTION_ALREADY_SENT", "An introduction was already sent to this person.")
			return
		}
		if input.SuperLike && !*super && benefits.Features.SuperLikes == 0 {
			fail(w, 429, "DAILY_ALLOWANCE_REACHED", "Super likes are unavailable on this plan. Check Membership.")
			return
		}
		for _, feature := range []struct {
			enabled bool
			name    string
			limit   int
		}{{input.SuperLike, "super_like", benefits.Features.SuperLikes}, {input.Introduction != "", "direct_introduction", benefits.Features.Introductions}} {
			if !feature.enabled {
				continue
			}
			allowed, err := consume(r.Context(), tx, a.ID, input.TargetID, feature.name, feature.limit)
			if err != nil {
				fail(w, 503, "ALLOWANCE_UNAVAILABLE", "Your action was not saved. Retry safely.")
				return
			}
			if !allowed {
				fail(w, 429, "DAILY_ALLOWANCE_REACHED", "Your daily allowance is used or unavailable on this plan. Check Membership; allowances reset at midnight IST.")
				return
			}
		}
		*super = *super || input.SuperLike
		*mine = "like"
		if input.Introduction != "" {
			*intro = input.Introduction
		}
		*content = input.Content
	case "pass":
		if matchID != nil {
			fail(w, 409, "MATCH_EXISTS", "Unmatch to end this connection.")
			return
		}
		*mine = "pass"
	case "undo":
		if *mine != "pass" || matchID != nil {
			fail(w, 409, "UNDO_UNAVAILABLE", "Only an unmatched pass can be undone.")
			return
		}
		*mine = "none"
	case "unmatch":
		la = "none"
		ha = "none"
	}
	if input.Action == "block" || input.Action == "unmatch" {
		if _, err = tx.Exec(r.Context(), "UPDATE matches SET active=false,ended_at=now() WHERE lo=$1 AND hi=$2 AND active", lo, hi); err != nil {
			fail(w, 503, "CONNECTION_UNAVAILABLE", "Please retry.")
			return
		}
		matchID = nil
		la = "none"
		ha = "none"
		ls = false
		hs = false
	}
	if _, err = tx.Exec(r.Context(), "UPDATE relationships SET lo_action=$3,hi_action=$4,lo_intro=$5,hi_intro=$6,lo_content=$7,hi_content=$8,lo_block=$9,hi_block=$10,lo_super=$11,hi_super=$12,updated_at=now() WHERE lo=$1 AND hi=$2", lo, hi, la, ha, li, hintro, lc, hc, lb, hb, ls, hs); err != nil {
		fail(w, 503, "CONNECTION_UNAVAILABLE", "Please retry.")
		return
	}
	if la == "like" && ha == "like" && !lb && !hb && matchID == nil {
		id := newID()
		if _, err = tx.Exec(r.Context(), "INSERT INTO matches(id,lo,hi) VALUES($1,$2,$3)", id, lo, hi); err != nil {
			fail(w, 503, "MATCH_FAILED", "Please retry.")
			return
		}
		matchID = &id
		payload, _ := json.Marshal(map[string]string{"matchId": id, "firstAccountId": lo, "secondAccountId": hi})
		if _, err = tx.Exec(r.Context(), "INSERT INTO outbox(id,type,aggregate_id,payload) VALUES($1,'connection.matched',$2,$3)", newID(), id, payload); err != nil {
			fail(w, 503, "MATCH_FAILED", "Please retry.")
			return
		}
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "CONNECTION_UNAVAILABLE", "Please retry.")
		return
	}
	reply(w, 200, map[string]any{"matched": matchID != nil, "matchId": matchID})
}
func list(w http.ResponseWriter, r *http.Request, a Actor) {
	incoming, sent, matches, blocked := []any{}, []any{}, []any{}, []any{}
	rows, err := pool.Query(r.Context(), "SELECT lo,hi,lo_action,hi_action,lo_intro,hi_intro,lo_block,hi_block,lo_super,hi_super FROM relationships WHERE lo=$1 OR hi=$1 ORDER BY updated_at DESC LIMIT 200", a.ID)
	if err != nil {
		fail(w, 503, "CONNECTIONS_UNAVAILABLE", "Please retry.")
		return
	}
	type relation struct {
		lo, hi, la, ha, li, hiIntro string
		lb, hb, ls, hs              bool
	}
	items := []relation{}
	for rows.Next() {
		var v relation
		rows.Scan(&v.lo, &v.hi, &v.la, &v.ha, &v.li, &v.hiIntro, &v.lb, &v.hb, &v.ls, &v.hs)
		items = append(items, v)
	}
	rows.Close()
	for _, v := range items {
		target, mine, theirs, intro, otherIntro, myBlock, mySuper, otherSuper := v.hi, v.la, v.ha, v.li, v.hiIntro, v.lb, v.ls, v.hs
		if a.ID == v.hi {
			target, mine, theirs, intro, otherIntro, myBlock, mySuper, otherSuper = v.lo, v.ha, v.la, v.hiIntro, v.li, v.hb, v.hs, v.ls
		}
		if myBlock {
			blocked = append(blocked, map[string]string{"id": target})
		}
		if v.lb || v.hb {
			continue
		}
		var card map[string]any
		if internal(r.Context(), "profile-discovery", "/internal/card?id="+target, "GET", "", nil, &card) != nil {
			continue
		}
		var id string
		var created time.Time
		isMatch := pool.QueryRow(r.Context(), "SELECT id,created_at FROM matches WHERE lo=$1 AND hi=$2 AND active", v.lo, v.hi).Scan(&id, &created) == nil
		if isMatch {
			matches = append(matches, map[string]any{"id": id, "person": card, "matchedAt": created})
			continue
		}
		if mine == "like" {
			sent = append(sent, map[string]any{"person": card, "introduction": intro, "superLike": mySuper})
		}
		if theirs == "like" && mine != "pass" {
			incoming = append(incoming, map[string]any{"person": card, "introduction": otherIntro, "superLike": otherSuper})
		}
	}
	reply(w, 200, map[string]any{"incoming": incoming, "sent": sent, "matches": matches, "blocked": blocked})
}
