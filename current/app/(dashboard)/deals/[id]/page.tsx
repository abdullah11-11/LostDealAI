import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  BrainCircuit,
  Calculator,
  CalendarClock,
  Clock3,
  Database,
  FileText,
  LayoutDashboard,
  Lightbulb,
  LoaderCircle,
  MessageSquareText,
  ShieldCheck,
  Target,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { AnalyzeDealButton } from "@/components/analyze-deal-button";
import { CalculateRecoveryScoreButton } from "@/components/calculate-recovery-score-button";
import { CopyMessageButton } from "@/components/copy-message-button";
import { DeepAnalysisButton } from "@/components/deep-analysis-button";
import { DeleteDealControl } from "@/components/delete-deal-control";
import { DealPriorityBadge, DealStatusBadge } from "@/components/deal-status";
import { ExpandableTranscript } from "@/components/expandable-transcript";
import { LocalTabs } from "@/components/local-tabs";
import { Badge, Card, buttonStyles } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/server";
import { resolveDeepAnalysisAccess, type AnalysisAccess } from "@/lib/billing/analysis-access";
import { getOrganizationUsageSnapshot } from "@/lib/billing/usage";
import { getSafeNextPath } from "@/lib/auth/validation";
import { formatDealCurrency, formatDealDate, formatDealTimestamp, humanizeDealEnum } from "@/lib/deals/format";
import { deriveDealExperienceState, evidenceIsGrounded, type DealExperienceState } from "@/lib/deals/intelligence";
import { getDealDetail, type DealAnalysisDetail, type DealDetail } from "@/lib/deals/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Deal intelligence" };
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const decodedId = decodeURIComponent(id);
  if (!UUID_PATTERN.test(decodedId)) notFound();

  const context = await requireOrganization(`/deals/${encodeURIComponent(decodedId)}`);
  const supabase = await createClient();
  const [result, usageSnapshot] = await Promise.all([
    getDealDetail(supabase, context.organization.id, decodedId),
    getOrganizationUsageSnapshot(supabase, context.organization.id),
  ]);
  if (!result.error && !result.deal) notFound();

  const rawFrom = typeof query.from === "string" ? query.from : null;
  const safeFrom = getSafeNextPath(rawFrom);
  const backHref = safeFrom === "/deals" || safeFrom.startsWith("/deals?") ? safeFrom : "/deals";

  if (result.error || !result.deal) return <DealLoadError dealId={decodedId} backHref={backHref} />;

  const deal = result.deal;
  const analysis = deal.analysis;
  const deepAccess: AnalysisAccess = usageSnapshot.available && usageSnapshot.plan
    ? resolveDeepAnalysisAccess(
        usageSnapshot.plan.planCode,
        usageSnapshot.subscriptionStatus,
        usageSnapshot.mode,
      )
    : { state: "INACTIVE", entitled: false, providerExecutionAllowed: false, trialPreviewEligible: false };
  const experience = deriveDealExperienceState({
    analysisStatus: deal.analysis_status,
    hasAnalysis: Boolean(analysis),
    recoveryScore: analysis?.recovery_score ?? null,
    recoveryPriority: analysis?.recovery_priority ?? null,
    recommendedChannel: analysis?.recommended_channel ?? null,
  });

  return (
    <main className="mx-auto max-w-7xl">
      <DealHeader deal={deal} backHref={backHref} />

      {analysis ? (
        <div className="mt-6 space-y-4">
          {analysis.analysis_usage_status === "PENDING" && <UsageFinalizationNotice deal={deal} />}
          {deal.analysis_status !== "completed" && <StoredAnalysisOperationNotice deal={deal} />}
          {analysis.analysis_mode === "DEEP" && analysis.deep_analysis ? (
            <DeepAnalysisExperience deal={deal} analysis={analysis} />
          ) : (
            <StandardAnalysisExperience deal={deal} analysis={analysis} experience={experience} deepAccess={deepAccess} />
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <AnalysisStateCard deal={deal} experience={experience} deepAccess={deepAccess} />
          <details className="rounded-2xl border border-line bg-panel shadow-sm">
            <summary className="flex min-h-14 list-none items-center justify-between gap-3 rounded-2xl px-5 text-sm font-bold text-content transition-colors hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><Database aria-hidden="true" className="size-4 text-brand-strong" />View Imported Source Data</span>
              <span className="text-xs font-semibold text-secondary">Notes, transcript, and privacy controls</span>
            </summary>
            <div className="space-y-5 border-t border-line p-5"><SourceSeparationNote /><SourceSections deal={deal} /><DataPrivacySection dealId={deal.id} /></div>
          </details>
        </div>
      )}
    </main>
  );
}

function UsageFinalizationNotice({ deal }: { deal: DealDetail }) {
  const deep = deal.analysis?.analysis_mode === "DEEP";
  return (
    <aside role="status" className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-4 text-sm leading-6 text-warning-content">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p>
          <strong className="text-content">The validated analysis is saved.</strong>{" "}
          Its usage record still needs an idempotent reconciliation; this action will not run the AI provider again.
        </p>
        {deep
          ? <DeepAnalysisButton dealId={deal.id} label="Finalize usage record" primary={false} />
          : <AnalyzeDealButton dealId={deal.id} retry label="Finalize usage record" primary={false} />}
      </div>
    </aside>
  );
}

function DealLoadError({ dealId, backHref }: { dealId: string; backHref: string }) {
  return (
    <main className="mx-auto max-w-3xl">
      <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-semibold text-secondary hover:text-content">
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to Deals
      </Link>
      <div role="alert" className="mt-8 rounded-2xl border border-red-500/35 bg-panel p-8 text-center shadow-sm">
        <AlertCircle aria-hidden="true" className="mx-auto size-9 text-danger-content" />
        <h1 className="mt-4 text-xl font-bold text-content">This deal could not be loaded</h1>
        <p className="mt-2 text-sm leading-6 text-secondary">Your data has not changed. Try again shortly.</p>
        <Link href={`/deals/${dealId}?from=${encodeURIComponent(backHref)}`} className={buttonStyles("outline", "mt-6")}>Try again</Link>
      </div>
    </main>
  );
}

function DealHeader({ deal, backHref }: { deal: DealDetail; backHref: string }) {
  const hasCompleteScore = deal.analysis?.recovery_score !== null && deal.analysis?.recovery_score !== undefined && Boolean(deal.analysis.recovery_priority);
  return (
    <>
      <nav aria-label="Deal navigation" className="flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref} className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm font-semibold text-secondary hover:text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25">
          <ArrowLeft aria-hidden="true" className="size-4" /> Back to Deals
        </Link>
        <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-secondary hover:bg-panel-hover hover:text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25">
          <LayoutDashboard aria-hidden="true" className="size-4" /> View Overview
        </Link>
      </nav>

      <header className="mt-4 rounded-2xl border border-line bg-panel p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <DealStatusBadge status={deal.analysis_status} />
              {deal.external_deal_id && <Badge tone="neutral">{deal.external_deal_id}</Badge>}
            </div>
            <h1 className="mt-3 break-words text-2xl font-semibold tracking-[-0.025em] text-content sm:text-3xl">{deal.customer_name || "Unnamed customer"}</h1>
            <p className="mt-2 text-sm leading-6 text-secondary">
              {deal.service_type || "Service not provided"} <span aria-hidden="true">·</span> Quoted {formatDealDate(deal.quote_date)}
            </p>
          </div>
          <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:min-w-[23rem]">
            <HeaderMetric label="Deal Value" value={formatDealCurrency(deal.deal_value)} detail="Imported source value" />
            <HeaderMetric
              label="Recovery"
              value={hasCompleteScore ? `${deal.analysis?.recovery_score}/100` : "Not scored"}
              detail={hasCompleteScore ? `${humanizeDealEnum(deal.analysis?.recovery_priority ?? null)} priority` : "Persisted score status"}
            />
          </div>
        </div>
      </header>
    </>
  );
}

function HeaderMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-raised px-4 py-3">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-secondary">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-content">{value}</p>
      <p className="mt-1 text-[11px] leading-5 text-secondary">{detail}</p>
    </div>
  );
}

