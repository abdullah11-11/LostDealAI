import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import type { UsageMetric } from "@/lib/billing/plans";
import { fixtureSecret, orgA, postgresFixture, userA } from "./helpers/postgres-fixture";
import { serverHarness, type Operation } from "./helpers/prompt18b-server-harness";

const ready = postgresFixture();
after(async () => (await ready).close());
type Harness = ReturnType<typeof serverHarness>;
const operations: Operation[] = ["standard", "deep", "mapping", "auto", "import"];
const metrics: Record<Operation, UsageMetric> = { standard: "AI_ANALYSES", deep: "AI_ANALYSES", mapping: "AI_MAPPING_REQUESTS", auto: "AUTO_CONVERT_ROWS", import: "IMPORTED_DEALS" };
const limits: Record<Operation, number> = { standard: 10, deep: 2, mapping: 3, auto: 25, import: 50 };

/** Every case rolls back synthetic fixture data. All 16 production migrations and
 * RPC bodies are unchanged; only Auth, rate-limit and provider boundaries are isolated.
 * Simultaneous requests use PGlite's queued connection, not independent DB sessions. */
async function isolated(run: (db: PGlite, h: Harness) => Promise<void>, mode: "ENFORCED" | "SHADOW" = "ENFORCED") {
  const db = await ready;
  await db.exec("begin");
  try {
    await db.exec("reset role; update public.organization_subscriptions set plan_code='TRIAL',subscription_status='trialing',provider=null," +
      "current_period_start=clock_timestamp()-interval '1 day',current_period_end=clock_timestamp()+interval '13 days'," +
      "trial_ends_at=clock_timestamp()+interval '13 days' where organization_id='" + orgA + "'; set role authenticated;");
    await run(db, serverHarness(db, mode));
  } finally { await db.exec("rollback"); }
}

async function deal(db: PGlite): Promise<string> {
  const id = crypto.randomUUID();
  await db.exec("reset role");
  await db.query("insert into public.deals(id,organization_id,deal_value,sales_notes,transcript) values($1,$2,2500,$3,$4)",
    [id, orgA, "Customer likes the system but monthly payments are unaffordable.", "Customer: I like the system. The monthly payment is too high for us right now."]);
  await db.exec("set role authenticated");
  return id;
}
async function operationId(db: PGlite, operation: Operation) {
  return operation === "standard" || operation === "deep" ? deal(db) : crypto.randomUUID();
}
async function seed(h: Harness, metric: UsageMetric, units: number, deep = false) {
  const key = (deep ? "deep-analysis:" : "fixture:") + crypto.randomUUID();
  const reservation = await h.usage.reserveOrganizationUsage(h.client as never, orgA, metric, units, key);
  assert.equal(reservation.allowed, true, "fixture seed must remain inside the real allowance");
  assert.equal(await h.usage.commitOrganizationUsage(h.client as never, orgA, reservation, units), true);
}
async function used(db: PGlite, metric: UsageMetric): Promise<number> {
  await db.exec("reset role");
  const result = await db.query<{ total: number }>("select coalesce(sum(units),0)::integer total from public.organization_usage_events where organization_id=$1 and metric=$2 and status='committed'", [orgA, metric]);
  await db.exec("set role authenticated");
  return result.rows[0].total;
}
async function activeReserved(db: PGlite, metric: UsageMetric): Promise<number> {
  await db.exec("reset role");
  const result = await db.query<{ total: number }>("select coalesce(sum(units),0)::integer total from public.organization_usage_events where organization_id=$1 and metric=$2 and status='reserved' and reservation_expires_at>clock_timestamp()", [orgA, metric]);
  await db.exec("set role authenticated");
  return result.rows[0].total;
}
function totalCalls(h: Harness) { return Object.values(h.calls).reduce((sum, value) => sum + value, 0); }
function success(operation: Operation) { return operation === "standard" || operation === "deep" ? "completed" : 200; }
function quotaDenied(operation: Operation) { return operation === "standard" || operation === "deep" ? "quota_exceeded" : 403; }
function assertNoCalls(h: Harness) { assert.deepEqual(h.calls, { standard: 0, deep: 0, mapping: 0, auto: 0 }); }
async function assertNoImport(db: PGlite) {
  assert.equal((await db.query<{ n: number }>("select count(*)::integer n from public.uploads where organization_id=$1", [orgA])).rows[0].n, 0);
}

