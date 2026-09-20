import { Badge } from "@/components/ui";
import type { DealAnalysisStatus, DealPriority } from "@/lib/deals/constants";

const STATUS_LABELS: Record<DealAnalysisStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_TONES: Record<DealAnalysisStatus, "pending" | "completed" | "failed"> = {
  pending: "pending",
  processing: "pending",
  completed: "completed",
  failed: "failed",
};

const PRIORITY_TONES: Record<DealPriority, "high" | "medium" | "low"> = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

const PRIORITY_LABELS: Record<DealPriority, string> = {
  HIGH: "High Priority",
  MEDIUM: "Medium Priority",
  LOW: "Low Priority",
};

export function DealStatusBadge({ status }: { status: string }) {
  const normalized = (status in STATUS_LABELS ? status : "pending") as DealAnalysisStatus;
  return <Badge tone={STATUS_TONES[normalized]}>{STATUS_LABELS[normalized]}</Badge>;
}

export function DealPriorityBadge({ priority }: { priority: DealPriority | null }) {
  return priority ? <Badge tone={PRIORITY_TONES[priority]}>{PRIORITY_LABELS[priority]}</Badge> : <span aria-label="No priority">—</span>;
}
