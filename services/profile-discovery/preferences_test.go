package main

import "testing"

func TestPrivateAnswersAndDealbreakers(t *testing.T) {
	p := Profile{Gender: "Woman", Smoking: "never", Interests: []string{"Books"}, Work: "Writer", Education: "University", HiddenFields: []string{"smoking", "education", "interests", "gender"}}
	public := visibleProfile(p)
	if public.Smoking != "" || public.Education != "" || public.Gender != "" || public.Work != "" || len(public.Interests) != 0 {
		t.Fatal("private fields leaked")
	}
	if p.Smoking != "never" || len(p.Interests) != 1 {
		t.Fatal("visibility mutated private preferences")
	}
	onlyNever := Dealbreakers{Smoking: []string{"never"}}
	if !acceptsAnswers(onlyNever, p) || acceptsAnswers(onlyNever, Profile{}) || acceptsAnswers(onlyNever, Profile{Smoking: "regularly"}) {
		t.Fatal("dealbreaker ignored unknown or incompatible answer")
	}
	if !acceptsAnswers(Dealbreakers{}, Profile{}) {
		t.Fatal("empty dealbreaker is restrictive")
	}
	if validPreferences(Profile{HiddenFields: []string{"phone"}}) || validPreferences(Profile{Dealbreakers: Dealbreakers{Smoking: []string{"never", "never"}}}) {
		t.Fatal("invalid preference accepted")
	}
}

func TestLocationProjectionRetainsPrivatePreference(t *testing.T) {
	p := Profile{City: "Panaji", HiddenFields: []string{"age", "city"}}
	if !validPreferences(p) {
		t.Fatal("privacy settings rejected")
	}
	public := visibleProfile(p)
	if public.City != "" || p.City != "Panaji" {
		t.Fatal("city privacy projection is not isolated")
	}
}
