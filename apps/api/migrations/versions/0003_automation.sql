CREATE TABLE app.automation_settings (
    user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
    level varchar(20) NOT NULL DEFAULT 'suggest' CHECK(level IN ('suggest','auto_capture','auto_action')),
    capture_threshold numeric(5,4) NOT NULL DEFAULT 0.95 CHECK(capture_threshold BETWEEN 0 AND 1),
    review_threshold numeric(5,4) NOT NULL DEFAULT 0.70 CHECK(review_threshold BETWEEN 0 AND capture_threshold),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.integrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    provider varchar(32) NOT NULL, status varchar(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','error')),
    credentials_reference text, settings jsonb NOT NULL DEFAULT '{}', last_synced_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id,provider), UNIQUE(id,user_id)
);
CREATE TABLE app.inbound_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    integration_id uuid NOT NULL, source_type varchar(32) NOT NULL, external_id varchar(200) NOT NULL,
    raw_content jsonb NOT NULL, normalized_content jsonb, status varchar(20) NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','processing','processed','ignored','failed')),
    error_message text, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
    received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
    UNIQUE(user_id,integration_id,external_id), UNIQUE(id,user_id),
    FOREIGN KEY(integration_id,user_id) REFERENCES app.integrations(id,user_id) ON DELETE CASCADE
);
CREATE INDEX ix_inbound_user_status ON app.inbound_events(user_id,status,received_at);
CREATE INDEX ix_inbound_integration ON app.inbound_events(integration_id,user_id);
CREATE TABLE app.item_candidates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    inbound_event_id uuid NOT NULL UNIQUE, suggested_space_id uuid NOT NULL, suggested_assignee_id uuid,
    payload jsonb NOT NULL, original_payload jsonb NOT NULL, corrections jsonb NOT NULL DEFAULT '[]',
    confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1), explanations jsonb NOT NULL DEFAULT '[]',
    status varchar(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','auto_accepted','rejected','expired')),
    item_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(inbound_event_id,user_id) REFERENCES app.inbound_events(id,user_id) ON DELETE CASCADE,
    FOREIGN KEY(suggested_space_id) REFERENCES app.spaces(id),
    FOREIGN KEY(suggested_space_id,suggested_assignee_id) REFERENCES app.space_members(space_id,user_id),
    FOREIGN KEY(item_id,user_id) REFERENCES app.items(id,creator_id) ON DELETE SET NULL(item_id)
);
CREATE INDEX ix_candidates_user_status ON app.item_candidates(user_id,status,created_at);
CREATE INDEX ix_candidates_space ON app.item_candidates(suggested_space_id);
CREATE INDEX ix_candidates_item ON app.item_candidates(item_id);
CREATE INDEX ix_candidates_assignee ON app.item_candidates(suggested_space_id,suggested_assignee_id);
CREATE TABLE app.automation_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    space_id uuid, name varchar(100) NOT NULL CHECK(length(trim(name))>0), description text NOT NULL DEFAULT '',
    trigger_type varchar(40) NOT NULL CHECK(trigger_type IN ('inbound_received','candidate_created','item_created','item_updated','deadline_approaching','integration_sync')),
    version integer NOT NULL DEFAULT 1 CHECK(version=1), conditions jsonb NOT NULL, actions jsonb NOT NULL,
    priority integer NOT NULL DEFAULT 0, is_enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id),
    FOREIGN KEY(space_id) REFERENCES app.spaces(id)
);
CREATE INDEX ix_rules_user_trigger ON app.automation_rules(user_id,trigger_type,is_enabled,priority DESC);
CREATE INDEX ix_rules_space ON app.automation_rules(space_id);
CREATE TABLE app.automation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    rule_id uuid, rule_name varchar(100) NOT NULL, trigger_type varchar(40) NOT NULL, trigger_entity_id uuid NOT NULL,
    execution_key varchar(200) NOT NULL, status varchar(20) NOT NULL CHECK(status IN ('success','failed','skipped')),
    input_snapshot jsonb NOT NULL, output_snapshot jsonb NOT NULL, error_message text,
    executed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,execution_key),
    FOREIGN KEY(rule_id,user_id) REFERENCES app.automation_rules(id,user_id) ON DELETE SET NULL(rule_id)
);
CREATE INDEX ix_runs_user_time ON app.automation_runs(user_id,executed_at DESC);
CREATE INDEX ix_runs_rule ON app.automation_runs(rule_id);
CREATE TABLE app.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    item_id uuid, rule_id uuid, title varchar(200) NOT NULL, message text NOT NULL,
    dedupe_key varchar(250) NOT NULL, scheduled_for timestamptz NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','delivered','cancelled')),
    read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
    UNIQUE(user_id,dedupe_key),
    FOREIGN KEY(item_id) REFERENCES app.items(id) ON DELETE SET NULL,
    FOREIGN KEY(rule_id,user_id) REFERENCES app.automation_rules(id,user_id) ON DELETE SET NULL(rule_id)
);
CREATE INDEX ix_notifications_user_status ON app.notifications(user_id,status,scheduled_for);
CREATE INDEX ix_notifications_item ON app.notifications(item_id);
CREATE INDEX ix_notifications_rule ON app.notifications(rule_id);

DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['automation_settings','integrations','inbound_events','item_candidates','automation_rules','automation_runs','notifications'] LOOP
        EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
        EXECUTE format('CREATE POLICY owned_rows ON app.%I TO lifeinbox_app USING(user_id=(SELECT app.current_user_id())) WITH CHECK(user_id=(SELECT app.current_user_id()))',t);
    END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON app.automation_settings,app.integrations,app.inbound_events,app.item_candidates,app.notifications TO lifeinbox_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.automation_rules TO lifeinbox_app;
GRANT SELECT,INSERT ON app.automation_runs TO lifeinbox_app;

DROP POLICY owned_rows ON app.item_candidates;
CREATE POLICY owned_rows ON app.item_candidates TO lifeinbox_app USING(user_id=(SELECT app.current_user_id()))
WITH CHECK(user_id=(SELECT app.current_user_id()) AND app.space_role(suggested_space_id) IN ('owner','member'));
DROP POLICY owned_rows ON app.automation_rules;
CREATE POLICY owned_rows ON app.automation_rules TO lifeinbox_app USING(user_id=(SELECT app.current_user_id()))
WITH CHECK(user_id=(SELECT app.current_user_id()) AND (space_id IS NULL OR app.space_role(space_id)='owner'));
DROP POLICY owned_rows ON app.notifications;
CREATE POLICY owned_rows ON app.notifications TO lifeinbox_app USING(user_id=(SELECT app.current_user_id()))
WITH CHECK(user_id=(SELECT app.current_user_id()) AND (item_id IS NULL OR EXISTS(SELECT 1 FROM app.items WHERE id=item_id)));

CREATE FUNCTION app.automation_worker_users() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path='' AS $$ SELECT user_id FROM app.automation_settings $$;
REVOKE ALL ON FUNCTION app.automation_worker_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.automation_worker_users() TO lifeinbox_app;

CREATE FUNCTION app.guard_item_creator() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF new.creator_id<>old.creator_id THEN
        RAISE EXCEPTION 'Item creator is immutable' USING ERRCODE='23514';
    END IF;
    RETURN new;
END $$;
REVOKE ALL ON FUNCTION app.guard_item_creator() FROM PUBLIC;
CREATE TRIGGER guard_item_creator BEFORE UPDATE ON app.items FOR EACH ROW EXECUTE FUNCTION app.guard_item_creator();
