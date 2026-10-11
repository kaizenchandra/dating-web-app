CREATE TABLE subscriptions(id uuid PRIMARY KEY,account_id uuid NOT NULL,provider_id text UNIQUE,status text NOT NULL DEFAULT 'creating',short_url text,current_end timestamptz,paid_count integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX active_subscription ON subscriptions(account_id) WHERE status NOT IN ('cancelled','completed','expired');
CREATE TABLE payment_events(id text PRIMARY KEY,payload_hash text NOT NULL,processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE refund_requests(id uuid PRIMARY KEY,account_id uuid NOT NULL,subscription_id uuid NOT NULL REFERENCES subscriptions(id),reason text NOT NULL,status text NOT NULL DEFAULT 'submitted',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE deleted_accounts(account_id uuid PRIMARY KEY,deleted_at timestamptz NOT NULL DEFAULT now());
