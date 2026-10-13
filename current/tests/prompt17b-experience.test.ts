import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import Papa from "papaparse";
import { buildTenantDataExport, DATA_EXPORT_MAX_BYTES, DATA_EXPORT_PAGE_SIZE, DataExportError, type ExportRow } from "@/lib/settings/data-export";
import { ProfileUpdateSchema } from "@/lib/settings/profile";
import { canSelectBillingPlan, canCancelBillingPlan, type BillingViewState } from "@/lib/billing/presentation";
import { parseRecoveryQuery, buildRecoveryUrl } from "@/lib/deals/recovery-view";
import { resolveLaunchDetails, approvedLaunchDetails } from "@/lib/marketing/launch";
import { getPolicySections } from "@/lib/marketing/policies";
import { applySecurityHeaders } from "@/lib/security/headers";
import { getFirstValueStep } from "@/lib/ui/onboarding";
const source = (p: string) => readFileSync(p, "utf8");
const row = (id = "a", extra: ExportRow = {}): ExportRow => ({ id, organization_id: "own", customer_name: "Customer", deal_value: 20, quote_date: "2026-10-05", status: "lost", ...extra });
const one = (rows: ExportRow[], count = rows.length) => async () => ({ rows, count, error: false });
const rejected = (reason: string) => (error: unknown) => error instanceof DataExportError && error.reason === reason;

