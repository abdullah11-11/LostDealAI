import { Skeleton } from "@/components/ui";

export default function DealIntelligenceLoading() {
  return (
    <div className="mx-auto max-w-7xl" aria-label="Loading deal intelligence" aria-busy="true">
      <div className="flex justify-between gap-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      <Skeleton className="mt-5 h-48 rounded-2xl border border-line bg-panel" />
      <Skeleton className="mt-5 h-64 rounded-2xl border border-line bg-panel" />
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-2xl border border-line bg-panel" />
        <Skeleton className="h-56 rounded-2xl border border-line bg-panel" />
      </div>
    </div>
  );
}
