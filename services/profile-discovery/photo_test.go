package main

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
)

func TestImageValidationAndReencoding(t *testing.T) {
	if _, err := processPhoto([]byte("not an image")); err == nil {
		t.Fatal("invalid image accepted")
	}
	img := image.NewRGBA(image.Rect(0, 0, 200, 200))
	img.Set(0, 0, color.White)
	var b bytes.Buffer
	jpeg.Encode(&b, img, nil)
	raw := append(b.Bytes(), []byte("private-trailing-metadata")...)
	clean, err := processPhoto(raw)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(clean, []byte("private-trailing-metadata")) {
		t.Fatal("metadata retained")
	}
}
func TestAgeAndHeightPreferences(t *testing.T) {
	p := Profile{DisplayName: "Asha", MinAge: 18, MaxAge: 40, HeightCm: 165}
	if !validProfile(p) {
		t.Fatal("valid profile rejected")
	}
	p.MinAge = 17
	if validProfile(p) {
		t.Fatal("underage preference accepted")
	}
	p.MinAge = 50
	if validProfile(p) {
		t.Fatal("inverted age range accepted")
	}
}
