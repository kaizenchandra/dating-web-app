CREATE TABLE IF NOT EXISTS reports(id uuid PRIMARY KEY,reporter_id uuid NOT NULL,target_id uuid,subject_id uuid,kind text NOT NULL,reason text NOT NULL,detail text NOT NULL,evidence jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'submitted',resolution text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS reports_reporter ON reports(reporter_id,created_at DESC);
CREATE TABLE IF NOT EXISTS staff_mfa(account_id uuid PRIMARY KEY,secret text NOT NULL,confirmed boolean NOT NULL DEFAULT false,last_counter bigint NOT NULL DEFAULT 0);
