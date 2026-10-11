CREATE TABLE recovery_actions(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,service text NOT NULL,job_id uuid NOT NULL,reason text NOT NULL,status text NOT NULL DEFAULT 'unconfirmed',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE recovery_receipts(request_id uuid PRIMARY KEY,job_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
