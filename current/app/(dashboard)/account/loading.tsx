import { Skeleton } from "@/components/ui";

export default function AccountLoading() {
  return (
    <div className="mx-auto max-w-5xl" aria-label="Loading plan and usage">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="mt-4 h-5 w-full max-w-xl" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      <div className="mt-6 grid gap-4 md:grid-cols-3"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
    </div>
  );
}
