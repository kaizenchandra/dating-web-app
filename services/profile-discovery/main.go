package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

//go:embed migrations/*.sql
var migrations embed.FS
var pool *pgxpool.Pool
var store *minio.Client

const bucket = "profile-photos"

var internalClient = &http.Client{Timeout: 3 * time.Second}

func digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, code, message string) {
	reply(w, status, map[string]any{"error": map[string]string{"code": code, "message": message, "correlationId": w.Header().Get("X-Correlation-Id")}})
}
func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil {
		fail(w, 422, "INVALID_FIELDS", "Check your information and try again.")
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		fail(w, 400, "INVALID_JSON", "Send one JSON object.")
		return false
	}
	return true
}

type Identity struct {
	ID                 string `json:"id"`
	DisplayName        string `json:"displayName"`
	Consented          bool   `json:"consented"`
	Paused             bool   `json:"paused"`
	AgeYears           *int   `json:"ageYears"`
	IdentityApproved   bool   `json:"identityApproved"`
	VerificationSource string `json:"verificationSource"`
}

func identity(w http.ResponseWriter, r *http.Request) (Identity, bool) {
	var a Identity
	req, _ := http.NewRequestWithContext(r.Context(), "GET", "http://identity:4000/internal/identity/me", nil)
	req.Header.Set("Authorization", "Bearer "+serviceToken("identity"))
	req.Header.Set("Cookie", r.Header.Get("Cookie"))
	response, err := internalClient.Do(req)
	if err != nil {
		fail(w, 503, "IDENTITY_UNAVAILABLE", "Account permissions could not be checked. Please retry.")
		return a, false
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(response.StatusCode)
		io.Copy(w, io.LimitReader(response.Body, 16384))
		return a, false
	}
	if json.NewDecoder(response.Body).Decode(&a) != nil {
		fail(w, 503, "IDENTITY_UNAVAILABLE", "Unable to verify account permissions.")
		return a, false
	}
	if !a.Consented {
		fail(w, 403, "CONSENT_REQUIRED", "Complete onboarding consent first.")
		return a, false
	}
	return a, true
}
func migrate(ctx context.Context) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(731802)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return err
	}
	files, _ := migrations.ReadDir("migrations")
	sort.Slice(files, func(i, j int) bool { return files[i].Name() < files[j].Name() })
	for _, f := range files {
		sql, _ := migrations.ReadFile("migrations/" + f.Name())
		checksum := digest(string(sql))
		var previous string
		err = tx.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE name=$1", f.Name()).Scan(&previous)
		if err == nil {
			if previous != checksum {
				return fmt.Errorf("migration checksum mismatch")
			}
			continue
		}
		if _, err = tx.Exec(ctx, string(sql)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", f.Name(), checksum); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func main() {
	var err error
	pool, err = pgxpool.New(context.Background(), os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal("database configuration invalid")
	}
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if migrate(ctx) != nil {
		log.Fatal("profile migration failed")
	}
	store, err = minio.New(os.Getenv("S3_ENDPOINT"), &minio.Options{Creds: credentials.NewStaticV4(os.Getenv("S3_ACCESS_KEY"), os.Getenv("S3_SECRET_KEY"), ""), Secure: os.Getenv("S3_TLS") == "true"})
	if err != nil {
		log.Fatal("object storage configuration invalid")
	}
	exists, err := store.BucketExists(ctx, bucket)
	if err != nil {
		log.Fatal("object storage unavailable")
	}
	if !exists {
		if store.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}) != nil {
			log.Fatal("object bucket initialization failed")
		}
	}
	local := os.Getenv("APP_ENV") == "local"
	if local && os.Getenv("LOCAL_TEST_DELIVERY") != "enabled" {
		log.Fatal("local simulator flag required")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Correlation-Id", uuid.NewString())
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path == "/health/live" {
			reply(w, 200, map[string]string{"status": "ok"})
			return
		}
		token := os.Getenv("SERVICE_TOKEN")
		if token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			fail(w, 401, "UNAUTHORIZED", "Authentication required.")
			return
		}
		if r.URL.Path == "/health/ready" {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if pool.Ping(ctx) != nil {
				fail(w, 503, "DATABASE_UNAVAILABLE", "Database unavailable.")
				return
			}
			conn, err := net.DialTimeout("tcp", "redis:6379", time.Second)
			if err != nil {
				fail(w, 503, "REDIS_UNAVAILABLE", "Coordination unavailable.")
				return
			}
			defer conn.Close()
			conn.SetDeadline(time.Now().Add(time.Second))
			conn.Write([]byte("*1\r\n$4\r\nPING\r\n"))
			b := make([]byte, 7)
			n, err := conn.Read(b)
			if err != nil || string(b[:n]) != "+PONG\r\n" {
				fail(w, 503, "REDIS_UNAVAILABLE", "Coordination unavailable.")
				return
			}
			if _, err = store.BucketExists(ctx, bucket); err != nil {
				fail(w, 503, "STORAGE_UNAVAILABLE", "Photo storage unavailable.")
				return
			}
			reply(w, 200, map[string]string{"status": "ok"})
			return
		}
		if operatorRecovery(w, r) {
			return
		}
		if mediaRecoveryRoute(w, r) {
			return
		}
		if privacyRoutes(w, r) {
			return
		}
		if internalDiscovery(w, r) {
			return
		}
		if reviewRoutes(w, r, local) {
			return
		}
		a, ok := identity(w, r)
		if !ok {
			return
		}
		if feedbackRoutes(w, r, a) {
			return
		}
		if discoveryRoutes(w, r, a) {
			return
		}
		profileRoutes(w, r, a, local)
	})
	server := &http.Server{Addr: ":4000", Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Print("profile listener stopped")
		}
	}()
	go func() {
		for range time.Tick(time.Minute) {
			reconcileMedia()
			cleanupObjects()
			pool.Exec(context.Background(), "DELETE FROM capture_sessions WHERE expires_at<now()-interval '1 day'")
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	<-stop
	ctx, cancel = context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server.Shutdown(ctx)
}
func bounded(s string, n int) bool { return len([]rune(s)) <= n && !strings.ContainsRune(s, 0) }
