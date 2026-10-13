import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { formatDealCurrency } from "@/lib/deals/format";

const root = process.cwd();

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function sourceFiles(relativeDirectory: string): Promise<string[]> {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relative = path.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? sourceFiles(relative) : [relative];
  }));
  return files.flat().filter((file) => /\.(?:ts|tsx|css)$/.test(file));
}

test("final warm LostDeal AI logo derivatives replace the legacy cyan assets", async () => {
  const [brand, layout, proxy, lightWordmark, darkWordmark, icon, favicon, appleTouch, social] = await Promise.all([
    source("components/brand-logo.tsx"),
    source("app/layout.tsx"),
    source("proxy.ts"),
    stat(path.join(root, "public/lostdeal-wordmark-light.webp")),
    stat(path.join(root, "public/lostdeal-wordmark-dark.webp")),
    stat(path.join(root, "public/lostdeal-icon.png")),
    stat(path.join(root, "public/lostdeal-favicon-v2.ico")),
    stat(path.join(root, "public/lostdeal-apple-touch-icon-v2.png")),
    stat(path.join(root, "public/og.png")),
  ]);
  assert.match(brand, /lostdeal-wordmark-light\.webp/);
  assert.match(brand, /lostdeal-wordmark-dark\.webp/);
  assert.match(brand, /lostdeal-icon\.png/);
  assert.match(brand, /theme-logo-light/);
  assert.match(brand, /theme-logo-dark/);
  assert.doesNotMatch(brand, />LD</);
  assert.match(layout, /icon: \[\{ url: "\/lostdeal-favicon-v2\.ico", type: "image\/x-icon" \}\]/);
  assert.match(layout, /shortcut: "\/lostdeal-favicon-v2\.ico"/);
  assert.match(layout, /apple: \[\{ url: "\/lostdeal-apple-touch-icon-v2\.png", type: "image\/png", sizes: "180x180" \}\]/);
  assert.doesNotMatch(layout, /["']\/favicon\.ico["']/);
  assert.match(proxy, /lostdeal-favicon-v2\.ico/);
  assert.match(layout, /og\.png/);
  await assert.rejects(stat(path.join(root, "public/lostdeal-wordmark.webp")));
  await assert.rejects(stat(path.join(root, "public/favicon.ico")));
  assert.ok(lightWordmark.size < 50_000);
  assert.ok(darkWordmark.size < 50_000);
  assert.ok(icon.size < 100_000);
  assert.ok(favicon.size < 160_000);
  assert.ok(appleTouch.size < 100_000);
  assert.ok(social.size < 250_000);
});

test("light, dark, and system themes use one semantic token system with light default", async () => {
  const [theme, layout, initializer, selector] = await Promise.all([
    source("app/globals.css"),
    source("app/layout.tsx"),
    source("public/theme-init.js"),
    source("components/theme-selector.tsx"),
  ]);
  for (const token of [
    "--background: #f7f8fa",
    "--sidebar-background: #f3f4f6",
    "--surface: #ffffff",
    "--surface-raised: #f8f9fb",
    "--surface-hover: #eceef2",
    "--border: #e4e7ec",
    "--brand: #c2410c",
    "--brand-hover: #9a3412",
    "--text-primary: #182230",
    "--background: #13161c",
    "--sidebar-background: #171b22",
    "--surface: #1c212a",
    "--surface-raised: #232a35",
    "--brand: #fb923c",
    "--text-primary: #fafaf9",
  ]) assert.match(theme, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(theme, /html\[data-theme="dark"\]/);
  assert.match(theme, /prefers-color-scheme: dark/);
  assert.match(theme, /html\[data-theme="system"\]/);
  assert.match(theme, /prefers-reduced-motion/);
  assert.match(layout, /data-theme="light"/);
  assert.match(layout, /src="\/theme-init\.js"/);
  assert.match(initializer, /lostdeal-theme/);
  assert.match(initializer, /light: true, dark: true, system: true/);
  assert.match(initializer, /var theme = "light"/);
  assert.match(selector, /"light", "dark", "system"/);
  assert.match(selector, /localStorage\.setItem\("lostdeal-theme", theme\)/);
  assert.doesNotMatch(selector, /fetch\(|\/api\//);
});

test("pre-hydration theme initialization honors saved preferences and rejects arbitrary values", async () => {
  const initializer = await source("public/theme-init.js");
  function initializedTheme(saved: string | null, storageFailure = false) {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    const window = {
      localStorage: {
        getItem(key: string) {
          assert.equal(key, "lostdeal-theme");
          if (storageFailure) throw new Error("storage blocked");
          return saved;
        },
      },
    };
    vm.runInNewContext(initializer, { window, document });
    return document.documentElement.dataset.theme;
  }

  assert.equal(initializedTheme(null), "light");
  assert.equal(initializedTheme("light"), "light");
  assert.equal(initializedTheme("dark"), "dark");
  assert.equal(initializedTheme("system"), "system");
  assert.equal(initializedTheme("url(javascript:alert(1))"), "light");
  assert.equal(initializedTheme("dark", true), "light");
});

test("legacy cyan and midnight brand constants are absent from visible application source", async () => {
  const files = [...await sourceFiles("app"), ...await sourceFiles("components")];
  const joined = (await Promise.all(files.map(async (file) => `${file}\n${await source(file)}`))).join("\n");
  assert.doesNotMatch(joined, /brand-cyan|text-cyan-|#22d3ee|#06b6d4|#070b12|#080e18|lostdeal-wordmark\.webp/iu);
  assert.doesNotMatch(joined, /bg-white|bg-\[#f7f8fb\]|text-\[#0b1739\]|\[#2952cc\]|\[#172554\]|favicon\.svg/);
});

test("shared controls preserve semantic status colors and accessible focus styling", async () => {
  const ui = await source("components/ui.tsx");
  assert.match(ui, /high: "[^"]*danger-content/);
  assert.match(ui, /medium: "[^"]*warning-content/);
  assert.match(ui, /low: "[^"]*low-content/);
  assert.match(ui, /completed: "[^"]*success-content/);
  assert.match(ui, /destructive: "[^"]*red/);
  assert.match(ui, /focus-visible:ring-brand/);
  assert.match(ui, /placeholder:text-muted/);
  assert.match(ui, /text-on-brand/);
});

test("navigation exposes the implemented workspace routes and reachable appearance settings", async () => {
  const shell = await source("components/dashboard-shell.tsx");
  for (const route of ["/dashboard", "/deals", "/upload"]) assert.match(shell, new RegExp(`href: "${route}"`));
  assert.match(shell, /aria-current=\{active \? "page"/);
  assert.match(shell, /aria-label="Log out"/);
  assert.match(shell, /href="\/settings"/);
  assert.match(shell, /<Dialog open=\{mobileOpen\}/);
  assert.match(await source("app/(dashboard)/settings/page.tsx"), /<ThemeSelector compact/);
  assert.doesNotMatch(shell, /Reports|Contacts/);
});

test("dashboard has four compact KPIs, action-first content, and three local sections", async () => {
  const dashboard = await source("app/(dashboard)/dashboard/page.tsx");
  const metricCards = dashboard.match(/<MetricCard\b/g) ?? [];
  assert.equal(metricCards.length, 4);
  for (const label of ["Total Lost Deal Value", "Total Lost Deals", "High Priority Opportunities", "Average Recovery Score"]) assert.match(dashboard, new RegExp(label));
  assert.match(dashboard, /highPriorityDealValue/);
  assert.match(dashboard, /At a Glance/);
  assert.match(dashboard, /What Should I Do\?/);
  assert.ok(dashboard.indexOf("Top Recovery Opportunities") < dashboard.indexOf("<LocalTabs"));
  assert.ok(dashboard.indexOf("<NeedsAttention") < dashboard.indexOf("<LocalTabs"));
  for (const tab of ["Insights", "Coverage", "Activity"]) assert.match(dashboard, new RegExp(`label: "${tab}"`));
  assert.doesNotMatch(dashboard, /fetch\(|\/api\/deals\/analyze|\/api\/deals\/score/);
});

test("deals keeps primary filters visible and moves advanced controls behind one disclosure", async () => {
  const deals = await source("app/(dashboard)/deals/page.tsx");
  for (const id of ["deal-search", "analysis-filter", "priority-filter"]) assert.match(deals, new RegExp(`id="${id}"`));
  assert.match(deals, /<details[^>]*open=\{activeAdvancedFilters > 0\}/);
  assert.match(deals, /More Filters/);
  assert.match(deals, /activeAdvancedFilters/);
  for (const id of ["reason-filter", "service-filter", "salesperson-filter", "sort-filter", "direction-filter"]) assert.match(deals, new RegExp(`id="${id}"`));
  assert.match(deals, /Apply View/);
  assert.match(deals, /Clear View/);
  assert.match(deals, /py-2\.5/);
  assert.match(deals, /title=\{deal\.customer_name/);
});

test("completed deal intelligence is compact and all supporting content remains in accessible tabs", async () => {
  const [detail, tabs] = await Promise.all([
    source("app/(dashboard)/deals/[id]/page.tsx"),
    source("components/local-tabs.tsx"),
  ]);
  for (const label of ["Overview", "Evidence", "Score Details", "Source Data"]) assert.match(detail, new RegExp(`label: "${label}"`));
  for (const content of ["Recovery Summary", "Recommended Next Action", "Suggested Follow-Up", "Grounded Evidence", "How Recovery Score Was Calculated", "Data &amp; Privacy"]) assert.match(detail, new RegExp(content));
  assert.match(detail, /\{analysis \? \([\s\S]*?<StandardAnalysisExperience/);
  assert.match(detail, /function StandardAnalysisExperience[\s\S]*?<LocalTabs/);
  assert.match(detail, /\) : \([\s\S]*?<AnalysisStateCard[\s\S]*?<details/);
  assert.match(detail, /View Imported Source Data/);
  assert.match(detail, /<DeleteDealControl/);
  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /role="tab"/);
  assert.match(tabs, /role="tabpanel"/);
  assert.match(tabs, /aria-selected/);
  assert.match(tabs, /ArrowRight/);
  assert.match(tabs, /ArrowLeft/);
  assert.match(tabs, /event\.key === "Home"/);
  assert.match(tabs, /event\.key === "End"/);
});

test("upload preserves four steps while bounding dense review and activity regions", async () => {
  const workflow = await source("components/csv-import-workflow.tsx");
  for (const label of ["Select CSV", "Map & Normalize", "Review", "Import"]) assert.match(workflow, new RegExp(label.replace("&", "&")));
  assert.match(workflow, /\/sample-lost-deals\.csv/);
  assert.match(workflow, /\/lostdeal-demo-hvac\.csv/);
  assert.match(workflow, /max-h-80/);
  assert.match(workflow, /<details className="rounded-2xl/);
  assert.match(workflow, /imports\.slice\(0, 4\)/);
  assert.match(workflow, /Existing external IDs remain protected/i);
  assert.match(workflow, /No AI analysis starts/i);
  assert.match(workflow, /authorized to process/i);
});

test("auth polish preserves server actions, redirects, and tenant-safe onboarding", async () => {
  const [auth, login, signup, onboarding] = await Promise.all([
    source("components/auth-screen.tsx"),
    source("app/(auth)/login/page.tsx"),
    source("app/(auth)/signup/page.tsx"),
    source("app/(auth)/onboarding/page.tsx"),
  ]);
  assert.match(auth, /loginAction/);
  assert.match(auth, /signupAction/);
  assert.match(auth, /useActionState\(action, INITIAL_STATE\)/);
  assert.match(auth, /name="next"/);
  assert.match(auth, /name="email"/);
  assert.match(auth, /name="password"/);
  assert.match(login, /redirectAuthenticatedUser\(\)/);
  assert.match(login, /getSafeNextPath\(next\)/);
  assert.match(signup, /redirectAuthenticatedUser\(\)/);
  assert.match(onboarding, /getAppAuthContext\(\)/);
  assert.match(onboarding, /redirect\("\/login\?next=%2Fonboarding"\)/);
  assert.match(onboarding, /redirect\(nextPath\)/);
  assert.match(onboarding, /getSafeNextPath/);
});

test("copy, transcript, deletion, and downloads retain safety and accessibility contracts", async () => {
  const [copy, transcript, deletion, workflow] = await Promise.all([
    source("components/copy-message-button.tsx"),
    source("components/expandable-transcript.tsx"),
    source("components/delete-deal-control.tsx"),
    source("components/csv-import-workflow.tsx"),
  ]);
  assert.match(copy, /navigator\.clipboard\.writeText\(message\)/);
  assert.doesNotMatch(copy, /fetch\(|\/api\//);
  assert.match(copy, /never sends it/i);
  assert.match(copy, /aria-live="polite"/);
  assert.match(transcript, /aria-expanded=\{expanded\}/);
  assert.match(transcript, /aria-controls=\{contentId\}/);
  assert.match(deletion, /setConfirming\(true\)/);
  assert.match(deletion, /Permanently delete this deal\?/);
  assert.match(deletion, /Yes, Delete Deal/);
  assert.match(deletion, /\/api\/deals\/delete/);
  assert.match(workflow, /"\/sample-lost-deals\.csv"/);
  assert.match(workflow, /"\/lostdeal-demo-hvac\.csv"/);
});

test("currency, loading, error, empty, and tenant-safe not-found contracts remain intact", async () => {
  assert.equal(formatDealCurrency(300_250), "$300,250");
  assert.equal(formatDealCurrency(300_250.5), "$300,250.50");
  assert.equal(formatDealCurrency(null), "—");
  const [dashboard, deals, detail, notFound, error] = await Promise.all([
    source("app/(dashboard)/dashboard/page.tsx"),
    source("app/(dashboard)/deals/page.tsx"),
    source("app/(dashboard)/deals/[id]/page.tsx"),
    source("app/not-found.tsx"),
    source("app/(dashboard)/error.tsx"),
  ]);
  assert.match(dashboard, /No lost deals yet/);
  assert.match(dashboard, /No scored opportunities yet/);
  assert.match(deals, /No deals match your filters/);
  assert.match(detail, /Ready for Analysis/);
  assert.match(detail, /Analysis in progress/);
  assert.match(detail, /Analysis needs attention/);
  assert.doesNotMatch(notFound, /another workspace|organization_id|tenant/i);
  assert.match(error, /Your data has not been changed/);
});
