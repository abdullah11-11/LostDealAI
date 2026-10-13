"use strict";

// Offline presentation only. No fetch, provider calls, upload, storage or checkout.
const dialog = document.querySelector("#deal-dialog");
let activeRecord = null;
let openingControl = null;
let analysisMode = "standard";

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderRecords() {
  const query = document.querySelector("#deal-search").value.trim().toLocaleLowerCase("en-US");
  const priority = document.querySelector("#priority-filter").value;
  const records = DEMO_RECORDS.filter(record => (priority === "all" || record.scoring.recoveryPriority === priority) && `${record.name} ${record.service} ${record.reasonLabel}`.toLocaleLowerCase("en-US").includes(query));
  const list = document.querySelector("#deal-list");
  list.replaceChildren();
  records.forEach(record => {
    const button = element("button", undefined, "deal-item");
    button.type = "button";
    button.setAttribute("aria-label", `Open ${record.name}, fictional ${record.service}, Recovery Score ${record.scoring.recoveryScore}, ${record.scoring.recoveryPriority.toLowerCase()} priority`);
    const name = element("span");
    name.append(element("strong", record.name), element("small", `${record.service} · $${record.value.toLocaleString("en-US")}`));
    const action = element("span", record.action, "deal-action");
    const score = element("span", record.scoring.recoveryScore, "deal-score");
    score.append(element("small", "/100"));
    const priorityLabel = element("span", `${record.scoring.recoveryPriority[0]}${record.scoring.recoveryPriority.slice(1).toLowerCase()}`, `priority ${record.scoring.recoveryPriority.toLowerCase()}`);
    const arrow = element("span", "↗", "deal-arrow");
    arrow.setAttribute("aria-hidden", "true");
    button.append(name, action, score, priorityLabel, arrow);
    button.addEventListener("click", () => openRecord(record, button));
    list.append(button);
  });
  if (!records.length) {
    const empty = element("div", undefined, "empty-state");
    empty.append(element("h4", "No matching examples"), element("p", "Try another name, service or priority. Only four fictional records are included."));
    list.append(empty);
  }
  document.querySelector("#result-count").textContent = `${records.length} of 4 fictional deals shown.`;
}

function detailSection(title) {
  const section = element("section", undefined, "detail-section");
  section.append(element("h3", title));
  return section;
}

