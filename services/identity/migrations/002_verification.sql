CREATE TABLE IF NOT EXISTS verifications (
 account_id uuid PRIMARY KEY REFERENCES accounts(id),
 age_state text NOT NULL DEFAULT 'not_started' CHECK(age_state IN ('not_started','pending','approved','rejected')),
 identity_state text NOT NULL DEFAULT 'not_started' CHECK(identity_state IN ('not_started','pending','approved','rejected')),
 source text CHECK(source IN ('local','digilocker','alternative')),
 date_of_birth date, reason text NOT NULL DEFAULT '', consented_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
