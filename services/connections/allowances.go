package main

import (
	"context"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

type Benefits struct {
	SuperLikes    int  `json:"superLikesPerDay"`
	Introductions int  `json:"directIntroductionsPerDay"`
	HideAge       bool `json:"hideAge"`
	HideLocation  bool `json:"hideLocation"`
}
type Entitlement struct {
	Tier     *string  `json:"tier"`
	Features Benefits `json:"features"`
}

var ist = time.FixedZone("Asia/Kolkata", 19800)

func allowanceWindow(now time.Time) (time.Time, time.Time) {
	local := now.In(ist)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, ist)
	return start, start.AddDate(0, 0, 1)
}
func entitlement(ctx context.Context, id string) (Entitlement, error) {
	var e Entitlement
	err := internal(ctx, "commerce-operations", "/internal/entitlement?accountId="+id, "GET", "", nil, &e)
	return e, err
}
func allowance(w http.ResponseWriter, r *http.Request, a Actor) {
	e, err := entitlement(r.Context(), a.ID)
	if err != nil {
		fail(w, 503, "ENTITLEMENT_UNAVAILABLE", "Membership could not be checked. Please retry.")
		return
	}
	start, end := allowanceWindow(time.Now())
	var likes, intros int
	err = pool.QueryRow(r.Context(), "SELECT count(*) FILTER (WHERE feature='super_like'),count(*) FILTER (WHERE feature='direct_introduction') FROM connection_usage WHERE account_id=$1 AND used_at >= $2 AND used_at < $3", a.ID, start, end).Scan(&likes, &intros)
	if err != nil {
		fail(w, 503, "ALLOWANCE_UNAVAILABLE", "Usage could not be checked. Please retry.")
		return
	}
	reply(w, 200, map[string]any{"tier": e.Tier, "features": e.Features, "superLikesUsed": likes, "directIntroductionsUsed": intros, "resetsAt": end})
}

// Caller holds the sender advisory lock and pair row lock. Usage and relationship
// mutation commit together. A recipient can receive each premium action only once.
func consume(ctx context.Context, tx pgx.Tx, actor, target, feature string, limit int) (bool, error) {
	var exists bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM connection_usage WHERE account_id=$1 AND target_id=$2 AND feature=$3)", actor, target, feature).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return true, nil
	}
	start, end := allowanceWindow(time.Now())
	var count int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM connection_usage WHERE account_id=$1 AND feature=$2 AND used_at >= $3 AND used_at < $4", actor, feature, start, end).Scan(&count); err != nil {
		return false, err
	}
	if count >= limit {
		return false, nil
	}
	_, err := tx.Exec(ctx, "INSERT INTO connection_usage(account_id,target_id,feature) VALUES($1,$2,$3)", actor, target, feature)
	return err == nil, err
}