test("new organization RPC catalog retains a 14-day trial and the fixed 50/10/3/2/25 policy", () => isolated(async (db, h) => {
  const id = crypto.randomUUID();
  await db.exec("reset role");
  await db.query("insert into public.organizations(id,name,created_by) values($1,'Synthetic new trial',$2)", [id, userA]);
  const subscription = (await db.query<{ plan_code: string; subscription_status: string; days: number; trial_matches: boolean }>("select plan_code,subscription_status,extract(epoch from(current_period_end-current_period_start))/86400 days,trial_ends_at=current_period_end trial_matches from public.organization_subscriptions where organization_id=$1", [id])).rows[0];
  assert.deepEqual({ ...subscription, days: Number(subscription.days) }, { plan_code: "TRIAL", subscription_status: "trialing", days: 14, trial_matches: true });
  await db.exec("set role authenticated");
  const snapshot = await h.usage.getOrganizationUsageSnapshot(h.client as never, orgA);
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.mode, "ENFORCED");
  assert.deepEqual(Object.values(snapshot.usage!).map(line => line.allowance), [50, 10, 3, 25]);
  await seed(h, "AI_ANALYSES", 2, true);
  assert.equal((await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AI_ANALYSES", 1, "deep-analysis:" + crypto.randomUUID())).allowed, false);
}));

for (const operation of operations) {
  test(`${operation}: valid trial executes through actual server path and commits once`, () => isolated(async (db, h) => {
    const id = await operationId(db, operation);
    const result = await h.invoke(operation, id);
    assert.equal(result.status, success(operation), JSON.stringify(result));
    assert.equal(await used(db, metrics[operation]), 1);
    assert.equal(await activeReserved(db, metrics[operation]), 0);
    if (operation === "import") assertNoCalls(h);
    else assert.ok(totalCalls(h) >= 1);
  }));

  test(`${operation}: expired trial blocks new work before provider/import persistence`, () => isolated(async (db, h) => {
    const id = await operationId(db, operation);
    await db.exec("reset role; update public.organization_subscriptions set trial_ends_at=clock_timestamp()-interval '1 second',current_period_end=clock_timestamp()-interval '1 second' where organization_id='" + orgA + "';set role authenticated;");
    assert.equal((await h.invoke(operation, id)).status, quotaDenied(operation));
    assertNoCalls(h);
    assert.equal(await used(db, metrics[operation]), 0);
    assert.equal(await activeReserved(db, metrics[operation]), 0);
    await assertNoImport(db);
  }));

  test(`${operation}: exact exhausted allowance blocks new work and releases rejected reservation`, () => isolated(async (db, h) => {
    await seed(h, metrics[operation], limits[operation], operation === "deep");
    const id = await operationId(db, operation);
    assert.equal((await h.invoke(operation, id)).status, quotaDenied(operation));
    assertNoCalls(h);
    assert.equal(await used(db, metrics[operation]), limits[operation]);
    assert.equal(await activeReserved(db, metrics[operation]), 0);
    await assertNoImport(db);
  }));

  test(`${operation}: failed metering RPC produces zero provider calls and no business result`, () => isolated(async (db, h) => {
    const id = await operationId(db, operation);
    h.unavailable.add(operation === "import" ? "persist_deal_import" : "reserve_organization_usage");
    assert.notEqual((await h.invoke(operation, id)).status, success(operation));
    assertNoCalls(h);
    assert.equal(await used(db, metrics[operation]), 0);
    await assertNoImport(db);
  }));

  test(`${operation}: response-loss/replay never spends or commits twice`, () => isolated(async (db, h) => {
    const id = await operationId(db, operation);
    h.lostReplies.set(operation === "import" ? "persist_deal_import" : operation === "mapping" || operation === "auto" ? "persist_provider_operation" : "finalize_analysis_usage", 1);
    assert.equal((await h.invoke(operation, id)).status, success(operation));
    const calls = { ...h.calls };
    assert.equal((await h.invoke(operation, id)).status, success(operation));
    assert.deepEqual(h.calls, calls);
    assert.equal(await used(db, metrics[operation]), 1);
    assert.equal(await activeReserved(db, metrics[operation]), 0);
    if (operation === "import") {
      assert.equal((await db.query<{ n: number }>("select count(*)::integer n from public.uploads where organization_id=$1", [orgA])).rows[0].n, 1);
      assert.equal((await db.query<{ n: number }>("select count(*)::integer n from public.deals where organization_id=$1", [orgA])).rows[0].n, 1);
    }
  }));

  test(`${operation}: simultaneous distinct requests share the remaining one-unit capacity`, () => isolated(async (db, h) => {
    await seed(h, metrics[operation], limits[operation] - 1, operation === "deep");
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await operationId(db, operation));
    const results = await Promise.all(ids.map(id => h.invoke(operation, id)));
    assert.equal(results.filter(result => result.status === success(operation)).length, 1);
    assert.equal(results.filter(result => result.status === quotaDenied(operation)).length, 3);
    assert.equal(await used(db, metrics[operation]), limits[operation]);
    assert.equal(await activeReserved(db, metrics[operation]), 0);
    if (operation === "import") assertNoCalls(h);
    else assert.equal(totalCalls(h), 1);
  }));
}

