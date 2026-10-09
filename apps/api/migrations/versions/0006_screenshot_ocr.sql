CREATE TABLE app.screenshot_inputs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    inbound_event_id uuid NOT NULL UNIQUE,
    image_bytes bytea CHECK(image_bytes IS NULL OR octet_length(image_bytes) BETWEEN 1 AND 5242880),
    image_sha256 varchar(64) NOT NULL,
    mime_type varchar(32) NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/webp')),
    file_name varchar(200) NOT NULL,
    width integer NOT NULL CHECK(width>0), height integer NOT NULL CHECK(height>0),
    ocr_status varchar(24) NOT NULL DEFAULT 'pending'
        CHECK(ocr_status IN ('pending','processing','completed','failed','deleted')),
    ocr_text text, ocr_confidence numeric(5,4) CHECK(ocr_confidence BETWEEN 0 AND 1),
    ocr_details jsonb NOT NULL DEFAULT '{}', provider varchar(32),
    attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
    claim_token uuid, last_attempt_at timestamptz, processed_at timestamptz, error_message text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id,image_sha256),
    FOREIGN KEY(inbound_event_id,user_id) REFERENCES app.inbound_events(id,user_id) ON DELETE CASCADE,
    CHECK(width::bigint*height<=25000000)
);
CREATE INDEX ix_screenshots_event_owner ON app.screenshot_inputs(inbound_event_id,user_id);
CREATE INDEX ix_screenshots_user_work ON app.screenshot_inputs(user_id,ocr_status,last_attempt_at);
ALTER TABLE app.screenshot_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY owned_rows ON app.screenshot_inputs TO lifeinbox_app
    USING(user_id=(SELECT app.current_user_id())) WITH CHECK(user_id=(SELECT app.current_user_id()));
GRANT SELECT,INSERT,UPDATE ON app.screenshot_inputs TO lifeinbox_app;
