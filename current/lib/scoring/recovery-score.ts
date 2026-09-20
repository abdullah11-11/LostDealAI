import {
  RECOVERY_SCORING_NAME,
  RECOVERY_SCORING_VERSION,
  RECOVERY_WEIGHTS,
  REASON_RECOVERABILITY,
} from "@/lib/scoring/constants";
import type {
  AppliedScoringCap,
  RecoveryScoreBreakdown,
  RecoveryScoreInput,
} from "@/lib/scoring/types";
import type { RecoveryPriority } from "@/types/database";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function assertScore(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new TypeError(`${label} must be an integer from 0 to 100.`);
  }
}

function dateOnlyEpoch(value: string): number {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new TypeError("Dates must use YYYY-MM-DD format.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const epoch = Date.UTC(year, month - 1, day);
  const check = new Date(epoch);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new TypeError("Dates must be valid calendar dates.");
  }
  return epoch;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function titleCase(value: string): string {
  return value.toLocaleLowerCase("en-US").split("_")
    .map((part) => `${part.charAt(0).toLocaleUpperCase("en-US")}${part.slice(1)}`)
    .join(" ");
}

export function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function recoveryPriorityForScore(score: number): RecoveryPriority {
  assertScore(score, "Recovery Score");
  if (score >= 70) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
}

export function calculateRecencyScore(quoteDate: string | null, asOfDate: string): {
  score: number;
  ageDays: number | null;
  notes: Array<"FUTURE_QUOTE_DATE">;
} {
  const asOfEpoch = dateOnlyEpoch(asOfDate);
  if (!quoteDate) return { score: 50, ageDays: null, notes: [] };
  const ageDays = Math.trunc((asOfEpoch - dateOnlyEpoch(quoteDate)) / DAY_MS);
  if (ageDays < 0) return { score: 50, ageDays, notes: ["FUTURE_QUOTE_DATE"] };
  if (ageDays <= 14) return { score: 100, ageDays, notes: [] };
  if (ageDays <= 30) return { score: 90, ageDays, notes: [] };
  if (ageDays <= 60) return { score: 75, ageDays, notes: [] };
  if (ageDays <= 90) return { score: 60, ageDays, notes: [] };
  if (ageDays <= 180) return { score: 40, ageDays, notes: [] };
  if (ageDays <= 365) return { score: 20, ageDays, notes: [] };
  return { score: 10, ageDays, notes: [] };
}

function applicableCaps(input: RecoveryScoreInput, preCapScore: number): AppliedScoringCap[] {
  const caps: Array<Omit<AppliedScoringCap, "limitedScore">> = [];
  if (input.confidenceScore <= 20) {
    caps.push({ code: "LOW_CONFIDENCE_20_CAP", maximum: 40, explanation: "confidence is 20 or lower" });
  } else if (input.confidenceScore <= 39) {
    caps.push({ code: "LOW_CONFIDENCE_39_CAP", maximum: 60, explanation: "confidence is between 21 and 39" });
  }
  if (input.evidenceCount === 0) {
    caps.push({ code: "NO_EVIDENCE_CAP", maximum: 55, explanation: "the analysis has no grounded evidence" });
  }
  if (input.lostReason === "NOT_QUALIFIED") {
    caps.push({ code: "NOT_QUALIFIED_CAP", maximum: 15, explanation: "the lead was not qualified" });
  }
  if (input.recommendedChannel === "NO_ACTION") {
    caps.push({ code: "NO_ACTION_CAP", maximum: 20, explanation: "the recommended channel is No Action" });
  }
  return caps.map((cap) => ({ ...cap, limitedScore: preCapScore > cap.maximum }));
}

function deterministicExplanation(result: Omit<RecoveryScoreBreakdown, "scoreExplanation">): string {
  const priority = titleCase(result.recoveryPriority);
  const caps = result.appliedCaps.length
    ? ` Applicable caps: ${result.appliedCaps.map((cap) => `${cap.code} (maximum ${cap.maximum})`).join(", ")}.`
    : " No limiting caps applied.";
  const future = result.notes.includes("FUTURE_QUOTE_DATE")
    ? " A future quote date was treated with neutral recency."
    : "";
  return `Recovery Score ${result.recoveryScore}/100 (${priority}) using ${RECOVERY_SCORING_NAME}. Buying Intent ${result.buyingIntentScore} contributed ${result.buyingIntentContribution.toFixed(1)} points; ${titleCase(result.lostReason)} recoverability ${result.reasonRecoverability} contributed ${result.reasonContribution.toFixed(1)}; recency ${result.recencyScore} contributed ${result.recencyContribution.toFixed(1)}. Base ${result.baseScore.toFixed(1)}, adjusted by confidence ${result.confidenceScore}/100 using multiplier ${result.confidenceMultiplier.toFixed(3)}.${caps}${future}`;
}

export function calculateRecoveryScore(input: RecoveryScoreInput): RecoveryScoreBreakdown {
  assertScore(input.buyingIntentScore, "Buying Intent Score");
  assertScore(input.confidenceScore, "Confidence Score");
  if (!Number.isSafeInteger(input.evidenceCount) || input.evidenceCount < 0) {
    throw new TypeError("Evidence count must be a non-negative integer.");
  }
  if (!(input.lostReason in REASON_RECOVERABILITY)) throw new TypeError("Lost Reason is not supported.");

  const recency = calculateRecencyScore(input.quoteDate, input.asOfDate);
  const reasonRecoverability = REASON_RECOVERABILITY[input.lostReason];
  const buyingIntentContribution = input.buyingIntentScore * RECOVERY_WEIGHTS.buyingIntent;
  const reasonContribution = reasonRecoverability * RECOVERY_WEIGHTS.reasonRecoverability;
  const recencyContribution = recency.score * RECOVERY_WEIGHTS.recency;
  const baseScore = buyingIntentContribution + reasonContribution + recencyContribution;
  const confidenceMultiplier = 0.7 + 0.3 * (input.confidenceScore / 100);
  const preCapScore = baseScore * confidenceMultiplier;
  const caps = applicableCaps(input, preCapScore);
  const maximum = caps.reduce((lowest, cap) => Math.min(lowest, cap.maximum), 100);
  const recoveryScore = Math.max(0, Math.min(100, Math.round(Math.min(preCapScore, maximum))));
  const recoveryPriority = recoveryPriorityForScore(recoveryScore);

  const withoutExplanation: Omit<RecoveryScoreBreakdown, "scoreExplanation"> = {
    scoringVersion: RECOVERY_SCORING_VERSION,
    asOfDate: input.asOfDate,
    buyingIntentScore: input.buyingIntentScore,
    buyingIntentWeight: RECOVERY_WEIGHTS.buyingIntent,
    buyingIntentContribution: rounded(buyingIntentContribution),
    lostReason: input.lostReason,
    reasonRecoverability,
    reasonWeight: RECOVERY_WEIGHTS.reasonRecoverability,
    reasonContribution: rounded(reasonContribution),
    quoteDate: input.quoteDate,
    quoteAgeDays: recency.ageDays,
    recencyScore: recency.score,
    recencyWeight: RECOVERY_WEIGHTS.recency,
    recencyContribution: rounded(recencyContribution),
    confidenceScore: input.confidenceScore,
    confidenceMultiplier: rounded(confidenceMultiplier),
    rawScore: rounded(preCapScore),
    baseScore: rounded(baseScore),
    preCapScore: rounded(preCapScore),
    appliedCaps: caps,
    notes: recency.notes,
    recoveryScore,
    recoveryPriority,
  };
  return { ...withoutExplanation, scoreExplanation: deterministicExplanation(withoutExplanation) };
}