for (const operation of operations.filter(operation => operation !== "import")) {
  test(`${operation}: concurrent duplicate is fenced while original provider is pending`, () => isolated(async (db, h) => {
    const id = await operationId(db, operation);
    let entered!: () => void;
    let release!: () => void;
    const providerEntered = new Promise<void>(resolve => { entered = resolve; });
    const providerReleased = new Promise<void>(resolve => { release = resolve; });
    h.pauseProvider(async () => { entered(); await providerReleased; });
    const first = h.invoke(operation, id);
    try {
      // Returning before reaching the provider boundary is a test failure.
      await Promise.race([providerEntered, first.then(result => { throw new Error("Provider not reached: " + JSON.stringify(result)); })]);
      const duplicate = await h.invoke(operation, id);
      assert.equal(duplicate.status, operation === "standard" || operation === "deep" ? "processing" : 409);
      assert.equal(totalCalls(h), 1);
    } finally { release(); await first; }
    assert.equal((await first).status, success(operation));
    assert.equal(await used(db, metrics[operation]), 1);
    const replay = await h.invoke(operation, id);
    assert.equal(replay.status, success(operation));
    assert.equal(totalCalls(h), 1);
  }));

  test(`${operation}: provider failure releases capacity and the supported retry commits once`, () => isolated(async (db, h) => {
    const id = await operationId(db, operation);
    h.failProvider(true);
    const failed = await h.invoke(operation, id);
    if (operation === "auto") {
      // Extraction failure preserves a durable partial result. The UI completes
      // that operation and retries unresolved rows with a fresh operation ID.
      assert.equal(failed.status, 200);
      assert.equal(failed.body?.success, true);
      assert.equal(failed.body?.partial, true);
      assert.equal(failed.body?.usageUnits, 0);
      assert.equal(failed.body?.providerRowsCompleted, 0);
      assert.deepEqual(failed.body?.retryableRowNumbers, [2]);
    } else assert.notEqual(failed.status, success(operation));
    assert.equal(totalCalls(h), 1);
    assert.equal(await used(db, metrics[operation]), 0);
    assert.equal(await activeReserved(db, metrics[operation]), 0);
    h.failProvider(false);
    if (operation === "auto") {
      const replay = await h.invoke(operation, id);
      assert.deepEqual(replay, failed);
      assert.equal(totalCalls(h), 1);
      const retryId = crypto.randomUUID();
      const retry = { rowNumbers: failed.body!.retryableRowNumbers as number[], recipe: failed.body!.recipe };
      const completed = await h.invoke(operation, retryId, 1, retry);
      assert.equal(completed.status, 200);
      assert.equal(completed.body?.partial, false);
      assert.equal(completed.body?.usageUnits, 1);
      assert.deepEqual(completed.body?.retryableRowNumbers, []);
      assert.deepEqual(await h.invoke(operation, retryId, 1, retry), completed);
    } else assert.equal((await h.invoke(operation, id)).status, success(operation));
    assert.equal(totalCalls(h), 2);
    assert.equal(await used(db, metrics[operation]), 1);
    assert.equal(await activeReserved(db, metrics[operation]), 0);
    assert.equal((await h.invoke(operation, id)).status, success(operation));
    assert.equal(totalCalls(h), 2);
  }));
}

