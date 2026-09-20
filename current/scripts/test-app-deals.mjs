import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

const port = 3016;
const baseUrl = `http://127.0.0.1:${port}`;
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const password = `Ld!${randomUUID()}Z9`;
const accounts = [
  { email: `lostdeal.prompt6.app.a.${runId}@example.com`, fullName: "Prompt Six App User A", businessName: "Prompt Six Synthetic HVAC A" },
  { email: `lostdeal.prompt6.app.b.${runId}@example.com`, fullName: "Prompt Six App User B", businessName: "Prompt Six Synthetic HVAC B" },
];

const server = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "start"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore",
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeHtml(value) {
  return value.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function renderedHtml(value) {
  return decodeHtml(value.replace(/<!--[\s\S]*?-->/g, ""));
}

function hiddenFields(html, marker) {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find((candidate) => candidate.includes(marker));
  assert(form, `Could not find the ${marker} form.`);
  const fields = [];
  for (const input of form.match(/<input\b[^>]*type="hidden"[^>]*>/g) ?? []) {
    const name = input.match(/name="([^"]+)"/)?.[1];
    const value = input.match(/value="([^"]*)"/)?.[1] ?? "";
    if (name) fields.push([decodeHtml(name), decodeHtml(value)]);
  }
  assert(fields.some(([name]) => name.startsWith("$ACTION_")), `The ${marker} action was not serialized.`);
  return fields;
}

class AppSession {
  constructor() {
    this.cookies = new Map();
  }

