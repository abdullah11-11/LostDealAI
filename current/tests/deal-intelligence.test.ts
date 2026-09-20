import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { formatDealCurrency } from "@/lib/deals/format";
import { RECOVERY_WEIGHTS } from "@/lib/scoring/constants";
import {
  deriveDealExperienceState,
  evidenceIsGrounded,
  normalizeScoringMetadata,
} from "@/lib/deals/intelligence";

function scoringMetadata(overrides: Record<string, unknown> = {}) {
  return {
    version: "1.0",
    calculated_at: "2026-08-25T10:00:00.000Z",
    as_of_date: "2026-08-25",
    buying_intent_score: 65,
    buying_intent_weight: 0.5,
    buying_intent_contribution: 32.5,
    reason: "FINANCING",
    reason_recoverability: 75,
    reason_weight: 0.3,
    reason_contribution: 22.5,
    quote_date: "2026-08-18",
    quote_age_days: 7,
    recency_score: 100,
    recency_weight: 0.2,
    recency_contribution: 20,
    confidence_score: 96,
    confidence_multiplier: 0.988,
    base_score: 75,
    pre_cap_score: 74.1,
    applied_caps: [],
    notes: [],
    final_score: 74,
    priority: "HIGH",
    ...overrides,
  };
}

function experience(overrides: Partial<Parameters<typeof deriveDealExperienceState>[0]> = {}) {
  return deriveDealExperienceState({
    analysisStatus: "completed",
    hasAnalysis: true,
    recoveryScore: 74,
    recoveryPriority: "HIGH",
    recommendedChannel: "HUMAN_CALL",
    ...overrides,
  });
}

test("all persisted deal intelligence states classify without page-load work", () => {
  assert.equal(experience(), "completed_scored");
  assert.equal(experience({ recoveryScore: null, recoveryPriority: null }), "completed_unscored");
  assert.equal(experience({ recommendedChannel: "NO_ACTION" }), "no_action");
  assert.equal(experience({ analysisStatus: "pending", hasAnalysis: false, recoveryScore: null, recoveryPriority: null }), "pending");
  assert.equal(experience({ analysisStatus: "processing", hasAnalysis: false, recoveryScore: null, recoveryPriority: null }), "processing");
  assert.equal(experience({ analysisStatus: "failed", hasAnalysis: false, recoveryScore: null, recoveryPriority: null }), "failed");
  assert.equal(experience({ hasAnalysis: false }), "failed");
});

test("an older score missing only its calculation date retains every useful component", () => {
  const result = normalizeScoringMetadata(scoringMetadata({ calculated_at: null }));
  assert.ok(result);
  assert.equal(result.calculated_at, null);
  assert.equal(result.version, "1.0");
  assert.equal(result.buying_intent_contribution, 32.5);
  assert.equal(result.reason_recoverability, 75);
  assert.equal(result.recency_score, 100);
  assert.equal(result.confidence_multiplier, 0.988);
  assert.equal(result.final_score, 74);
});

test("deal intelligence fixtures document the production 50/30/20 score weights", () => {
  const result = normalizeScoringMetadata(scoringMetadata());
  assert.ok(result);
  assert.deepEqual(
    [result.buying_intent_weight, result.reason_weight, result.recency_weight],
    [0.5, 0.3, 0.2],
  );
  assert.deepEqual(RECOVERY_WEIGHTS, {
    buyingIntent: 0.5,
    reasonRecoverability: 0.3,
    recency: 0.2,
  });
});

test("partial metadata fails closed while malformed caps and notes are safely excluded", () => {
  assert.equal(normalizeScoringMetadata({ version: "1.0" }), null);
  assert.equal(normalizeScoringMetadata(scoringMetadata({ reason: "INVENTED" })), null);
  assert.equal(normalizeScoringMetadata(scoringMetadata({ priority: "URGENT" })), null);
  const result = normalizeScoringMetadata(scoringMetadata({
    applied_caps: [
      { code: "NO_ACTION_CAP", maximum: 20, explanation: "no outreach is recommended", limitedScore: true },
      { code: "INVENTED_CAP", maximum: 99, explanation: "invalid", limitedScore: true },
      { code: "NO_EVIDENCE_CAP", maximum: Number.NaN, explanation: "invalid number", limitedScore: true },
    ],
    notes: ["FUTURE_QUOTE_DATE", "PRIVATE_NOTE"],
  }));
  assert.ok(result);
  assert.deepEqual(result.applied_caps.map((cap) => cap.code), ["NO_ACTION_CAP"]);
  assert.deepEqual(result.notes, ["FUTURE_QUOTE_DATE"]);
});

