package main

import "slices"

type Dealbreakers struct {
	Smoking  []string `json:"smoking"`
	Drinking []string `json:"drinking"`
	Children []string `json:"children"`
}

var habits = []string{"never", "sometimes", "regularly"}
var children = []string{"want", "do_not_want", "open"}
var hiddenFields = []string{"datingPace", "dateVibes", "openingQuestion", "age", "city", "gender", "pronouns", "languages", "bio", "prompt", "interests", "education", "lifestyle", "futurePlans", "communication", "boundaries", "smoking", "drinking", "children"}

func validSet(values, allowed []string) bool {
	if len(values) > len(allowed) {
		return false
	}
	seen := map[string]bool{}
	for _, v := range values {
		if !slices.Contains(allowed, v) || seen[v] {
			return false
		}
		seen[v] = true
	}
	return true
}
func validPreferences(p Profile) bool {
	return (p.Smoking == "" || slices.Contains(habits, p.Smoking)) && (p.Drinking == "" || slices.Contains(habits, p.Drinking)) && (p.Children == "" || slices.Contains(children, p.Children)) && validSet(p.HiddenFields, hiddenFields) && validSet(p.Dealbreakers.Smoking, habits) && validSet(p.Dealbreakers.Drinking, habits) && validSet(p.Dealbreakers.Children, children)
}
func acceptsAnswers(preferences Dealbreakers, other Profile) bool {
	accepts := func(allowed []string, answer string) bool {
		return len(allowed) == 0 || slices.Contains(allowed, answer)
	}
	return accepts(preferences.Smoking, other.Smoking) && accepts(preferences.Drinking, other.Drinking) && accepts(preferences.Children, other.Children)
}
func normalizeProfile(p Profile) Profile {
	if p.DateVibes == nil {
		p.DateVibes = []string{}
	}
	if p.IntroductionPolicy == "" {
		p.IntroductionPolicy = "everyone"
	}
	if p.HiddenFields == nil {
		p.HiddenFields = []string{}
	}
	if p.Languages == nil {
		p.Languages = []string{}
	}
	if p.Interests == nil {
		p.Interests = []string{}
	}
	if p.Dealbreakers.Smoking == nil {
		p.Dealbreakers.Smoking = []string{}
	}
	if p.Dealbreakers.Drinking == nil {
		p.Dealbreakers.Drinking = []string{}
	}
	if p.Dealbreakers.Children == nil {
		p.Dealbreakers.Children = []string{}
	}
	return p
}

// One projection for preview and every cross-service candidate card.
func visibleProfile(raw Profile) Profile {
	p := normalizeProfile(raw)
	if !p.ShowWork {
		p.Work = ""
	}
	if !p.ShowHeight {
		p.HeightCm = 0
	}
	strings := map[string]*string{"datingPace": &p.DatingPace, "openingQuestion": &p.OpeningQuestion, "city": &p.City, "gender": &p.Gender, "pronouns": &p.Pronouns, "bio": &p.Bio, "prompt": &p.Prompt, "education": &p.Education, "lifestyle": &p.Lifestyle, "futurePlans": &p.FuturePlans, "communication": &p.Communication, "boundaries": &p.Boundaries, "smoking": &p.Smoking, "drinking": &p.Drinking, "children": &p.Children}
	for _, field := range p.HiddenFields {
		if field == "dateVibes" {
			p.DateVibes = []string{}
		}
		if v, ok := strings[field]; ok {
			*v = ""
		}
		if field == "languages" {
			p.Languages = []string{}
		}
		if field == "interests" {
			p.Interests = []string{}
		}
	}
	return p
}
