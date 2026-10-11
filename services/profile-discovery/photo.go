package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
)

func osLocal() bool { return os.Getenv("APP_ENV") == "local" }
func createCapture(w http.ResponseWriter, r *http.Request, a Identity) {
	var count int
	if err := pool.QueryRow(r.Context(), "SELECT count(*) FROM capture_sessions WHERE account_id=$1 AND expires_at>now()", a.ID).Scan(&count); err != nil {
		fail(w, 503, "CAPTURE_UNAVAILABLE", "Please retry.")
		return
	}
	if count >= 10 {
		fail(w, 429, "CAPTURE_LIMIT", "Wait two minutes before another capture.")
		return
	}
	id := uuid.NewString()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		fail(w, 503, "CAPTURE_UNAVAILABLE", "Please retry.")
		return
	}
	token := hex.EncodeToString(b)
	if _, err := pool.Exec(r.Context(), "INSERT INTO capture_sessions(id,account_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '120 seconds')", id, a.ID, digest(token)); err != nil {
		fail(w, 503, "CAPTURE_UNAVAILABLE", "Please retry.")
		return
	}
	reply(w, 200, map[string]any{"captureId": id, "token": token, "expiresIn": 120})
}
func processPhoto(raw []byte) ([]byte, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	if (format != "jpeg" && format != "png") || config.Width < 120 || config.Height < 120 || config.Width > 6000 || config.Height > 6000 || config.Width*config.Height > 12000000 {
		return nil, io.ErrUnexpectedEOF
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	var output bytes.Buffer
	err = jpeg.Encode(&output, img, &jpeg.Options{Quality: 85})
	return output.Bytes(), err
}
func submitPhoto(w http.ResponseWriter, r *http.Request, a Identity) {
	id := r.Header.Get("X-Capture-Id")
	if _, err := uuid.Parse(id); err != nil {
		fail(w, 400, "CAPTURE_INVALID", "Start a fresh camera session.")
		return
	}
	contentType := r.Header.Get("Content-Type")
	if contentType != "image/jpeg" && contentType != "image/png" {
		fail(w, 415, "IMAGE_REQUIRED", "Submit a camera JPEG or PNG.")
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 5*1024*1024))
	if err != nil {
		fail(w, 413, "IMAGE_TOO_LARGE", "Photo must be smaller than 5 MB.")
		return
	}
	processed, err := processPhoto(raw)
	if err != nil {
		fail(w, 422, "IMAGE_INVALID", "The photo could not be processed. Retake it in good light.")
		return
	}
	tx, err := pool.Begin(r.Context())
	if err != nil {
		fail(w, 503, "CAPTURE_UNAVAILABLE", "Please retry.")
		return
	}
	defer tx.Rollback(r.Context())
	var capture string
	err = tx.QueryRow(r.Context(), "UPDATE capture_sessions SET consumed_at=now() WHERE id=$1 AND account_id=$2 AND token_hash=$3 AND consumed_at IS NULL AND expires_at>now() RETURNING id", id, a.ID, digest(r.Header.Get("X-Capture-Token"))).Scan(&capture)
	if err != nil {
		fail(w, 409, "CAPTURE_EXPIRED", "That camera session was used or expired. Start a new capture.")
		return
	}
	var previous *string
	if tx.QueryRow(r.Context(), "SELECT photo_key FROM profiles WHERE account_id=$1 FOR UPDATE", a.ID).Scan(&previous) != nil {
		fail(w, 503, "PROFILE_UNAVAILABLE", "Please retry.")
		return
	}
	key := a.ID + "/" + uuid.NewString() + ".jpg"
	// A durable cleanup intent precedes storage I/O and survives a process crash.
	// It is outside the profile transaction; the worker locks that profile before
	// deleting and preserves any key referenced after an uncertain commit.
	if _, err = pool.Exec(r.Context(), "INSERT INTO object_cleanup(object_key,next_attempt_at) VALUES($1,now()+interval '1 hour') ON CONFLICT DO NOTHING", key); err != nil {
		fail(w, 503, "STORAGE_UNAVAILABLE", "Photo recovery could not be prepared. Please retry.")
		return
	}
	if _, err = store.PutObject(r.Context(), bucket, key, bytes.NewReader(processed), int64(len(processed)), minio.PutObjectOptions{ContentType: "image/jpeg"}); err != nil {
		fail(w, 503, "STORAGE_UNAVAILABLE", "Photo storage is unavailable. Please retry.")
		return
	}
	_, err = tx.Exec(r.Context(), "UPDATE profiles SET photo_key=$1,photo_status='pending',photo_source='',photo_updated_at=now(),photo_review_version=gen_random_uuid() WHERE account_id=$2", key, a.ID)
	if err != nil {
		fail(w, 503, "PHOTO_SAVE_FAILED", "Retake your photo and try again.")
		return
	}
	if previous != nil {
		if _, err = tx.Exec(r.Context(), "INSERT INTO object_cleanup(object_key) VALUES($1) ON CONFLICT DO NOTHING", *previous); err != nil {
			fail(w, 503, "PHOTO_SAVE_FAILED", "Retake your photo and try again.")
			return
		}
	}
	if tx.Commit(r.Context()) != nil {
		fail(w, 503, "PHOTO_SAVE_FAILED", "Retake your photo and try again.")
		return
	}
	// The worker safely removes the cleanup intent once it sees this live key.
	profileResponse(w, r, a, false)
}
