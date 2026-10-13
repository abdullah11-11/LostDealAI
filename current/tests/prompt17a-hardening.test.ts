import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoundedRequest, RequestBodyLimitError } from "@/lib/security/request-body";
import { clientOperation } from "@/lib/security/client-operation";
import { makeSpreadsheetTextInert } from "@/lib/csv/export";
import { applySecurityHeaders } from "@/lib/security/headers";
import { validateLogin } from "@/lib/auth/validation";
import { safeRoute } from "@/lib/security/diagnostics";
import { makeFontCachePortable, makeFontCacheRelative } from "../build/font-cache-portability";
import { normalizeDashboardDeal } from "@/lib/dashboard/normalize";
import { calculateDashboardMetrics } from "@/lib/dashboard/metrics";
import { migration17 } from "./helpers/postgres-fixture";

test("actual streamed bytes enforce limits without a length header and cancel oversized input", async () => {
  let cancelled = false;
  const request = new Request("https://fixture.test/api/uploads/import", { method: "POST",
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(5)); },
      cancel() { cancelled = true; } }), duplex: "half" } as RequestInit);
  await assert.rejects(readBoundedRequest(request, 8), RequestBodyLimitError);
  assert.equal(cancelled, true);
});
test("exact body limit preserves bytes and an empty body is valid", async () => {
  assert.deepEqual(await readBoundedRequest(new Request("https://fixture.test", { method: "POST", body: "12345678" }), 8),
    new TextEncoder().encode("12345678"));
  assert.equal((await readBoundedRequest(new Request("https://fixture.test"), 8)).length, 0);
});
test("lying Content-Length cannot bypass the body limit", async () => {
  await assert.rejects(readBoundedRequest(new Request("https://fixture.test", { method: "POST",
    headers: { "Content-Length": "1" }, body: "123456789" }), 8), RequestBodyLimitError);
});
test("reload and double-click retries share a stable operation with no CSV data in storage", async () => {
  const data = new Map<string,string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key,value); },
    removeItem: (key: string) => { data.delete(key); } };
  const form = new FormData(); form.append("file",new File(["sensitive customer notes"],"fixture.csv")); form.append("date_format","AUTO");
  const [first, second] = await Promise.all([clientOperation("fixture-import",form,storage),clientOperation("fixture-import",form,storage)]);
  assert.equal(first.id,second.id);
  assert.equal((await clientOperation("fixture-import",form,storage)).id,first.id);
  assert.doesNotMatch(JSON.stringify([...data]),/sensitive|customer|notes|fixture\.csv|AUTO/);
  first.complete();
  assert.notEqual((await clientOperation("fixture-import",form,storage)).id,first.id);
});
test("changed request input starts a distinct operation and restricted storage has a safe fallback", async () => {
  const blocked = { getItem() { throw new Error("restricted"); }, setItem() { throw new Error("restricted"); }, removeItem() { throw new Error("restricted"); } };
  const first = await clientOperation("fixture-blocked",{ id: 1 },blocked);
  assert.equal((await clientOperation("fixture-blocked",{ id: 1 },blocked)).id,first.id);
  assert.notEqual((await clientOperation("fixture-blocked",{ id: 2 },blocked)).id,first.id);
  first.complete();
});
test("CSV formula protection catches leading whitespace and controls without changing ordinary text", () => {
  for (const value of ["=SUM(1,2)"," \t+cmd","\r\n@evil","\u0000-10"]) assert.equal(makeSpreadsheetTextInert(value),"'"+value);
  for (const value of ["Customer","  ordinary text","123.50"]) assert.equal(makeSpreadsheetTextInert(value),value);
});
test("auth and tenant surfaces are no-store and carry security headers", () => {
  for (const path of ["/login","/signup","/forgot-password","/reset-password","/auth/callback","/dashboard","/deals/a","/upload","/account","/api/uploads/import"]) {
    const response = applySecurityHeaders(new Response(),path,"https:");
    assert.equal(response.headers.get("cache-control"),"private, no-store");
    assert.equal(response.headers.get("x-frame-options"),"DENY");
    assert.ok(response.headers.get("strict-transport-security"));
  }
});
test("login bounds excessive passwords before contacting Auth", () => {
  const form = new FormData(); form.set("email","fixture@example.com"); form.set("password","a".repeat(129));
  assert.ok(validateLogin(form).fieldErrors.password);
});
test("safe diagnostics omit dynamic record IDs and query values", () => {
  assert.equal(safeRoute("/deals/11111111-1111-4111-8111-111111111111"),"/deals/:id");
});
test("font cache references from a previous checkout re-root to packaged fonts", async () => {
  const root = await mkdtemp(join(tmpdir(),"lostdeal-font-"));
  try {
    const cache = join(root,".vinext/fonts"); await mkdir(join(cache,"fixture"),{recursive:true});
    await writeFile(join(cache,"fixture/a.woff2"),"fixture");
    await writeFile(join(cache,"fixture/style.css"),'src:url("/old/checkout/.vinext/fonts/fixture/a.woff2")');
    await makeFontCachePortable(cache);
    assert.equal(await readFile(join(cache,"fixture/style.css"),"utf8"),"src:url("+cache+"/fixture/a.woff2)");
    await makeFontCacheRelative(cache);
    assert.equal(await readFile(join(cache,"fixture/style.css"),"utf8"),"src:url(a.woff2)");
    await makeFontCachePortable(cache);
    assert.equal(await readFile(join(cache,"fixture/style.css"),"utf8"),"src:url("+cache+"/fixture/a.woff2)");
  } finally { await rm(root,{recursive:true,force:true}); }
});
test("font cache rejects traversal rather than packaging an unrelated file", async () => {
  const root = await mkdtemp(join(tmpdir(),"lostdeal-font-"));
  try {
    await mkdir(join(root,"fixture"),{recursive:true});
    await writeFile(join(root,"fixture/style.css"),"src:url(/old/.vinext/fonts/../../secret.woff2)");
    await assert.rejects(makeFontCachePortable(root),/Invalid font cache path/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
test("all fifteen Release 45 migration files stay byte-identical with exactly one authorized forward migration", async () => {
  const paths = execFileSync("git",["ls-tree","-r","--name-only","175fe2a59dfd8d923c681cd0a8bfa514c90c8bc6","supabase/migrations"],{encoding:"utf8"}).trim().split("\n");
  assert.equal(paths.length,15);
  for (const path of paths) assert.deepEqual(await readFile(path),execFileSync("git",["show","175fe2a59dfd8d923c681cd0a8bfa514c90c8bc6:"+path]));
  assert.deepEqual((await readdir("supabase/migrations")).sort(),[...paths.map(path=>path.split("/").at(-1)!),migration17].sort());
});
test("compact dashboard JSON projection preserves scoring freshness and legacy normalization", () => {
  const row = { id:"deal",organization_id:"org",created_at:"2026-10-01",analysis_status:"completed",deal_value:10,
    deal_analyses:{id:"analysis",lost_reason:"TIMING",recovery_score:60,recovery_priority:"MEDIUM",model_metadata:{scoring:{calculated_at:"2026-10-01T01:00:00Z"}}}};
  const compact = {...row,deal_analyses:{...row.deal_analyses,model_metadata:undefined,scoring_calculated_at:"2026-10-01T01:00:00Z"}};
  assert.deepEqual(normalizeDashboardDeal(compact),normalizeDashboardDeal(row));
});
test("large dashboard metrics preserve counts, value and tenant isolation", () => {
  const records = Array.from({length:20_000},(_,i)=>normalizeDashboardDeal({id:String(i),organization_id:"org",
    created_at:"2026-10-01",analysis_status:"pending",deal_value:"25.50",deal_analyses:[]})!);
  const foreign = {...records[0],id:"foreign",organizationId:"other"};
  const metrics = calculateDashboardMetrics([...records,foreign,records[0]],"org");
  assert.equal(metrics.totalDeals,20_000); assert.equal(metrics.totalLostDealValue,510_000);
  assert.equal(metrics.statusCounts.pending,20_000);
});
