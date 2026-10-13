import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
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

test("built worker denies anonymous sensitive APIs without a provider request", async () => {
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error("Provider call before authorization"); };
  const env = { NEXT_PUBLIC_SUPABASE_URL:"https://example.supabase.co",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"public-test-key",
    ASSETS:{fetch:async()=>new Response("Not found",{status:404})} };
  try {
    for (const path of ["/api/uploads/import","/api/uploads/validate","/api/uploads/normalize","/api/uploads/suggest-mapping","/api/uploads/auto-convert","/api/deals/analyze","/api/deals/analyze-deep","/api/deals/analyze-batch","/api/deals/score","/api/deals/score-batch","/api/deals/delete","/api/billing/checkout-intent","/api/billing/change-plan","/api/billing/cancel","/api/billing/portal","/api/billing/reconcile","/api/billing/status"]) {
      const multipart = ["/api/uploads/import","/api/uploads/validate","/api/uploads/normalize","/api/uploads/auto-convert"].includes(path);
      const response = await worker.fetch(new Request("http://localhost"+path,{method:"POST",
        headers:{origin:"http://localhost",...(multipart?{}:{"content-type":"application/json"})},body:multipart?new FormData():"{}"}),env,{waitUntil(){},passThroughOnException(){}});
      assert.ok([400,401,403,405].includes(response.status),path+": "+response.status);
      assert.equal(response.headers.get("cache-control"),"private, no-store");
      assert.match(response.headers.get("x-request-id")??"",/^[0-9a-f-]{36}$/);
    }
    assert.equal(externalCalls,0);
  } finally { globalThis.fetch = originalFetch; }
});
test("built worker returns a secure correlated 413 before processing oversized actual bytes", async () => {
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  const response = await worker.fetch(new Request("https://fixture.test/api/uploads/suggest-mapping",{method:"POST",
    headers:{"content-type":"application/json","content-length":"1"},body:"x".repeat(65537)}),
    {ASSETS:{fetch:async()=>new Response("Not found",{status:404})}},{waitUntil(){},passThroughOnException(){}});
  assert.equal(response.status,413);
  assert.equal(response.headers.get("cache-control"),"private, no-store");
  assert.equal(response.headers.get("x-frame-options"),"DENY");
  assert.equal((await response.json()).requestId,response.headers.get("x-request-id"));
});
test("all generated font CSS references resolve to packaged assets without checkout paths", async () => {
  const assets = new URL("../dist/client/assets/",import.meta.url);
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  const response = await worker.fetch(new Request("http://localhost/",{headers:{accept:"text/html"}}),
    {NEXT_PUBLIC_SUPABASE_URL:"https://example.supabase.co",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"public-test-key",
      ASSETS:{fetch:async()=>new Response("Not found",{status:404})}},{waitUntil(){},passThroughOnException(){}});
  const styles = [await response.text()];
  for (const file of await readdir(assets)) if (file.endsWith(".css")) styles.push(await readFile(new URL(file,assets),"utf8"));
  let fonts = 0;
  for (const css of styles) {
    assert.doesNotMatch(css,/\/workspace\/|\/lostdeal-source\/|\/\.vinext\/fonts\//);
    for (const match of css.matchAll(/url\(["']?(\/assets\/[^)"']+\.(?:woff2?|ttf|otf))["']?\)/g)) {
      await access(new URL("../dist/client"+match[1],import.meta.url));
      fonts += 1;
    }
  }
  assert.ok(fonts>0,"font assets were not found");
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

test("Prompt 17B public feature and trust routes render real product boundaries", async () => {
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  const env = { NEXT_PUBLIC_SUPABASE_URL:"https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"public-test-key", ASSETS:{fetch:async()=>new Response("Not found",{status:404})} };
  for (const path of ["/lost-deal-intelligence", "/deal-recovery", "/ai-analysis", "/security", "/pricing", "/product"]) {
    const response = await worker.fetch(new Request("https://fixture.test"+path, {headers:{accept:"text/html"}}),env,{waitUntil(){},passThroughOnException(){}});
    assert.equal(response.status,200,path);
    const html = await response.text(); assert.equal((html.match(/<h1\b/g)??[]).length,1,path);
    assert.ok(html.includes('id="main-content"'),path); assert.doesNotMatch(html,/when (?:Pro )?billing launches|no checkout is active/i,path);
  }
});
test("Prompt 17B new private pages redirect anonymous users with no-store", async () => {
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  const env = { NEXT_PUBLIC_SUPABASE_URL:"https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"public-test-key", ASSETS:{fetch:async()=>new Response("Not found",{status:404})} };
  for (const path of ["/recovery", "/insights", "/settings", "/settings/account", "/settings/analysis", "/settings/privacy", "/settings/help"]) {
    const response = await worker.fetch(new Request("https://fixture.test"+path, {headers:{accept:"text/html"}}),env,{waitUntil(){},passThroughOnException(){}});
    assert.ok([302,303,307,308].includes(response.status),path+": "+response.status);
    assert.match(response.headers.get("location")??"",/\/login\?next=/,path);
    assert.equal(response.headers.get("cache-control"),"private, no-store",path);
  }
});
test("Prompt 17B profile and export APIs refuse anonymous authority without external work", async () => {
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  const originalFetch = globalThis.fetch; let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error("Unexpected unauthenticated external work"); };
  const env = { NEXT_PUBLIC_SUPABASE_URL:"https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"public-test-key", ASSETS:{fetch:async()=>new Response("Not found",{status:404})} };
  try {
    for (const [path,options,status] of [
      ["/api/exports/deals",{},401],
      ["/api/settings/profile",{method:"POST",headers:{origin:"https://fixture.test","content-type":"application/json"},body:JSON.stringify({fullName:"QA Name"})},401],
      ["/api/settings/profile",{method:"POST",headers:{origin:"https://other.invalid","content-type":"application/json"},body:JSON.stringify({fullName:"QA Name"})},403],
      ["/api/settings/profile",{method:"POST",headers:{origin:"https://fixture.test","content-type":"application/json"},body:JSON.stringify({fullName:"QA Name",id:"another-user"})},400],
      ["/api/settings/profile",{method:"POST",headers:{origin:"https://fixture.test","content-type":"application/json"},body:"x".repeat(1025)},413],
    ]) {
      const response=await worker.fetch(new Request("https://fixture.test"+path,options),env,{waitUntil(){},passThroughOnException(){}});
      assert.equal(response.status,status,path); assert.equal(response.headers.get("cache-control"),"private, no-store");
    }
    assert.equal(externalCalls,0);
  } finally { globalThis.fetch=originalFetch; }
});

test("Prompt 17B legal and contact routes publish only an approved complete record", async () => {
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  const config=JSON.parse(await readFile(new URL("../lib/marketing/launch-details.json",import.meta.url),"utf8"));
  const approved=config.approved===true && ["sellerName","sellerStructure","sellerLocality","sellerCountry","supportEmail","privacyEmail","governingLaw","disputeForum","effectiveDate","refundPolicy"].every(key=>typeof config[key]==="string"&&config[key].length>0);
  const env={NEXT_PUBLIC_SUPABASE_URL:"https://example.supabase.co",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"public-test-key",ASSETS:{fetch:async()=>new Response("Not found",{status:404})}};
  for(const path of ["/privacy","/terms","/refund-policy","/contact"]){
    const response=await worker.fetch(new Request("https://fixture.test"+path,{headers:{accept:"text/html"}}),env,{waitUntil(){},passThroughOnException(){}});
    assert.equal(response.status,approved?200:404,path);
    const html=await response.text();assert.doesNotMatch(html,/OWNER REQUIRED|\[OWNER:|owner-required@example\.invalid/,path);
    if(!approved) assert.doesNotMatch(html,/mailto:/,path);
    else {
      assert.match(html,/LostDeal AI/,path);
      if(path!=="/refund-policy") assert.match(html,/Abdullah Waheed, trading as LostDeal AI/,path);
      if(path==="/contact"||path==="/terms"||path==="/refund-policy") assert.match(html,/support@lostdeal\.ai/,path);
      if(path==="/contact"||path==="/privacy") assert.match(html,/privacy@lostdeal\.ai/,path);
      if(path!=="/contact") assert.ok(html.replace(/<!--[\s\S]*?-->/g,"").includes(`Effective ${config.effectiveDate}`),path);
      if(path==="/terms") assert.match(html,/mandatory jurisdiction rules/,path);
      if(path==="/refund-policy") assert.match(html,/no additional blanket voluntary money-back guarantee/,path);
    }
  }
});
