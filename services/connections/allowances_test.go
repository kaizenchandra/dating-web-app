package main

import (
	"testing"
	"time"
)

func TestAllowanceResetsAtISTMidnight(t *testing.T) {
	before, _ := time.Parse(time.RFC3339, "2026-10-11T18:29:59Z")
	start, end := allowanceWindow(before)
	if start.UTC().Format(time.RFC3339) != "2026-10-10T18:30:00Z" || end.UTC().Format(time.RFC3339) != "2026-10-11T18:30:00Z" {
		t.Fatal("wrong IST boundary", start, end)
	}
	next, _ := allowanceWindow(before.Add(time.Second))
	if !next.Equal(end) {
		t.Fatal("allowance did not roll over")
	}
}
