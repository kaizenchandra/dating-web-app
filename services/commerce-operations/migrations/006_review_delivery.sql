ALTER TABLE review_audit ADD COLUMN review_version uuid;
ALTER TABLE review_audit ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE review_audit ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE review_audit ADD COLUMN last_error text;
ALTER TABLE review_audit ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX review_delivery_due ON review_audit(next_attempt_at) WHERE status='requested' AND review_version IS NOT NULL;
