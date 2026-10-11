package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

//go:embed migrations/*.sql
var migrations embed.FS
var pool *pgxpool.Pool
var client = &http.Client{Timeout: 3 * time.Second}

func reply(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, status int, code, msg string) {
	reply(w, status, map[string]any{"error": map[string]string{"code": code, "message": msg, "correlationId": w.Header().Get("X-Correlation-Id")}})
}
func internal(ctx context.Context, service, path, method, cookie string, data any, out any) error {
	var b io.Reader
	if data != nil {
		raw, _ := json.Marshal(data)
		b = bytes.NewReader(raw)
	}
	r, _ := http.NewRequestWithContext(ctx, method, "http://"+service+":4000"+path, b)
	r.Header.Set("Authorization", "Bearer "+serviceToken(service))
	r.Header.Set("Cookie", cookie)
	r.Header.Set("Content-Type", "application/json")
	response, err := client.Do(r)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("authority status %d", response.StatusCode)
	}
	return json.NewDecoder(response.Body).Decode(out)
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
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL)"); err != nil {
		return err
	}
	files, _ := migrations.ReadDir("migrations")
	for _, f := range files {
		sql, _ := migrations.ReadFile("migrations/" + f.Name())
		h := sha256.Sum256(sql)
		sum := hex.EncodeToString(h[:])
		var previous string
		if tx.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE name=$1", f.Name()).Scan(&previous) == nil {
			if previous != sum {
				return fmt.Errorf("migration checksum changed")
			}
			continue
		}
		if _, err = tx.Exec(ctx, string(sql)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", f.Name(), sum); err != nil {
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
	if migrate(context.Background()) != nil {
		log.Fatal("connections migration failed")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Correlation-Id", newID())
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
				fail(w, 503, "DATABASE_UNAVAILABLE", "Please retry.")
				return
			}
			conn, err := net.DialTimeout("tcp", "redis:6379", time.Second)
			if err != nil {
				fail(w, 503, "REDIS_UNAVAILABLE", "Please retry.")
				return
			}
			defer conn.Close()
			conn.SetDeadline(time.Now().Add(time.Second))
			conn.Write([]byte("*1\r\n$4\r\nPING\r\n"))
			b := make([]byte, 7)
			n, err := conn.Read(b)
			if err != nil || string(b[:n]) != "+PONG\r\n" {
				fail(w, 503, "REDIS_UNAVAILABLE", "Please retry.")
				return
			}
			reply(w, 200, map[string]string{"status": "ok"})
			return
		}
		if privacyRoutes(w, r) {
			return
		}
		if communicationRoutes(w, r) {
			return
		}
		routes(w, r)
	})
	server := &http.Server{Addr: ":4000", Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go server.ListenAndServe()
	go dispatchEvents()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server.Shutdown(ctx)
}
