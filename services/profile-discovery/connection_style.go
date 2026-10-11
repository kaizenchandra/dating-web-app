package main

import "slices"

var datingPaces = []string{"slow_and_steady", "chat_then_meet", "meet_soon"}
var dateVibes = []string{"chai_coffee", "food_walk", "arts_culture", "outdoors", "games", "video_first"}

func validConnectionStyle(p Profile) bool {
	return (p.DatingPace == "" || slices.Contains(datingPaces, p.DatingPace)) && len(p.DateVibes) <= 3 && validSet(p.DateVibes, dateVibes) && bounded(p.OpeningQuestion, 180) && (p.IntroductionPolicy == "" || p.IntroductionPolicy == "everyone" || p.IntroductionPolicy == "matches_only")
}
func matchesStyle(p Candidate, pace, vibe string) bool {
	return (pace == "" || p.DatingPace == pace) && (vibe == "" || slices.Contains(p.DateVibes, vibe))
}