test("financing, timing, NO_ACTION, and weak-information fixtures remain truthful", () => {
  const salesNotes = "Customer likes the system but said the monthly payment is too high.";
  const transcript = "Customer: Revisit this after our budget resets in October.";
  assert.equal(evidenceIsGrounded("SALES_NOTES", "monthly payment is too high", salesNotes, transcript), true);
  assert.equal(evidenceIsGrounded("TRANSCRIPT", "budget resets in October", salesNotes, transcript), true);
  assert.equal(evidenceIsGrounded("TRANSCRIPT", "guaranteed savings", salesNotes, transcript), false);
  assert.equal(evidenceIsGrounded("SALES_NOTES", "anything", null, transcript), false);
  assert.equal(experience({ recommendedChannel: "NO_ACTION", recoveryScore: 20, recoveryPriority: "LOW" }), "no_action");
  assert.equal(experience({ recoveryScore: 26, recoveryPriority: "LOW" }), "completed_scored");
});

test("evidence display shares Prompt 7 normalization without fuzzy matching", () => {
  const salesNotes = "Customer likes the system.\r\nMonthly   payment\tis the blocker.";
  const transcript = "Customer asked for a follow-up\nnext month.";
  assert.equal(evidenceIsGrounded("SALES_NOTES", "Customer likes the system.", salesNotes, transcript), true);
  assert.equal(evidenceIsGrounded("SALES_NOTES", "Monthly payment is the blocker.", salesNotes, transcript), true);
  assert.equal(evidenceIsGrounded("TRANSCRIPT", "follow-up\r\nnext month", salesNotes, transcript), true);
  assert.equal(evidenceIsGrounded("TRANSCRIPT", "follow-up next month", salesNotes, transcript), true);
  assert.equal(evidenceIsGrounded("SALES_NOTES", "payment remains unaffordable", salesNotes, transcript), false);
  assert.equal(evidenceIsGrounded("SALES_NOTES", "genuinely absent excerpt", salesNotes, transcript), false);
});

test("currency never shows a dangling single decimal", () => {
  assert.equal(formatDealCurrency("300250.50"), "$300,250.50");
  assert.equal(formatDealCurrency("300250.05"), "$300,250.05");
  assert.equal(formatDealCurrency("300250.00"), "$300,250");
  assert.equal(formatDealCurrency("1.20"), "$1.20");
  assert.equal(formatDealCurrency(null), "—");
  assert.equal(formatDealCurrency("not-a-number"), "—");
});

test("the completed page follows the value-first information order", async () => {
  const page = await readFile("app/(dashboard)/deals/[id]/page.tsx", "utf8");
  const standardStart = page.indexOf("function StandardAnalysisExperience");
  const standardEnd = page.indexOf("function DeepUpgradeCard");
  assert.ok(standardStart >= 0 && standardEnd > standardStart);
  const standardExperience = page.slice(standardStart, standardEnd);
  const orderedMarkers = [
    "<RecoverySummary",
    "<RecommendedNextAction",
    "<SuggestedFollowUp",
    "<WhyLost",
    "<SignalSections",
    "<EvidenceSection",
    "<RecoveryScoreBreakdown",
    "<SourceSeparationNote",
    "<SourceSections",
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const current = standardExperience.indexOf(marker);
    assert.ok(current > previous, `${marker} must appear after the prior intelligence section.`);
    previous = current;
  }
  for (const copy of [
    "Recovery Summary", "Recommended Next Action", "Suggested Follow-Up", "Why This Deal Was Lost",
    "Positive Signals", "Negative Signals", "Grounded Evidence", "How Recovery Score Was Calculated",
    "Deal Information", "Sales Notes", "Transcript",
  ]) assert.match(page, new RegExp(copy));
  assert.ok(page.indexOf("Recovery Summary") < page.indexOf("Deal Information"));
  assert.ok(page.indexOf("Recommended Next Action") < page.indexOf("Sales Notes"));
});

