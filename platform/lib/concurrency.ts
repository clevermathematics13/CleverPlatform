/**
 * Runs async tasks with at most `limit` in flight at once, in the order
 * given, and resolves once every task has settled. Like
 * Promise.allSettled, a task that rejects never stops the others.
 *
 * The AI grader's "grade all parts" fan-out uses this: firing every part
 * of a class-sized upload at the same instant (26 parts at once on
 * 5 Sep 2026) pushed the split step past its serverless time limit, so
 * the parts now go through a small pool instead.
 */
export async function runWithConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const width = Math.max(1, Math.floor(limit));
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;

  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, worker));
  return results;
}
