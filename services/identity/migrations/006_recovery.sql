CREATE TABLE recovery_receipts(request_id uuid PRIMARY KEY,job_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