function renderDetail() {
  if (!activeRecord) return;
  const record = activeRecord;
  const content = document.querySelector("#dialog-content");
  content.replaceChildren();
  const summary = element("div", undefined, "detail-summary");
  const summaryText = element("div");
  summaryText.append(element("h3", `${record.reasonLabel} is the recorded blocker`), element("p", record.interpretation));
  const score = element("div", undefined, "detail-score");
  score.append(element("strong", record.scoring.recoveryScore), element("span", "Recovery Score / 100"));
  summary.append(summaryText, score);
  content.append(summary);

  const evidence = detailSection("Source evidence");
  evidence.append(element("blockquote", record.source), element("p", "Authored fictional sales note · Quoted verbatim in this prepared example"));
  content.append(evidence);

  if (analysisMode === "deep") {
    const strategy = detailSection("Prepared Deep strategy example");
    strategy.append(element("p", record.deep));
    content.append(strategy);
    const boundaries = detailSection("What remains unknown");
    const list = element("ul");
    record.negative.forEach(signal => list.append(element("li", signal)));
    boundaries.append(list);
    content.append(boundaries);
  } else {
    const signals = detailSection("Signals for human review");
    const list = element("ul");
    record.positive.forEach(signal => list.append(element("li", `Positive: ${signal}`)));
    record.negative.forEach(signal => list.append(element("li", `Caution: ${signal}`)));
    signals.append(list);
    content.append(signals);
  }

  const scoring = detailSection("Deterministic score breakdown");
  const breakdown = element("div", undefined, "score-detail");
  const entries = [
    [`Buying Intent ${record.intent} × 50%`, `${record.scoring.buyingIntentContribution.toFixed(1)} points`],
    [`${record.reasonLabel} recoverability ${record.scoring.reasonRecoverability} × 30%`, `${record.scoring.reasonContribution.toFixed(1)} points`],
    [`Quote recency ${record.scoring.recencyScore} × 20%`, `${record.scoring.recencyContribution.toFixed(1)} points`],
    ["Confidence adjustment", `× ${record.scoring.confidenceMultiplier.toFixed(3)}`],
    ["Final score, as of 12 October 2026", `${record.scoring.recoveryScore} / 100 · ${record.scoring.recoveryPriority.toLowerCase()}`],
  ];
  entries.forEach(([label, value]) => { const row = element("div"); row.append(element("span", label), element("strong", value)); breakdown.append(row); });
  scoring.append(breakdown, element("p", "No limiting safety cap applies to these four grounded fictional examples. The score is review priority, not sale probability."));
  content.append(scoring);
  const followup = detailSection("Prepared follow-up draft");
  followup.append(element("blockquote", record.draft), element("p", `Suggested channel: email · Timing guidance: ${record.timing}. Review actual circumstances before any follow-up.`));
  content.append(followup);
  document.querySelectorAll("[data-analysis]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.analysis === analysisMode)));
}

function openRecord(record, button) {
  activeRecord = record;
  openingControl = button;
  analysisMode = "standard";
  document.querySelector("#dialog-title").textContent = record.name;
  document.querySelector("#dialog-subtitle").textContent = `${record.service} · Original quote $${record.value.toLocaleString("en-US")} · ${record.quoteDate}`;
  renderDetail();
  dialog.showModal();
  document.querySelector("#close-dialog").focus();
}

document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => { if (openingControl?.isConnected) openingControl.focus(); });
dialog.addEventListener("keydown", event => {
  if (event.key !== "Tab") return;
  const controls = [...dialog.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']")].filter(control => control.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
dialog.addEventListener("click", event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
document.querySelectorAll("[data-analysis]").forEach(button => button.addEventListener("click", () => { analysisMode = button.dataset.analysis; renderDetail(); }));
document.querySelector("#deal-search").addEventListener("input", renderRecords);
document.querySelector("#priority-filter").addEventListener("change", renderRecords);

document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll(".demo-view").forEach(view => { view.hidden = view.id !== `view-${button.dataset.view}`; });
  document.querySelectorAll("[data-view]").forEach(control => { const active = control === button; control.classList.toggle("active", active); control.setAttribute("aria-pressed", String(active)); });
  const title = document.querySelector(`#view-${button.dataset.view} h3`);
  title.tabIndex = -1;
  title.focus({ preventScroll: true });
}));

function showImport(mode) {
  const root = document.querySelector("#import-description");
  root.replaceChildren();
  if (mode === "auto") {
    root.append(element("h4", "AI-assisted preparation, with source provenance"), element("p", "In the real application, eligible Auto Convert uses deterministic mappings first, then explicitly bounded AI mapping/extraction only where needed. Proposed values require supporting source excerpts and the same authoritative validation. Sales notes and transcripts are preserved, not rewritten. No Auto Convert job runs in this preview."));
  } else {
    root.append(element("h4", "Deterministic first. Editable throughout."), element("p", "Strong header aliases map without AI. Values and dates normalize through one validator. Weak matches need confirmation; ignored columns stay visible. Optional AI mapping suggestions are a separate explicit action. Downloading a normalized CSV does not import or analyze a deal."));
  }
  document.querySelectorAll("[data-import]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.import === mode)));
}
document.querySelectorAll("[data-import]").forEach(button => button.addEventListener("click", () => showImport(button.dataset.import)));
document.querySelector("#theme-toggle").addEventListener("click", event => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  event.currentTarget.textContent = dark ? "Light view" : "Dark view";
  event.currentTarget.setAttribute("aria-pressed", String(dark));
});
showImport("smart");
renderRecords();
