ALTER TABLE app.items DROP CONSTRAINT items_space_id_assignee_id_fkey;
ALTER TABLE app.items ADD CONSTRAINT items_space_id_assignee_id_fkey
FOREIGN KEY(space_id,assignee_id) REFERENCES app.space_members(space_id,user_id) ON DELETE SET NULL(assignee_id);
ALTER TABLE app.item_candidates DROP CONSTRAINT item_candidates_suggested_space_id_suggested_assignee_id_fkey;
ALTER TABLE app.item_candidates ADD CONSTRAINT item_candidates_suggested_space_id_suggested_assignee_id_fkey
FOREIGN KEY(suggested_space_id,suggested_assignee_id) REFERENCES app.space_members(space_id,user_id) ON DELETE SET NULL(suggested_assignee_id);

DROP POLICY owned_rows ON app.automation_runs;
CREATE POLICY runs_visible ON app.automation_runs FOR SELECT TO lifeinbox_app USING(
    user_id=(SELECT app.current_user_id()) OR (
        trigger_type IN ('item_created','item_updated','deadline_approaching')
        AND input_snapshot->'entity'->>'actor_id'=(SELECT app.current_user_id())::text
        AND app.space_role((input_snapshot->'entity'->>'space_id')::uuid) IS NOT NULL
    )
);
CREATE POLICY runs_create_owned ON app.automation_runs FOR INSERT TO lifeinbox_app WITH CHECK(user_id=(SELECT app.current_user_id()));
CREATE INDEX ix_runs_actor_time ON app.automation_runs((input_snapshot->'entity'->>'actor_id'),executed_at DESC)
WHERE trigger_type IN ('item_created','item_updated','deadline_approaching');

-- 공유 권한을 잃어도 본인의 후보를 무시하거나 오래된 알림을 취소할 수 있습니다.
DROP POLICY owned_rows ON app.item_candidates;
CREATE POLICY owned_rows ON app.item_candidates TO lifeinbox_app USING(user_id=(SELECT app.current_user_id()))
WITH CHECK(user_id=(SELECT app.current_user_id()) AND (status='rejected' OR app.space_role(suggested_space_id) IN ('owner','member')));
DROP POLICY owned_rows ON app.notifications;
CREATE POLICY notifications_visible ON app.notifications FOR SELECT TO lifeinbox_app USING(user_id=(SELECT app.current_user_id()));
CREATE POLICY notifications_create ON app.notifications FOR INSERT TO lifeinbox_app
WITH CHECK(user_id=(SELECT app.current_user_id()) AND (item_id IS NULL OR EXISTS(SELECT 1 FROM app.items WHERE id=item_id)));
CREATE POLICY notifications_update ON app.notifications FOR UPDATE TO lifeinbox_app USING(user_id=(SELECT app.current_user_id()))
WITH CHECK(user_id=(SELECT app.current_user_id()) AND (status='cancelled' OR item_id IS NULL OR EXISTS(SELECT 1 FROM app.items WHERE id=item_id)));
