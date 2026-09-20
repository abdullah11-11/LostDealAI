import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { autoMapColumns } from "../lib/csv/mapping.ts";
import { parseCsvText, validateCsvRows } from "../lib/csv/validation.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Supabase public environment is not configured.");

const runId = `${Date.now()}-${webcrypto.randomUUID().slice(0, 8)}`;
const password = `Ld!${webcrypto.randomUUID()}Aa9`;
const accounts = [
  { email: `lostdeal.prompt5.rls.a.${runId}@example.com`, name: "Prompt Five CSV User A", business: "Prompt Five Synthetic HVAC A" },
  { email: `lostdeal.prompt5.rls.b.${runId}@example.com`, name: "Prompt Five CSV User B", business: "Prompt Five Synthetic HVAC B" },
];

function client() {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function uuidBytes(uuid) {
  const compact = uuid.replaceAll("-", "");
  return Uint8Array.from(compact.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

async function primaryOrganizationIdForUser(userId) {
  const namespace = uuidBytes("46a0f9dc-a07b-4f4a-9952-3d58ef8392d8");
  const name = new TextEncoder().encode(userId);
  const input = new Uint8Array(namespace.length + name.length);
  input.set(namespace);
  input.set(name, namespace.length);
  const digest = new Uint8Array(await webcrypto.subtle.digest("SHA-1", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function signupAndOnboard(account) {
  const supabase = client();
  const { data, error } = await supabase.auth.signUp({
    email: account.email,
    password,
    options: { data: { full_name: account.name } },
  });
  assert(!error && data.session && data.user, "CSV RLS test signup failed.");
  const userId = data.user.id;
  const organizationId = await primaryOrganizationIdForUser(userId);
  const { error: organizationError } = await supabase.from("organizations").insert({
    id: organizationId,
    name: account.business,
    industry: "HVAC",
    created_by: userId,
  });
  assert(!organizationError, "CSV RLS test organization creation failed.");
  const { error: membershipError } = await supabase.from("organization_members").insert({
    organization_id: organizationId,
    user_id: userId,
    role: "owner",
  });
  assert(!membershipError, "CSV RLS test membership creation failed.");
  return { supabase, userId, organizationId };
}

let uploadId = null;
try {
  const [a, b] = await Promise.all(accounts.map(signupAndOnboard));
  const sampleText = await readFile(new URL("../public/sample-lost-deals.csv", import.meta.url), "utf8");
  const parsed = parseCsvText(sampleText);
  const validation = validateCsvRows(parsed, autoMapColumns(parsed.headers));
  assert(validation.validRows.length === 10 && validation.invalidRows.length === 0, "Sample CSV did not normalize to 10 valid deals.");

  uploadId = webcrypto.randomUUID();
  const { data: upload, error: uploadError } = await a.supabase.from("uploads").insert({
    id: uploadId,
    organization_id: a.organizationId,
    filename: "sample-lost-deals.csv",
    total_rows: 10,
    valid_rows: 10,
    invalid_rows: 0,
    status: "pending",
    created_by: a.userId,
  }).select("id, organization_id, created_by, status").single();
  assert(!uploadError && upload?.created_by === a.userId, "Pending upload record creation failed.");

  const { error: processingError } = await a.supabase.from("uploads")
    .update({ status: "processing" })
    .eq("id", uploadId)
    .eq("organization_id", a.organizationId);
  assert(!processingError, "Upload could not progress to processing.");

  const dealRows = validation.validRows.map((row) => ({
    id: webcrypto.randomUUID(),
    organization_id: a.organizationId,
    upload_id: uploadId,
    external_deal_id: row.external_deal_id,
    customer_name: row.customer_name,
    deal_value: row.deal_value,
    quote_date: row.quote_date,
    status: "lost",
    salesperson: row.salesperson,
    service_type: row.service_type,
    lead_source: row.lead_source,
    sales_notes: row.sales_notes,
    transcript: row.transcript,
    analysis_status: "pending",
    analysis_error: null,
  }));
  const { data: insertedDeals, error: dealsError } = await a.supabase.from("deals")
    .insert(dealRows)
    .select("id, organization_id, upload_id, analysis_status");
  assert(!dealsError && insertedDeals?.length === 10, "Live 10-deal batch insert failed.");
  assert(insertedDeals.every((deal) => deal.organization_id === a.organizationId), "A deal escaped Organization A.");
  assert(insertedDeals.every((deal) => deal.upload_id === uploadId), "A deal has the wrong upload ID.");
  assert(insertedDeals.every((deal) => deal.analysis_status === "pending"), "A deal analysis status is not pending.");

  const { error: completedError } = await a.supabase.from("uploads")
    .update({ status: "completed" })
    .eq("id", uploadId)
    .eq("organization_id", a.organizationId);
  assert(!completedError, "Upload could not progress to completed.");

  const [{ data: completedUpload }, { data: analyses }] = await Promise.all([
    a.supabase.from("uploads").select("status, total_rows, valid_rows, invalid_rows").eq("id", uploadId).single(),
    a.supabase.from("deal_analyses").select("id").eq("organization_id", a.organizationId),
  ]);
  assert(completedUpload?.status === "completed" && completedUpload.valid_rows === 10, "Completed upload verification failed.");
  assert(analyses?.length === 0, "Deal analyses were unexpectedly created.");

  const [{ data: bReadsUpload }, { data: bReadsDeals }] = await Promise.all([
    b.supabase.from("uploads").select("id").eq("id", uploadId),
    b.supabase.from("deals").select("id").eq("upload_id", uploadId),
  ]);
  assert(bReadsUpload?.length === 0, "User B could read Organization A upload.");
  assert(bReadsDeals?.length === 0, "User B could read Organization A deals.");

  const maliciousUploadId = webcrypto.randomUUID();
  const { error: maliciousUploadError } = await a.supabase.from("uploads").insert({
    id: maliciousUploadId,
    organization_id: b.organizationId,
    filename: "malicious-org-substitution.csv",
    total_rows: 1,
    valid_rows: 1,
    invalid_rows: 0,
    status: "pending",
    created_by: a.userId,
  });
  assert(maliciousUploadError, "Malicious organization substitution unexpectedly succeeded.");
  const { data: maliciousRecord } = await b.supabase.from("uploads").select("id").eq("id", maliciousUploadId);
  assert(maliciousRecord?.length === 0, "Malicious cross-tenant upload record exists.");

  const { error: maliciousDealError } = await a.supabase.from("deals").insert({
    id: webcrypto.randomUUID(),
    organization_id: b.organizationId,
    external_deal_id: `MAL-${runId}`,
    deal_value: "100.00",
    status: "lost",
    sales_notes: "Synthetic malicious substitution test",
    analysis_status: "pending",
  });
  assert(maliciousDealError, "Malicious cross-tenant deal insert unexpectedly succeeded.");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    sampleImport: true,
    uploadsRow: true,
    dealCount: insertedDeals.length,
    organizationIdCorrect: true,
    createdByCorrect: true,
    uploadIdCorrect: true,
    analysisStatusPending: true,
    noDealAnalyses: true,
    statusProgression: true,
    batchInsert: true,
    crossTenantReadBlocked: true,
    maliciousOrganizationSubstitutionBlocked: true,
    uploadId,
    cleanupEmails: accounts.map((account) => account.email),
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: "FAIL",
    message: error instanceof Error ? error.message : "Unknown CSV RLS test failure.",
    uploadId,
    cleanupEmails: accounts.map((account) => account.email),
  })}\n`);
  process.exitCode = 1;
}

