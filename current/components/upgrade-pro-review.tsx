import { PLAN_CATALOG } from "@/lib/billing/plans";
import { formatPlanAllowance } from "@/lib/billing/presentation";
import type { PaidPlan } from "@/lib/billing/paddle-policy";

export function UpgradeProReview({ selectedPlan }: { selectedPlan: PaidPlan }) {
  const selected = PLAN_CATALOG[selectedPlan];
  const plans = [PLAN_CATALOG.STARTER, PLAN_CATALOG.PRO];
  const comparison = [
    ["Monthly price", ...plans.map(plan => plan.priceLabel)],
    ["Imported deals", ...plans.map(plan => formatPlanAllowance(plan, "IMPORTED_DEALS"))],
    ["AI analyses", ...plans.map(plan => formatPlanAllowance(plan, "AI_ANALYSES"))],
    ["AI mapping requests", ...plans.map(plan => formatPlanAllowance(plan, "AI_MAPPING_REQUESTS"))],
    ["AI Auto Convert", ...plans.map(plan => plan.features.autoConvert ? formatPlanAllowance(plan, "AUTO_CONVERT_ROWS") : "Not included")],
    ["Deep Recovery Analysis", ...plans.map(plan => plan.features.deepAnalysis ? "Included" : "Not included")],
  ];
  return <>
    <div className="flex items-end justify-between gap-4"><h3 className="text-lg font-semibold">LostDeal {selected.displayName}</h3><p className="text-2xl font-semibold tracking-tight">{selected.priceLabel}</p></div>
    <p className="mt-2 text-sm text-secondary">Billed monthly in USD. Any applicable tax is shown by secure checkout.</p>
    {selectedPlan === "PRO" ? <>
      <div className="mt-5 overflow-hidden rounded-xl border border-line">
        <table className="w-full table-fixed text-left text-sm" aria-label="Starter and Pro plan comparison">
          <thead className="bg-panel-raised"><tr><th scope="col" className="w-[40%] px-3 py-3 font-medium">Plan comparison</th>{plans.map(plan => <th key={plan.planCode} scope="col" className="px-3 py-3 font-semibold">{plan.displayName}</th>)}</tr></thead>
          <tbody>{comparison.map(([label, starter, pro]) => <tr key={label} className="border-t border-line"><th scope="row" className="px-3 py-3 font-medium text-secondary">{label}</th><td className="px-3 py-3 align-top">{starter}</td><td className="px-3 py-3 align-top font-medium">{pro}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="mt-5 space-y-4 text-sm leading-6 text-secondary">
        <section><h4 className="font-semibold text-content">Deep Recovery Analysis</h4><p className="mt-1">Uses stored deal evidence to explain blockers, readiness, risk and recovery strategy. Each successful Standard or Deep analysis uses one AI analysis unit; you decide what to do next.</p></section>
        <section><h4 className="font-semibold text-content">AI Auto Convert</h4><p className="mt-1">Prepares messy CSV exports with mappings, normalized values and source provenance for review. It uses your Auto Convert row allowance and does not import deals or start Deal Analysis.</p></section>
      </div>
    </> : <dl className="mt-5 divide-y divide-line rounded-xl border border-line">{[
      ["Imported deals", formatPlanAllowance(selected, "IMPORTED_DEALS")],
      ["AI analyses", formatPlanAllowance(selected, "AI_ANALYSES")],
      ["AI mapping requests", formatPlanAllowance(selected, "AI_MAPPING_REQUESTS")],
      ["AI Auto Convert", selected.features.autoConvert ? formatPlanAllowance(selected, "AUTO_CONVERT_ROWS") : "Not included"],
      ["Deep Recovery Analysis", selected.features.deepAnalysis ? "Included in AI analysis allowance" : "Not included"],
    ].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4 px-4 py-3 text-sm"><dt className="text-secondary">{label}</dt><dd className="max-w-[55%] text-right font-medium">{value}</dd></div>)}</dl>}
  </>;
}
