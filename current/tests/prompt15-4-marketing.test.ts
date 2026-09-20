import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { PUBLIC_MARKETING_PLANS } from "@/lib/marketing/plans";
import { PLAN_CATALOG } from "@/lib/billing/plans";
import { MARKETING_NAVIGATION, FAQ_ITEMS, SYNTHETIC_DEALS } from "@/lib/marketing/content";
import { PricingSection } from "@/components/marketing/pricing-section";
import { FAQSection } from "@/components/marketing/faq-section";

const source = (file: string) => readFileSync(file, "utf8");
const files = [
  ...readdirSync("components/marketing").map(file => `components/marketing/${file}`),
  ...readdirSync("lib/marketing").map(file => `lib/marketing/${file}`),
  "app/page.tsx", "app/product/page.tsx", "app/pricing/page.tsx",
];

test("marketing home composes one semantic hero and complete product story", () => {
  const page = source("components/marketing/home-content.tsx");
  for (const component of ["HeroProductStory", "BeforeAfterVisual", "AutoConvertVisual", "RecoveryScoreVisual", "StandardAnalysisVisual", "DeepAnalysisVisual", "EvidenceGroundingVisual", "PricingSection", "FAQSection"]) assert.ok(page.includes(`<${component}`), component);
  assert.equal((page.match(/<h1\b/g) ?? []).length, 1);
  assert.ok(page.includes('id="main-content"'));
});

test("marketing allowances and prices derive from authoritative Starter and Pro catalog", () => {
  for (const plan of PUBLIC_MARKETING_PLANS) {
    const catalog = PLAN_CATALOG[plan.code];
    assert.equal(plan.monthlyPriceUsd, catalog.monthlyPriceUsd);
    for (const [display, metric] of [["importedDeals", "IMPORTED_DEALS"], ["aiAnalyses", "AI_ANALYSES"], ["aiMappingRequests", "AI_MAPPING_REQUESTS"]] as const) {
      assert.equal(plan.allowances[display], Number(catalog.usage![metric]).toLocaleString("en-US"));
    }
  }
  assert.equal(PUBLIC_MARKETING_PLANS[0].allowances.autoConvertRows, null);
  assert.equal(PUBLIC_MARKETING_PLANS[1].allowances.autoConvertRows, "1,500");
});

test("Starter does not include Pro operations and Pro correctly includes both", () => {
  assert.equal(PUBLIC_MARKETING_PLANS[0].features.some(value => /Deep|Auto Convert/.test(value)), false);
  assert.ok(PUBLIC_MARKETING_PLANS[1].features.includes("AI Auto Convert"));
  assert.ok(PUBLIC_MARKETING_PLANS[1].features.includes("Deep Recovery Analysis"));
});

test("Sandbox pricing preserves plan intent through authenticated account navigation", () => {
  const html = renderToStaticMarkup(createElement(PricingSection));
  assert.equal((html.match(/href="\/account\?plan=(?:STARTER|PRO)"/g) ?? []).length, 2);
  assert.equal((html.match(/data-checkout-state="sandbox"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<form|Buy now|Subscribe now|href="[^"]*checkout/i);
  assert.ok(source("app/(auth)/signup/page.tsx").includes("AuthScreen"));
});

test("marketing navigation uses implemented routes and native accessible disclosure", () => {
  assert.deepEqual(MARKETING_NAVIGATION.map(item => item.href), ["/product", "/#how-it-works", "/pricing", "/#trust"]);
  const header = source("components/marketing/marketing-header.tsx");
  for (const marker of ['href="/login"', 'aria-expanded={open}', 'aria-controls="marketing-mobile-navigation"', 'hidden={!open}', 'event.key === "Escape"', 'setOpen(false)']) assert.ok(header.includes(marker), marker);
  assert.ok(source("app/(auth)/login/page.tsx").includes("redirectAuthenticatedUser"));
});

test("FAQ uses keyboard-accessible native details and summaries", () => {
  const html = renderToStaticMarkup(createElement(FAQSection));
  assert.equal((html.match(/<details\b/g) ?? []).length, FAQ_ITEMS.length);
  assert.equal((html.match(/<summary\b/g) ?? []).length, FAQ_ITEMS.length);
  assert.ok(html.includes("Outreach remains under your control"));
});

test("marketing dependency boundary prevents provider execution and database mutations", () => {
  for (const file of files) {
    const code = source(file);
    assert.doesNotMatch(code, /fetch\s*\(|\/api\/|createClient|supabase|lib\/ai|lib\/auth|lib\/billing\/(?:config|usage)|process\.env|use server|responses\.(?:create|parse)|\.insert\(|\.update\(/, file);
    assert.doesNotMatch(code, /Paddle|Stripe|gpt-5|Terra|Luna|Sol\b|service_role|OPENAI_API_KEY/, file);
  }
});

test("marketing examples are synthetic and contain no contact data or unsupported social proof", () => {
  assert.ok(SYNTHETIC_DEALS.every(deal => deal.name.startsWith("Synthetic ")));
  const content = files.map(source).join("\n");
  assert.doesNotMatch(content, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|SOC 2|ISO 27001|HIPAA|Trusted by|customers served|revenue recovered|guaranteed revenue/i);
  assert.ok(content.includes('data-marketing-demo="static"'));
});

test("protected app shell and mutations retain server authorization", () => {
  assert.match(source("app/(dashboard)/layout.tsx"), /await requireOrganization\(destination\)/);
  for (const file of ["app/api/deals/analyze/route.ts", "app/api/deals/analyze-deep/route.ts", "app/api/uploads/auto-convert/route.ts"]) {
    assert.match(source(file), /getAuthorizedRouteContext/);
    assert.doesNotMatch(source(file), /export async function GET/);
  }
});

test("marketing styling preserves reduced motion and scoped light appearance", () => {
  const css = source("app/globals.css");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.marketing-surface \{ color-scheme: light; \}/);
  assert.match(css, /\.marketing-surface :focus-visible/);
  assert.match(source("components/marketing/marketing-header.tsx"), /lg:hidden/);
});

test("marketing pages have individual metadata and real canonical paths", () => {
  for (const file of ["app/page.tsx", "app/product/page.tsx", "app/pricing/page.tsx"]) {
    for (const marker of ["metadata: Metadata", "description:", "canonical:", "openGraph:", "twitter:"]) assert.ok(source(file).includes(marker), `${file}: ${marker}`);
  }
});
