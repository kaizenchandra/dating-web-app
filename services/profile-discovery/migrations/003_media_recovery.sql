ALTER TABLE object_cleanup ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE media_reconciliation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 cursor text NOT NULL DEFAULT '', last_scan_at timestamptz,
 last_scan_error text, scanned integer NOT NULL DEFAULT 0, queued integer NOT NULL DEFAULT 0
);
INSERT INTO media_reconciliation(singleton) VALUES(true);
