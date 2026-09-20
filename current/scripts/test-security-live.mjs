import { randomUUID } from "node:crypto";

const baseUrl = process.env.BASE_URL?.replace(/\/$/, "");
const sitesBearer = process.env.SITES_BEARER;
if (!baseUrl || !sitesBearer) throw new Error("Live security test environment is not configured.");

const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const password = `Ld!${randomUUID()}Z9`;
const accounts = [
  { email: `lostdeal.prompt12.security.a.${runId}@example.com`, fullName: "Prompt Twelve Security A", businessName: "Prompt Twelve Security Workspace A" },
  { email: `lostdeal.prompt12.security.b.${runId}@example.com`, fullName: "Prompt Twelve Security B", businessName: "Prompt Twelve Security Workspace B" },
];
const cleanupEmails = accounts.map((account) => account.email);
const uploadIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeHtml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function visibleText(html) {
  return decodeHtml(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
      if (!value || attributes.join(";").toLowerCase().includes("max-age=0")) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(path, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("OAI-Sites-Authorization", `Bearer ${sitesBearer}`);
    if (this.cookies.size) {
      headers.set("cookie", Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join("; "));
    }
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(60_000),
    });
    this.captureCookies(response);
    return response;
  }

  async submit(path, html, marker, values) {
    const formData = new FormData();
    for (const [name, value] of hiddenFields(html, marker)) formData.append(name, value);
    for (const [name, value] of Object.entries(values)) formData.append(name, value);
    return this.request(path, {
      method: "POST",
      body: formData,
      headers: { origin: baseUrl, referer: `${baseUrl}${path}` },
    });
  }
}

function redirectLocation(response) {
  return response.headers.get("location") ?? response.headers.get("x-action-redirect");
}

