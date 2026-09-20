import { createClient } from "@supabase/supabase-js";
import { webcrypto } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) throw new Error("Supabase public environment is not configured.");

const runId = `${Date.now()}-${webcrypto.randomUUID().slice(0, 8)}`;
const password = `Ld!${webcrypto.randomUUID()}Aa9`;
const accounts = [
  { email: `lostdeal.prompt4.a.${runId}@example.com`, name: "Prompt Four User A", business: "Prompt Four HVAC A", industry: "HVAC" },
  { email: `lostdeal.prompt4.b.${runId}@example.com`, name: "Prompt Four User B", business: "Prompt Four Roofing B", industry: "Roofing" },
];

function client(options = {}) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
      ...options,
    },
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
  const { data: signup, error: signupError } = await supabase.auth.signUp({
    email: account.email,
    password,
    options: { data: { full_name: account.name } },
  });

  assert(!signupError, "Signup failed.");
  assert(signup.session, "Development auto-confirm did not return a session.");

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  assert(!claimsError && claimsData?.claims?.sub, "Signed-up identity could not be verified.");
  const userId = claimsData.claims.sub;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", userId)
    .single();
  assert(!profileError && profile?.id === userId, "Profile trigger verification failed.");
  assert(profile.full_name === account.name, "Profile full name was not populated.");

  const { data: beforeMembership, error: beforeMembershipError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId);
  assert(!beforeMembershipError && beforeMembership.length === 0, "New user unexpectedly has a workspace.");

  const organizationId = await primaryOrganizationIdForUser(userId);
  const { error: organizationError } = await supabase.from("organizations").insert({
    id: organizationId,
    name: account.business,
    industry: account.industry,
    created_by: userId,
  });
  assert(!organizationError, "Organization creation failed.");

  const { error: membershipError } = await supabase.from("organization_members").insert({
    organization_id: organizationId,
    user_id: userId,
    role: "owner",
  });
  assert(!membershipError, "Initial owner membership creation failed.");

  const { data: ownProfile, error: ownProfileError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", userId)
    .single();
  const { data: ownOrganization, error: ownOrganizationError } = await supabase
    .from("organizations")
    .select("id, name, industry")
    .eq("id", organizationId)
    .single();
  const { data: ownMembership, error: ownMembershipError } = await supabase
    .from("organization_members")
    .select("organization_id, user_id, role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .single();

  assert(!ownProfileError && ownProfile?.id === userId, "Own profile RLS read failed.");
  assert(!ownOrganizationError && ownOrganization?.id === organizationId, "Own organization RLS read failed.");
  assert(!ownMembershipError && ownMembership?.role === "owner", "Own membership RLS read failed.");

  return { supabase, userId, organizationId };
}

try {
  const a = await signupAndOnboard(accounts[0]);
  const b = await signupAndOnboard(accounts[1]);

  const { data: testUpload, error: uploadError } = await b.supabase
    .from("uploads")
    .insert({
      organization_id: b.organizationId,
      filename: "prompt-4-rls-test.csv",
      status: "pending",
      created_by: b.userId,
    })
    .select("id")
    .single();
  assert(!uploadError && testUpload?.id, "Tenant-owned test record creation failed.");

  const [{ data: aReadsBOrg }, { data: aReadsBMembership }, { data: aReadsBUpload }] = await Promise.all([
    a.supabase.from("organizations").select("id").eq("id", b.organizationId),
    a.supabase.from("organization_members").select("id").eq("organization_id", b.organizationId),
    a.supabase.from("uploads").select("id").eq("id", testUpload.id),
  ]);
  const { data: bReadsAOrg } = await b.supabase
    .from("organizations")
    .select("id")
    .eq("id", a.organizationId);

  assert(aReadsBOrg?.length === 0, "User A could read User B organization.");
  assert(aReadsBMembership?.length === 0, "User A could read User B membership.");
  assert(aReadsBUpload?.length === 0, "User A could read User B tenant record.");
  assert(bReadsAOrg?.length === 0, "User B could read User A organization.");

  const wrongPasswordClient = client();
  const { data: wrongPasswordData, error: wrongPasswordError } = await wrongPasswordClient.auth.signInWithPassword({
    email: accounts[0].email,
    password: `${password}-wrong`,
  });
  assert(wrongPasswordError && !wrongPasswordData.session, "Wrong password unexpectedly created a session.");

  const sharedValues = new Map();
  const storage = {
    getItem(name) { return sharedValues.get(name) ?? null; },
    setItem(name, value) { sharedValues.set(name, value); },
    removeItem(name) { sharedValues.delete(name); },
  };
  const persistentClient = client({ persistSession: true, storage });
  const { error: loginError } = await persistentClient.auth.signInWithPassword({
    email: accounts[0].email,
    password,
  });
  assert(!loginError, "Valid login failed.");

  const restoredClient = client({ persistSession: true, storage });
  const { data: restoredClaims, error: restoredClaimsError } = await restoredClient.auth.getClaims();
  assert(!restoredClaimsError && restoredClaims?.claims?.sub === a.userId, "Session did not persist across client recreation.");
  const { data: restoredOrganization } = await restoredClient
    .from("organizations")
    .select("id")
    .eq("id", a.organizationId)
    .single();
  assert(restoredOrganization?.id === a.organizationId, "Persisted session could not read its organization.");

  await restoredClient.auth.signOut({ scope: "local" });
  const loggedOutClient = client({ persistSession: true, storage });
  const { data: loggedOutClaims } = await loggedOutClient.auth.getClaims();
  assert(!loggedOutClaims?.claims, "Session remained after logout.");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    signup: true,
    developmentAutoConfirm: true,
    profile: true,
    fullName: true,
    organization: true,
    ownerMembership: true,
    ownRls: true,
    crossTenantRls: true,
    tenantRecordIsolation: true,
    wrongPassword: true,
    login: true,
    sessionPersistence: true,
    logout: true,
    cleanupEmails: accounts.map((account) => account.email),
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: "FAIL",
    message: error instanceof Error ? error.message : "Unknown authentication test failure.",
    cleanupEmails: accounts.map((account) => account.email),
  })}\n`);
  process.exitCode = 1;
}