function StoredAnalysisOperationNotice({ deal }: { deal: DealDetail }) {
  const processing = deal.analysis_status === "processing";
  return (
    <aside
      role="status"
      className={`rounded-xl border px-4 py-3 text-sm leading-6 ${processing ? "border-brand/30 bg-brand/10 text-secondary" : "border-amber-500/35 bg-amber-500/10 text-warning-content"}`}
    >
      <strong className="text-content">{processing ? "Deep Analysis is in progress." : "The latest Deep Analysis attempt did not complete."}</strong>{" "}
      The last validated stored analysis remains visible and unchanged.
    </aside>
  );
}

function StandardAnalysisExperience({
  deal,
  analysis,
  experience,
  deepAccess,
}: {
  deal: DealDetail;
  analysis: DealAnalysisDetail;
  experience: DealExperienceState;
  deepAccess: AnalysisAccess;
}) {
  return (
    <>
      <RecoverySummary analysis={analysis} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <RecommendedNextAction analysis={analysis} noAction={experience === "no_action"} />
        <SuggestedFollowUp analysis={analysis} noAction={experience === "no_action"} />
      </div>
      <DeepUpgradeCard deal={deal} access={deepAccess} />
      <section aria-labelledby="deal-details-heading" className="pt-2">
        <h2 id="deal-details-heading" className="sr-only">Deal intelligence details</h2>
        <LocalTabs
          label="Deal intelligence sections"
          tabs={[
            {
              id: "overview",
              label: "Overview",
              content: <div className="space-y-5"><WhyLost analysis={analysis} /><SignalSections analysis={analysis} /></div>,
            },
            {
              id: "evidence",
              label: "Evidence",
              content: <EvidenceSection deal={deal} analysis={analysis} />,
            },
            {
              id: "score-details",
              label: "Score Details",
              content: <RecoveryScoreBreakdown deal={deal} />,
            },
            {
              id: "source-data",
              label: "Source Data",
              content: <div className="space-y-5"><SourceSeparationNote /><SourceSections deal={deal} /><DataPrivacySection dealId={deal.id} /></div>,
            },
          ]}
        />
      </section>
    </>
  );
}

