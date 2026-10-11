CREATE TABLE IF NOT EXISTS conversations(id uuid PRIMARY KEY,first_id uuid NOT NULL,second_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS messages(
 id uuid PRIMARY KEY,conversation_id uuid NOT NULL REFERENCES conversations(id),sender_id uuid NOT NULL,recipient_id uuid NOT NULL,
 client_message_id uuid NOT NULL,text text NOT NULL CHECK(length(text) BETWEEN 1 AND 2000),
 sequence bigserial UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz,read_at timestamptz,
 UNIQUE(sender_id,client_message_id)
);
CREATE INDEX IF NOT EXISTS message_history ON messages(conversation_id,sequence DESC);
CREATE TABLE IF NOT EXISTS read_cursors(account_id uuid NOT NULL,conversation_id uuid NOT NULL,through_sequence bigint NOT NULL DEFAULT 0,PRIMARY KEY(account_id,conversation_id));
CREATE TABLE IF NOT EXISTS processed_events(id uuid PRIMARY KEY,processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS notifications(id uuid PRIMARY KEY,event_id uuid NOT NULL,account_id uuid NOT NULL,kind text NOT NULL,conversation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),read boolean NOT NULL DEFAULT false,UNIQUE(event_id,account_id));
CREATE TABLE IF NOT EXISTS outbox(id uuid PRIMARY KEY,conversation_id uuid NOT NULL,sequence bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz,attempts integer NOT NULL DEFAULT 0,last_error text);
