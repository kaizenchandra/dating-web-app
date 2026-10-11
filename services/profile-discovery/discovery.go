package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"io"
	"math"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"
)

type Candidate struct {
	DatingPace            string   `json:"datingPace"`
	DateVibes             []string `json:"dateVibes"`
	OpeningQuestion       string   `json:"openingQuestion"`
	IntroductionPolicy    string   `json:"introductionPolicy"`
	actualAge             int
	Smoking               string   `json:"smoking"`
	Drinking              string   `json:"drinking"`
	Children              string   `json:"children"`
	ApproximateDistanceKm *int     `json:"approximateDistanceKm"`
	SharedInterests       []string `json:"sharedInterests"`
	ID                    string   `json:"id"`
	DisplayName           string   `json:"displayName"`
	Age                   *int     `json:"age"`
	Gender                string   `json:"gender"`
	Pronouns              string   `json:"pronouns"`
	City                  string   `json:"city"`
	Languages             []string `json:"languages"`
	Intent                string   `json:"intent"`
	Bio                   string   `json:"bio"`
	Prompt                string   `json:"prompt"`
	Interests             []string `json:"interests"`
	HeightCm              int      `json:"heightCm"`
	Work                  string   `json:"work"`
	Education             string   `json:"education"`
	Lifestyle             string   `json:"lifestyle"`
	FuturePlans           string   `json:"futurePlans"`
	Communication         string   `json:"communication"`
	Boundaries            string   `json:"boundaries"`
	VerificationSource    string   `json:"verificationSource"`
}

