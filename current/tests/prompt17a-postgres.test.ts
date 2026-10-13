import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fixtureSecret as secret, orgA, orgB, userA, userB, postgresFixture } from "./helpers/postgres-fixture";
import type { PGlite } from "@electric-sql/pglite";
import { validateImportWithReplay } from "@/lib/csv/import-replay";

const ready = postgresFixture();
after(async () => (await ready).close());
const hash = "a".repeat(64);
const row = { external_deal_id: "test-deal", customer_name: "Fixture", deal_value: "25.50",
  quote_date: "2026-10-01", sales_notes: "Customer postponed the job.", transcript: null };
async function isolated(run: (db: PGlite) => Promise<void>) {
  const db = await ready;
  await db.exec("begin");
  try { await run(db); } finally { await db.exec("rollback"); }
}
async function rejected(db: PGlite, sql: string, params: unknown[], code: string) {
  await db.exec("savepoint expected_error");
  try { await assert.rejects(db.query<Record<string, unknown>>(sql, params), (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === code)); }
  finally { await db.exec("rollback to savepoint expected_error; release savepoint expected_error"); }
}
const importSql = "select public.persist_deal_import($1,$2,$3,$4,$5,$6,$7,$8::jsonb,true) as result";
function importArgs(id = crypto.randomUUID(), rows: unknown[] = [row], fingerprint = hash, organization = orgA) {
  return [secret, organization, id, fingerprint, "fixture.csv", rows.length, 0, JSON.stringify(rows)];
}
async function counts(db: PGlite) {
  return (await inspect(db, "select (select count(*) from public.deals)::int as deals,(select count(*) from public.uploads)::int as uploads,(select coalesce(sum(units),0) from public.organization_usage_events where status='committed')::int as units")).rows;
}
async function inspect(db: PGlite, sql: string) {
  await db.exec("reset role");
  try { return await db.query<Record<string, unknown>>(sql); }
  finally { await db.exec("set role authenticated"); }
}

test("PostgreSQL import persists deals, upload and usage atomically and replays without another write", () => isolated(async db => {
  const args = importArgs();
  const first = await db.query<Record<string, unknown>>(importSql, args);
  assert.deepEqual(await counts(db), [{ deals: 1, uploads: 1, units: 1 }]);
  assert.deepEqual((await db.query<Record<string, unknown>>(importSql, args)).rows, first.rows);
  assert.deepEqual(await counts(db), [{ deals: 1, uploads: 1, units: 1 }]);
  await rejected(db, importSql, importArgs(args[2] as string, [row], "b".repeat(64)), "23505");
}));
test("PostgreSQL invalid row rolls back upload, deal batches and reservation", () => isolated(async db => {
  await rejected(db, importSql, importArgs(undefined, [row, { ...row, external_deal_id: "bad", deal_value: "-1" }]), "23514");
  assert.deepEqual(await counts(db), [{ deals: 0, uploads: 0, units: 0 }]);
  assert.equal((await inspect(db,"select count(*)::int as n from public.organization_usage_events")).rows[0].n, 0);
}));
test("PostgreSQL concurrent import response loss replays completion after duplicate-ID validation changes", () => isolated(async db => {
  const args=importArgs();
  const prepared=await validateImportWithReplay(
    async()=> (await db.query<Record<string,unknown>>("select id,valid_rows from public.uploads where id=$1",[args[2]])).rows[0]??null,
    async()=>{
      // Another request commits while this request's validation is in flight.
      await db.query(importSql,args);
      const duplicate=(await db.query<Record<string,unknown>>("select count(*)::int as n from public.deals where external_deal_id=$1",[row.external_deal_id])).rows[0].n;
      return {readyRows:duplicate?[]:[row]};
    });
  assert.equal(prepared.replay?.id,args[2]);
  assert.equal(prepared.validation,null);
  assert.deepEqual(await counts(db),[{deals:1,uploads:1,units:1}]);
  let revalidated=false;
  const replay=await validateImportWithReplay(async()=>prepared.replay,async()=>{revalidated=true;return {readyRows:[]};});
  assert.equal(replay.replay?.id,args[2]); assert.equal(revalidated,false);
}));
test("PostgreSQL direct deal/upload INSERT is denied despite historical column grants", () => isolated(async db => {
  await rejected(db, "insert into public.deals(organization_id,deal_value,sales_notes) values($1,1,'bypass')", [orgA], "42501");
  await rejected(db, "insert into public.uploads(organization_id,created_by,filename) values($1,$2,'bypass.csv')", [orgA,userA], "42501");
}));
test("PostgreSQL authority and tenant spoofing fail before import or metering writes", () => isolated(async db => {
  const args = importArgs(); args[0] = "forged";
  await rejected(db, importSql, args, "42501");
  await rejected(db, importSql, importArgs(undefined, [row], hash, orgB), "42501");
  assert.deepEqual(await counts(db), [{ deals: 0, uploads: 0, units: 0 }]);
}));
test("PostgreSQL canceled Paddle-backed import stays blocked even when server shadow flag is false", () => isolated(async db => {
  await db.exec("reset role; update public.organization_subscriptions set provider='paddle_sandbox',plan_code='STARTER',subscription_status='canceled' where organization_id='" + orgA + "'; set role authenticated");
  await rejected(db, importSql.replace("true)", "false)"), importArgs(), "P0001");
  assert.deepEqual(await counts(db), [{ deals: 0, uploads: 0, units: 0 }]);
}));
test("PostgreSQL duplicate external IDs roll back the entire second import", () => isolated(async db => {
  await db.query<Record<string, unknown>>(importSql, importArgs());
  await rejected(db, importSql, importArgs(), "23505");
  assert.deepEqual(await counts(db), [{ deals: 1, uploads: 1, units: 1 }]);
}));
test("PostgreSQL queued quota-boundary reservations never exceed the limit", () => isolated(async db => {
  await db.exec("reset role; update public.organization_subscriptions set plan_code='TRIAL',subscription_status='trialing',trial_ends_at=current_period_end where organization_id='" + orgA + "'; set role authenticated");
  const reservations = await Promise.all(Array.from({ length: 12 }, (_, i) => db.query<Record<string, unknown>>(
    "select * from public.reserve_organization_usage($1,$2,'IMPORTED_DEALS',10,$3)", [secret,orgA,"boundary:"+i])));
  const allowed = reservations.filter(r => r.rows[0].allowed === true).length;
  assert.equal(allowed, 5);
}));

