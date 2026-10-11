package main

import (
	"encoding/json"
	"github.com/minio/minio-go/v7"
	"io"
	"net/http"
	"slices"
	"strings"
)

type Profile struct {
	DatingPace         string       `json:"datingPace"`
	DateVibes          []string     `json:"dateVibes"`
	OpeningQuestion    string       `json:"openingQuestion"`
	IntroductionPolicy string       `json:"introductionPolicy"`
	Smoking            string       `json:"smoking"`
	Drinking           string       `json:"drinking"`
	Children           string       `json:"children"`
	HiddenFields       []string     `json:"hiddenFields"`
	Dealbreakers       Dealbreakers `json:"dealbreakers"`
	DisplayName        string       `json:"displayName"`
	Gender             string       `json:"gender"`
	Pronouns           string       `json:"pronouns"`
	City               string       `json:"city"`
	Languages          []string     `json:"languages"`
	Intent             string       `json:"intent"`
	Bio                string       `json:"bio"`
	Prompt             string       `json:"prompt"`
	Interests          []string     `json:"interests"`
	HeightCm           int          `json:"heightCm"`
	Work               string       `json:"work"`
	Education          string       `json:"education"`
	Lifestyle          string       `json:"lifestyle"`
	FuturePlans        string       `json:"futurePlans"`
	Communication      string       `json:"communication"`
	Boundaries         string       `json:"boundaries"`
	ShowWork           bool         `json:"showWork"`
	ShowHeight         bool         `json:"showHeight"`
	MinAge             int          `json:"minAge"`
	MaxAge             int          `json:"maxAge"`
	PreferredGender    string       `json:"preferredGender"`
	LongDistance       bool         `json:"longDistance"`
	Incognito          bool         `json:"incognito"`
}

func validProfile(p Profile) bool {
	if !validPreferences(p) || !validConnectionStyle(p) {
		return false
	}
	if len([]rune(strings.TrimSpace(p.DisplayName))) < 2 || !bounded(p.DisplayName, 60) || !bounded(p.Bio, 1000) || !bounded(p.Prompt, 500) || p.HeightCm < 100 || p.HeightCm > 250 || p.MinAge < 18 || p.MaxAge > 100 || p.MinAge > p.MaxAge || len(p.Languages) > 10 || len(p.Interests) > 15 {
		return false
	}
	for _, s := range []string{p.Gender, p.Pronouns, p.City, p.Intent, p.Work, p.Education, p.Lifestyle, p.FuturePlans, p.Communication, p.Boundaries, p.PreferredGender} {
		if !bounded(s, 200) {
			return false
		}
	}
	for _, s := range append(append([]string{}, p.Languages...), p.Interests...) {
		if !bounded(s, 40) {
			return false
		}
	}
	return true
}
func ensureProfile(r *http.Request, a Identity) error {
	p := Profile{DisplayName: a.DisplayName, Languages: []string{}, Interests: []string{}, HeightCm: 165, MinAge: 18, MaxAge: 40, ShowHeight: true}
	data, _ := json.Marshal(normalizeProfile(p))
	_, err := pool.Exec(r.Context(), "INSERT INTO profiles(account_id,data) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING", a.ID, data)
	return err
}
func profileResponse(w http.ResponseWriter, r *http.Request, a Identity, preview bool) {
	var data []byte
	var status, source string
	err := pool.QueryRow(r.Context(), "SELECT data,photo_status,photo_source FROM profiles WHERE account_id=$1", a.ID).Scan(&data, &status, &source)
	if err != nil {
		fail(w, 503, "PROFILE_UNAVAILABLE", "Your profile could not be loaded.")
		return
	}
	var p Profile
	if json.Unmarshal(data, &p) != nil {
		fail(w, 503, "PROFILE_UNAVAILABLE", "Your profile could not be loaded.")
		return
	}
	p = normalizeProfile(p)
	age := a.AgeYears
	if preview && slices.Contains(p.HiddenFields, "age") {
		age = nil
	}
	if preview {
		p = visibleProfile(p)
	}

	reply(w, 200, map[string]any{"profile": p, "photo": map[string]string{"status": status, "source": source}, "ageYears": age, "eligible": a.IdentityApproved && status == "approved" && (osLocal() || source != "local")})
}
func profileRoutes(w http.ResponseWriter, r *http.Request, a Identity, local bool) {
	if ensureProfile(r, a) != nil {
		fail(w, 503, "PROFILE_UNAVAILABLE", "Your profile is temporarily unavailable.")
		return
	}
	switch r.URL.Path {
	case "/api/v1/profile", "/api/v1/profile/preview":
		if r.Method == "GET" {
			profileResponse(w, r, a, r.URL.Path == "/api/v1/profile/preview")
			return
		}
		if r.Method == "PUT" && r.URL.Path == "/api/v1/profile" {
			var p Profile
			if !decode(w, r, &p) {
				return
			}
			if !validProfile(p) {
				fail(w, 422, "INVALID_PROFILE", "Check your profile fields, age range and height.")
				return
			}
			data, _ := json.Marshal(normalizeProfile(p))
			if _, err := pool.Exec(r.Context(), "UPDATE profiles SET data=$1,updated_at=now() WHERE account_id=$2", data, a.ID); err != nil {
				fail(w, 503, "SAVE_FAILED", "Your changes could not be saved. Please retry.")
				return
			}
			profileResponse(w, r, a, false)
			return
		}
	case "/api/v1/profile/capture":
		if r.Method == "POST" {
			createCapture(w, r, a)
			return
		}
	case "/api/v1/profile/photo":
		if r.Method == "POST" {
			submitPhoto(w, r, a)
			return
		}
		if r.Method == "GET" {
			var key *string
			if err := pool.QueryRow(r.Context(), "SELECT photo_key FROM profiles WHERE account_id=$1", a.ID).Scan(&key); err != nil || key == nil {
				fail(w, 404, "PHOTO_MISSING", "Capture a photo first.")
				return
			}
			object, err := store.GetObject(r.Context(), bucket, *key, minio.GetObjectOptions{})
			if err != nil {
				fail(w, 503, "PHOTO_UNAVAILABLE", "Photo temporarily unavailable.")
				return
			}
			defer object.Close()
			if _, err = object.Stat(); err != nil {
				fail(w, 503, "PHOTO_UNAVAILABLE", "Photo temporarily unavailable.")
				return
			}
			w.Header().Set("Content-Type", "image/jpeg")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			io.Copy(w, object)
			return
		}
	case "/api/v1/profile/photo/local-decision":
		if r.Method == "POST" {
			if !local {
				fail(w, 403, "SIMULATOR_FORBIDDEN", "Local simulation is disabled.")
				return
			}
			var input struct {
				Decision string `json:"decision"`
			}
			if !decode(w, r, &input) {
				return
			}
			if input.Decision != "approved" && input.Decision != "rejected" {
				fail(w, 422, "INVALID_DECISION", "Choose approve or reject.")
				return
			}
			changed, err := decidePhoto(r.Context(), a.ID, input.Decision)
			if err != nil {
				fail(w, 503, "REVIEW_FAILED", "Review could not be saved.")
				return
			}
			if !changed {
				fail(w, 409, "PHOTO_NOT_PENDING", "Capture a photo before review.")
				return
			}
			profileResponse(w, r, a, false)
			return
		}
	}
	fail(w, 404, "NOT_FOUND", "This route does not exist.")
}
