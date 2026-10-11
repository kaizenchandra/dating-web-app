ALTER TABLE subscriptions ADD COLUMN tier text NOT NULL DEFAULT 'gold' CHECK(tier IN ('gold','diamond','platinum'));
ALTER TABLE subscriptions ADD COLUMN billing_mode text NOT NULL DEFAULT 'recurring' CHECK(billing_mode IN ('recurring','month_pass'));
ALTER TABLE subscriptions ADD COLUMN amount integer NOT NULL DEFAULT 49900;
ALTER TABLE subscriptions ADD COLUMN currency text NOT NULL DEFAULT 'INR';
ALTER TABLE subscriptions ADD COLUMN provider_plan_id text;
ALTER TABLE subscriptions ADD COLUMN provider_order_id text UNIQUE;
ALTER TABLE subscriptions ADD COLUMN provider_payment_id text UNIQUE;
ALTER TABLE subscriptions ADD COLUMN paid_at timestamptz;
ALTER TABLE payment_events ADD COLUMN applied boolean NOT NULL DEFAULT true;