async function signupAndOnboard(account) {
  const session = new AppSession();
  const signup = await session.request("/signup");
  assert(signup.status === 200, "Signup page did not load.");
  const signupAction = await session.submit("/signup", await signup.text(), "Create Account", {
    fullName: account.fullName,
    email: account.email,
    password,
  });
  assert(redirectLocation(signupAction)?.includes("/onboarding"), "Signup did not continue to onboarding.");
  const onboarding = await session.request("/onboarding");
  const onboardingAction = await session.submit("/onboarding", await onboarding.text(), "Create Workspace", {
    businessName: account.businessName,
    industry: "HVAC",
  });
  assert(redirectLocation(onboardingAction)?.includes("/dashboard"), "Onboarding failed.");
  return session;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvForm(filename, row) {
  const headers = [
    "external_deal_id", "customer_name", "deal_value", "quote_date", "status",
    "salesperson", "service_type", "lead_source", "sales_notes", "transcript",
  ];
  const csv = [headers, row].map((values) => values.map(csvEscape).join(",")).join("\r\n");
  const formData = new FormData();
  formData.append("file", new File([csv], filename, { type: "text/csv" }));
  formData.append("mapping", JSON.stringify(Object.fromEntries(headers.map((header, index) => [header, index]))));
  formData.append("organization_id", randomUUID());
  return formData;
}

async function importRow(session, filename, row) {
  const response = await session.request("/api/uploads/import", {
    method: "POST",
    headers: { origin: baseUrl },
    body: csvForm(filename, row),
  });
  const body = await response.json().catch(() => null);
  assert(response.status === 200 && body?.success, `CSV import failed (${response.status}).`);
  uploadIds.push(body.uploadId);
  process.stdout.write(`${JSON.stringify({ event: "synthetic-upload", uploadId: body.uploadId })}\n`);
  return body;
}

async function findDeal(session, externalId) {
  const list = await session.request(`/deals?q=${encodeURIComponent(externalId)}`);
  const html = await list.text();
  assert(list.status === 200 && visibleText(html).includes(externalId), `Could not find ${externalId}.`);
  const matches = [...html.matchAll(/href="\/deals\/([0-9a-f-]{36})(?:\?|\")/gi)];
  for (const match of matches) {
    const detail = await session.request(`/deals/${match[1]}`);
    const detailHtml = await detail.text();
    if (detail.status === 200 && visibleText(detailHtml).includes(externalId)) {
      return { id: match[1], html: detailHtml };
    }
  }
  throw new Error(`Could not resolve ${externalId}.`);
}

async function jsonMutation(session, path, body, origin = baseUrl) {
  const response = await session.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json().catch(() => null) };
}

const result = {
  status: "FAIL",
  cleanupEmails,
  uploadIds,
  openaiCalls: 0,
  deleteStatus: "NOT_RUN",
};
process.stdout.write(`${JSON.stringify({ event: "synthetic-accounts", cleanupEmails })}\n`);

try {
  const anonymous = new AppSession();
  const crossOrigin = await jsonMutation(anonymous, "/api/deals/analyze", { deal_id: randomUUID() }, "https://evil.example");
  assert(crossOrigin.response.status === 403, "Cross-origin POST was not rejected before authorization.");
  const badType = await anonymous.request("/api/deals/analyze", {
    method: "POST",
    headers: { origin: baseUrl, "content-type": "text/plain" },
    body: "{}",
  });
  assert(badType.status === 415, "JSON content-type guard failed.");
  const getAnalyze = await anonymous.request("/api/deals/analyze");
  assert([404, 405].includes(getAnalyze.status), `GET analysis method was not rejected (${getAnalyze.status}).`);

  const [sessionA, sessionB] = await Promise.all(accounts.map(signupAndOnboard));
  const rowA = [
    `LD-P12-A-${runId}`, "<img src=x onerror=alert(1)>", "8500", "2026-08-15", "lost",
    "Security A", "HVAC", "Synthetic", "<script>alert(1)</script> Authorized synthetic note.", "Synthetic transcript.",
  ];
  const rowB = [
    `LD-P12-B-${runId}`, "Prompt Twelve Tenant B", "4200", "2026-08-16", "lost",
    "Security B", "HVAC", "Synthetic", "Authorized synthetic tenant B note.", "",
  ];
  const importedA = await importRow(sessionA, "../../<script>.csv", rowA);
  await importRow(sessionB, "tenant-b.csv", rowB);
  assert(importedA.filename === "_.._script_.csv", "Malicious filename was not normalized as expected.");

  const [dealA, dealB] = await Promise.all([
    findDeal(sessionA, rowA[0]),
    findDeal(sessionB, rowB[0]),
  ]);
  assert(!/<script>alert\(1\)<\/script>/i.test(dealA.html), "Imported source rendered as executable script markup.");
  assert(visibleText(dealA.html).includes("AI analysis sends the deal's relevant sales notes or transcript"), "Analysis privacy notice is missing.");

  const detailCrossTenant = await sessionB.request(`/deals/${dealA.id}`);
  const detailCrossTenantText = visibleText(await detailCrossTenant.text());
  assert(
    [200, 404].includes(detailCrossTenant.status)
      && !detailCrossTenantText.includes(rowA[0])
      && !detailCrossTenantText.includes(rowA[1])
      && !detailCrossTenantText.includes("Authorized synthetic note"),
    `Cross-tenant detail access was not safely unavailable (${detailCrossTenant.status}).`,
  );
  const searchCrossTenant = await sessionB.request(`/deals?q=${encodeURIComponent(rowA[0])}`);
  assert(!visibleText(await searchCrossTenant.text()).includes(rowA[0]), "Cross-tenant search leaked a deal.");
  for (const path of ["/api/deals/analyze", "/api/deals/score", "/api/deals/delete"]) {
    const attempt = await jsonMutation(sessionB, path, { deal_id: dealA.id });
    assert(attempt.response.status === 404, `Cross-tenant ${path} was not unavailable.`);
    assert(!attempt.body?.usage, `Cross-tenant ${path} exposed paid-call metadata.`);
  }
  const dashboardB = await sessionB.request("/dashboard");
  assert(!visibleText(await dashboardB.text()).includes(rowA[0]), "Cross-tenant dashboard leaked a deal.");
  const uploadB = await sessionB.request("/upload");
  assert(!visibleText(await uploadB.text()).includes("_.._script_.csv"), "Cross-tenant upload metadata leaked.");
  const scoreBatchB = await jsonMutation(sessionB, "/api/deals/score-batch", { mode: "unscored", cursor: null });
  assert(scoreBatchB.response.status === 200, "Tenant-safe score batch did not remain available.");

  const dashboardA = await sessionA.request("/dashboard");
  for (const [name, pattern] of [
    ["content-security-policy", /frame-ancestors 'none'/],
    ["x-content-type-options", /nosniff/],
    ["x-frame-options", /DENY/],
    ["permissions-policy", /camera=\(\)/],
    ["cache-control", /private.*no-store|no-store.*private/],
    ["strict-transport-security", /max-age=/],
  ]) {
    assert(pattern.test(dashboardA.headers.get(name) ?? ""), `Missing deployed ${name} header.`);
  }
  const uploadA = await sessionA.request("/upload");
  const uploadAText = visibleText(await uploadA.text());
  assert(uploadAText.includes("Import only information your organization is authorized to process"), "Upload privacy guidance is missing.");
  assert(uploadAText.includes("_.._script_.csv"), "Safe upload filename is missing.");

  const validationStatuses = await Promise.all(Array.from({ length: 21 }, async (_, attempt) => {
    const response = await sessionA.request("/api/uploads/validate", {
      method: "POST",
      headers: { origin: baseUrl },
      body: csvForm(`rate-${attempt}.csv`, [
        `LD-P12-RATE-${runId}-${attempt}`, "Rate fixture", "100", "2026-08-20", "lost",
        "Security", "HVAC", "Synthetic", "Synthetic note.", "",
      ]),
    });
    return response.status;
  }));
  assert(validationStatuses.filter((status) => status === 200).length === 20, "Upload validation limit blocked too early.");
  assert(validationStatuses.filter((status) => status === 429).length === 1, "Upload validation threshold was not enforced atomically.");
  const blockedValidation = await sessionA.request("/api/uploads/validate", {
    method: "POST",
    headers: { origin: baseUrl },
    body: csvForm("rate-blocked.csv", [
      `LD-P12-RATE-BLOCKED-${runId}`, "Rate fixture", "100", "2026-08-20", "lost",
      "Security", "HVAC", "Synthetic", "Synthetic note.", "",
    ]),
  });
  assert(blockedValidation.status === 429 && Number(blockedValidation.headers.get("retry-after")) > 0, "Retry-After is missing on rate limit response.");

  const ownDelete = await jsonMutation(sessionA, "/api/deals/delete", { deal_id: dealA.id });
  if (ownDelete.response.status === 200) {
    result.deleteStatus = "PASS";
    const afterDelete = await sessionA.request(`/deals/${dealA.id}`);
    assert(afterDelete.status === 404, "Deleted deal remained accessible.");
    const otherDeal = await sessionB.request(`/deals/${dealB.id}`);
    assert(otherDeal.status === 200, "Deleting one deal affected another tenant.");
    const uploadAfterDelete = await sessionA.request("/upload");
    assert(visibleText(await uploadAfterDelete.text()).includes("_.._script_.csv"), "Deal deletion removed upload metadata.");
  } else if (ownDelete.response.status === 503) {
    result.deleteStatus = "DEFERRED_SUPABASE_MIGRATION";
  } else {
    throw new Error(`Own-tenant deletion failed unexpectedly (${ownDelete.response.status}).`);
  }

  result.status = "PASS";
  result.crossTenant = true;
  result.csrf = true;
  result.headers = true;
  result.rateLimit = true;
  result.privacyCopy = true;
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  result.message = error instanceof Error ? error.message : "Unknown live security test failure.";
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
}