test("import: simultaneous duplicate inserts one upload/deal and commits one unit", () => isolated(async (db, h) => {
  const id = crypto.randomUUID();
  const results = await Promise.all(Array.from({ length: 4 }, () => h.invoke("import", id)));
  assert.deepEqual(results.map(result => result.status), [200, 200, 200, 200]);
  assertNoCalls(h);
  assert.equal(await used(db, "IMPORTED_DEALS"), 1);
  assert.equal((await db.query<{ n: number }>("select count(*)::integer n from public.uploads where organization_id=$1", [orgA])).rows[0].n, 1);
  assert.equal((await db.query<{ n: number }>("select count(*)::integer n from public.deals where organization_id=$1", [orgA])).rows[0].n, 1);
}));

test("import: temporarily unavailable atomic persistence retries the same operation without duplicate rows", () => isolated(async (db, h) => {
  const id = crypto.randomUUID();
  h.unavailable.add("persist_deal_import");
  assert.equal((await h.invoke("import", id)).status, 503);
  assert.equal(await used(db, "IMPORTED_DEALS"), 0);
  await assertNoImport(db);
  h.unavailable.delete("persist_deal_import");
  assert.equal((await h.invoke("import", id)).status, 200);
  assert.equal((await h.invoke("import", id)).status, 200);
  assert.equal(await used(db, "IMPORTED_DEALS"), 1);
  assertNoCalls(h);
}));

test("Deep: own two-operation cap does not consume the remaining eight Standard analyses", () => isolated(async (db, h) => {
  await seed(h, "AI_ANALYSES", 2, true);
  assert.equal((await h.invoke("deep", await deal(db))).status, "quota_exceeded");
  assert.equal(h.calls.deep, 0);
  assert.equal((await h.invoke("standard", await deal(db))).status, "completed");
  assert.equal(h.calls.standard, 1);
  assert.equal(await used(db, "AI_ANALYSES"), 3);
}));

test("Deep: a permitted Deep operation also consumes the shared ten-analysis cap", () => isolated(async (db, h) => {
  await seed(h, "AI_ANALYSES", 9);
  assert.equal((await h.invoke("deep", await deal(db))).status, "completed");
  assert.equal(await used(db, "AI_ANALYSES"), 10);
  assert.equal((await h.invoke("standard", await deal(db))).status, "quota_exceeded");
  assert.equal((await h.invoke("deep", await deal(db))).status, "quota_exceeded");
  assert.equal(h.calls.deep, 1);
  assert.equal(h.calls.standard, 0);
}));

test("Auto Convert: all 25 unresolved rows fit and a 26th new row never reaches a provider", () => isolated(async (db, h) => {
  const id = crypto.randomUUID();
  assert.equal((await h.invoke("auto", id, 25)).status, 200);
  assert.equal(await used(db, "AUTO_CONVERT_ROWS"), 25);
  const calls = { ...h.calls };
  assert.equal((await h.invoke("auto", crypto.randomUUID())).status, 403);
  assert.deepEqual(h.calls, calls);
  assert.equal((await h.invoke("auto", id, 25)).status, 200);
  assert.deepEqual(h.calls, calls);
}));

test("Auto Convert: one oversized 26-row operation is blocked atomically before any paid work", () => isolated(async (db, h) => {
  assert.equal((await h.invoke("auto", crypto.randomUUID(), 26)).status, 403);
  assertNoCalls(h);
  assert.equal(await used(db, "AUTO_CONVERT_ROWS"), 0);
  assert.equal(await activeReserved(db, "AUTO_CONVERT_ROWS"), 0);
}));

test("Import: exact 50-row trial allowance is atomic and the 51st row cannot persist", () => isolated(async (db, h) => {
  const id = crypto.randomUUID();
  assert.equal((await h.invoke("import", id, 50)).status, 200);
  assert.equal(await used(db, "IMPORTED_DEALS"), 50);
  assert.equal((await h.invoke("import", crypto.randomUUID())).status, 403);
  assert.equal((await h.invoke("import", id, 50)).status, 200);
  assert.equal((await db.query<{ n: number }>("select count(*)::integer n from public.deals where organization_id=$1", [orgA])).rows[0].n, 50);
  assertNoCalls(h);
}));

