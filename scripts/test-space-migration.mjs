import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const db = await PGlite.create();
const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222", c = "33333333-3333-4333-8333-333333333333";
const sql = async name => readFile(new URL(`../apps/api/migrations/versions/${name}`, import.meta.url), "utf8");
const scalar = async (query, args = []) => Object.values((await db.query(query, args)).rows[0])[0];
async function asUser(id, fn) {
  await db.exec("BEGIN; SET LOCAL ROLE lifeinbox_app;");
  await db.query("SELECT set_config('app.user_id',$1,true)", [id]);
  try { const result = await fn(); await db.exec("COMMIT"); return result; }
  catch (error) { await db.exec("ROLLBACK"); throw error; }
}
try {
  await db.exec("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb DEFAULT '{}');");
  await db.exec(await sql("0001_initial.sql"));
  await db.query("INSERT INTO auth.users(id) VALUES($1),($2),($3)", [a, b, c]);
  const original = (await db.query("SELECT id,owner_id FROM app.spaces ORDER BY owner_id")).rows;
  const first = original[0].id;
  const item = await scalar("INSERT INTO app.items(space_id,creator_id,title,source_text) VALUES($1,$2,'기존 항목','원문 유지') RETURNING id", [first, a]);
  await db.query("INSERT INTO app.item_updates(item_id,user_id,type,content) VALUES($1,$2,'comment','기존 기록')", [item, a]);
  const legacyGroup = await scalar("INSERT INTO app.spaces(name,type,owner_id) VALUES('기존 그룹','group',$1) RETURNING id", [a]);
  await db.query("INSERT INTO app.space_members(space_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')", [legacyGroup, a, b]);
  const legacyItem = await scalar("INSERT INTO app.items(space_id,creator_id,title) VALUES($1,$2,'기존 그룹 항목') RETURNING id", [legacyGroup, a]);
  const spaceDigest = await scalar("SELECT md5(string_agg(jsonb_set(to_jsonb(s),'{type}',to_jsonb(CASE WHEN type='group' THEN 'shared' ELSE type END))::text,',' ORDER BY id)) FROM app.spaces s");
  const itemDigest = await scalar("SELECT md5(string_agg(to_jsonb(i)::text,',' ORDER BY id)) FROM app.items i");
  await db.exec(await sql("0002_spaces.sql"));
  assert.equal(await scalar("SELECT md5(string_agg((to_jsonb(s)-'is_default')::text,',' ORDER BY id)) FROM app.spaces s"), spaceDigest);
  assert.equal(await scalar("SELECT md5(string_agg(to_jsonb(i)::text,',' ORDER BY id)) FROM app.items i"), itemDigest);
  assert.equal(await scalar("SELECT count(*)::int FROM app.spaces WHERE is_default"), 3);
  assert.equal(await scalar("SELECT count(*)::int FROM app.item_updates WHERE item_id=$1", [item]), 1);
  await db.exec(await sql("0003_automation.sql"));
  await db.exec(await sql("0004_membership_references.sql"));
  const legacyIntegration = await scalar("INSERT INTO app.integrations(user_id,provider) VALUES($1,'legacy-fixture') RETURNING id", [a]);
  const legacyEvent = await scalar("INSERT INTO app.inbound_events(user_id,integration_id,source_type,external_id,raw_content) VALUES($1,$2,'email','legacy','{}') RETURNING id", [a, legacyIntegration]);
  const legacyCandidate = await scalar("INSERT INTO app.item_candidates(user_id,inbound_event_id,suggested_space_id,payload,original_payload,confidence,item_id,status) VALUES($1,$2,$3,'{\"title\":\"기존 후보\"}','{\"title\":\"기존 분석\"}',0.92,$4,'accepted') RETURNING id", [a, legacyEvent, first, item]);
  const oldCandidate = await scalar("SELECT to_jsonb(c)::text FROM app.item_candidates c WHERE id=$1", [legacyCandidate]);
  const legacyRule = await scalar("INSERT INTO app.automation_rules(user_id,space_id,name,trigger_type,conditions,actions) VALUES($1,$2,'기존 공간 규칙','candidate_created','[]','[{\"type\":\"ignore\"}]') RETURNING id", [a, first]);
  await db.exec(await sql("0005_automation_phase_one.sql"));
  const beforeOcrItems = await scalar("SELECT md5(string_agg(to_jsonb(i)::text,',' ORDER BY id)) FROM app.items i");
  const beforeOcrSpaces = await scalar("SELECT md5(string_agg(to_jsonb(s)::text,',' ORDER BY id)) FROM app.spaces s");
  await db.exec(await sql("0006_screenshot_ocr.sql"));
  assert.equal(await scalar("SELECT md5(string_agg(to_jsonb(i)::text,',' ORDER BY id)) FROM app.items i"), beforeOcrItems);
  assert.equal(await scalar("SELECT md5(string_agg(to_jsonb(s)::text,',' ORDER BY id)) FROM app.spaces s"), beforeOcrSpaces);
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE healthcheck_guest;");
  await db.exec(await sql("0007_daily_healthcheck.sql"));
  assert.equal(await scalar("SELECT md5(string_agg(to_jsonb(i)::text,',' ORDER BY id)) FROM app.items i"), beforeOcrItems);
  assert.equal(await scalar("SELECT md5(string_agg(to_jsonb(s)::text,',' ORDER BY id)) FROM app.spaces s"), beforeOcrSpaces);
  const healthFunction = (await db.query("SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE oid='public.lifeinbox_healthcheck()'::regprocedure")).rows[0];
  assert.equal(healthFunction.prosecdef, false);
  assert.equal(healthFunction.provolatile, "s");
  assert.deepEqual(healthFunction.proconfig, ['search_path=""']);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    assert.equal(await scalar("SELECT public.lifeinbox_healthcheck()"), "ok");
    await assert.rejects(db.query("SELECT * FROM app.items"), /permission denied/);
    await db.exec("RESET ROLE");
  }
  await db.exec("SET ROLE healthcheck_guest");
  await assert.rejects(db.query("SELECT public.lifeinbox_healthcheck()"), /permission denied/);
  await db.exec("RESET ROLE");
  assert.equal(await scalar("SELECT (to_jsonb(c)-'candidate_index'-'field_confidences'-'original_field_confidences'-'routing_source'-'routing_reason')::text FROM app.item_candidates c WHERE id=$1", [legacyCandidate]), oldCandidate);
  assert.equal(await scalar("SELECT scope_type FROM app.automation_rules WHERE id=$1", [legacyRule]), 'space');
  assert.equal(await scalar("SELECT field_confidences->'title'->>'confidence' FROM app.item_candidates WHERE id=$1", [legacyCandidate]), '0.9200');
  assert.equal(await scalar("SELECT original_field_confidences->'title'->>'value' FROM app.item_candidates WHERE id=$1", [legacyCandidate]), '기존 분석');
  await asUser(a, () => db.query("INSERT INTO app.item_candidates(user_id,inbound_event_id,candidate_index,suggested_space_id,payload,original_payload,confidence) VALUES($1,$2,1,$3,'{}','{}',0.8)", [a, legacyEvent, first]));
  await assert.rejects(asUser(a, () => db.query("INSERT INTO app.item_candidates(user_id,inbound_event_id,candidate_index,suggested_space_id,payload,original_payload,confidence) VALUES($1,$2,1,$3,'{}','{}',0.8)", [a, legacyEvent, first])), /duplicate key/);
  await asUser(a, () => db.query("INSERT INTO app.automation_rules(user_id,scope_type,integration_id,name,trigger_type,conditions,actions) VALUES($1,'integration',$2,'경로 규칙','inbound_received','[]','[]')", [a, legacyIntegration]));
  await assert.rejects(asUser(b, () => db.query("INSERT INTO app.automation_rules(user_id,scope_type,integration_id,name,trigger_type,conditions,actions) VALUES($1,'integration',$2,'위조 경로','inbound_received','[]','[]')", [b, legacyIntegration])), /foreign key/);
  await assert.rejects(asUser(a, () => db.query("INSERT INTO app.automation_rules(user_id,scope_type,name,trigger_type,conditions,actions) VALUES($1,'space','불완전 범위','inbound_received','[]','[]')", [a])), /check constraint/);
  assert.equal(await scalar("SELECT type FROM app.spaces WHERE id=$1", [legacyGroup]), 'shared');
  assert.equal(await asUser(b, () => scalar("SELECT count(*)::int FROM app.items WHERE id=$1", [legacyItem])), 1);
  const newUser = '44444444-4444-4444-8444-444444444444';
  await db.query("INSERT INTO auth.users(id) VALUES($1)", [newUser]);
  assert.equal(await asUser(newUser, () => scalar("SELECT count(*)::int FROM app.spaces WHERE is_default")), 1);
  assert.equal(await asUser(newUser, () => scalar("SELECT count(*)::int FROM app.space_members WHERE user_id=$1 AND role='owner'", [newUser])), 1);

  const second = await asUser(a, () => scalar("INSERT INTO app.spaces(name,type,owner_id) VALUES('학교','personal',$1) RETURNING id", [a]));
  const third = await asUser(a, () => scalar("INSERT INTO app.spaces(name,type,owner_id) VALUES('개발','personal',$1) RETURNING id", [a]));
  for (const id of [second, third]) await asUser(a, () => db.query("INSERT INTO app.space_members(space_id,user_id,role) VALUES($1,$2,'owner')", [id, a]));
  assert.equal(await scalar("SELECT count(*)::int FROM app.spaces WHERE owner_id=$1 AND type='personal'", [a]), 3);
  await asUser(a, async () => {
    await db.query("UPDATE app.spaces SET is_default=false WHERE id=$1", [first]);
    await db.query("UPDATE app.spaces SET is_default=true WHERE id=$1", [second]);
  });
  assert.equal(await scalar("SELECT id FROM app.spaces WHERE owner_id=$1 AND is_default", [a]), second);
  assert.equal((await asUser(a, () => db.query("DELETE FROM app.spaces WHERE id=$1 RETURNING id", [second]))).rows.length, 0);
  await assert.rejects(asUser(a, () => db.query("UPDATE app.spaces SET is_default=false WHERE id=$1", [second])), /default Personal Space/);
  await assert.rejects(asUser(a, () => db.query("UPDATE app.spaces SET is_default=true WHERE id=$1", [first])), /duplicate key/);
  await assert.rejects(asUser(a, () => db.query("INSERT INTO app.space_members(space_id,user_id,role) VALUES($1,$2,'member')", [first, b])), /Invalid space membership/);
  assert.equal(await asUser(b, () => scalar("SELECT count(*)::int FROM app.spaces WHERE owner_id=$1 AND type='personal'", [a])), 0);
  assert.equal(await asUser(b, () => scalar("SELECT count(*)::int FROM app.items WHERE id=$1", [item])), 0);
  const shared = await asUser(a, () => scalar("INSERT INTO app.spaces(name,type,owner_id) VALUES('가족','shared',$1) RETURNING id", [a]));
  await asUser(a, async () => {
    await db.query("INSERT INTO app.space_members(space_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member'),($1,$4,'viewer')", [shared, a, b, c]);
  });
  const sharedItem = await asUser(b, () => scalar("INSERT INTO app.items(space_id,creator_id,title) VALUES($1,$2,'공유 항목') RETURNING id", [shared, b]));
  assert.equal(await asUser(c, () => scalar("SELECT count(*)::int FROM app.items WHERE id=$1", [sharedItem])), 1);
  assert.equal((await asUser(c, () => db.query("UPDATE app.items SET title='변조' WHERE id=$1 RETURNING id", [sharedItem]))).rows.length, 0);
  await assert.rejects(asUser(c, () => db.query("INSERT INTO app.items(space_id,creator_id,title) VALUES($1,$2,'변조')", [shared, c])), /row-level security/);
  await assert.rejects(asUser(b, () => db.query("INSERT INTO app.space_members(space_id,user_id,role) VALUES($1,$2,'member')", [shared, b])), /row-level security/);
  await asUser(b, () => db.query("UPDATE app.items SET space_id=$1 WHERE id=$2", [original[1].id, sharedItem]));
  assert.equal(await asUser(c, () => scalar("SELECT count(*)::int FROM app.items WHERE id=$1", [sharedItem])), 0);
  await asUser(a, () => db.query("INSERT INTO app.automation_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING", [a]));
  const integration = await asUser(a, () => scalar("INSERT INTO app.integrations(user_id,provider) VALUES($1,'manual_share') RETURNING id", [a]));
  const event = await asUser(a, () => scalar("INSERT INTO app.inbound_events(user_id,integration_id,source_type,external_id,raw_content) VALUES($1,$2,'manual_share','key','{}') RETURNING id", [a, integration]));
  const imageInsert = "INSERT INTO app.screenshot_inputs(user_id,inbound_event_id,image_bytes,image_sha256,mime_type,file_name,width,height) VALUES($1,$2,decode('89504e47','hex'),$3,'image/png','test.png',100,100) RETURNING id";
  const sourceImage = await asUser(a, () => scalar(imageInsert, [a, event, 'a'.repeat(64)]));
  assert.equal(await asUser(b, () => scalar("SELECT count(*)::int FROM app.screenshot_inputs")), 0);
  assert.equal((await asUser(b, () => db.query("UPDATE app.screenshot_inputs SET ocr_text='변조' WHERE id=$1 RETURNING id", [sourceImage]))).rows.length, 0);
  await assert.rejects(asUser(b, () => db.query(imageInsert, [b, legacyEvent, 'b'.repeat(64)])), /foreign key/);
  await assert.rejects(asUser(a, () => db.query(imageInsert, [b, event, 'c'.repeat(64)])), /row-level security/);
  await asUser(a, () => db.query("UPDATE app.screenshot_inputs SET image_bytes=null,ocr_status='deleted' WHERE id=$1", [sourceImage]));
  assert.equal(await asUser(a, () => scalar("SELECT image_bytes FROM app.screenshot_inputs WHERE id=$1", [sourceImage])), null);
  await assert.rejects(asUser(a, () => db.query("INSERT INTO app.inbound_events(user_id,integration_id,source_type,external_id,raw_content) VALUES($1,$2,'manual_share','key','{}')", [a, integration])), /duplicate key/);
  await asUser(a, () => db.query("INSERT INTO app.item_candidates(user_id,inbound_event_id,suggested_space_id,payload,original_payload,confidence) VALUES($1,$2,$3,'{\"title\":\"후보\"}','{\"title\":\"후보\"}',0.9)", [a, event, third]));
  assert.equal(await asUser(b, () => scalar("SELECT count(*)::int FROM app.item_candidates")), 0);
  await assert.rejects(asUser(b, () => db.query("INSERT INTO app.inbound_events(user_id,integration_id,source_type,external_id,raw_content) VALUES($1,$2,'manual_share','forged','{}')", [b, integration])), /foreign key/);
  await assert.rejects(asUser(a, () => db.query("INSERT INTO app.automation_rules(user_id,scope_type,space_id,name,trigger_type,conditions,actions) VALUES($1,'space',$2,'위조','item_created','[]','[]')", [a, original[1].id])), /row-level security/);
  assert.equal(await asUser(b, () => scalar("SELECT count(*)::int FROM app.inbound_events")), 0);
  assert.equal(await scalar("SELECT id FROM app.spaces WHERE owner_id=$1 AND is_default", [a]), second);
  const assigned = await asUser(b, () => scalar("INSERT INTO app.items(space_id,creator_id,assignee_id,title) VALUES($1,$2,$2,'담당자 참조') RETURNING id", [shared, b]));
  const memberIntegration = await asUser(b, () => scalar("INSERT INTO app.integrations(user_id,provider) VALUES($1,'manual_share') RETURNING id", [b]));
  const memberEvent = await asUser(b, () => scalar("INSERT INTO app.inbound_events(user_id,integration_id,source_type,external_id,raw_content) VALUES($1,$2,'manual_share','member-key','{}') RETURNING id", [b, memberIntegration]));
  const memberCandidate = await asUser(b, () => scalar("INSERT INTO app.item_candidates(user_id,inbound_event_id,suggested_space_id,suggested_assignee_id,payload,original_payload,confidence) VALUES($1,$2,$3,$1,'{}','{}',0.9) RETURNING id", [b, memberEvent, shared]));
  const run = await asUser(a, () => scalar("INSERT INTO app.automation_runs(user_id,rule_name,trigger_type,trigger_entity_id,execution_key,status,input_snapshot,output_snapshot) VALUES($1,'공유 규칙','item_created',$2,'shared-run','success',$3,'{}') RETURNING id", [a, assigned, JSON.stringify({ entity: { actor_id: b, space_id: shared } })]));
  assert.equal(await asUser(b, () => scalar("SELECT count(*)::int FROM app.automation_runs WHERE id=$1", [run])), 1);
  assert.equal(await asUser(c, () => scalar("SELECT count(*)::int FROM app.automation_runs WHERE id=$1", [run])), 0);
  const notification = await asUser(b, () => scalar("INSERT INTO app.notifications(user_id,item_id,title,message,dedupe_key,scheduled_for) VALUES($1,$2,'알림','내용','member-notification',now()) RETURNING id", [b, assigned]));
  await asUser(a, () => db.query("DELETE FROM app.space_members WHERE space_id=$1 AND user_id=$2", [shared, b]));
  assert.equal(await asUser(a, () => scalar("SELECT assignee_id FROM app.items WHERE id=$1", [assigned])), null);
  assert.equal(await asUser(b, () => scalar("SELECT suggested_assignee_id FROM app.item_candidates WHERE id=$1", [memberCandidate])), null);
  assert.equal(await asUser(b, () => scalar("SELECT count(*)::int FROM app.automation_runs WHERE id=$1", [run])), 0);
  assert.equal(await asUser(b, () => scalar("SELECT count(*)::int FROM app.items WHERE id=$1", [assigned])), 0);
  await asUser(b, () => db.query("UPDATE app.item_candidates SET status='rejected' WHERE id=$1", [memberCandidate]));
  await asUser(b, () => db.query("UPDATE app.notifications SET status='cancelled' WHERE id=$1", [notification]));
  assert.equal(await asUser(b, () => scalar("SELECT status FROM app.notifications WHERE id=$1", [notification])), 'cancelled');
  if (process.argv[2]) {
    const fresh = await PGlite.create();
    try {
      await fresh.exec("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb DEFAULT '{}');");
      await fresh.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
      await fresh.exec((await readFile(process.argv[2], "utf8")).replace(/^\uFEFF/, ""));
      assert.equal((await fresh.query("SELECT version_num FROM app_migrations.alembic_version")).rows[0].version_num, "0007");
      await fresh.query("INSERT INTO auth.users(id) VALUES($1)", [a]);
      assert.equal((await fresh.query("SELECT name FROM app.spaces WHERE is_default")).rows[0].name, "개인 Inbox");
    } finally { await fresh.close(); }
  }
  console.log("Migration checks passed: existing data, multiple Personal Spaces, one default, Shared roles, routing, RLS, idempotency, member removal, shared execution history and read-only health RPC.");
} finally { await db.close(); }
