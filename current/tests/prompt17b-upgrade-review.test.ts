import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UpgradeProReview } from "@/components/upgrade-pro-review";
import { PLAN_CATALOG } from "@/lib/billing/plans";
import { formatPlanAllowance } from "@/lib/billing/presentation";

const text = (html: string) => html.replace(/<[^>]+>/g, "");

test("the rendered Pro review compares canonical Starter and Pro pricing and allowances", () => {
  const html = renderToStaticMarkup(createElement(UpgradeProReview, { selectedPlan: "PRO" }));
  assert.match(html, /aria-label="Starter and Pro plan comparison"/);
  const rows = new Map([...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(match => {
    const cells = [...match[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(cell => text(cell[2]));
    return [cells[0], cells.slice(1)] as const;
  }));
  const plans = [PLAN_CATALOG.STARTER, PLAN_CATALOG.PRO];
  assert.deepEqual(rows.get("Plan comparison"), plans.map(plan => plan.displayName));
  assert.deepEqual(rows.get("Monthly price"), plans.map(plan => plan.priceLabel));
  for (const [label, metric] of [["Imported deals", "IMPORTED_DEALS"], ["AI analyses", "AI_ANALYSES"], ["AI mapping requests", "AI_MAPPING_REQUESTS"]] as const) {
    assert.deepEqual(rows.get(label), plans.map(plan => formatPlanAllowance(plan, metric)));
  }
  assert.deepEqual(rows.get("AI Auto Convert"), plans.map(plan => plan.features.autoConvert ? formatPlanAllowance(plan, "AUTO_CONVERT_ROWS") : "Not included"));
  assert.deepEqual(rows.get("Deep Recovery Analysis"), plans.map(plan => plan.features.deepAnalysis ? "Included" : "Not included"));
});

test("the rendered Pro review explains both features and their processing boundaries", () => {
  const html = renderToStaticMarkup(createElement(UpgradeProReview, { selectedPlan: "PRO" }));
  const copy = text(html);
  assert.match(copy, /stored deal evidence.*blockers, readiness, risk and recovery strategy/);
  assert.match(copy, /Each successful Standard or Deep analysis uses one AI analysis unit/);
  assert.match(copy, /messy CSV exports with mappings, normalized values and source provenance/);
  assert.match(copy, /Auto Convert row allowance.*does not import deals or start Deal Analysis/);
  assert.doesNotMatch(copy, /guaranteed recovery|automatic outreach|unlimited AI/i);
});

test("the rendered Starter review retains its own price and feature boundaries", () => {
  const html = renderToStaticMarkup(createElement(UpgradeProReview, { selectedPlan: "STARTER" }));
  const copy = text(html);
  assert.ok(copy.includes(PLAN_CATALOG.STARTER.priceLabel!));
  assert.ok(copy.includes(formatPlanAllowance(PLAN_CATALOG.STARTER, "IMPORTED_DEALS")));
  assert.match(copy, /AI Auto ConvertNot included/);
  assert.match(copy, /Deep Recovery AnalysisNot included/);
  assert.doesNotMatch(html, /Starter and Pro plan comparison/);
});
