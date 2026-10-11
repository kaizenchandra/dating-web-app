CREATE TABLE discovery_feedback (
 account_id uuid NOT NULL REFERENCES profiles(account_id) ON DELETE CASCADE,
 target_id uuid NOT NULL REFERENCES profiles(account_id) ON DELETE CASCADE,
 reason text NOT NULL CHECK(reason IN ('intent','distance','interests','not_for_me')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,target_id),
 CHECK(account_id<>target_id)
);
CREATE INDEX discovery_feedback_target ON discovery_feedback(target_id);
