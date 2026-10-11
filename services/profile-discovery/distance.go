package main

import (
	"embed"
	"encoding/json"
	"math"
	"strings"
)

//go:embed data/india-cities.json
var cityData embed.FS
var cityCoordinates = func() map[string][2]float64 {
	data, err := cityData.ReadFile("data/india-cities.json")
	if err != nil {
		panic("City dataset unavailable")
	}
	var cities map[string][2]float64
	if json.Unmarshal(data, &cities) != nil {
		panic("City dataset invalid")
	}
	return cities
}()

func cityDistance(a, b string) *float64 {
	first, ok := cityCoordinates[strings.ToLower(strings.TrimSpace(a))]
	if !ok {
		return nil
	}
	second, ok := cityCoordinates[strings.ToLower(strings.TrimSpace(b))]
	if !ok {
		return nil
	}
	rad := math.Pi / 180
	lat1, lat2 := first[0]*rad, second[0]*rad
	dlat := (second[0] - first[0]) * rad
	dlon := (second[1] - first[1]) * rad
	h := math.Pow(math.Sin(dlat/2), 2) + math.Cos(lat1)*math.Cos(lat2)*math.Pow(math.Sin(dlon/2), 2)
	distance := 6371 * 2 * math.Atan2(math.Sqrt(h), math.Sqrt(math.Max(0, 1-h)))
	return &distance
}
