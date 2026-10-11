package main

import "testing"

func TestConnectionStyleValidationAndVisibility(t *testing.T) {
	p := Profile{DatingPace: "slow_and_steady", DateVibes: []string{"chai_coffee", "video_first"}, OpeningQuestion: "What are you reading?", IntroductionPolicy: "matches_only"}
	if !validConnectionStyle(p) {
		t.Fatal("valid style rejected")
	}
	for _, bad := range []Profile{{DatingPace: "unknown"}, {IntroductionPolicy: "all"}, {DateVibes: []string{"chai_coffee", "chai_coffee"}}, {DateVibes: []string{"chai_coffee", "food_walk", "games", "outdoors"}}} {
		if validConnectionStyle(bad) {
			t.Fatal("invalid style accepted")
		}
	}
	p.HiddenFields = []string{"datingPace", "dateVibes", "openingQuestion"}
	public := visibleProfile(p)
	if public.DatingPace != "" || public.OpeningQuestion != "" || len(public.DateVibes) != 0 || public.IntroductionPolicy != "matches_only" {
		t.Fatal("projection leaked hidden answers or lost consent policy")
	}
	if matchesStyle(Candidate{DatingPace: public.DatingPace, DateVibes: public.DateVibes}, "slow_and_steady", "") {
		t.Fatal("hidden style affected public filter")
	}
	if !matchesStyle(Candidate{DatingPace: "slow_and_steady", DateVibes: []string{"video_first"}}, "slow_and_steady", "video_first") {
		t.Fatal("matching style excluded")
	}
	if normalizeProfile(Profile{}).IntroductionPolicy != "everyone" {
		t.Fatal("legacy defaults changed")
	}
}
