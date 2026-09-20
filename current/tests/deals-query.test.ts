import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { formatDealCurrency, formatDealDate, humanizeDealEnum } from "../lib/deals/format";
import {
  buildDealsUrl,
  buildSafeDealSearchFilter,
  parseDealsQueryState,
  validateDynamicDealFilters,
} from "../lib/deals/query-state";

test("query parameters use allowlists and safe defaults", () => {
  const state = parseDealsQueryState({
    page: "-5",
    sort: "drop_table",
    direction: "sideways",
    analysis: "unknown",
    priority: "urgent",
    reason: "not-real",
  });
  assert.equal(state.page, 1);
  assert.equal(state.sort, "created");
  assert.equal(state.direction, "desc");
  assert.equal(state.analysis, null);
  assert.equal(state.priority, null);
  assert.equal(state.reason, null);
});

test("valid list state is normalized without losing URL persistence", () => {
  const state = parseDealsQueryState({
    q: "  Synthetic Maple  ",
    page: "2",
    sort: "value",
    direction: "asc",
    analysis: "pending",
    priority: "high",
    reason: "price",
    service: "Heat Pump",
    salesperson: "Avery Cole",
  });
  assert.equal(state.q, "Synthetic Maple");
  assert.equal(state.page, 2);
  assert.equal(state.priority, "HIGH");
  assert.equal(state.reason, "PRICE");
  assert.equal(
    buildDealsUrl(state),
    "/deals?q=Synthetic+Maple&page=2&sort=value&direction=asc&analysis=pending&priority=HIGH&reason=PRICE&service=Heat+Pump&salesperson=Avery+Cole",
  );
});

test("Recovery Score sorting is allowlisted and URL-persistent", () => {
  const highFirst = parseDealsQueryState({ sort: "recovery_score", direction: "desc" });
  const lowFirst = parseDealsQueryState({ sort: "recovery_score", direction: "asc" });
  assert.equal(highFirst.sort, "recovery_score");
  assert.equal(buildDealsUrl(highFirst), "/deals?sort=recovery_score");
  assert.equal(buildDealsUrl(lowFirst), "/deals?sort=recovery_score&direction=asc");
});

test("Recovery Score ordering uses the global server RPC and blocks the PGRST118 relation form", () => {
  const server = readFileSync(`${process.cwd()}/lib/deals/server.ts`, "utf8");
  const migration = readFileSync(`${process.cwd()}/supabase/migrations/20260905070000_prompt15_3_1_runtime_hardening.sql`, "utf8");
  assert.match(server, /rpc\(\s*["']list_deal_ids_by_recovery_score["']/);
  assert.doesNotMatch(server, /\.order\(`?deal_analyses\(/);
  assert.match(migration, /nulls last/);
  assert.match(migration, /filtered\.id asc/);
});

test("search grammar keeps special characters inside fixed quoted values", () => {
  const filter = buildSafeDealSearchFilter(`  %_(),"quoted"  `);
  assert.ok(filter);
  assert.ok(filter.startsWith('customer_name.ilike."%'));
  assert.ok(filter.includes("\\%\\_(),\\\"quoted\\\""));
  assert.ok(filter.endsWith('%"'));
  assert.equal((filter.match(/customer_name\.ilike/g) ?? []).length, 1);
  assert.equal((filter.match(/external_deal_id\.ilike/g) ?? []).length, 1);
});

test("empty search removes the database search expression", () => {
  assert.equal(buildSafeDealSearchFilter("   "), null);
});

test("dynamic service and salesperson filters require tenant-derived options", () => {
  const requested = parseDealsQueryState({ service: "Other tenant service", salesperson: "Unknown Rep" });
  const checked = validateDynamicDealFilters(requested, ["Heat Pump"], ["Avery Cole"]);
  assert.equal(checked.service, null);
  assert.equal(checked.salesperson, null);
});

test("currency, DATE, and enum formatting are centralized and deterministic", () => {
  assert.equal(formatDealCurrency("8500.00"), "$8,500");
  assert.equal(formatDealDate("2026-01-02"), "Jan 2, 2026");
  assert.equal(formatDealDate(null), "—");
  assert.equal(formatDealDate("not-a-date"), "—");
  assert.equal(humanizeDealEnum("DECISION_MAKER"), "Decision Maker");
});
