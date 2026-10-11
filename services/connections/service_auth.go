package main

import (
	"encoding/json"
	"os"
)

func serviceToken(service string) string {
	var tokens map[string]string
	if json.Unmarshal([]byte(os.Getenv("SERVICE_TOKENS")), &tokens) != nil {
		return ""
	}
	token := tokens[service]
	if len(token) < 32 {
		return ""
	}
	return token
}