function DeepUpgradeCard({ deal, access }: { deal: DealDetail; access: AnalysisAccess }) {
  const setupPending = access.providerExecutionAllowed && !deal.deep_persistence_available;
  return (
    <Card
      title="Deep Recovery Analysis"
      description="Go beyond the primary loss reason with blocker, timing, decision and recovery-strategy analysis"
      action={<Badge tone="demo">Pro</Badge>}
      className="border-brand/30"
    >
      <div className="p-5 sm:p-6">
        {access.providerExecutionAllowed && !setupPending ? (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-bold text-content">Add a deeper, evidence-grounded recovery assessment.</p>
              <p className="mt-1 text-xs leading-5 text-secondary">This explicit provider-backed operation uses one AI Analysis unit. It does not change the Recovery Score formula.</p>
            </div>
            <DeepAnalysisButton dealId={deal.id} label="Upgrade to Deep Analysis" />
          </div>
        ) : (
          <div>
            <p className="text-sm font-bold text-content">
              {setupPending
                ? "Deep Analysis setup is pending."
                : access.state === "LOCKED"
                  ? "Pro feature — available when Pro billing launches."
                  : "Deep Analysis will activate with verified Pro billing."}
            </p>
            <p className="mt-2 text-xs leading-5 text-secondary">Your current Standard Analysis remains fully available and unobstructed. No checkout or automatic AI call occurs here.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function DeepAnalysisExperience({ deal, analysis }: { deal: DealDetail; analysis: DealAnalysisDetail }) {
  const deep = analysis.deep_analysis;
  if (!deep) return null;
  return (
    <>
      <DeepRecoverySummary deal={deal} analysis={analysis} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <DeepRecoveryStrategy analysis={analysis} />
        <DeepFollowUp analysis={analysis} />
      </div>
      <section aria-labelledby="deep-details-heading" className="pt-2">
        <h2 id="deep-details-heading" className="sr-only">Deep Recovery Analysis details</h2>
        <LocalTabs
          label="Deep Recovery Analysis sections"
          tabs={[
            {
              id: "overview",
              label: "Overview",
              content: <div className="space-y-5"><RecoverySummary analysis={analysis} /><RecommendedNextAction analysis={analysis} noAction={analysis.recommended_channel === "NO_ACTION"} /><SignalSections analysis={analysis} /></div>,
            },
            {
              id: "blockers",
              label: "Blockers",
              content: <DeepBlockers analysis={analysis} />,
            },
            {
              id: "decision-dynamics",
              label: "Decision Dynamics",
              content: <DeepDecisionDynamics analysis={analysis} />,
            },
            {
              id: "evidence",
              label: "Evidence",
              content: <EvidenceSection deal={deal} analysis={analysis} />,
            },
            {
              id: "score-details",
              label: "Score Details",
              content: <RecoveryScoreBreakdown deal={deal} />,
            },
            {
              id: "source-data",
              label: "Source Data",
              content: <div className="space-y-5"><SourceSeparationNote /><SourceSections deal={deal} /><DataPrivacySection dealId={deal.id} /></div>,
            },
          ]}
        />
      </section>
    </>
  );
}

function DeepRecoverySummary({ deal, analysis }: { deal: DealDetail; analysis: DealAnalysisDetail }) {
  const deep = analysis.deep_analysis!;
  return (
    <Card
      title="Deep Recovery Summary"
      description="Evidence-grounded strategic assessment · Not a probability"
      action={<Badge tone="demo">Deep Recovery Analysis</Badge>}
      className="overflow-hidden border-brand/35"
    >
      <div className="grid gap-px bg-line lg:grid-cols-[1.25fr_1fr]">
        <div className="bg-panel p-5 sm:p-6">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">Primary Blocker · {humanizeDealEnum(deep.primary_blocker.reason)}</p>
          <p className="mt-3 text-base font-bold leading-7 text-content">{deep.primary_blocker.explanation}</p>
          <p className="mt-5 text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">Recovery Thesis</p>
          <p className="mt-2 text-sm leading-7 text-secondary">{deep.recovery_thesis.explanation}</p>
        </div>
        <dl className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <SummaryMetric label="Customer Readiness" value={humanizeDealEnum(deep.customer_readiness.level)} detail={deep.customer_readiness.explanation} />
          <SummaryMetric label="Recovery Risk" value={humanizeDealEnum(deep.recovery_risk.level)} detail={deep.recovery_risk.explanation} />
          <SummaryMetric label="Buying Intent" value={`${analysis.buying_intent_score}/100`} detail="Same semantics used by Standard Analysis" />
          <SummaryMetric label="Confidence" value={`${analysis.confidence_score}/100`} detail="Strength of source support" />
        </dl>
      </div>
      <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs leading-5 text-secondary">Re-running is explicit and uses one additional AI Analysis unit. Normal page loads reuse this stored result.</p>
        {deal.deep_persistence_available && analysis.analysis_usage_status !== "PENDING" && <DeepAnalysisButton dealId={deal.id} rerun primary={false} />}
      </div>
    </Card>
  );
}

function DeepRecoveryStrategy({ analysis }: { analysis: DealAnalysisDetail }) {
  const strategy = analysis.deep_analysis!.recovery_strategy;
  return (
    <Card title="Recovery Strategy" description="How to approach recovery without changing the deterministic score" action={<Target aria-hidden="true" className="size-5 text-brand-strong" />}>
      <div className="space-y-4 p-5 sm:p-6">
        <DeepTextField label="Objective" value={strategy.objective} />
        <DeepTextField label="Recommended Angle" value={strategy.recommended_angle} />
        <div className="grid gap-3 sm:grid-cols-2">
          <DeepTextField label="Lead With" value={strategy.lead_with} />
          <DeepTextField label="Do Not Lead With" value={strategy.avoid_leading_with} />
        </div>
        <DeepTextField label="Next Best Step" value={strategy.next_best_step} />
        <EvidenceReferences indices={strategy.evidence_indices} />
      </div>
    </Card>
  );
}

function DeepFollowUp({ analysis }: { analysis: DealAnalysisDetail }) {
  const strategy = analysis.deep_analysis!.follow_up_strategy;
  return (
    <Card title="Deep Follow-Up" description="Communication strategy and one editable draft · Nothing is sent automatically" action={<MessageSquareText aria-hidden="true" className="size-5 text-brand-strong" />}>
      <div className="space-y-4 p-5 sm:p-6">
        <DeepTextField label="Communication Objective" value={strategy.communication_objective} />
        <div className="grid gap-3 sm:grid-cols-2">
          <DeepTextField label="Tone" value={strategy.tone} />
          <DeepTextField label="Address" value={strategy.key_point_to_address} />
        </div>
        <DeepTextField label="Avoid" value={strategy.key_point_to_avoid} />
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">Recommended Sequence</p>
          <ol className="mt-2 space-y-2 text-sm leading-6 text-secondary">
            {strategy.recommended_sequence.map((step, index) => <li key={`${step}-${index}`}><strong className="mr-2 text-content">{index + 1}.</strong>{step}</li>)}
          </ol>
        </div>
        {analysis.follow_up_message ? (
          <div className="rounded-xl border border-line bg-panel-raised p-4">
            <p className="whitespace-pre-wrap text-sm leading-7 text-secondary">{analysis.follow_up_message}</p>
            <div className="mt-4"><CopyMessageButton message={analysis.follow_up_message} /></div>
          </div>
        ) : <p className="rounded-xl border border-line bg-panel-raised p-4 text-sm text-secondary">No customer-facing message is recommended.</p>}
        <EvidenceReferences indices={strategy.evidence_indices} />
      </div>
    </Card>
  );
}

function DeepBlockers({ analysis }: { analysis: DealAnalysisDetail }) {
  const deep = analysis.deep_analysis!;
  return (
    <div className="space-y-5">
      <Card title="Blocker Hierarchy" description="Primary and contributing factors supported by the evidence" action={<BrainCircuit aria-hidden="true" className="size-5 text-brand-strong" />}>
        <div className="space-y-4 p-5 sm:p-6">
          <DeepRankedItem rank={1} label={humanizeDealEnum(deep.primary_blocker.reason)} value={deep.primary_blocker.explanation} indices={deep.primary_blocker.evidence_indices} />
          {deep.secondary_blockers.map((blocker, index) => (
            <DeepRankedItem key={`${blocker.reason}-${index}`} rank={index + 2} label={humanizeDealEnum(blocker.reason)} value={blocker.explanation} indices={blocker.evidence_indices} />
          ))}
          {!deep.secondary_blockers.length && <p className="text-sm text-secondary">No supported secondary blocker was identified.</p>}
        </div>
      </Card>
      <Card title="Objection Hierarchy" description="Supported objections ordered by importance">
        <div className="space-y-3 p-5 sm:p-6">
          {deep.objection_hierarchy.length ? deep.objection_hierarchy.map((objection, index) => (
            <DeepRankedItem key={`${objection.reason}-${index}`} rank={index + 1} label={humanizeDealEnum(objection.reason)} value={objection.explanation} indices={objection.evidence_indices} />
          )) : <p className="text-sm text-secondary">The source does not support a reliable objection hierarchy.</p>}
        </div>
      </Card>
    </div>
  );
}

function DeepDecisionDynamics({ analysis }: { analysis: DealAnalysisDetail }) {
  const deep = analysis.deep_analysis!;
  return (
    <Card title="Decision Dynamics" description="Grounded interpretation of timing, price, competition and decision authority">
      <div className="grid gap-px bg-line md:grid-cols-2">
        <DeepInterpretation label="Decision Maker" value={deep.decision_dynamics.explanation} indices={deep.decision_dynamics.evidence_indices} />
        <DeepInterpretation label={`Timing · ${humanizeDealEnum(deep.timing_interpretation.category)}`} value={deep.timing_interpretation.explanation} indices={deep.timing_interpretation.evidence_indices} />
        <DeepInterpretation label={`Price / Value · ${humanizeDealEnum(deep.price_value_interpretation.category)}`} value={deep.price_value_interpretation.explanation} indices={deep.price_value_interpretation.evidence_indices} />
        <DeepInterpretation label={`Competitor · ${humanizeDealEnum(deep.competitor_dynamics.category)}`} value={deep.competitor_dynamics.explanation} indices={deep.competitor_dynamics.evidence_indices} />
        <DeepInterpretation label={`Discount Caution · ${humanizeDealEnum(deep.margin_discount_caution.assessment)}`} value={deep.margin_discount_caution.explanation} indices={deep.margin_discount_caution.evidence_indices} className="md:col-span-2" />
      </div>
    </Card>
  );
}

function DeepTextField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-raised p-4">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">{label}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-content">{value}</p>
    </div>
  );
}

function DeepRankedItem({ rank, label, value, indices }: { rank: number; label: string; value: string; indices: number[] }) {
  return (
    <div className="rounded-xl border border-line bg-panel-raised p-4">
      <div className="flex items-center gap-3"><span className="flex size-7 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand-strong">{rank}</span><p className="text-sm font-bold text-content">{label}</p></div>
      <p className="mt-3 text-sm leading-6 text-secondary">{value}</p>
      <EvidenceReferences indices={indices} />
    </div>
  );
}

function DeepInterpretation({ label, value, indices, className = "" }: { label: string; value: string; indices: number[]; className?: string }) {
  return (
    <div className={`bg-panel p-5 sm:p-6 ${className}`}>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">{label}</p>
      <p className="mt-3 text-sm leading-7 text-content">{value}</p>
      <EvidenceReferences indices={indices} />
    </div>
  );
}

function EvidenceReferences({ indices }: { indices: number[] }) {
  return (
    <p className="mt-3 text-xs leading-5 text-secondary">
      {indices.length ? `Grounded in Evidence ${indices.map((index) => index + 1).join(", ")}` : "No source claim is asserted beyond the available evidence."}
    </p>
  );
}

function RecoverySummary({ analysis }: { analysis: DealAnalysisDetail }) {
  const hasCompleteScore = analysis.recovery_score !== null && Boolean(analysis.recovery_priority);
  return (
    <Card
      title="Recovery Summary"
      description="The recovery decision at a glance"
      action={hasCompleteScore ? <DealPriorityBadge priority={analysis.recovery_priority} /> : <Badge tone="neutral">Unscored</Badge>}
      className="overflow-hidden border-brand/30"
    >
      <dl className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-5">
        <SummaryMetric label="Recovery Score" value={hasCompleteScore ? `${analysis.recovery_score}/100` : "Not scored yet"} detail="Deterministic ranking" />
        <SummaryMetric label="Recovery Priority" value={hasCompleteScore ? humanizeDealEnum(analysis.recovery_priority) : "Unscored"} detail="Action queue" />
        <SummaryMetric label="Lost Reason" value={humanizeDealEnum(analysis.lost_reason)} detail="AI classification" />
        <SummaryMetric label="Buying Intent" value={`${analysis.buying_intent_score}/100`} detail="How strongly source data suggests intent to purchase" />
        <SummaryMetric
          label="Analysis Confidence"
          value={`${analysis.confidence_score}/100`}
          detail={analysis.confidence_score < 40 ? "Low confidence — review source evidence" : "How strongly notes or transcript support the analysis"}
          warning={analysis.confidence_score < 40}
        />
      </dl>
      <p className="border-t border-line px-5 py-3 text-xs leading-5 text-secondary sm:px-6">
        Recovery Score is a prioritization indicator based on stored deal signals. It is not a probability, prediction, or guarantee of conversion.
      </p>
    </Card>
  );
}

function SummaryMetric({ label, value, detail, warning = false }: { label: string; value: string; detail: string; warning?: boolean }) {
  return (
    <div className="bg-panel p-4">
      <dt className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">{label}</dt>
      <dd className="mt-2 break-words text-lg font-bold leading-6 text-content">{value}</dd>
      <dd className={`mt-2 text-xs leading-5 ${warning ? "font-semibold text-warning-content" : "text-secondary"}`}>{detail}</dd>
    </div>
  );
}

function RecommendedNextAction({ analysis, noAction }: { analysis: DealAnalysisDetail; noAction: boolean }) {
  return (
    <Card
      title={noAction ? "No Active Recovery Recommended" : "Recommended Next Action"}
      description={noAction ? "A restrained outcome based on the stored analysis" : "The clearest next step from the persisted analysis"}
      action={noAction ? <ShieldCheck aria-hidden="true" className="size-6 text-warning-content" /> : <Target aria-hidden="true" className="size-6 text-brand-strong" />}
      className={noAction ? "border-amber-500/35 bg-amber-500/5" : "border-brand/30"}
    >
      <div className="p-5">
        <p className="max-w-4xl text-base font-semibold leading-7 text-content">
          {analysis.recommended_action || (noAction ? "Do not initiate recovery outreach at this time." : "No next-action recommendation was stored.")}
        </p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <ActionDetail icon={<CalendarClock aria-hidden="true" className="size-4" />} label="Timing" value={analysis.recommended_timing || "Not provided"} />
          <ActionDetail icon={<MessageSquareText aria-hidden="true" className="size-4" />} label="Channel" value={noAction ? "No outreach" : humanizeDealEnum(analysis.recommended_channel)} />
        </dl>
        {noAction && <p className="mt-4 text-sm leading-6 text-warning-content">Keep this deal for reference and reassess only if new customer information changes the recommendation.</p>}
      </div>
    </Card>
  );
}

function ActionDetail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <dt className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">{icon}{label}</dt>
      <dd className="mt-2 text-sm font-bold text-content">{value}</dd>
    </div>
  );
}