test("normal detail loading is one tenant-scoped read with no AI or score calculation", async () => {
  const [page, server] = await Promise.all([
    readFile("app/(dashboard)/deals/[id]/page.tsx", "utf8"),
    readFile("lib/deals/server.ts", "utf8"),
  ]);
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /getDealDetail\(supabase, context\.organization\.id, decodedId\)/);
  assert.doesNotMatch(page, /\bfetch\s*\(/);
  assert.doesNotMatch(page, /from ["']openai["']|getOpenAIClient|runOpenAIAnalysis|calculateRecoveryScore\s*\(/);
  assert.doesNotMatch(page, /expected revenue|predicted revenue|deal_value\s*\*|recovery_score\s*\*/i);
  const detailStart = server.indexOf("export async function getDealDetail");
  const detailSource = server.slice(detailStart);
  assert.match(detailSource, /\.from\("deals"\)/);
  assert.match(detailSource, /\.eq\("organization_id", organizationId\)/);
  assert.match(detailSource, /\.eq\("id", dealId\)/);
  assert.match(detailSource, /\.maybeSingle\(\)/);
  assert.doesNotMatch(detailSource, /insert\(|update\(|upsert\(|delete\(|service_role|SUPABASE_SERVICE_ROLE/);
});

test("copy and transcript interactions are client-only, accessible, and side-effect free", async () => {
  const [copy, transcript, page] = await Promise.all([
    readFile("components/copy-message-button.tsx", "utf8"),
    readFile("components/expandable-transcript.tsx", "utf8"),
    readFile("app/(dashboard)/deals/[id]/page.tsx", "utf8"),
  ]);
  assert.match(copy, /"use client"/);
  assert.match(copy, /navigator\.clipboard\.writeText\(message\)/);
  assert.match(copy, /aria-live="polite"/);
  assert.doesNotMatch(copy, /fetch\(|from ["']openai["']|mailto:|sms:/i);
  assert.match(transcript, /"use client"/);
  assert.match(transcript, /aria-expanded=\{expanded\}/);
  assert.match(transcript, /aria-controls=\{contentId\}/);
  assert.doesNotMatch(transcript, /fetch\(|openai/i);
  assert.match(page, /<CopyMessageButton message=\{message\}/);
  assert.match(page, /<ExpandableTranscript text=\{deal\.transcript\}/);
  assert.doesNotMatch(page, /contentEditable|type="number"|Manual Score|Override Score/i);
});

test("NO_ACTION, weak data, failure, pending, and unscored UX are explicit", async () => {
  const [page, copy] = await Promise.all([
    readFile("app/(dashboard)/deals/[id]/page.tsx", "utf8"),
    readFile("components/copy-message-button.tsx", "utf8"),
  ]);
  for (const copy of [
    "No Active Recovery Recommended",
    "No outreach message is recommended for this deal.",
    "Low confidence — review source evidence",
    "No grounded evidence was stored.",
    "Ready for Analysis",
    "Analysis in progress",
    "Analysis needs attention",
    "Completed analysis, not scored yet",
    "Score calculation date unavailable",
    "Review before sending. LostDeal AI does not contact the customer automatically.",
  ]) assert.match(page, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(copy, /Copies only; LostDeal AI never sends it/);
  assert.doesNotMatch(page, /Contact Customer|Send Message|Send Email|Start Outreach/);
});

test("detail access retains tenant RLS and the dashboard relationship-order fix", async () => {
  const [migration, dashboardServer, detailServer] = await Promise.all([
    readFile("supabase/migrations/20260810000000_initial_lostdeal_schema.sql", "utf8"),
    readFile("lib/dashboard/server.ts", "utf8"),
    readFile("lib/deals/server.ts", "utf8"),
  ]);
  assert.match(migration, /alter table public\.deals enable row level security;/);
  assert.match(migration, /create policy deals_select_org_member/);
  assert.match(migration, /create policy deal_analyses_select_org_member/);
  assert.match(detailServer, /\.eq\("organization_id", organizationId\)/);
  assert.doesNotMatch(detailServer, /createServiceClient|service_role|SUPABASE_SERVICE_ROLE/);
  assert.doesNotMatch(dashboardServer, /deal_analyses\(recovery_score\)/);
  assert.doesNotMatch(dashboardServer, /fetchTopOpportunities/);
});
