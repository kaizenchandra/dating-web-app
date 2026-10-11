CREATE TABLE deleted_accounts(account_id uuid PRIMARY KEY,deleted_at timestamptz NOT NULL DEFAULT now());