function SuggestedFollowUp({ analysis, noAction }: { analysis: DealAnalysisDetail; noAction: boolean }) {
  const message = !noAction && analysis.follow_up_message?.trim() ? analysis.follow_up_message : null;
  return (
    <Card title="Suggested Follow-Up" description="Persisted AI draft · Review and personalize before use" action={<MessageSquareText aria-hidden="true" className="size-5 text-muted" />}>
      <div className="p-5">
        {message ? (
          <>
            <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
              <p className="whitespace-pre-wrap break-words rounded-xl border border-line bg-panel-raised p-4 text-sm leading-7 text-secondary">{message}</p>
              <CopyMessageButton message={message} />
            </div>
            <p className="mt-3 text-xs leading-5 text-secondary">Review before sending. LostDeal AI does not contact the customer automatically.</p>
          </>
        ) : (
          <div className="rounded-xl border border-line bg-panel-raised p-4">
            <p className="text-sm font-semibold text-content">{noAction ? "No outreach message is recommended for this deal." : "No follow-up message was stored."}</p>
            <p className="mt-1 text-xs leading-5 text-secondary">LostDeal AI has not created or sent any customer communication.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function WhyLost({ analysis }: { analysis: DealAnalysisDetail }) {
  return (
    <Card title="Why This Deal Was Lost" description="AI interpretation grounded in the imported source" action={<Lightbulb aria-hidden="true" className="size-5 text-amber-400" />}>
      <div className="p-5 sm:p-6">
        <Badge tone="neutral">{humanizeDealEnum(analysis.lost_reason)}</Badge>
        <p className="mt-4 max-w-4xl text-sm leading-7 text-secondary">{analysis.lost_reason_detail || "No additional explanation was stored."}</p>
      </div>
    </Card>
  );
}

function SignalSections({ analysis }: { analysis: DealAnalysisDetail }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <SignalCard title="Positive Signals" items={analysis.positive_signals} empty="No strong positive buying signals identified." positive />
      <SignalCard title="Negative Signals" items={analysis.negative_signals} empty="No major negative signals identified." />
    </div>
  );
}

function SignalCard({ title, items, empty, positive = false }: { title: string; items: string[]; empty: string; positive?: boolean }) {
  return (
    <Card title={title} description="AI-identified signal" action={positive ? <ThumbsUp aria-hidden="true" className="size-5 text-emerald-400" /> : <ThumbsDown aria-hidden="true" className="size-5 text-red-400" />}>
      <div className="p-5 sm:p-6">
        {items.length ? (
          <ul className="space-y-3 text-sm leading-6 text-secondary">
            {items.map((item, index) => (
              <li key={`${item}-${index}`} className="flex gap-3">
                <span aria-hidden="true" className={`mt-2 size-1.5 shrink-0 rounded-full ${positive ? "bg-emerald-500" : "bg-red-500"}`} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-secondary">{empty}</p>}
      </div>
    </Card>
  );
}

function EvidenceSection({ deal, analysis }: { deal: DealDetail; analysis: DealAnalysisDetail }) {
  return (
    <Card title="Grounded Evidence" description="These excerpts come directly from the imported sales notes or transcript" action={<ShieldCheck aria-hidden="true" className="size-5 text-emerald-400" />}>
      <div className="space-y-3 p-5 sm:p-6">
        {analysis.evidence.length ? analysis.evidence.map((evidence, index) => {
          const grounded = evidenceIsGrounded(evidence.source, evidence.excerpt, deal.sales_notes, deal.transcript);
          return (
            <figure key={`${evidence.source}-${index}`} className={`rounded-xl border p-4 ${grounded ? "border-emerald-500/35 bg-emerald-500/10" : "border-amber-500/35 bg-amber-500/10"}`}>
              <figcaption className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{humanizeDealEnum(evidence.source)}</Badge>
                <span className={`text-xs font-semibold ${grounded ? "text-success-content" : "text-warning-content"}`}>{grounded ? "Exact imported excerpt" : "Source match unavailable"}</span>
              </figcaption>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-content">{evidence.excerpt}</p>
            </figure>
          );
        }) : (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4">
            <p className="text-sm font-semibold text-warning-content">No grounded evidence was stored.</p>
            <p className="mt-1 text-xs leading-5 text-warning-content">Review the source notes and transcript before acting on this analysis.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function RecoveryScoreBreakdown({ deal }: { deal: DealDetail }) {
  const analysis = deal.analysis;
  if (!analysis) return null;
  if (analysis.recovery_score === null || !analysis.recovery_priority) {
    return (
      <Card title="How Recovery Score Was Calculated" description="Deterministic prioritization · Separate from AI analysis" action={<Calculator aria-hidden="true" className="size-5 text-brand" />}>
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <p className="text-xl font-semibold text-content">Completed analysis, not scored yet</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">Calculate from stored analysis signals and quote recency. This deterministic action makes no OpenAI request.</p>
          </div>
          <CalculateRecoveryScoreButton dealId={deal.id} />
        </div>
      </Card>
    );
  }

  const scoring = analysis.scoring_metadata;
  return (
    <Card title="How Recovery Score Was Calculated" description="Persisted deterministic components · No recalculation on page load" action={<DealPriorityBadge priority={analysis.recovery_priority} />}>
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p aria-label={`Recovery Score ${analysis.recovery_score} out of 100`} className="text-4xl font-semibold tracking-[-0.04em] text-content">{analysis.recovery_score}<span className="text-xl text-muted">/100</span></p>
            <p className="mt-2 text-sm leading-6 text-secondary">{analysis.score_explanation || "A stored deterministic score is available."}</p>
          </div>
          <div className="text-left text-xs leading-5 text-secondary sm:text-right">
            {scoring ? (
              <>
                <p>Scoring model: v{scoring.version}</p>
                <p>{scoring.calculated_at ? `Score calculated ${formatDealTimestamp(scoring.calculated_at)}` : "Score calculation date unavailable"}</p>
                <p>Inputs evaluated as of {formatDealDate(scoring.as_of_date)}</p>
              </>
            ) : <p>Versioned breakdown unavailable for this older score.</p>}
          </div>
        </div>

        {scoring ? (
          <>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ScoreFactor label="Buying Intent" value={`${scoring.buying_intent_score}/100`} detail={`${Math.round(scoring.buying_intent_weight * 100)}% weight · ${scoring.buying_intent_contribution.toFixed(1)} points`} />
              <ScoreFactor label="Loss Recoverability" value={`${scoring.reason_recoverability}/100`} detail={`${humanizeDealEnum(scoring.reason)} · ${scoring.reason_contribution.toFixed(1)} points`} />
              <ScoreFactor label="Recency" value={`${scoring.recency_score}/100`} detail={`${Math.round(scoring.recency_weight * 100)}% weight${scoring.quote_age_days === null ? " · Date unavailable" : scoring.quote_age_days < 0 ? " · Future date neutralized" : ` · ${scoring.quote_age_days} days old`}`} />
              <ScoreFactor label="Analysis Confidence" value={`${scoring.confidence_score}/100`} detail={`Confidence multiplier ${scoring.confidence_multiplier.toFixed(3)}`} />
            </dl>
            <div className="mt-5 rounded-xl border border-line bg-panel-raised p-4">
              <h3 className="text-xs font-extrabold uppercase tracking-[0.1em] text-secondary">Score Caps</h3>
              {scoring.applied_caps.length ? (
                <ul className="mt-3 space-y-2 text-sm leading-6 text-secondary">
                  {scoring.applied_caps.map((cap) => (
                    <li key={cap.code} className="flex gap-2">
                      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" />
                      <span>{cap.limitedScore ? `Score limited to ${cap.maximum}` : `Maximum ${cap.maximum} considered`} because {cap.explanation}.</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-secondary">No limiting caps applied.</p>}
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-xl border border-line bg-panel-raised p-4 text-sm leading-6 text-secondary">
            The score and priority remain available, but the detailed component, cap, version, and freshness metadata was not stored with this older analysis.
          </div>
        )}
      </div>
    </Card>
  );
}

function ScoreFactor({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <dt className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">{label}</dt>
      <dd className="mt-2 text-sm font-bold text-content">{value}</dd>
      <dd className="mt-1 text-xs leading-5 text-secondary">{detail}</dd>
    </div>
  );
}

function AnalysisStateCard({ deal, experience, deepAccess }: { deal: DealDetail; experience: DealExperienceState; deepAccess: AnalysisAccess }) {
  const state = experience === "processing" ? {
    title: "Analysis in progress",
    description: "LostDeal AI is processing the imported notes or transcript. Refresh later to view the persisted result.",
    icon: <LoaderCircle aria-hidden="true" className="size-7 animate-spin" />,
    tone: "border-brand/30 bg-brand/10 text-brand",
  } : experience === "failed" ? {
    title: "Analysis needs attention",
    description: "A usable analysis is not available. Your imported source data is unchanged, and you can retry explicitly.",
    icon: <AlertCircle aria-hidden="true" className="size-7" />,
    tone: "border-red-500/35 bg-red-500/10 text-danger-content",
  } : {
    title: "Ready for Analysis",
    description: "Analyze the imported sales notes or transcript to identify the loss reason, buying intent, evidence, and next action.",
    icon: <Clock3 aria-hidden="true" className="size-7" />,
    tone: "border-brand/30 bg-brand/10 text-brand",
  };
  const deepReady = deepAccess.providerExecutionAllowed && deal.deep_persistence_available;
  const deepAttemptFailed = experience === "failed" && deal.requested_analysis_mode === "DEEP";
  return (
    <Card title="Deal Intelligence" description="No analysis is inferred or generated during normal page load" action={<Bot aria-hidden="true" className="size-5 text-muted" />}>
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl border ${state.tone}`}>{state.icon}</div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-content">{state.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">{state.description}</p>
            {experience !== "processing" && (
              <div className="mt-5">
                <p className="mb-3 max-w-2xl text-xs leading-5 text-secondary">
                  AI analysis sends the deal&apos;s relevant sales notes or transcript to the configured AI provider for processing. Avoid including unnecessary sensitive personal information.
                </p>
                {deepReady ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <DeepAnalysisButton dealId={deal.id} label={deepAttemptFailed ? "Retry Deep Analysis" : "Run Deep Analysis"} />
                    <AnalyzeDealButton dealId={deal.id} label="Run Standard Analysis" primary={false} />
                  </div>
                ) : (
                  <AnalyzeDealButton dealId={deal.id} retry={experience === "failed"} />
                )}
                {!deepReady && (
                  <p className="mt-4 max-w-2xl rounded-xl border border-line bg-panel-raised px-4 py-3 text-xs leading-5 text-secondary">
                    <strong className="text-content">Deep Recovery Analysis — Pro.</strong>{" "}
                    {deepAccess.state === "LOCKED"
                      ? "Available when Pro billing launches. Continue with Standard Analysis."
                      : deepAccess.providerExecutionAllowed
                        ? "Workspace setup is pending. Continue with Standard Analysis."
                        : "Commercial Deep Analysis activates after verified billing launches. Continue with Standard Analysis."}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SourceSeparationNote() {
  return (
    <aside className="rounded-2xl border border-brand/30 bg-brand/10 p-5" aria-label="Data provenance">
      <div className="flex items-center gap-2 text-sm font-bold text-content"><Database aria-hidden="true" className="size-4 text-brand-strong" />Source, AI, and score stay separate</div>
      <p className="mt-2 text-sm leading-6 text-secondary"><strong className="text-content">Deal Information, Sales Notes, and Transcript</strong> are imported source data. <strong className="text-content">Recovery intelligence</strong> is stored AI interpretation. <strong className="text-content">Recovery Score</strong> is a separate deterministic ranking calculated from stored signals and quote recency.</p>
    </aside>
  );
}

function SourceSections({ deal }: { deal: DealDetail }) {
  return (
    <div className="space-y-5">
      <Card title="Deal Information" description="Imported business information · Not AI-generated" action={<Badge tone="neutral">Source</Badge>}>
        <dl className="grid gap-px bg-panel-hover sm:grid-cols-2 lg:grid-cols-3">
          <DataField label="Customer Name" value={deal.customer_name || "Unnamed customer"} />
          <DataField label="External Deal ID" value={deal.external_deal_id || "—"} />
          <DataField label="Deal Value" value={formatDealCurrency(deal.deal_value)} />
          <DataField label="Quote Date" value={formatDealDate(deal.quote_date)} />
          <DataField label="Status" value={humanizeDealEnum(deal.status)} />
          <DataField label="Salesperson" value={deal.salesperson || "—"} />
          <DataField label="Service Type" value={deal.service_type || "—"} />
          <DataField label="Lead Source" value={deal.lead_source || "—"} />
          <DataField label="Imported Date" value={formatDealTimestamp(deal.created_at)} />
        </dl>
      </Card>

      <Card title="Sales Notes" description="Complete imported source text" action={<FileText aria-hidden="true" className="size-5 text-muted" />}>
        <div className="p-5 sm:p-6">
          {deal.sales_notes ? <p className="whitespace-pre-wrap break-words rounded-xl border border-line bg-panel-raised p-4 text-sm leading-7 text-secondary">{deal.sales_notes}</p> : <p className="text-sm text-secondary">No sales notes provided.</p>}
        </div>
      </Card>

      <Card title="Transcript" description="Complete imported conversation text" action={<MessageSquareText aria-hidden="true" className="size-5 text-muted" />}>
        <div className="p-5 sm:p-6">
          {deal.transcript ? <ExpandableTranscript text={deal.transcript} /> : <p className="text-sm text-secondary">No transcript provided.</p>}
        </div>
      </Card>
    </div>
  );
}

function DataField({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel px-5 py-4 sm:px-6">
      <dt className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">{label}</dt>
      <dd className="mt-2 break-words text-sm font-semibold text-content">{value}</dd>
    </div>
  );
}

function DataPrivacySection({ dealId }: { dealId: string }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 shadow-sm sm:p-6" aria-labelledby="data-privacy-title">
      <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-start">
        <div>
          <h2 id="data-privacy-title" className="text-base font-bold text-content">Data &amp; Privacy</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">Remove this individual deal and its stored analysis when your organization no longer needs them. Other deals and the original upload record are unaffected.</p>
        </div>
        <DeleteDealControl dealId={dealId} />
      </div>
    </section>
  );
}