func serviceCall(ctx context.Context, service, path, method string, data, out any) bool {
	var b io.Reader
	if data != nil {
		raw, _ := json.Marshal(data)
		b = bytes.NewReader(raw)
	}
	r, _ := http.NewRequestWithContext(ctx, method, "http://"+service+":4000"+path, b)
	r.Header.Set("Authorization", "Bearer "+serviceToken(service))
	r.Header.Set("Content-Type", "application/json")
	response, err := internalClient.Do(r)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode == 200 && json.NewDecoder(response.Body).Decode(out) == nil
}
func authoritative(ctx context.Context, id string) (Identity, bool) {
	var result struct {
		Accounts []Identity `json:"accounts"`
	}
	if !serviceCall(ctx, "identity", "/internal/eligibility", "POST", map[string]any{"ids": []string{id}}, &result) || len(result.Accounts) != 1 {
		return Identity{}, false
	}
	return result.Accounts[0], true
}
func loadCandidate(ctx context.Context, id string) (Candidate, Profile, string, bool) {
	var p Profile
	var raw []byte
	var status, source string
	var key *string
	if pool.QueryRow(ctx, "SELECT data,photo_status,photo_source,photo_key FROM profiles WHERE account_id=$1", id).Scan(&raw, &status, &source, &key) != nil || json.Unmarshal(raw, &p) != nil {
		return Candidate{}, p, "", false
	}
	a, ok := authoritative(ctx, id)
	if !ok || !a.IdentityApproved || a.AgeYears == nil || status != "approved" || key == nil || (!osLocal() && source == "local") || p.City == "" || p.Gender == "" || p.Intent == "" {
		return Candidate{}, p, "", false
	}
	visible := visibleProfile(p)
	c := Candidate{ID: id, DisplayName: visible.DisplayName, Age: a.AgeYears, actualAge: *a.AgeYears, Gender: visible.Gender, Pronouns: visible.Pronouns, City: visible.City, Languages: visible.Languages, Intent: visible.Intent, Bio: visible.Bio, Prompt: visible.Prompt, Interests: visible.Interests, Education: visible.Education, Lifestyle: visible.Lifestyle, FuturePlans: visible.FuturePlans, Communication: visible.Communication, Boundaries: visible.Boundaries, VerificationSource: a.VerificationSource}
	if slices.Contains(p.HiddenFields, "age") {
		c.Age = nil
	}
	c.DatingPace = visible.DatingPace
	c.DateVibes = visible.DateVibes
	c.OpeningQuestion = visible.OpeningQuestion
	c.IntroductionPolicy = visible.IntroductionPolicy
	c.HeightCm = visible.HeightCm
	c.Work = visible.Work
	c.Smoking = visible.Smoking
	c.Drinking = visible.Drinking
	c.Children = visible.Children

	return c, p, *key, true
}
func internalDiscovery(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/internal/eligibility" && r.URL.Path != "/internal/card" {
		return false
	}
	id := r.URL.Query().Get("id")
	if _, err := uuid.Parse(id); err != nil {
		fail(w, 400, "INVALID_ID", "Invalid account.")
		return true
	}
	card, _, _, ok := loadCandidate(r.Context(), id)
	if r.URL.Path == "/internal/eligibility" {
		reply(w, 200, map[string]any{"eligible": ok, "introductionPolicy": card.IntroductionPolicy})
		return true
	}
	if !ok {
		fail(w, 403, "INELIGIBLE", "This profile is unavailable.")
		return true
	}
	reply(w, 200, card)
	return true
}
func preference(gender, preference string) bool {
	return preference == "" || strings.EqualFold(preference, "any") || strings.EqualFold(gender, preference)
}
func discoveryRoutes(w http.ResponseWriter, r *http.Request, a Identity) bool {
	if r.URL.Path != "/api/v1/discovery" && r.URL.Path != "/api/v1/discovery/photo" {
		return false
	}
	if r.Method != "GET" {
		fail(w, 405, "METHOD_NOT_ALLOWED", "Use GET.")
		return true
	}
	mine, preferences, _, ok := loadCandidate(r.Context(), a.ID)
	if !ok {
		fail(w, 403, "DATING_INELIGIBLE", "Complete age, identity and photo review, then save your city, gender and intention.")
		return true
	}
	if r.URL.Path == "/api/v1/discovery/photo" {
		id := r.URL.Query().Get("id")
		if _, err := uuid.Parse(id); err != nil {
			fail(w, 400, "INVALID_ID", "Invalid profile.")
			return true
		}
		var access struct {
			Blocked bool `json:"blocked"`
			Matched bool `json:"matched"`
		}
		if !serviceCall(r.Context(), "connections", "/internal/access?actor="+a.ID+"&target="+id, "GET", nil, &access) {
			fail(w, 503, "SAFETY_UNAVAILABLE", "Profile access could not be checked.")
			return true
		}
		_, p, key, eligible := loadCandidate(r.Context(), id)
		if !eligible || access.Blocked || (p.Incognito && !access.Matched) {
			fail(w, 404, "PROFILE_UNAVAILABLE", "This photo is unavailable.")
			return true
		}
		object, err := store.GetObject(r.Context(), bucket, key, minio.GetObjectOptions{})
		if err != nil {
			fail(w, 503, "PHOTO_UNAVAILABLE", "Please retry.")
			return true
		}
		defer object.Close()
		if _, err = object.Stat(); err != nil {
			fail(w, 503, "PHOTO_UNAVAILABLE", "Please retry.")
			return true
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		io.Copy(w, object)
		return true
	}
	var exclusions struct {
		IDs []string `json:"ids"`
	}
	if !serviceCall(r.Context(), "connections", "/internal/exclusions?id="+a.ID, "GET", nil, &exclusions) {
		fail(w, 503, "SAFETY_UNAVAILABLE", "Discovery is unavailable until relationship permissions can be checked.")
		return true
	}
	excluded := map[string]bool{a.ID: true}
	for _, id := range exclusions.IDs {
		excluded[id] = true
	}
	query := r.URL.Query()
	if (query.Get("datingPace") != "" && !slices.Contains(datingPaces, query.Get("datingPace"))) || (query.Get("dateVibe") != "" && !slices.Contains(dateVibes, query.Get("dateVibe"))) {
		fail(w, 422, "INVALID_STYLE_FILTER", "Choose an available dating pace or date preference.")
		return true
	}
	ranking := query.Get("ranking")
	if ranking == "" && query.Get("curated") == "1" {
		ranking = "interests"
	}
	if ranking != "" && ranking != "interests" && ranking != "intent" && ranking != "city" {
		fail(w, 422, "INVALID_RANKING", "Choose an available discovery order.")
		return true
	}
	if ranking != "" {
		var entitlement struct {
			Active bool     `json:"active"`
			Modes  []string `json:"discoveryModes"`
		}
		if !serviceCall(r.Context(), "commerce-operations", "/internal/entitlement?accountId="+a.ID, "GET", nil, &entitlement) {
			fail(w, 503, "ENTITLEMENT_UNAVAILABLE", "Membership could not be checked.")
			return true
		}
		allowed := false
		for _, mode := range entitlement.Modes {
			if mode == ranking {
				allowed = true
			}
		}
		if !entitlement.Active || !allowed {
			fail(w, 403, "MEMBERSHIP_REQUIRED", "Your membership does not include this discovery order.")
			return true
		}
	}
	maxDistance := 0
	if value := query.Get("maxDistanceKm"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 10 || n > 3000 {
			fail(w, 422, "INVALID_DISTANCE", "Choose a radius between 10 and 3000 km.")
			return true
		}
		if cityDistance(preferences.City, preferences.City) == nil {
			fail(w, 422, "CITY_DISTANCE_UNAVAILABLE", "Your profile city is not in the city-distance dataset. Edit your city or clear the distance filter.")
			return true
		}
		maxDistance = n
	}
	cursor := query.Get("cursor")
	if cursor == "" {
		cursor = "00000000-0000-0000-0000-000000000000"
	}
	if _, err := uuid.Parse(cursor); err != nil {
		fail(w, 422, "INVALID_CURSOR", "Refresh discovery to start again.")
		return true
	}
	minAge, maxAge := preferences.MinAge, preferences.MaxAge
	if v := query.Get("minAge"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 18 || n > 100 {
			fail(w, 422, "INVALID_FILTER", "Age must be between 18 and 100.")
			return true
		}
		minAge = n
	}
	if v := query.Get("maxAge"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 18 || n > 100 {
			fail(w, 422, "INVALID_FILTER", "Age must be between 18 and 100.")
			return true
		}
		maxAge = n
	}
	if minAge > maxAge {
		fail(w, 422, "INVALID_FILTER", "Minimum age must not exceed maximum age.")
		return true
	}
	rows, err := pool.Query(r.Context(), "SELECT account_id FROM profiles WHERE account_id>$1::uuid AND photo_status='approved' AND coalesce((data->>'incognito')::boolean,false)=false AND NOT EXISTS (SELECT 1 FROM discovery_feedback f WHERE f.account_id=$2 AND f.target_id=profiles.account_id) ORDER BY account_id LIMIT 40", cursor, a.ID)
	if err != nil {
		fail(w, 503, "DISCOVERY_UNAVAILABLE", "Please retry.")
		return true
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) != nil {
			rows.Close()
			fail(w, 503, "DISCOVERY_UNAVAILABLE", "Please retry.")
			return true
		}
		ids = append(ids, id)
	}
	rows.Close()
	if rows.Err() != nil {
		fail(w, 503, "DISCOVERY_UNAVAILABLE", "Please retry.")
		return true
	}
	items := []Candidate{}
	var next *string
	for i, id := range ids {
		if i == len(ids)-1 && len(ids) == 40 {
			copy := id
			next = &copy
		}
		if excluded[id] {
			continue
		}
		person, p, _, ok := loadCandidate(r.Context(), id)
		if !ok {
			continue
		}
		if person.actualAge < minAge || person.actualAge > maxAge || mine.actualAge < p.MinAge || mine.actualAge > p.MaxAge || !preference(p.Gender, preferences.PreferredGender) || !preference(preferences.Gender, p.PreferredGender) {
			continue
		}
		if !matchesStyle(person, query.Get("datingPace"), query.Get("dateVibe")) {
			continue
		}
		if !acceptsAnswers(preferences.Dealbreakers, p) || !acceptsAnswers(p.Dealbreakers, preferences) {
			continue
		}
		if query.Get("city") != "" && !strings.EqualFold(p.City, query.Get("city")) {
			continue
		}
		if query.Get("city") == "" && !preferences.LongDistance && !strings.EqualFold(preferences.City, p.City) {
			continue
		}
		if !p.LongDistance && !strings.EqualFold(preferences.City, p.City) {
			continue
		}
		if query.Get("intent") != "" && !strings.EqualFold(person.Intent, query.Get("intent")) {
			continue
		}
		distance := cityDistance(preferences.City, p.City)
		if maxDistance > 0 && (distance == nil || *distance > float64(maxDistance)) {
			continue
		}
		if distance != nil && !slices.Contains(p.HiddenFields, "city") && !slices.Contains(preferences.HiddenFields, "city") {
			rounded := int(math.Round(*distance/10) * 10)
			person.ApproximateDistanceKm = &rounded
		}
		person.SharedInterests = []string{}
		for _, x := range mine.Interests {
			for _, y := range person.Interests {
				if strings.TrimSpace(x) != "" && strings.EqualFold(x, y) {
					person.SharedInterests = append(person.SharedInterests, x)
					break
				}
			}
		}
		items = append(items, person)
		if len(items) == 12 {
			copy := id
			next = &copy
			break
		}
	}
	if ranking != "" {
		score := func(p Candidate) int {
			n := 0
			if ranking == "intent" && mine.Intent != "" && strings.EqualFold(mine.Intent, p.Intent) {
				n += 1000
			}
			if ranking == "city" && mine.City != "" && strings.EqualFold(mine.City, p.City) {
				n += 1000
			}
			for _, x := range mine.Interests {
				for _, y := range p.Interests {
					if strings.EqualFold(x, y) {
						n++
						break
					}
				}
			}
			return n
		}
		sort.SliceStable(items, func(i, j int) bool { return score(items[i]) > score(items[j]) })
	}
	reply(w, 200, map[string]any{"items": items, "nextCursor": next})
	return true
}
