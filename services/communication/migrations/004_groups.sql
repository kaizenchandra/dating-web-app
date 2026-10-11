CREATE TABLE group_messages(id uuid PRIMARY KEY,group_id uuid NOT NULL,sender_id uuid NOT NULL,name text NOT NULL,text text NOT NULL,client_message_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(sender_id,client_message_id));
CREATE INDEX group_history ON group_messages(group_id,created_at);
