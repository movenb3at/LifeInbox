ALTER TABLE app.item_candidates
    DROP CONSTRAINT item_candidates_inbound_event_id_key,
    ADD COLUMN candidate_index integer NOT NULL DEFAULT 0 CHECK(candidate_index >= 0),
    ADD COLUMN field_confidences jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(field_confidences)='object'),
    ADD COLUMN original_field_confidences jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(original_field_confidences)='object'),
    ADD COLUMN routing_source varchar(32) NOT NULL DEFAULT 'legacy',
    ADD COLUMN routing_reason text NOT NULL DEFAULT '기존 후보의 저장 공간을 유지했습니다.',
    ADD CONSTRAINT uq_candidate_event_index UNIQUE(inbound_event_id,candidate_index);

UPDATE app.item_candidates c SET field_confidences =
    COALESCE((SELECT jsonb_object_agg(key,jsonb_build_object('value',value,'confidence',c.confidence,
        'reason','기존 전체 신뢰도에서 이관했습니다.','source','legacy','needs_review',false))
        FROM jsonb_each(c.payload) WHERE key <> 'description'),'{}'::jsonb)
    || jsonb_build_object('space',jsonb_build_object('value',c.suggested_space_id,'confidence',1,
        'reason','기존 저장 공간을 유지했습니다.','source','legacy','needs_review',false));
UPDATE app.item_candidates c SET original_field_confidences =
    COALESCE((SELECT jsonb_object_agg(key,jsonb_build_object('value',value,'confidence',c.confidence,
        'reason','최초 분석 값과 기존 전체 신뢰도에서 이관했습니다.','source','legacy','needs_review',false))
        FROM jsonb_each(c.original_payload) WHERE key <> 'description'),'{}'::jsonb)
    || jsonb_build_object('space',c.field_confidences->'space');

ALTER TABLE app.automation_rules
    ADD COLUMN scope_type varchar(20) NOT NULL DEFAULT 'global',
    ADD COLUMN integration_id uuid,
    ADD CONSTRAINT fk_rule_integration_owner FOREIGN KEY(integration_id,user_id)
        REFERENCES app.integrations(id,user_id),
    ADD CONSTRAINT ck_rule_scope CHECK(
        (scope_type='global' AND space_id IS NULL AND integration_id IS NULL) OR
        (scope_type='space' AND space_id IS NOT NULL AND integration_id IS NULL) OR
        (scope_type='integration' AND space_id IS NULL AND integration_id IS NOT NULL)) NOT VALID;
UPDATE app.automation_rules SET scope_type='space' WHERE space_id IS NOT NULL;
ALTER TABLE app.automation_rules VALIDATE CONSTRAINT ck_rule_scope;
CREATE INDEX ix_rules_integration ON app.automation_rules(integration_id,user_id);
