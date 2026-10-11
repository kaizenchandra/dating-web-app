CREATE TABLE IF NOT EXISTS relationships(
 lo uuid NOT NULL,hi uuid NOT NULL,lo_action text NOT NULL DEFAULT 'none',hi_action text NOT NULL DEFAULT 'none',
 lo_intro text NOT NULL DEFAULT '',hi_intro text NOT NULL DEFAULT '',lo_content text NOT NULL DEFAULT 'profile',hi_content text NOT NULL DEFAULT 'profile',
 lo_block boolean NOT NULL DEFAULT false,hi_block boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(lo,hi),CHECK(lo<hi),CHECK(lo_action IN ('none','like','pass')),CHECK(hi_action IN ('none','like','pass'))
);
CREATE TABLE IF NOT EXISTS matches(id uuid PRIMARY KEY,lo uuid NOT NULL,hi uuid NOT NULL,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),ended_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_match ON matches(lo,hi) WHERE active;
CREATE TABLE IF NOT EXISTS outbox(id uuid PRIMARY KEY,type text NOT NULL,version integer NOT NULL DEFAULT 1,aggregate_id uuid NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 0,delivered_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),last_error text);
