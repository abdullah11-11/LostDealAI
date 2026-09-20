import { Skeleton } from "@/components/ui";

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl" aria-label="Loading dashboard">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-4 h-10 w-64 max-w-full" />
      <Skeleton className="mt-3 h-4 w-[34rem] max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-48 rounded-2xl border border-line bg-panel" />)}
      </div>
      <Skeleton className="mt-5 h-[26rem] rounded-2xl border border-line bg-panel" />
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-[28rem] rounded-2xl border border-line bg-panel" />
        <Skeleton className="h-[28rem] rounded-2xl border border-line bg-panel" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Skeleton className="h-96 rounded-2xl border border-line bg-panel" />
        <Skeleton className="h-96 rounded-2xl border border-line bg-panel" />
      </div>
    </div>
  );
}