test("source export contains only canonical fields and handles empty workspaces", async () => {
  const csv = await buildTenantDataExport("own", one([row()]));
  const parsed = Papa.parse(csv, { header: true });
  assert.equal(parsed.data.length, 1);
  assert.equal((parsed.data[0] as Record<string, string>).customer_name, "Customer");
  assert.doesNotMatch(csv, /organization_id|^id,/);
  assert.equal(Papa.parse(await buildTenantDataExport("own", one([])), { header: true }).data.length, 0);
});
test("export refuses cross-tenant rows rather than dropping them", async () => {
  await assert.rejects(buildTenantDataExport("own", one([row("a", { organization_id: "other" })])), rejected("invalid_scope"));
});
test("export rejects duplicate and missing identities", async () => {
  await assert.rejects(buildTenantDataExport("own", one([row(), row()])), rejected("invalid_scope"));
  await assert.rejects(buildTenantDataExport("own", one([row("")])), rejected("invalid_scope"));
});
test("export paginates a complete bounded set without omitting rows", async () => {
  const rows = Array.from({ length: DATA_EXPORT_PAGE_SIZE + 3 }, (_, i) => row(String(i)));
  const ranges: number[][] = [];
  const csv = await buildTenantDataExport("own", async (from, to) => { ranges.push([from, to]); return { rows: rows.slice(from, to + 1), count: rows.length, error: false }; });
  assert.deepEqual(ranges, [[0, DATA_EXPORT_PAGE_SIZE - 1], [DATA_EXPORT_PAGE_SIZE, DATA_EXPORT_PAGE_SIZE * 2 - 1]]);
  assert.equal(Papa.parse(csv, { header: true }).data.length, rows.length);
});
test("export fails on count changes, missing rows and inaccessible data", async () => {
  const rows = Array.from({ length: DATA_EXPORT_PAGE_SIZE }, (_, i) => row(String(i)));
  await assert.rejects(buildTenantDataExport("own", async from => ({ rows: from ? [] : rows, count: from ? 1000 : 1001, error: false })), rejected("unavailable"));
  await assert.rejects(buildTenantDataExport("own", one([row()], 2)), rejected("unavailable"));
  await assert.rejects(buildTenantDataExport("own", async () => ({ rows: [], count: null, error: true })), rejected("unavailable"));
});
test("export enforces row and byte limits and rejects non-finite values", async () => {
  await assert.rejects(buildTenantDataExport("own", one([], 5001)), rejected("too_large"));
  await assert.rejects(buildTenantDataExport("own", one([row("a", { sales_notes: "x".repeat(DATA_EXPORT_MAX_BYTES) })])), rejected("too_large"));
  await assert.rejects(buildTenantDataExport("own", one([row("a", { deal_value: Infinity })])), rejected("unavailable"));
});
test("export preserves multiline notes while neutralizing spreadsheet formulas", async () => {
  const csv = await buildTenantDataExport("own", one([row("a", { customer_name: "=1+1", salesperson: "+CMD", sales_notes: 'Line one\n"Line two"', transcript: "@SUM(1,2)" })]));
  const exported = Papa.parse<Record<string, string>>(csv, { header: true }).data[0];
  assert.equal(exported.customer_name, "'=1+1"); assert.equal(exported.salesperson, "'+CMD");
  assert.equal(exported.transcript, "'@SUM(1,2)"); assert.equal(exported.sales_notes, 'Line one\n"Line two"');
});
test("display name update normalizes valid names and rejects authority fields", () => {
  assert.deepEqual(ProfileUpdateSchema.parse({ fullName: "  Alex Doe  " }), { fullName: "Alex Doe" });
  for (const extra of [{ id: "other" }, { organization_id: "other" }, { role: "owner" }, { email: "other@example.invalid" }]) assert.equal(ProfileUpdateSchema.safeParse({ fullName: "Alex", ...extra }).success, false);
});
test("display name rejects empty, oversized and control-character values", () => {
  for (const fullName of ["", "   ", "x".repeat(101), "A\nB", "A\u0000B"]) assert.equal(ProfileUpdateSchema.safeParse({ fullName }).success, false);
});
test("profile API derives identity from fresh authentication and changes only its own name", () => {
  const api = source("app/api/settings/profile/route.ts");
  assert.match(api, /getAuthorizedRouteContext\(\)/); assert.match(api, /validateMutationRequest\(request, "json"\)/);
  assert.match(api, /readBoundedRequest\(request, 1024\)/); assert.match(api, /\.eq\("id", identity.id\)/);
  assert.match(api, /update\(\{ full_name: parsed.data.fullName \}\)/);
  assert.doesNotMatch(api, /service_role|SERVICE_ROLE|organization_memberships|email:\s*parsed|console\./);
});
test("export API adds RLS tenant scope, stable ordering, no-store and safe disposition", () => {
  const api = source("app/api/exports/deals/route.ts");
  assert.match(api, /getAuthorizedRouteContext\(\)/); assert.match(api, /\.eq\("organization_id", organization.id\)/);
  assert.match(api, /\.order\("id", \{ ascending: true \}\)/); assert.match(api, /private, no-store/);
  assert.match(api, /filename="lostdeal-workspace-deals.csv"/);
  assert.doesNotMatch(api, /\.insert\(|\.update\(|\.delete\(|reserve_usage|reconcile|createClient|console\./);
});
const billing: BillingViewState = { plan: "STARTER", status: "active", owner: true, sandbox: true, scheduledAction: null, operationPending: false };
test("plan review obeys owner, current plan, scheduled changes and operation locks", () => {
  assert.equal(canSelectBillingPlan(billing, "PRO"), true); assert.equal(canSelectBillingPlan(billing, "STARTER"), false);
  for (const extra of [{ owner: false }, { scheduledAction: "cancel" }, { operationPending: true }, { plan: "INTERNAL" }, { plan: "BUSINESS" }]) assert.equal(canSelectBillingPlan({ ...billing, ...extra }, "PRO"), false);
});
test("past-due and paused block plan changes; canceled permits owner checkout only", () => {
  for (const status of ["past_due", "paused", "trialing", null]) assert.equal(canSelectBillingPlan({ ...billing, status }, "PRO"), false);
  assert.equal(canSelectBillingPlan({ ...billing, status: "canceled" }, "PRO"), true);
  assert.equal(canSelectBillingPlan({ ...billing, status: "canceled", owner: false }, "PRO"), false);
});
test("cancellation review is limited to active unscheduled sandbox subscriptions", () => {
  assert.equal(canCancelBillingPlan(billing), true);
  for (const extra of [{ status: "canceled" }, { status: "past_due" }, { scheduledAction: "cancel" }, { operationPending: true }, { sandbox: false }, { owner: false }]) assert.equal(canCancelBillingPlan({ ...billing, ...extra }), false);
});
test("all newly sensitive routes receive private no-cache headers and no Paddle permissions", () => {
  for (const path of ["/recovery", "/insights", "/settings", "/settings/account", "/settings/privacy", "/api/exports/deals", "/api/settings/profile"]) {
    const headers = applySecurityHeaders(new Response(), path, "https:").headers;
    assert.equal(headers.get("Cache-Control"), "private, no-store"); assert.equal(headers.get("Pragma"), "no-cache");
    assert.doesNotMatch(headers.get("Content-Security-Policy")!, /paddle/);
  }
});
test("billing navigation keeps document loads for route-specific checkout CSP", () => {
  for (const file of ["components/dashboard-shell.tsx", "components/settings-frame.tsx", "components/workspace-access.tsx"]) assert.match(source(file), /<a[^>]*href="\/account"/);
  for (const file of ["components/dashboard-shell.tsx", "components/workspace-access.tsx", "app/(dashboard)/deals/[id]/page.tsx"]) assert.doesNotMatch(source(file), /<Link href="\/account/);
});
test("recovery query locks completed analysis and descending score, retaining safe filters", () => {
  const state = parseRecoveryQuery({ analysis: "pending", sort: "customer_name", direction: "asc", q: "Acme", priority: "MEDIUM" });
  assert.equal(state.analysis, "completed"); assert.equal(state.sort, "recovery_score"); assert.equal(state.direction, "desc"); assert.equal(state.q, "Acme");
  assert.equal(parseRecoveryQuery({}).priority, "HIGH"); assert.match(buildRecoveryUrl(state), /^\/recovery\?/);
});
test("first-value progress derives only from saved workspace results", () => {
  assert.deepEqual([[0,0,0],[20,0,0],[20,1,0],[20,1,1]].map(([d,a,s]) => getFirstValueStep(d,a,s)), [0,1,2,3]);
});
test("device initialization validates theme, density and sidebar without network or account writes", () => {
  const values = { "lostdeal-theme": "dark", "lostdeal-density": "compact", "lostdeal-sidebar": "collapsed" };
  const document = { documentElement: { dataset: {} as Record<string,string> } };
  vm.runInNewContext(source("public/theme-init.js"), { window: { localStorage: { getItem: (key: keyof typeof values) => values[key] } }, document });
  assert.deepEqual({ ...document.documentElement.dataset }, { theme: "dark", density: "compact", sidebar: "collapsed" });
  const fallback = { documentElement: { dataset: {} as Record<string,string> } };
  vm.runInNewContext(source("public/theme-init.js"), { window: { localStorage: { getItem: () => "<script>" } }, document: fallback });
  assert.equal(fallback.documentElement.dataset.theme, "light"); assert.equal(fallback.documentElement.dataset.density, "comfortable"); assert.equal(fallback.documentElement.dataset.sidebar, "expanded");
});
test("unapproved legal/support configuration remains closed and absent from navigation", () => {
  assert.equal(resolveLaunchDetails({ approved: false }), null);
  if (approvedLaunchDetails) assert.equal(approvedLaunchDetails.approved, true);
  for (const route of ["privacy", "terms", "refund-policy", "contact"]) assert.match(source(`app/${route}/page.tsx`), /if \(!approvedLaunchDetails\) notFound\(\)/);
  assert.match(source("components/marketing/marketing-footer.tsx"), /approvedLaunchDetails && <FooterGroup/);
});
test("legal approval requires complete valid owner facts rather than a broad flag", () => {
  const valid = { approved: true, sellerName: "Abdullah Waheed, trading as LostDeal AI", sellerStructure: "Individual / Sole Proprietor — Pakistan", sellerLocality: "Gujranwala, Punjab", sellerCountry: "Pakistan", supportEmail: "support@lostdeal.ai", privacyEmail: "privacy@lostdeal.ai", governingLaw: "Laws of the Islamic Republic of Pakistan", disputeForum: "Courts of competent jurisdiction in Gujranwala, Punjab, Pakistan", effectiveDate: "2026-10-06", refundPolicy: "No additional blanket voluntary refund guarantee. Mandatory and payment-provider rights remain applicable." };
  assert.ok(resolveLaunchDetails(valid));
  for (const patch of [{ approved: false }, { supportEmail: "javascript:alert(1)" }, { sellerName: "" }, { refundPolicy: "" }, { effectiveDate: "2026-13-01" }, { invented: true }]) assert.equal(resolveLaunchDetails({ ...valid, ...patch }), null);
});
test("approved legal identity uses a locality and country without inventing a street address", () => {
  assert.ok(approvedLaunchDetails);
  assert.equal(approvedLaunchDetails.sellerName, "Abdullah Waheed, trading as LostDeal AI");
  assert.equal(approvedLaunchDetails.sellerStructure, "Individual / Sole Proprietor — Pakistan");
  assert.equal(approvedLaunchDetails.sellerLocality, "Gujranwala, Punjab");
  assert.equal(approvedLaunchDetails.sellerCountry, "Pakistan");
  assert.equal(approvedLaunchDetails.supportEmail, "support@lostdeal.ai");
  assert.equal(approvedLaunchDetails.privacyEmail, "privacy@lostdeal.ai");
  assert.equal("sellerAddress" in approvedLaunchDetails, false);
});
test("publication rejects unresolved and dummy content even with owner approval", () => {
  assert.ok(approvedLaunchDetails);
  for (const field of ["sellerName", "sellerLocality", "sellerCountry", "governingLaw", "disputeForum", "refundPolicy"]) {
    for (const value of ["OWNER REQUIRED", "[OWNER: complete this publication fact]", "Example address to be supplied before publication", "Dummy information to be supplied before publication", "TBD policy content to be supplied before publication", "Draft policy content awaiting confirmation", "Lorem ipsum policy awaiting publication"]) {
      assert.equal(resolveLaunchDetails({ ...approvedLaunchDetails, [field]: value }), null, `${field}: ${value}`);
    }
  }
});
test("publication rejects example contacts, missing locality/country and unapproved structure", () => {
  assert.ok(approvedLaunchDetails);
  for (const field of ["supportEmail", "privacyEmail"]) {
    for (const value of ["support@example.com", "support@example.org", "support@sub.example.net", "support@example.invalid", "support@demo.test", "support@localhost", "support@dummy.lostdeal.ai", "test@lostdeal.ai", "sample@lostdeal.ai"]) {
      assert.equal(resolveLaunchDetails({ ...approvedLaunchDetails, [field]: value }), null, value);
    }
  }
  for (const patch of [{ sellerLocality: undefined }, { sellerCountry: undefined }, { sellerStructure: undefined }, { sellerStructure: "LostDeal AI LLC" }]) assert.equal(resolveLaunchDetails({ ...approvedLaunchDetails, ...patch }), null);
});
test("approved policies preserve processing, billing and mandatory-rights boundaries", () => {
  assert.ok(approvedLaunchDetails);
  const privacy = getPolicySections("privacy", approvedLaunchDetails).flatMap(section => section.paragraphs).join(" ");
  const terms = getPolicySections("terms", approvedLaunchDetails).flatMap(section => section.paragraphs).join(" ");
  const refund = getPolicySections("refund-policy", approvedLaunchDetails).flatMap(section => section.paragraphs).join(" ");
  assert.match(privacy, /based in Gujranwala, Punjab, Pakistan/);
  assert.match(privacy, /privacy@lostdeal\.ai/);
  for (const text of ["Supabase", "OpenAI", "Cloudflare", "not a zero-retention guarantee", "independent usage, billing, security or processing records"]) assert.ok(privacy.includes(text), text);
  for (const text of ["verified billing confirmation", "failed payment prevents", "credit applied on the next bill", "mandatory jurisdiction rules", "human review"]) assert.ok(terms.includes(text), text);
  for (const text of ["no additional blanket voluntary money-back guarantee", "does not itself create a refund entitlement", "mandatory customer rights", "case-by-case discretionary basis", "recorded usage are preserved"]) assert.ok(refund.includes(text), text);
  for (const text of [privacy, terms, refund]) assert.doesNotMatch(text, /OWNER REQUIRED|\[OWNER:|(?:7|14|30)[ -]day money.back guarantee|GDPR certified|SOC 2 certified|ISO certified/);
});
test("new data views remain read-only and share existing tenant-authorized queries", () => {
  for (const file of ["app/(dashboard)/recovery/page.tsx", "app/(dashboard)/insights/page.tsx"]) {
    const code = source(file); assert.match(code, /requireOrganization\(/); assert.doesNotMatch(code, /\.insert\(|\.update\(|\.delete\(|responses\.create|reconcile|reserve_usage/);
  }
});
test("native dialogs provide labeled modal semantics and a deletion-in-flight guard", () => {
  const dialog = source("components/dialog.tsx");
  for (const marker of ["<dialog", "element.showModal()", "element.close()", "aria-labelledby", "aria-describedby", "event.preventDefault()", "closeDisabled"]) assert.ok(dialog.includes(marker));
  assert.match(source("components/delete-deal-control.tsx"), /closeDisabled=\{deleting\}/);
});

test("theme text and essential input boundaries meet contrast targets", () => {
  const css=source("app/globals.css");
  function luminance(hex: string) {
    const channels=hex.match(/[a-f\d]{2}/gi)!.map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
    return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  }
  function contrast(a: string,b: string) { const x=luminance(a),y=luminance(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }
  for (const block of [css.slice(css.indexOf(':root,'),css.indexOf('html[data-theme="dark"]')),css.slice(css.indexOf('html[data-theme="dark"]'),css.indexOf('@media (prefers-color-scheme: dark)'))]) {
    const tokens=Object.fromEntries([...block.matchAll(/--([\w-]+): (#[a-f\d]{6});/gi)].map(m=>[m[1],m[2]]));
    for (const text of ["text-primary","text-secondary","text-muted","brand-content"]) for(const background of ["background","surface","surface-raised"]) assert.ok(contrast(tokens[text],tokens[background])>=4.5,`${text} on ${background}`);
    assert.ok(contrast(tokens['on-brand'],tokens.brand)>=4.5,'button label');
    assert.ok(contrast(tokens['border-strong'],tokens.surface)>=3,'input boundary');
  }
});
