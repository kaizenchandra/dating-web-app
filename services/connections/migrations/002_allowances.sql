ALTER TABLE relationships ADD COLUMN lo_super boolean NOT NULL DEFAULT false;
ALTER TABLE relationships ADD COLUMN hi_super boolean NOT NULL DEFAULT false;
CREATE TABLE connection_usage (
 account_id uuid NOT NULL,
 target_id uuid NOT NULL,
 feature text NOT NULL CHECK(feature IN ('super_like','direct_introduction')),
 used_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,target_id,feature)
);
CREATE INDEX connection_usage_day ON connection_usage(account_id,used_at);