test("All metrics: future trial window and missing trial end fail closed at the real RPC", () => isolated(async (db, h) => {
  for (const state of ["future", "missing-end"]) {
    await db.exec("reset role;update public.organization_subscriptions set current_period_start=" + (state === "future" ? "clock_timestamp()+interval '1 day'" : "clock_timestamp()-interval '1 day'") + ", current_period_end=clock_timestamp()+interval '15 days',trial_ends_at=" + (state === "future" ? "clock_timestamp()+interval '15 days'" : "null") + " where organization_id='" + orgA + "';set role authenticated;");
    for (const metric of new Set(Object.values(metrics))) {
      const reservation = await h.usage.reserveOrganizationUsage(h.client as never, orgA, metric, 1, "future:" + crypto.randomUUID());
      assert.equal(reservation.available, true);
      assert.equal(reservation.allowed, false);
      assert.equal(await h.usage.releaseUnusedUsage(h.client as never, orgA, reservation), true);
    }
  }
  assertNoCalls(h);
}));

test("SHADOW records trial denials while permitting internal rollout; ENFORCED behavior is test-local", () => isolated(async (db, h) => {
  await seed(h, "AI_ANALYSES", 10);
  const reservation = await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AI_ANALYSES", 1, "shadow:" + crypto.randomUUID());
  assert.equal(reservation.available, true);
  assert.equal(reservation.allowed, true);
  assert.equal(reservation.wouldDeny, true);
  assert.equal(reservation.mode, "SHADOW");
  assert.equal(await h.usage.releaseUnusedUsage(h.client as never, orgA, reservation), true);
  assertNoCalls(h);
}, "SHADOW"));

test("Paddle-backed ended subscription remains authoritative even in SHADOW for all five paths", () => isolated(async (db, h) => {
  await db.exec("reset role;update public.organization_subscriptions set plan_code='PRO',provider='paddle_sandbox',subscription_status='canceled' where organization_id='" + orgA + "';set role authenticated;");
  for (const operation of operations) {
    assert.notEqual((await h.invoke(operation, await operationId(db, operation))).status, success(operation));
  }
  assertNoCalls(h);
  for (const metric of new Set(Object.values(metrics))) assert.equal(await used(db, metric), 0);
  await assertNoImport(db);
}, "SHADOW"));

test("Authority read failure cannot bypass provider gating in SHADOW", () => isolated(async (db, h) => {
  const standardId = await deal(db);
  const deepId = await deal(db);
  h.unavailable.add("organization_subscriptions");
  assert.notEqual((await h.invoke("standard", standardId)).status, "completed");
  assert.notEqual((await h.invoke("deep", deepId)).status, "completed");
  assert.notEqual((await h.invoke("mapping", crypto.randomUUID())).status, 200);
  assert.notEqual((await h.invoke("auto", crypto.randomUUID())).status, 200);
  assertNoCalls(h);
}, "SHADOW"));

test("Analysis persistence unavailable retains fencing and retries without another provider call", () => isolated(async (db, h) => {
  const id = await deal(db);
  h.unavailable.add("finalize_analysis_usage");
  assert.equal((await h.invoke("standard", id)).status, "usage_pending");
  assert.equal(h.calls.standard, 1);
  assert.equal(await used(db, "AI_ANALYSES"), 0);
  assert.equal(await activeReserved(db, "AI_ANALYSES"), 1);
  h.unavailable.delete("finalize_analysis_usage");
  assert.equal((await h.invoke("standard", id)).status, "completed");
  assert.equal(h.calls.standard, 1);
  assert.equal(await used(db, "AI_ANALYSES"), 1);
}));

test("Metering authority rejects synthetic wrong secret before creating reservation", () => isolated(async (db, h) => {
  const result = await h.client.rpc("reserve_organization_usage", { target_authority_secret: fixtureSecret + "-wrong", target_organization_id: orgA,
    target_metric: "AI_ANALYSES", target_units: 1, target_idempotency_key: "wrong:" + crypto.randomUUID() });
  assert.equal(result.error?.code, "42501");
  assert.equal(await used(db, "AI_ANALYSES"), 0);
  assert.equal(await activeReserved(db, "AI_ANALYSES"), 0);
  assertNoCalls(h);
}));
