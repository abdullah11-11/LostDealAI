import { Skeleton } from "@/components/ui";

export default function DealsLoading() {
  return (
    <div className="mx-auto max-w-7xl" aria-label="Loading deals">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-4 h-10 w-64 max-w-full" />
      <Skeleton className="mt-3 h-4 w-[38rem] max-w-full" />
      <Skeleton className="mt-8 h-52 rounded-2xl border border-line bg-panel" />
      <Skeleton className="mt-5 h-[30rem] rounded-2xl border border-line bg-panel" />
    </div>
  );
}

