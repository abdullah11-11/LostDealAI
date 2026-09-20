export const MARKETING_POSITIONING = Object.freeze({
  primary: "Lost deals in. Best recovery opportunities out.",
  headline: "Your CRM is full of deals you already paid to acquire.",
  secondaryHeadline: "Find the ones worth another shot.",
  supporting:
    "Upload your closed-lost sales data. LostDeal AI cleans messy exports, explains why deals were lost, ranks recovery opportunities, and gives your team the next move — grounded in the evidence you already have.",
  primaryCta: "See LostDeal in Action",
  secondaryCta: "View Pricing",
});

export const MARKETING_NAVIGATION = Object.freeze([
  { label: "Product", href: "/product" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "Trust", href: "/#trust" },
] as const);

export const TRUST_ITEMS = Object.freeze([
  { title: "Works with CSV exports", detail: "Start with supported sales data you already have." },
  { title: "Evidence-grounded analysis", detail: "Important findings stay connected to source evidence." },
  { title: "No automatic AI on page load", detail: "Provider-backed work begins only when you request it." },
  { title: "Deterministic Recovery Score", detail: "A consistent priority indicator — never a conversion promise." },
] as const);

export const WORKFLOW_STEPS = Object.freeze([
  {
    number: "01",
    title: "Upload",
    description: "Export the lost deals you already have. No CRM migration required.",
  },
  {
    number: "02",
    title: "Clean",
    description: "Auto Convert turns inconsistent CRM columns and notes into LostDeal’s canonical structure.",
  },
  {
    number: "03",
    title: "Analyze",
    description: "Understand loss reason, buying intent, evidence, and recovery context.",
  },
  {
    number: "04",
    title: "Prioritize",
    description: "Recovery Score ranks which opportunities deserve attention first.",
  },
] as const);

export const WHY_LOSTDEAL = Object.freeze([
  { title: "Start with what you have", detail: "No CRM migration required." },
  { title: "Clean messy sales data", detail: "Auto Convert handles supported export inconsistencies." },
  { title: "Prioritize, don’t just summarize", detail: "Recovery Score helps focus attention." },
  { title: "Go deep when it matters", detail: "Use Deep Recovery Analysis for strategic opportunities." },
] as const);

export const INDUSTRIES = Object.freeze([
  "HVAC",
  "Roofing",
  "Solar",
  "Home Services",
  "Remodeling",
  "Agencies",
  "Professional Services",
] as const);

export const PERSONAS = Object.freeze([
  { role: "Owner / Founder", detail: "See which lost opportunities deserve attention." },
  { role: "Sales Manager", detail: "Prioritize follow-up and understand recurring blockers." },
  { role: "RevOps", detail: "Turn inconsistent closed-lost data into structured intelligence." },
  { role: "Agency / Consultant", detail: "Analyze client exports without replacing their CRM." },
] as const);

export const PRODUCT_PROOF = Object.freeze([
  "Messy exports become structured deal records.",
  "Every Recovery Score is deterministic.",
  "Deep Analysis runs only when requested.",
  "Unsupported Deep interpretations fail closed.",
] as const);

export const FAQ_ITEMS = Object.freeze([
  {
    question: "What kind of data can I upload?",
    answer:
      "LostDeal currently accepts supported CSV exports containing closed-lost deal details such as customer name, deal value, quote date, sales notes, transcript, service type, salesperson, and status.",
  },
  {
    question: "Do I need to change CRMs?",
    answer:
      "No. LostDeal works from supported CSV exports, so you can use the sales data you already have without replacing your CRM.",
  },
  {
    question: "Does LostDeal contact customers automatically?",
    answer:
      "No. LostDeal provides recovery intelligence and recommended actions. Outreach remains under your control.",
  },
  {
    question: "What is Recovery Score?",
    answer:
      "Recovery Score is a deterministic prioritization indicator based on stored deal signals. It is not a conversion probability, revenue forecast, or guaranteed outcome.",
  },
  {
    question: "What is the difference between Standard and Deep Analysis?",
    answer:
      "Standard quickly explains what happened and recommends a next action. Deep adds strategic context around blockers, readiness, risk, timing, value, decision dynamics, and follow-up.",
  },
  {
    question: "Does LostDeal invent missing information?",
    answer:
      "No. LostDeal is designed to ground important analysis in imported evidence. Unsupported claims are rejected or safely downgraded rather than presented as fact.",
  },
  {
    question: "What happens when my CSV is messy?",
    answer:
      "Smart Import helps map supported columns. On Pro, Auto Convert can prepare inconsistent rows and fields while preserving provenance and avoiding invented facts.",
  },
  {
    question: "Which plan includes Auto Convert and Deep Analysis?",
    answer:
      "Pro includes AI Auto Convert and Deep Recovery Analysis. Starter includes Standard Analysis, Smart Import, and Recovery Score.",
  },
] as const);

export const SYNTHETIC_DEALS = Object.freeze([
  { name: "Synthetic Juniper", reason: "No response", score: 82, priority: "High" },
  { name: "Synthetic Orchard", reason: "Timing", score: 54, priority: "Medium" },
  { name: "Synthetic Maple", reason: "Product fit", score: 20, priority: "Low" },
] as const);

export const SYNTHETIC_SOURCE_NOTE =
  "Customer liked the proposal but paused after the budget review. Asked us to reconnect after the next planning cycle.";
