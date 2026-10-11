CREATE TABLE message_images (
 id uuid PRIMARY KEY, sender_id uuid NOT NULL, conversation_id uuid NOT NULL,
 client_image_id uuid NOT NULL, source_hash text NOT NULL, data bytea NOT NULL CHECK(octet_length(data)<=1048576),
 created_at timestamptz NOT NULL DEFAULT now(), attached boolean NOT NULL DEFAULT false,
 UNIQUE(sender_id,client_image_id)
);
CREATE INDEX message_image_sender ON message_images(sender_id,created_at);
ALTER TABLE messages ADD COLUMN image_id uuid REFERENCES message_images(id);
CREATE UNIQUE INDEX message_image_once ON messages(image_id) WHERE image_id IS NOT NULL;
ALTER TABLE messages DROP CONSTRAINT messages_text_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_check CHECK(length(text)<=2000 AND (length(text)>0 OR image_id IS NOT NULL));