const analysis = {
  lost_reason: "FINANCING", lost_reason_detail: "The customer objected to the monthly payment.",
  buying_intent_score: 82, confidence_score: 91,
  evidence: [{ source: "SALES_NOTES", excerpt: "Customer postponed the job." }],
  positive_signals: ["Reviewed the system"], negative_signals: ["Monthly payment concern"],
  recommended_action: "Discuss approved payment options without promising terms.",
  recommended_timing: "Within 24–48 hours", recommended_channel: "HUMAN_CALL",
  follow_up_message: "Would you like to discuss available payment options?",
};
test("PostgreSQL fresh legacy processing state cannot be stolen or falsely recovered during cutover", () => isolated(async db => {
  await db.query(importSql,importArgs());
  const deal=(await db.query<Record<string,unknown>>("select id from public.deals")).rows[0].id;
  await db.exec("reset role; update public.deals set analysis_status='processing'; set role authenticated");
  assert.equal((await db.query<Record<string,unknown>>("select public.claim_analysis_run($1,$2,$3,'STANDARD',$4) as ok",[secret,orgA,deal,crypto.randomUUID()])).rows[0].ok,false);
  assert.equal((await db.query<Record<string,unknown>>("select public.recover_analysis_run($1,$2,$3) as ok",[secret,orgA,deal])).rows[0].ok,false);
}));
async function pendingAnalysis(db: PGlite) {
  await db.query(importSql,importArgs());
  const deal = (await db.query<Record<string,unknown>>("select id from public.deals")).rows[0].id;
  const key = "analysis:"+deal, token = crypto.randomUUID();
  const reservation = (await db.query<Record<string,unknown>>("select * from public.reserve_organization_usage($1,$2,'AI_ANALYSES',1,$3)",[secret,orgA,key])).rows[0];
  assert.equal((await db.query<Record<string,unknown>>("select public.claim_analysis_run($1,$2,$3,'STANDARD',$4) as ok",[secret,orgA,deal,token])).rows[0].ok,true);
  const persist = "select public.persist_deal_analysis($1,$2,$3,$4::jsonb,'STANDARD','standard-1.0',null,null,$5::jsonb,$6,true) as ok";
  const args = [secret,orgA,deal,JSON.stringify(analysis),JSON.stringify({runtime_claim_id:token}),key];
  assert.equal((await db.query<Record<string,unknown>>(persist,args)).rows[0].ok,true);
  return {deal,key,token,reservation,persist,args};
}
test("PostgreSQL a saved pending analysis holds quota after reservation expiry and finalizes exactly once", () => isolated(async db => {
  const {key,reservation} = await pendingAnalysis(db);
  await db.exec("reset role; update public.organization_usage_events set status='expired',reservation_expires_at=clock_timestamp()-interval '1 second' where metric='AI_ANALYSES'; set role authenticated");
  assert.equal((await db.query<Record<string,unknown>>("select public.release_unused_usage($1,$2,'AI_ANALYSES',$3,$4) as ok",
    [secret,orgA,key,reservation.reservation_token])).rows[0].ok,false);
  assert.equal((await db.query<Record<string,unknown>>("select * from public.reserve_organization_usage($1,$2,'AI_ANALYSES',1,$3)",[secret,orgA,key])).rows[0].is_new,false);
  const finalize = "select public.finalize_analysis_usage($1,$2,'AI_ANALYSES',$3,1) as ok";
  for (let i=0;i<2;i++) assert.equal((await db.query<Record<string,unknown>>(finalize,[secret,orgA,key])).rows[0].ok,true);
  assert.equal((await inspect(db,"select sum(units)::int as n from public.organization_usage_events where metric='AI_ANALYSES' and status='committed'")).rows[0].n,1);
  assert.equal((await db.query<Record<string,unknown>>("select analysis_usage_status from public.deal_analyses")).rows[0].analysis_usage_status,"COMMITTED");
}));
test("PostgreSQL a lost success response cannot turn a saved analysis into failed or release its charge", () => isolated(async db => {
  const {deal,token,persist,args} = await pendingAnalysis(db);
  assert.equal((await db.query<Record<string,unknown>>(persist,args)).rows[0].ok,false);
  assert.equal((await db.query<Record<string,unknown>>("select public.fail_analysis_run($1,$2,$3,$4,'STANDARD','ANALYSIS_FAILED',null) as ok",
    [secret,orgA,deal,token])).rows[0].ok,false);
  assert.equal((await db.query<Record<string,unknown>>("select analysis_status from public.deals")).rows[0].analysis_status,"completed");
  assert.equal((await db.query<Record<string,unknown>>("select count(*)::int as n from public.deal_analyses")).rows[0].n,1);
}));
test("PostgreSQL unused failed-operation reservations are released and retry gets a new fenced token", () => isolated(async db => {
  const key="mapping:"+crypto.randomUUID(), reserve="select * from public.reserve_organization_usage($1,$2,'AI_MAPPING_REQUESTS',1,$3)";
  const before=(await db.query<Record<string,unknown>>(reserve,[secret,orgA,key])).rows[0];
  assert.equal((await db.query<Record<string,unknown>>("select public.release_unused_usage($1,$2,'AI_MAPPING_REQUESTS',$3,$4) as ok",[secret,orgA,key,before.reservation_token])).rows[0].ok,true);
  const next=(await db.query<Record<string,unknown>>(reserve,[secret,orgA,key])).rows[0];
  assert.equal(next.is_new,true); assert.notEqual(next.reservation_token,before.reservation_token);
  assert.equal((await db.query<Record<string,unknown>>("select public.commit_organization_usage($1,$2,'AI_MAPPING_REQUESTS',$3,$4,1) as ok",[secret,orgA,key,before.reservation_token])).rows[0].ok,false);
}));
test("PostgreSQL deterministic conversion saves replay state without consuming provider usage", () => isolated(async db => {
  const key="auto-convert:"+crypto.randomUUID();
  const reservation=(await db.query<Record<string,unknown>>("select * from public.reserve_organization_usage($1,$2,'AUTO_CONVERT_ROWS',5,$3)",[secret,orgA,key])).rows[0];
  await db.query("select public.persist_provider_operation($1,$2,$3,$4,'AUTO_CONVERT_ROWS',$5,0,'{\"success\":true}'::jsonb)",
    [secret,orgA,key,hash,reservation.reservation_token]);
  assert.equal((await inspect(db,"select count(*)::int as n from public.organization_usage_events")).rows[0].n,0);
  assert.equal((await db.query<Record<string,unknown>>("select count(*)::int as n from public.provider_operation_results")).rows[0].n,1);
}));
test("PostgreSQL maximum-size import commits once and over-limit or mass-assignment payloads write nothing", () => isolated(async db => {
  const rows=Array.from({length:2000},(_,i)=>({...row,external_deal_id:"large-"+i}));
  await rejected(db,importSql,importArgs(undefined,[...rows,row]),"22023");
  await rejected(db,importSql,importArgs(undefined,[{...row,organization_id:orgB}]),"22023");
  await db.exec("reset role; update public.organization_subscriptions set plan_code='INTERNAL' where organization_id='"+orgA+"'; set role authenticated");
  await db.query(importSql,importArgs(undefined,rows));
  assert.deepEqual(await counts(db),[{deals:2000,uploads:1,units:2000}]);
}));
test("PostgreSQL every non-active Paddle state denies import and analysis claims while historical reads survive", () => isolated(async db => {
  await db.query(importSql,importArgs());
  const deal=(await db.query<Record<string,unknown>>("select id from public.deals")).rows[0].id;
  for (const status of ["past_due","paused","canceled"]) {
    await db.exec("reset role; update public.organization_subscriptions set provider='paddle_sandbox',subscription_status='"+status+"' where organization_id='"+orgA+"'; set role authenticated");
    assert.equal((await db.query<Record<string,unknown>>("select public.claim_analysis_run($1,$2,$3,'STANDARD',$4) as ok",[secret,orgA,deal,crypto.randomUUID()])).rows[0].ok,false);
    await rejected(db,importSql,importArgs(undefined,[{...row,external_deal_id:status}]),"P0001");
    assert.equal((await db.query<Record<string,unknown>>("select count(*)::int as n from public.deals")).rows[0].n,1);
  }
}));
test("PostgreSQL provider result and charge are atomic, fenced, tenant scoped and replayable", () => isolated(async db => {
  const key = "mapping:" + crypto.randomUUID();
  const reservation = (await db.query<Record<string, unknown>>("select * from public.reserve_organization_usage($1,$2,'AI_MAPPING_REQUESTS',1,$3)", [secret,orgA,key])).rows[0];
  const sql = "select public.persist_provider_operation($1,$2,$3,$4,'AI_MAPPING_REQUESTS',$5,1,$6::jsonb) as result";
  const args = [secret,orgA,key,hash,reservation.reservation_token,JSON.stringify({suggestions:[]})];
  const first = await db.query<Record<string, unknown>>(sql,args);
  assert.deepEqual((await db.query<Record<string, unknown>>(sql,args)).rows,first.rows);
  assert.equal((await inspect(db,"select sum(units)::int as units from public.organization_usage_events where status='committed'")).rows[0].units,1);
  await rejected(db,sql,[secret,orgA,key+"new",hash,crypto.randomUUID(),JSON.stringify({suggestions:[]})],"P0001");
  await db.exec("set request.jwt.claim.sub='" + userB + "'");
  assert.equal((await db.query<Record<string, unknown>>("select * from public.provider_operation_results")).rows.length,0);
  await rejected(db,sql,[secret,orgA,key,hash,null,"{}"],"42501");
}));
test("PostgreSQL usage commit is idempotent and cannot refund or inflate completed work", () => isolated(async db => {
  const key = "mapping:" + crypto.randomUUID();
  const reservation = (await db.query<Record<string, unknown>>("select * from public.reserve_organization_usage($1,$2,'AI_MAPPING_REQUESTS',1,$3)", [secret,orgA,key])).rows[0];
  const sql = "select public.commit_organization_usage($1,$2,'AI_MAPPING_REQUESTS',$3,$4,1) as ok";
  const args = [secret,orgA,key,reservation.reservation_token];
  assert.equal((await db.query<Record<string, unknown>>(sql,args)).rows[0].ok,true);
  assert.equal((await db.query<Record<string, unknown>>(sql,args)).rows[0].ok,true);
  assert.equal((await db.query<Record<string, unknown>>("select public.release_unused_usage($1,$2,'AI_MAPPING_REQUESTS',$3,$4) as ok",args)).rows[0].ok,false);
  assert.equal((await db.query<Record<string, unknown>>(sql.replace(",1)",",2)"),args)).rows[0].ok,false);
}));
test("PostgreSQL active analysis lease prevents a second claim and late failure cannot regress a newer worker", () => isolated(async db => {
  await db.query<Record<string, unknown>>(importSql,importArgs());
  const deal = (await db.query<Record<string, unknown>>("select id from public.deals")).rows[0].id;
  const oldToken = crypto.randomUUID(), newToken = crypto.randomUUID();
  const claim = "select public.claim_analysis_run($1,$2,$3,'STANDARD',$4) as ok";
  assert.equal((await db.query<Record<string, unknown>>(claim,[secret,orgA,deal,oldToken])).rows[0].ok,true);
  assert.equal((await db.query<Record<string, unknown>>(claim,[secret,orgA,deal,newToken])).rows[0].ok,false);
  await db.exec("reset role; update private.analysis_run_claims set expires_at=clock_timestamp()-interval '1 second'; update public.deals set updated_at=clock_timestamp()-interval '16 minutes'; set role authenticated");
  assert.equal((await db.query<Record<string, unknown>>("select public.recover_analysis_run($1,$2,$3) as ok",[secret,orgA,deal])).rows[0].ok,true);
  assert.equal((await db.query<Record<string, unknown>>(claim,[secret,orgA,deal,newToken])).rows[0].ok,true);
  assert.equal((await db.query<Record<string, unknown>>("select public.fail_analysis_run($1,$2,$3,$4,'STANDARD','ANALYSIS_FAILED',null) as ok",[secret,orgA,deal,oldToken])).rows[0].ok,false);
  assert.equal((await db.query<Record<string, unknown>>("select analysis_status from public.deals")).rows[0].analysis_status,"processing");
}));
