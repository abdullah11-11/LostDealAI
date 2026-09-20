import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("../scripts/cloudflare-workers-loader.mjs", import.meta.url), import.meta.url);

const stalePreviewMeta = /<meta(?=[^>]*\bname=["']codex-preview["'])[^>]*>/i;

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= "public-test-key";

test("renders production social metadata without stale preview markers", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  for (const copy of ["Your CRM is full of deals", "Find the ones worth another shot", "See LostDeal in Action", "View Pricing", "Recovery Score", "Auto Convert", "Deep Recovery Analysis", "Standard Analysis", "Sign In"]) assert.ok(html.includes(copy), copy);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, stalePreviewMeta);
  assert.match(html, /<link rel=["']icon["'] href=["']https:\/\/lostdeal-ai\.equal-dune-2306\.chatgpt\.site\/lostdeal-favicon-v2\.ico["'] type=["']image\/x-icon["']\/>/i);
  assert.match(html, /<link rel=["']shortcut icon["'] href=["']https:\/\/lostdeal-ai\.equal-dune-2306\.chatgpt\.site\/lostdeal-favicon-v2\.ico["']\/>/i);
  assert.match(html, /<link rel=["']apple-touch-icon["'] href=["']https:\/\/lostdeal-ai\.equal-dune-2306\.chatgpt\.site\/lostdeal-apple-touch-icon-v2\.png["'] sizes=["']180x180["'] type=["']image\/png["']\/>/i);
  assert.doesNotMatch(html, /href=["']\/favicon\.ico["']/i);
  assert.match(html, /property=["']og:image["'][^>]*content=["']https:\/\/lostdeal-ai\.equal-dune-2306\.chatgpt\.site\/og\.png["']/i);
  assert.match(html, /name=["']twitter:card["'][^>]*content=["']summary_large_image["']/i);

  const favicon = await readFile(new URL("../dist/client/lostdeal-favicon-v2.ico", import.meta.url));
  assert.deepEqual([...favicon.subarray(0, 4)], [0, 0, 1, 0]);
  await access(new URL("../dist/client/lostdeal-apple-touch-icon-v2.png", import.meta.url));
  await assert.rejects(access(new URL("../dist/client/favicon.ico", import.meta.url)));
});

test("production marketing routes render without external calls while app pages require login", async () => {
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error("Unexpected external call during static marketing render"); };
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  try {
    for (const [path, expected] of [["/", "Your CRM is full of deals"], ["/product", "Turn lost-deal history into a recovery workflow"], ["/pricing", "Start small. Upgrade when your lost pipeline gets serious"]]) {
      const response = await worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), env, ctx);
      assert.equal(response.status, 200, path);
      const html = await response.text();
      assert.ok(html.includes(expected), path);
      assert.equal((html.match(/<h1\b/g) ?? []).length, 1, path);
      assert.ok(html.includes('href="/login"'), path);
    }
    assert.equal(externalCalls, 0);
    for (const path of ["/dashboard", "/deals", "/upload", "/account"]) {
      const response = await worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), env, ctx);
      assert.ok([302, 303, 307, 308].includes(response.status), `${path}: ${response.status}`);
      assert.match(response.headers.get("location") ?? "", /\/login/);
    }
  } finally { globalThis.fetch = originalFetch; }
});
