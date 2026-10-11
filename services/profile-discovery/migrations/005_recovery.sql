ALTER TABLE object_cleanup ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX object_cleanup_id ON object_cleanup(id);
CREATE TABLE recovery_receipts(request_id uuid PRIMARY KEY,job_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