  captureCookies(response) {
    const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const rawCookie of values) {
      const [pair, ...attributes] = rawCookie.split(";");
      const separator = pair.indexOf("=");
      if (separator < 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1);
      const expires = attributes.join(";").toLowerCase();
      if (!value || expires.includes("max-age=0")) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(path, init = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set("cookie", Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual" });
    this.captureCookies(response);
    return response;
  }

  async submit(path, html, marker, values) {
    const formData = new FormData();
    for (const [name, value] of hiddenFields(html, marker)) formData.append(name, value);
    for (const [name, value] of Object.entries(values)) formData.append(name, value);
    return this.request(path, { method: "POST", body: formData, headers: { origin: baseUrl, referer: `${baseUrl}${path}` } });
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Bounded readiness retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The local production server did not become ready.");
}

function redirectLocation(response) {
  return response.headers.get("location") ?? response.headers.get("x-action-redirect");
}

async function signupAndOnboard(account) {
  const session = new AppSession();
  const signupResponse = await session.request("/signup");
  const signupHtml = await signupResponse.text();
  const signupAction = await session.submit("/signup", signupHtml, "Create Account", {
    fullName: account.fullName,
    email: account.email,
    password,
  });
  assert(redirectLocation(signupAction)?.includes("/onboarding"), "Prompt 6 signup did not continue to onboarding.");
  const onboardingResponse = await session.request("/onboarding");
  const onboardingHtml = await onboardingResponse.text();
  const onboardingAction = await session.submit("/onboarding", onboardingHtml, "Create Workspace", {
    businessName: account.businessName,
    industry: "HVAC",
  });
  assert(redirectLocation(onboardingAction)?.includes("/dashboard"), "Prompt 6 onboarding failed.");
  return session;
}

function csvForm(filename, rows) {
  const headers = [
    "external_deal_id", "customer_name", "deal_value", "quote_date", "status",
    "salesperson", "service_type", "lead_source", "sales_notes", "transcript",
  ];
  const text = Papa.unparse({ fields: headers, data: rows }, { newline: "\r\n" });
  const formData = new FormData();
  formData.append("file", new File([text], filename, { type: "text/csv" }));
  formData.append("mapping", JSON.stringify(Object.fromEntries(headers.map((header, index) => [header, index]))));
  formData.append("organization_id", randomUUID());
  return formData;
}

async function importRows(session, filename, rows) {
  const response = await session.request("/api/uploads/import", { method: "POST", body: csvForm(filename, rows) });
  const body = await response.json();
  assert(response.status === 200 && body.success, `Prompt 6 CSV import failed: ${body.error ?? "unknown"}`);
  return body;
}

function verificationClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function loginVerification(account) {
  const supabase = verificationClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: account.email, password });
  assert(!error && data.user, "Prompt 6 verification login failed.");
  const { data: membership, error: membershipError } = await supabase.from("organization_members").select("organization_id").eq("user_id", data.user.id).single();
  assert(!membershipError && membership, "Prompt 6 verification membership failed.");
  return { supabase, organizationId: membership.organization_id, userId: data.user.id };
}

const cleanupEmails = accounts.map((account) => account.email);
let uploadIds = [];
try {
  await waitForServer();
  const [sessionA, sessionB] = await Promise.all(accounts.map(signupAndOnboard));

  const emptyDealsResponse = await sessionA.request("/deals");
  const emptyDealsHtml = renderedHtml(await emptyDealsResponse.text());
  assert(
    emptyDealsResponse.status === 200 && emptyDealsHtml.includes("No lost deals yet") && emptyDealsHtml.includes("Import Deals"),
    "A workspace with no imported deals did not show the organization-empty state.",
  );

  const rowsA = Array.from({ length: 30 }, (_, index) => {
    const number = index + 1;
    return [
      `P6-A-${String(number).padStart(3, "0")}`,
      `Prompt Six Alpha ${String(number).padStart(2, "0")}`,
      String(1_000 + number * 100),
      `2026-01-${String(((number - 1) % 28) + 1).padStart(2, "0")}`,
      "lost",
      number % 2 === 0 ? "Avery Cole" : "Jordan Lee",
      number % 2 === 0 ? "Heat Pump" : "AC Repair",
      number % 3 === 0 ? "Referral" : "Website",
      `Exact synthetic sales note for Prompt Six Alpha ${String(number).padStart(2, "0")}.`,
      number === 1 ? "Exact synthetic transcript: customer requested a later installation window." : "",
    ];
  });
  const rowsB = [
    ["P6-B-SECRET", "Other Tenant Secret Customer", "9999", "2026-02-01", "lost", "Tenant B Rep", "Tenant B Service", "Referral", "Other tenant only note.", ""],
    ["P6-B-002", "Other Tenant Second Customer", "7777", "2026-02-02", "lost", "Tenant B Rep", "Tenant B Service", "Website", "Other tenant second note.", ""],
  ];

  const [importA, importB] = await Promise.all([
    importRows(sessionA, "prompt-6-30-deals.csv", rowsA),
    importRows(sessionB, "prompt-6-tenant-b.csv", rowsB),
  ]);
  uploadIds = [importA.uploadId, importB.uploadId];
  assert(importA.insertedCount === 30 && importB.insertedCount === 2, "Prompt 6 import counts are incorrect.");

  const [a, b] = await Promise.all(accounts.map(loginVerification));
  const [{ data: dealsA }, { data: dealsB }, { data: analysesBefore }] = await Promise.all([
    a.supabase.from("deals").select("*").eq("organization_id", a.organizationId).order("external_deal_id"),
    b.supabase.from("deals").select("*").eq("organization_id", b.organizationId).order("external_deal_id"),
    a.supabase.from("deal_analyses").select("id").eq("organization_id", a.organizationId),
  ]);
  assert(dealsA?.length === 30 && dealsB?.length === 2, "Tenant deal counts are incorrect.");
  assert(analysesBefore?.length === 0, "The import automatically created analysis data.");

  const analyzedDeal = dealsA.find((deal) => deal.external_deal_id === "P6-A-030");
  assert(analyzedDeal, "Analyzed test deal is missing.");
  const { error: analysisInsertError } = await a.supabase.from("deal_analyses").insert({
    id: randomUUID(),
    organization_id: a.organizationId,
    deal_id: analyzedDeal.id,
    lost_reason: "PRICE",
    lost_reason_detail: "Synthetic stored analysis used only to verify real filters.",
    buying_intent_score: 70,
    recovery_score: 88,
    confidence_score: 91,
    recovery_priority: "HIGH",
    score_explanation: "Synthetic filter test.",
    evidence: [],
    positive_signals: [],
    negative_signals: [],
  });
  assert(!analysisInsertError, "Stored analysis fixture creation failed.");
  const { error: analysisStatusError } = await a.supabase.from("deals").update({ analysis_status: "completed" }).eq("id", analyzedDeal.id);
  assert(!analysisStatusError, "Stored analysis fixture status update failed.");

  const page1Response = await sessionA.request("/deals");
  const page1 = renderedHtml(await page1Response.text());
  assert(page1Response.status === 200, "Real deals page did not render.");
  assert(
    page1.includes("Prompt Six Alpha") && page1.includes("Showing 1–25 of 30 deals"),
    `Page 1 did not show real paginated data (real=${page1.includes("Prompt Six Alpha")}, count=${page1.includes("Showing 1–25 of 30 deals")}, error=${page1.includes("Deals could not be loaded")}, empty=${page1.includes("No deals match your filters")}).`,
  );
  assert(!page1.includes("David Miller") && !page1.includes("Demo Data") && !page1.includes("Sample Analysis"), "Deals page still contains demo records or labels.");

  const page2Response = await sessionA.request("/deals?page=2");
  const page2 = renderedHtml(await page2Response.text());
  assert(page2Response.status === 200 && page2.includes("Showing 26–30 of 30 deals"), "Page 2 pagination failed.");
  assert(page2.includes("Previous") && !page2.includes("Other Tenant Secret Customer"), "Page 2 navigation or isolation failed.");

  const invalidPage = await sessionA.request("/deals?page=abc");
  assert(invalidPage.status === 200 && renderedHtml(await invalidPage.text()).includes("Showing 1–25 of 30 deals"), "Invalid page did not normalize to page 1.");
  const oversizedPage = await sessionA.request("/deals?page=999999");
  assert(oversizedPage.status === 200 && renderedHtml(await oversizedPage.text()).includes("Showing 26–30 of 30 deals"), "Oversized page did not fall back to the last page.");

  for (const path of [
    "/deals?q=Prompt+Six+Alpha+01",
    "/deals?q=alpha",
    "/deals?q=P6-A-001",
    "/deals?q=%20%20P6-A-001%20%20",
    "/deals?q=",
  ]) {
    const response = await sessionA.request(path);
    const html = renderedHtml(await response.text());
    assert(response.status === 200 && html.includes("Prompt Six Alpha"), `Search failed for ${path}.`);
  }
  const hostileSearch = await sessionA.request("/deals?q=%25_%2C%28%29%22%27");
  const hostileHtml = renderedHtml(await hostileSearch.text());
  assert(hostileSearch.status === 200 && !hostileHtml.includes("Deals could not be loaded"), "Special-character search altered query structure.");

  const tenantSearch = await sessionA.request("/deals?q=P6-B-SECRET");
  const tenantSearchHtml = renderedHtml(await tenantSearch.text());
  assert(tenantSearch.status === 200 && tenantSearchHtml.includes("No deals match your filters") && !tenantSearchHtml.includes("Other Tenant Secret Customer"), "Cross-tenant search exposed a deal.");

  const filterChecks = [
    ["/deals?analysis=pending", "29 deals"],
    ["/deals?analysis=completed", "Prompt Six Alpha 30"],
    ["/deals?service=Heat+Pump", "15 deals"],
    ["/deals?salesperson=Avery+Cole", "15 deals"],
    ["/deals?priority=HIGH", "Prompt Six Alpha 30"],
    ["/deals?reason=PRICE", "Prompt Six Alpha 30"],
  ];
  for (const [path, expected] of filterChecks) {
    const response = await sessionA.request(path);
    const html = renderedHtml(await response.text());
    assert(response.status === 200 && html.includes(expected), `Filter failed for ${path}.`);
  }

  const valueAsc = renderedHtml(await (await sessionA.request("/deals?sort=value&direction=asc")).text());
  assert(valueAsc.indexOf("$1,100") >= 0 && valueAsc.indexOf("$1,100") < valueAsc.indexOf("$1,200"), "Deal value ascending sort failed.");
  const valueDesc = renderedHtml(await (await sessionA.request("/deals?sort=value&direction=desc")).text());
  assert(valueDesc.indexOf("$4,000") >= 0 && valueDesc.indexOf("$4,000") < valueDesc.indexOf("$3,900"), "Deal value descending sort failed.");
  const quoteAsc = renderedHtml(await (await sessionA.request("/deals?sort=quote_date&direction=asc")).text());
  assert(quoteAsc.indexOf("Jan 1, 2026") >= 0 && quoteAsc.indexOf("Jan 1, 2026") < quoteAsc.indexOf("Jan 2, 2026"), "Quote date oldest sort failed.");
  const quoteDesc = renderedHtml(await (await sessionA.request("/deals?sort=quote_date&direction=desc")).text());
  assert(quoteDesc.indexOf("Jan 28, 2026") >= 0 && quoteDesc.indexOf("Jan 28, 2026") < quoteDesc.indexOf("Jan 27, 2026"), "Quote date newest sort failed.");
  assert((await sessionA.request("/deals?sort=created&direction=desc")).status === 200, "Created date sort failed.");

  const sourceDeal = dealsA.find((deal) => deal.external_deal_id === "P6-A-001");
  const tenantBDeal = dealsB.find((deal) => deal.external_deal_id === "P6-B-SECRET");
  assert(sourceDeal && tenantBDeal, "Detail test deals are missing.");
  const detailResponse = await sessionA.request(`/deals/${sourceDeal.id}?from=${encodeURIComponent("/deals?q=P6-A-001")}`);
  const detail = renderedHtml(await detailResponse.text());
  for (const exactValue of [
    "Prompt Six Alpha 01",
    "P6-A-001",
    "$1,100",
    "Jan 1, 2026",
    "AC Repair",
    "Jordan Lee",
    "Website",
    "Exact synthetic sales note for Prompt Six Alpha 01.",
    "Exact synthetic transcript: customer requested a later installation window.",
    "Ready for Analysis",
  ]) assert(detail.includes(exactValue), `Deal detail is missing: ${exactValue}`);
  assert(detailResponse.status === 200 && detail.includes("Deal Information") && detail.includes("Deal Intelligence"), "Deal detail source/analysis sections failed.");
  assert(!detail.includes("Sample Analysis") && !detail.includes("Fictional demonstration"), "Deal detail still contains demo content.");

  const [bReadsADetail, aReadsBDetail] = await Promise.all([
    sessionB.request(`/deals/${sourceDeal.id}`),
    sessionA.request(`/deals/${tenantBDeal.id}`),
  ]);
  assert(bReadsADetail.status === 404 && aReadsBDetail.status === 404, "Cross-tenant detail route did not return not found.");
  assert(!renderedHtml(await bReadsADetail.text()).includes("Prompt Six Alpha 01"), "User B received User A detail data.");
  assert(!renderedHtml(await aReadsBDetail.text()).includes("Other Tenant Secret Customer"), "User A received User B detail data.");

  const tenantBList = await sessionB.request("/deals");
  const tenantBListHtml = renderedHtml(await tenantBList.text());
  assert(tenantBListHtml.includes("Other Tenant Secret Customer") && !tenantBListHtml.includes("Prompt Six Alpha"), "Cross-tenant list isolation failed.");

  const uploadPage = await sessionA.request("/upload");
  const uploadHtml = renderedHtml(await uploadPage.text());
  assert(uploadPage.status === 200 && uploadHtml.includes("prompt-6-30-deals.csv") && uploadHtml.includes("CSV import active"), "Prompt 5 upload history regression failed.");
  const sampleDownload = await sessionA.request("/sample-lost-deals.csv");
  assert(sampleDownload.status === 200 && (await sampleDownload.text()).includes("SYN-HVAC-1001"), "Prompt 5 sample download regression failed.");
  const dashboard = await sessionA.request("/dashboard");
  const dashboardHtml = renderedHtml(await dashboard.text());
  assert(dashboard.status === 200 && dashboardHtml.includes("Recovery Overview") && dashboardHtml.includes("Total Lost Deal Value"), "Real recovery dashboard did not render.");
  assert(!dashboardHtml.includes("Demo / Sample Data") && !dashboardHtml.includes("Sample data"), "Dashboard still contains demo labels.");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    realDeals: true,
    demoRemoved: true,
    search: true,
    searchInputSafety: true,
    filters: { analysis: true, service: true, salesperson: true, priority: true, reason: true },
    sorts: { valueAscending: true, valueDescending: true, quoteNewest: true, quoteOldest: true, createdNewest: true },
    pagination: { page1: true, page2: true, invalidPage: true, oversizedPage: true, count: true },
    emptyState: true,
    searchEmptyState: true,
    detailSourceData: true,
    pendingState: true,
    noAutomaticAnalysis: true,
    crossTenantList: true,
    crossTenantDetail: true,
    crossTenantSearch: true,
    prompt5UploadRegression: true,
    realRecoveryDashboard: true,
    uploadIds,
    cleanupEmails,
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: "FAIL",
    message: error instanceof Error ? error.message : "Unknown Prompt 6 application test failure.",
    uploadIds,
    cleanupEmails,
  })}\n`);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
