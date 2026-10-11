CREATE TABLE IF NOT EXISTS profiles (
 account_id uuid PRIMARY KEY, data jsonb NOT NULL,
 photo_key text, photo_status text NOT NULL DEFAULT 'not_started' CHECK(photo_status IN ('not_started','pending','approved','rejected')),
 photo_source text NOT NULL DEFAULT '', photo_updated_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS capture_sessions (
 id uuid PRIMARY KEY, account_id uuid NOT NULL, token_hash text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS capture_account ON capture_sessions(account_id);
CREATE TABLE IF NOT EXISTS object_cleanup (
 object_key text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0, last_error text
);
