package main

import (
	"math"
	"testing"
)

func TestCityDistancePrivacyAndSymmetry(t *testing.T) {
	if cityDistance("Unknown locality", "Mumbai") != nil {
		t.Fatal("unknown city must never invent distance")
	}
	same := cityDistance("Bengaluru", "Bangalore")
	if same == nil || *same != 0 {
		t.Fatal("city alias must resolve to the same centroid")
	}
	forward, reverse := cityDistance("Bengaluru", "Mumbai"), cityDistance("Mumbai", "Bengaluru")
	if forward == nil || reverse == nil || *forward < 800 || *forward > 900 || math.Abs(*forward-*reverse) > 0.0001 {
		t.Fatal("great-circle distance or symmetry invalid")
	}
}
