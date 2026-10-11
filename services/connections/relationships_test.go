package main

import "testing"

func TestCanonicalPair(t *testing.T) {
	a, b := pair("b", "a")
	c, d := pair("a", "b")
	if a != c || b != d || a != "a" {
		t.Fatal("pair ordering differs")
	}
	for i := 0; i < 100; i++ {
		if !uuidPattern.MatchString(newID()) {
			t.Fatal("invalid generated id")
		}
	}
}
