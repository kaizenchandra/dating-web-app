package main

import "testing"

func TestMediaOwner(t *testing.T) {
	owner := "10cc11a3-6c76-48da-a98e-690491225823"
	key := owner + "/a195fb4d-54b7-40ba-a12b-d95e6b537bb4.jpg"
	if got, ok := mediaOwner(key); !ok || got != owner {
		t.Fatal("canonical camera key rejected")
	}
	for _, bad := range []string{"../photo.jpg", owner + "/../../other.jpg", owner + "/photo.jpg", key + "/extra", "other/" + key} {
		if _, ok := mediaOwner(bad); ok {
			t.Fatal("unsafe key accepted", bad)
		}
	}
}
