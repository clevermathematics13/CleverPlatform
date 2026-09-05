import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "./concurrency";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("runWithConcurrency", () => {
  it("never has more than `limit` tasks in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      await tick();
      inFlight -= 1;
      return i;
    });
    const results = await runWithConcurrency(tasks, 3);
    expect(peak).toBe(3);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : -1))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("starts tasks in the order given", async () => {
    const started: number[] = [];
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      started.push(i);
      await tick();
    });
    await runWithConcurrency(tasks, 2);
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps going after a rejection and reports it in place", async () => {
    const tasks = [
      async () => "a",
      async () => {
        throw new Error("boom");
      },
      async () => "c",
    ];
    const results = await runWithConcurrency(tasks, 1);
    expect(results[0]).toEqual({ status: "fulfilled", value: "a" });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: "c" });
  });

  it("handles an empty task list and a limit below one", async () => {
    expect(await runWithConcurrency([], 4)).toEqual([]);
    const results = await runWithConcurrency([async () => 1, async () => 2], 0);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : -1))).toEqual([1, 2]);
  });
});
