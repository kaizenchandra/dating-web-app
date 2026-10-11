ALTER TABLE verifications ADD COLUMN review_version uuid NOT NULL DEFAULT gen_random_uuid();
CREATE TABLE review_receipts (
 decision_id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 payload_hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
);
