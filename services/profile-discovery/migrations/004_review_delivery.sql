ALTER TABLE profiles ADD COLUMN photo_review_version uuid NOT NULL DEFAULT gen_random_uuid();
CREATE TABLE review_receipts (
 decision_id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES profiles(account_id) ON DELETE CASCADE,
 payload_hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
);
