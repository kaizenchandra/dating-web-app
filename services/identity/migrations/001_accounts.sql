CREATE TABLE IF NOT EXISTS accounts (
 id uuid PRIMARY KEY, phone text UNIQUE, phone_source text CHECK (phone_source IN ('sms','local')),
 display_name text NOT NULL DEFAULT '', consented_at timestamptz, consent_version text,
 adult_declared boolean NOT NULL DEFAULT false, india_resident boolean NOT NULL DEFAULT false,
 paused boolean NOT NULL DEFAULT false, restricted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), token_hash text UNIQUE NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 reauthenticated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
CREATE TABLE IF NOT EXISTS otp_challenges (
 id uuid PRIMARY KEY, phone text NOT NULL, code_hash text NOT NULL, account_id uuid REFERENCES accounts(id),
 binding_hash text NOT NULL, attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, consumed_at timestamptz,
 source text NOT NULL CHECK (source IN ('sms','local'))
);
CREATE INDEX IF NOT EXISTS otp_phone_created ON otp_challenges(phone,created_at DESC);
CREATE TABLE IF NOT EXISTS provider_identities (
 provider text NOT NULL, subject text NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id),
 email text, name text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,subject),
 UNIQUE(account_id,provider)
);
CREATE TABLE IF NOT EXISTS consent_history (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
