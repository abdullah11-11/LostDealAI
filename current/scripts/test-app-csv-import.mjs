import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const port = 3015;
const baseUrl = `http://127.0.0.1:${port}`;
const email = `lostdeal.prompt5.app.${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
const password = `Ld!${randomUUID()}Z9`;
const fullName = "Prompt Five App Import User";
const businessName = "Prompt Five Synthetic HVAC App";
const cookieJar = new Map();

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

function captureCookies(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const rawCookie of values) {
    const [pair, ...attributes] = rawCookie.split(";");
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1);
    const expires = attributes.join(";").toLowerCase();
    if (!value || expires.includes("max-age=0")) cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  if (cookieJar.size) headers.set("cookie", Array.from(cookieJar, ([name, value]) => `${name}=${value}`).join("; "));
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual" });
  captureCookies(response);
  return response;
}

async function submit(path, html, marker, values) {
  const formData = new FormData();
  for (const [name, value] of hiddenFields(html, marker)) formData.append(name, value);
  for (const [name, value] of Object.entries(values)) formData.append(name, value);
  return request(path, { method: "POST", body: formData, headers: { origin: baseUrl, referer: `${baseUrl}${path}` } });
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

function sampleForm(fileBytes) {
  const formData = new FormData();
  formData.append("file", new File([fileBytes], "sample-lost-deals.csv", { type: "text/csv" }));
  formData.append("mapping", JSON.stringify({
    external_deal_id: 0,
    customer_name: 1,
    deal_value: 2,
    quote_date: 3,
    status: 4,
    salesperson: 5,
    service_type: 6,
    lead_source: 7,
    sales_notes: 8,
    transcript: 9,
  }));
  formData.append("organization_id", randomUUID());
  return formData;
}

let uploadId = null;
try {
  await waitForServer();
  const signupPage = await request("/signup");
  const signupHtml = await signupPage.text();
  const signupResponse = await submit("/signup", signupHtml, "Create Account", { fullName, email, password });
  assert(redirectLocation(signupResponse)?.includes("/onboarding"), "CSV app signup did not continue to onboarding.");

  const onboardingPage = await request("/onboarding");
  const onboardingHtml = await onboardingPage.text();
  const onboardingResponse = await submit("/onboarding", onboardingHtml, "Create Workspace", { businessName, industry: "HVAC" });
  assert(redirectLocation(onboardingResponse)?.includes("/dashboard"), "CSV app onboarding failed.");

  const uploadPage = await request("/upload");
  const uploadHtml = await uploadPage.text();
  assert(uploadPage.status === 200 && uploadHtml.includes("CSV import active"), "Protected CSV upload page did not render.");
  const sampleDownload = await request("/sample-lost-deals.csv");
  const sampleBytes = await sampleDownload.arrayBuffer();
  assert(sampleDownload.status === 200 && sampleBytes.byteLength > 500, "Sample CSV download failed.");

  const validateResponse = await request("/api/uploads/validate", { method: "POST", body: sampleForm(sampleBytes) });
  const validateBody = await validateResponse.json();
  assert(validateResponse.status === 200, `Server validation failed: ${validateBody.error ?? "unknown"}`);
  assert(validateBody.validation.validRows === 10 && validateBody.validation.invalidRows === 0, "Server validation did not find 10 valid rows.");

  const importResponse = await request("/api/uploads/import", { method: "POST", body: sampleForm(sampleBytes) });
  const importBody = await importResponse.json();
  assert(importResponse.status === 200, `App CSV import failed: ${importBody.error ?? "unknown"}`);
  assert(importBody.success && importBody.insertedCount === 10 && importBody.status === "completed", "App import did not report 10 completed deals.");
  assert(importBody.organizationName === businessName, "Request-supplied organization substitution affected the server organization.");
  uploadId = importBody.uploadId;

  const duplicateResponse = await request("/api/uploads/import", { method: "POST", body: sampleForm(sampleBytes) });
  const duplicateBody = await duplicateResponse.json();
  assert(duplicateResponse.status === 422 && /All rows are invalid/.test(duplicateBody.error), "Duplicate retry was not safely rejected.");

  const verificationClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: loginData, error: loginError } = await verificationClient.auth.signInWithPassword({ email, password });
  assert(!loginError && loginData.session && loginData.user, "CSV app verification login failed.");
  const userId = loginData.user.id;
  const { data: membership } = await verificationClient.from("organization_members").select("organization_id").eq("user_id", userId).single();
  const [{ data: upload }, { data: deals }, { data: analyses }] = await Promise.all([
    verificationClient.from("uploads").select("id, organization_id, created_by, status, valid_rows").eq("id", uploadId).single(),
    verificationClient.from("deals").select("id, organization_id, upload_id, analysis_status").eq("upload_id", uploadId),
    verificationClient.from("deal_analyses").select("id").eq("organization_id", membership.organization_id),
  ]);
  assert(upload?.organization_id === membership.organization_id, "App upload organization is incorrect.");
  assert(upload?.created_by === userId && upload.status === "completed" && upload.valid_rows === 10, "App upload fields are incorrect.");
  assert(deals?.length === 10, "App import did not persist exactly 10 deals.");
  assert(deals.every((deal) => deal.organization_id === membership.organization_id && deal.upload_id === uploadId && deal.analysis_status === "pending"), "App deal tenant or analysis fields are incorrect.");
  assert(analyses?.length === 0, "App import unexpectedly created deal analyses.");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    protectedUpload: true,
    sampleDownload: true,
    serverValidation: true,
    serverRevalidation: true,
    appImport: true,
    insertedCount: deals.length,
    uploadStatus: upload.status,
    requestOrganizationIgnored: true,
    duplicateRetryBlocked: true,
    analysisStatusPending: true,
    noDealAnalyses: true,
    uploadId,
    cleanupEmail: email,
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: "FAIL",
    message: error instanceof Error ? error.message : "Unknown app CSV test failure.",
    uploadId,
    cleanupEmail: email,
  })}\n`);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
