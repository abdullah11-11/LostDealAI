import {
  ArrowDown,
  ArrowRight,
  BrainCircuit,
  Check,
  CircleAlert,
  FileSpreadsheet,
  Fingerprint,
  Quote,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";

import { SYNTHETIC_DEALS, SYNTHETIC_SOURCE_NOTE } from "@/lib/marketing/content";

function MicroLabel({ children, inverse = false }: { children: React.ReactNode; inverse?: boolean }) {
  return (
    <span className={inverse
      ? "text-xs font-black uppercase tracking-[0.14em] text-marketing-ink-muted"
      : "text-xs font-black uppercase tracking-[0.14em] text-marketing-slate"}
    >
      {children}
    </span>
  );
}

function StatusPill({ children, tone = "orange" }: { children: React.ReactNode; tone?: "orange" | "green" | "neutral" }) {
  const tones = {
    orange: "border-marketing-orange/35 bg-marketing-orange-soft text-marketing-orange-dark",
    green: "border-marketing-green/30 bg-marketing-green-soft text-marketing-green",
    neutral: "border-marketing-line bg-marketing-cream text-marketing-slate",
  } as const;
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black uppercase tracking-[0.1em] ${tones[tone]}`}>{children}</span>;
}

export function HeroProductStory() {
  return (
    <div
      aria-label="Static product walkthrough using synthetic LostDeal data"
      data-marketing-demo="static"
      className="marketing-product-frame relative overflow-hidden rounded-[1.75rem] border border-white/14 bg-marketing-ink-raised p-3 shadow-[0_28px_80px_rgba(3,10,24,0.32)] sm:p-4 lg:p-5"
    >
      <div aria-hidden="true" className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-marketing-orange to-transparent opacity-70" />
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-4 pt-1">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-marketing-orange" />
          <MicroLabel inverse>Recovery workflow / synthetic preview</MicroLabel>
        </div>
        <span className="text-xs font-bold text-marketing-ink-muted">No live processing</span>
      </div>

      <ol aria-label="LostDeal workflow" className="grid grid-cols-2 gap-2 border-y border-white/10 py-3 sm:grid-cols-4">
        {[
          ["01", "Messy export"],
          ["02", "Auto Convert"],
          ["03", "Recovery Score"],
          ["04", "Deep strategy"],
        ].map(([number, label], index) => (
          <li key={number} className="flex items-center gap-2 px-2 text-xs font-bold text-marketing-ink-muted">
            <span className="text-marketing-orange-soft">{number}</span>
            <span>{label}</span>
            {index < 3 && <ArrowRight aria-hidden="true" className="ml-auto hidden size-3 text-white/30 sm:block" />}
          </li>
        ))}
      </ol>

      <div className="mt-4 grid gap-3 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="grid gap-3">
          <article className="marketing-flow-card-1 rounded-2xl border border-white/12 bg-marketing-ink p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-white">
                <FileSpreadsheet aria-hidden="true" className="size-4 text-marketing-orange-soft" />
                <p className="text-sm font-extrabold">closed-lost-export.csv</p>
              </div>
              <span className="text-xs font-bold text-marketing-ink-muted">3 rows</span>
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
              <div className="grid grid-cols-[1.2fr_0.8fr_0.7fr] bg-marketing-white/7 px-3 py-2 text-xs font-black uppercase tracking-[0.1em] text-marketing-ink-muted">
                <span>Client Name</span><span>CRM Memo</span><span>Quoted $</span>
              </div>
              {[
                ["Synthetic Juniper", "paused—budget", "18,400"],
                ["Synthetic Orchard", "circle back Q4", "9,750"],
                ["Synthetic Maple", "not the right fit", "6,200"],
              ].map((row) => (
                <div key={row[0]} className="grid grid-cols-[1.2fr_0.8fr_0.7fr] gap-2 border-t border-white/8 px-3 py-2.5 text-xs text-white/75">
                  {row.map((value) => <span key={value} className="truncate">{value}</span>)}
                </div>
              ))}
            </div>
          </article>

          <article className="marketing-flow-card-2 rounded-2xl border border-marketing-orange/25 bg-marketing-orange/8 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-white">
                <Sparkles aria-hidden="true" className="size-4 text-marketing-orange-soft" />
                <p className="text-sm font-extrabold">Auto Convert</p>
              </div>
              <StatusPill tone="green">Mapped</StatusPill>
            </div>
            <div className="mt-4 space-y-2">
              {[
                ["Client Name", "Customer"],
                ["CRM Memo", "Notes / Transcript"],
                ["Quoted $", "Deal Value"],
              ].map(([source, target]) => (
                <div key={source} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs font-bold">
                  <span className="truncate text-marketing-ink-muted">{source}</span>
                  <ArrowRight aria-hidden="true" className="size-3 text-marketing-orange-soft" />
                  <span className="truncate text-right text-white">{target}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 border-t border-white/10 pt-3 text-xs leading-4 text-marketing-ink-muted">Normalize what exists. Never invent what doesn’t.</p>
          </article>
        </div>

        <article className="marketing-flow-card-3 rounded-2xl border border-white/12 bg-marketing-white p-4 text-marketing-ink sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-marketing-line pb-4">
            <div>
              <StatusPill>Closed lost · no response</StatusPill>
              <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em]">Synthetic Juniper</h3>
              <p className="mt-1 text-xs text-marketing-slate">HVAC replacement · Synthetic example</p>
            </div>
            <div className="rounded-2xl bg-marketing-ink px-4 py-3 text-right text-white">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-marketing-ink-muted">Recovery Score</p>
              <p className="marketing-score-pop mt-1 text-3xl font-semibold tracking-[-0.05em]">54<span className="text-sm text-marketing-ink-muted">/100</span></p>
              <p className="mt-1 text-xs font-bold text-marketing-orange-soft">Medium priority</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-marketing-line bg-marketing-cream p-3">
              <MicroLabel>Primary blocker</MicroLabel>
              <p className="mt-2 text-sm font-extrabold">Timing / budget cycle</p>
            </div>
            <div className="rounded-xl border border-marketing-line bg-marketing-cream p-3">
              <MicroLabel>Customer readiness</MicroLabel>
              <p className="mt-2 text-sm font-extrabold">Conditional</p>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-marketing-line p-3">
            <div className="flex items-center justify-between gap-2">
              <MicroLabel>Deep recovery summary</MicroLabel>
              <BrainCircuit aria-hidden="true" className="size-4 text-marketing-orange-dark" />
            </div>
            <p className="mt-2 text-xs leading-5 text-marketing-slate">The source supports a timing-led pause, not a firm rejection. Re-engage around the stated planning window and keep the value case specific.</p>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-marketing-green-soft px-3 py-2.5 text-xs font-bold text-marketing-green">
            <span className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4" />Evidence grounded</span>
            <span>Recovery risk: Medium</span>
          </div>
        </article>
      </div>
    </div>
  );
}

export function BeforeAfterVisual() {
  const lanes = [
    {
      label: "Without LostDeal",
      tone: "muted",
      items: ["Closed Lost", "Vague notes", "Spreadsheet", "Forgotten"],
    },
    {
      label: "With LostDeal",
      tone: "brand",
      items: ["Import", "Understand", "Prioritize", "Act"],
    },
  ] as const;

  return (
    <div aria-label="Before and after LostDeal workflow comparison" className="rounded-[1.75rem] border border-marketing-line bg-marketing-white p-4 sm:p-6">
      <div className="grid gap-4">
        {lanes.map((lane) => (
          <div key={lane.label} className={`rounded-2xl border p-4 sm:p-5 ${lane.tone === "brand" ? "border-marketing-orange/35 bg-marketing-orange-soft" : "border-marketing-line bg-marketing-cream"}`}>
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${lane.tone === "brand" ? "text-marketing-orange-dark" : "text-marketing-slate"}`}>{lane.label}</p>
            <ol className="mt-4 grid gap-2 sm:grid-cols-4 sm:items-center">
              {lane.items.map((item, index) => (
                <li key={item} className="flex items-center gap-2 sm:min-w-0">
                  <span className={`flex min-h-10 flex-1 items-center rounded-xl border px-3 text-sm font-extrabold ${lane.tone === "brand" ? "border-marketing-orange/25 bg-marketing-white text-marketing-ink" : "border-marketing-line bg-marketing-white text-marketing-slate"}`}>{item}</span>
                  {index < lane.items.length - 1 && <ArrowRight aria-hidden="true" className="hidden size-4 shrink-0 text-marketing-slate-light sm:block" />}
                  {index < lane.items.length - 1 && <ArrowDown aria-hidden="true" className="size-4 shrink-0 text-marketing-slate-light sm:hidden" />}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AutoConvertVisual() {
  const mappings = [
    ["Client Name", "Customer"],
    ["CRM Memo + Rep Notes", "Notes / Transcript"],
    ["Account Owner", "Salesperson"],
    ["Call Outcome", "Status"],
    ["Quoted $", "Deal Value"],
  ];

  return (
    <div aria-label="Static Auto Convert mapping example using synthetic fields" data-marketing-demo="static" className="rounded-[1.75rem] border border-white/12 bg-marketing-ink-raised p-4 text-white sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><FileSpreadsheet aria-hidden="true" className="size-5 text-marketing-orange-soft" /><p className="font-extrabold">Synthetic CRM export</p></div>
        <StatusPill tone="green">Provenance kept</StatusPill>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="rounded-2xl border border-white/10 bg-marketing-ink p-4">
          <MicroLabel inverse>Before CSV</MicroLabel>
          <div className="mt-3 space-y-2">
            {mappings.map(([source]) => <p key={source} className="rounded-lg bg-marketing-white/6 px-3 py-2 text-xs font-bold text-white/75">{source}</p>)}
          </div>
        </div>
        <div className="flex items-center justify-center sm:flex-col">
          <span className="flex size-12 items-center justify-center rounded-full border border-marketing-orange/35 bg-marketing-orange/12 text-marketing-orange-soft"><Sparkles aria-hidden="true" className="size-5" /></span>
          <ArrowDown aria-hidden="true" className="ml-2 size-4 text-marketing-orange-soft sm:ml-0 sm:mt-2" />
        </div>
        <div className="rounded-2xl border border-marketing-orange/25 bg-marketing-orange/8 p-4">
          <MicroLabel inverse>LostDeal structure</MicroLabel>
          <div className="mt-3 space-y-2">
            {mappings.map(([, target]) => <p key={target} className="flex items-center justify-between rounded-lg bg-marketing-white/7 px-3 py-2 text-xs font-bold text-white"><span>{target}</span><Check aria-hidden="true" className="size-3.5 text-marketing-green-bright" /></p>)}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-white/10 bg-marketing-white/5 px-4 py-3">
        <Fingerprint aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-marketing-orange-soft" />
        <p className="text-xs leading-5 text-marketing-ink-muted"><strong className="text-white">Normalize what exists.</strong> Never invent what doesn’t.</p>
      </div>
    </div>
  );
}

export function RecoveryScoreVisual() {
  return (
    <div aria-label="Synthetic Recovery Score priority examples" data-marketing-demo="static" className="rounded-[1.75rem] border border-marketing-line bg-marketing-white p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 border-b border-marketing-line pb-4">
        <div><MicroLabel>Recovery queue</MicroLabel><p className="mt-1 text-sm font-extrabold text-marketing-ink">Ranked by deterministic score</p></div>
        <Target aria-hidden="true" className="size-5 text-marketing-orange-dark" />
      </div>
      <div className="mt-4 space-y-3">
        {SYNTHETIC_DEALS.map((deal) => {
          const width = `${deal.score}%`;
          return (
            <article key={deal.name} className="rounded-2xl border border-marketing-line bg-marketing-cream p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0"><p className="truncate text-sm font-extrabold text-marketing-ink">{deal.name}</p><p className="mt-1 text-xs text-marketing-slate">{deal.reason} · {deal.priority} priority</p></div>
                <p className="shrink-0 text-2xl font-semibold tracking-[-0.04em] text-marketing-ink">{deal.score}<span className="text-xs text-marketing-slate">/100</span></p>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-marketing-line" role="img" aria-label={`${deal.score} out of 100`}>
                <div className="h-full rounded-full bg-marketing-orange" style={{ width }} />
              </div>
            </article>
          );
        })}
      </div>
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-marketing-line px-3 py-3 text-xs leading-5 text-marketing-slate">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-marketing-orange-dark" />
        <p>Priority indicator only — not conversion probability, expected revenue, or a guaranteed outcome.</p>
      </div>
    </div>
  );
}

export function StandardAnalysisVisual() {
  const items = [
    ["Lost reason", "Timing"],
    ["Buying intent", "72 / 100"],
    ["Recommended action", "Revisit after planning cycle"],
    ["Channel", "Email"],
  ];
  return (
    <div aria-label="Synthetic Standard Analysis example" data-marketing-demo="static" className="rounded-[1.5rem] border border-marketing-line bg-marketing-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3"><div><MicroLabel>Standard Analysis</MicroLabel><h3 className="mt-2 text-lg font-semibold tracking-tight text-marketing-ink">Understand what happened</h3></div><StatusPill tone="green">Complete</StatusPill></div>
      <dl className="mt-5 grid gap-px overflow-hidden rounded-xl border border-marketing-line bg-marketing-line sm:grid-cols-2">
        {items.map(([label, value]) => <div key={label} className="bg-marketing-cream p-3"><dt className="text-xs font-black uppercase tracking-[0.1em] text-marketing-slate">{label}</dt><dd className="mt-1.5 text-xs font-extrabold text-marketing-ink">{value}</dd></div>)}
      </dl>
      <div className="mt-3 rounded-xl border border-marketing-line p-3"><MicroLabel>Evidence</MicroLabel><p className="mt-2 text-xs leading-5 text-marketing-slate">“Asked us to reconnect after the next planning cycle.”</p></div>
    </div>
  );
}

export function DeepAnalysisVisual() {
  const details = [
    ["Primary blocker", "Timing / budget cycle"],
    ["Customer readiness", "Conditional"],
    ["Recovery risk", "Medium"],
    ["Discount caution", "Do not lead with discount"],
  ];
  return (
    <div aria-label="Synthetic Deep Recovery Analysis example" data-marketing-demo="static" className="rounded-[1.5rem] border border-marketing-orange/25 bg-marketing-ink p-4 text-white sm:p-5">
      <div className="flex items-center justify-between gap-3"><div><MicroLabel inverse>Deep Recovery Analysis</MicroLabel><h3 className="mt-2 text-lg font-semibold tracking-tight">Build the recovery strategy</h3></div><BrainCircuit aria-hidden="true" className="size-5 text-marketing-orange-soft" /></div>
      <dl className="mt-5 grid gap-2 sm:grid-cols-2">
        {details.map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-marketing-white/6 p-3"><dt className="text-xs font-black uppercase tracking-[0.1em] text-marketing-ink-muted">{label}</dt><dd className="mt-1.5 text-xs font-extrabold text-white">{value}</dd></div>)}
      </dl>
      <div className="mt-3 rounded-xl border border-marketing-orange/25 bg-marketing-orange/8 p-3"><MicroLabel inverse>Recovery thesis</MicroLabel><p className="mt-2 text-xs leading-5 text-white/72">Use the stated planning window as the reason to re-engage. Restate operational value without assuming price was the blocker.</p></div>
    </div>
  );
}

export function EvidenceGroundingVisual() {
  return (
    <div aria-label="Static evidence grounding example using synthetic source text" data-marketing-demo="static" className="relative rounded-[1.75rem] border border-white/12 bg-marketing-ink-raised p-4 text-white sm:p-6">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
        <article className="rounded-2xl border border-white/10 bg-marketing-ink p-4">
          <div className="flex items-center gap-2"><Quote aria-hidden="true" className="size-4 text-marketing-orange-soft" /><MicroLabel inverse>Imported source note</MicroLabel></div>
          <blockquote className="mt-4 text-sm leading-6 text-white/75">“{SYNTHETIC_SOURCE_NOTE}”</blockquote>
        </article>
        <div className="flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full border border-marketing-green/35 bg-marketing-green/12 text-marketing-green-bright"><ShieldCheck aria-hidden="true" className="size-5" /></span>
        </div>
        <article className="rounded-2xl border border-marketing-green/25 bg-marketing-green/9 p-4">
          <MicroLabel inverse>Grounded analysis</MicroLabel>
          <p className="mt-4 text-sm font-extrabold leading-6">The source supports a timing-led pause and a specific future follow-up window.</p>
          <p className="mt-3 text-xs leading-5 text-marketing-ink-muted">It does not support claiming that price, a competitor, or a decision-maker caused the loss.</p>
        </article>
      </div>
    </div>
  );
}
