import { AI_CONFIG } from "@/lib/ai/config";

export type BatchItemResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
  concurrency = AI_CONFIG.batchConcurrency,
): Promise<Array<BatchItemResult<R>>> {
  const safeItems = items.slice(0, AI_CONFIG.batchSizeLimit);
  const results: Array<BatchItemResult<R>> = new Array(safeItems.length);
  let nextIndex = 0;

  async function consume(): Promise<void> {
    while (nextIndex < safeItems.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(safeItems[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), safeItems.length);
  await Promise.all(Array.from({ length: workerCount }, () => consume()));
  return results;
}
