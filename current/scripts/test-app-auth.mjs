import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const port = 3014;
const baseUrl = `http://127.0.0.1:${port}`;
const email = `lostdeal.prompt4.app.${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
const password = `Ld!${randomUUID()}Z9`;
const fullName = "Prompt Four App User";
const businessName = "Prompt Four Electrical App";
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
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
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
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];

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
  if (cookieJar.size) {
    headers.set("cookie", Array.from(cookieJar, ([name, value]) => `${name}=${value}`).join("; "));
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual" });
  captureCookies(response);
  return response;
}

async function submit(path, html, marker, values) {
  const formData = new FormData();
  for (const [name, value] of hiddenFields(html, marker)) formData.append(name, value);
  for (const [name, value] of Object.entries(values)) formData.append(name, value);
  return request(path, {
    method: "POST",
    body: formData,
    headers: { origin: baseUrl, referer: `${baseUrl}${path}` },
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The bounded retry gives the local production server time to bind.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The local production server did not become ready.");
}

function redirectLocation(response) {
  return response.headers.get("location") ?? response.headers.get("x-action-redirect");
}

try {
  await waitForServer();

  const signupPage = await request("/signup");
  const signupHtml = await signupPage.text();
  assert(signupPage.status === 200 && signupHtml.includes("Start with LostDeal AI"), "Signup page did not render.");

  const signupResponse = await submit("/signup", signupHtml, "Create Account", {
    fullName,
    email,
    password,
  });
  assert(redirectLocation(signupResponse)?.includes("/onboarding"), "Development signup did not continue to onboarding.");
  assert(cookieJar.size > 0, "Signup did not establish cookie-backed authentication.");

  const onboardingPage = await request("/onboarding");
  const onboardingHtml = await onboardingPage.text();
  assert(onboardingPage.status === 200 && onboardingHtml.includes("Set up your workspace"), "Onboarding page did not render for the signed-in user.");

  const onboardingResponse = await submit("/onboarding", onboardingHtml, "Create Workspace", {
    businessName,
    industry: "Electrical",
  });
  assert(redirectLocation(onboardingResponse)?.includes("/dashboard"), "Onboarding did not continue to the dashboard.");

  const dashboardPage = await request("/dashboard");
  const dashboardHtml = await dashboardPage.text();
  assert(dashboardPage.status === 200, "Authenticated dashboard access failed.");
  assert(dashboardHtml.includes(businessName), "Real organization name was not rendered in the dashboard shell.");
  assert(dashboardHtml.includes(fullName), "Real user name was not rendered in the dashboard shell.");
  assert(dashboardHtml.includes("Recovery Overview") && dashboardHtml.includes("No lost deals yet"), "Real empty-workspace dashboard did not render.");
  assert(!dashboardHtml.includes("Sample data") && !dashboardHtml.includes("Demo / Sample Data"), "Dashboard still contains demo labels.");

  for (const path of ["/dashboard", "/deals", "/upload"]) {
    const response = await request(path);
    assert(response.status === 200, `Session did not persist on ${path}.`);
  }

  const loggedInLogin = await request("/login");
  assert(redirectLocation(loggedInLogin)?.includes("/dashboard"), "Logged-in login route did not redirect to the dashboard.");

  const logoutResponse = await submit("/dashboard", dashboardHtml, "Log out", {});
  assert(redirectLocation(logoutResponse)?.includes("/login"), "Logout did not redirect to login.");
  const loggedOutDashboard = await request("/dashboard");
  assert(redirectLocation(loggedOutDashboard)?.includes("/login"), "Dashboard remained accessible after logout.");

  const loginPage = await request("/login?next=%2Fdeals");
  const loginHtml = await loginPage.text();
  const loginResponse = await submit("/login?next=%2Fdeals", loginHtml, "Log In", {
    email,
    password,
    next: "/deals",
  });
  assert(redirectLocation(loginResponse)?.includes("/deals"), "Valid login did not honor the safe internal destination.");
  assert((await request("/deals")).status === 200, "Logged-in deals access failed after session restoration.");
  assert((await request("/upload")).status === 200, "Logged-in upload access failed after session restoration.");

  cookieJar.clear();
  const wrongPasswordPage = await request("/login");
  const wrongPasswordHtml = await wrongPasswordPage.text();
  const wrongPasswordResponse = await submit("/login", wrongPasswordHtml, "Log In", {
    email,
    password: `${password}-wrong`,
    next: "/dashboard",
  });
  const wrongPasswordBody = await wrongPasswordResponse.text();
  assert(!cookieJar.size, "Wrong password created an authentication cookie.");
  assert(wrongPasswordBody.includes("Invalid email or password."), "Wrong password did not return a safe generic error.");

  const verificationClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { data: loginData, error: loginError } = await verificationClient.auth.signInWithPassword({ email, password });
  assert(!loginError && loginData.session, "Verification login failed.");
  const userId = loginData.user.id;
  const [{ data: profile }, { data: membership }] = await Promise.all([
    verificationClient.from("profiles").select("id, full_name").eq("id", userId).single(),
    verificationClient.from("organization_members").select("organization_id, role").eq("user_id", userId).single(),
  ]);
  assert(profile?.id === userId && profile.full_name === fullName, "App signup profile verification failed.");
  assert(membership?.role === "owner", "App onboarding owner membership verification failed.");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    signup: true,
    onboarding: true,
    dashboardIdentity: true,
    protectedRoutes: true,
    publicRouteRedirect: true,
    logout: true,
    login: true,
    wrongPassword: true,
    sessionPersistence: true,
    profile: true,
    ownerMembership: true,
    cleanupEmail: email,
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: "FAIL",
    message: error instanceof Error ? error.message : "Unknown application authentication test failure.",
    cleanupEmail: email,
  })}\n`);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
