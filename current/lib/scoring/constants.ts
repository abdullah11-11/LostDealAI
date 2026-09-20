import type { LostReason } from "@/types/database";

export const RECOVERY_SCORING_VERSION = "1.0";
export const RECOVERY_SCORING_NAME = `LostDeal Recovery Scoring v${RECOVERY_SCORING_VERSION}`;

export const RECOVERY_WEIGHTS = Object.freeze({
  buyingIntent: 0.5,
  reasonRecoverability: 0.3,
  recency: 0.2,
});

export const REASON_RECOVERABILITY: Readonly<Record<LostReason, number>> = Object.freeze({
  NO_FOLLOW_UP: 85,
  TIMING: 80,
  FINANCING: 75,
  DECISION_MAKER: 70,
  AVAILABILITY: 65,
  PRICE: 60,
  NO_RESPONSE: 45,
  TRUST: 40,
  OTHER: 35,
  COMPETITOR: 30,
  PRODUCT_FIT: 30,
  BAD_EXPERIENCE: 25,
  NOT_QUALIFIED: 10,
});

export const SCORING_BATCH_LIMIT = 100;
export const SCORING_BATCH_CONCURRENCY = 5;

