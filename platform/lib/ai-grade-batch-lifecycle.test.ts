import { describe, expect, it } from "vitest";
import {
  batchDisposition,
  GIVE_UP_MESSAGES,
  RESULTS_RETENTION_MS,
  STUCK_PROCESSING_MS,
  type BatchProbe,
} from "./ai-grade-batch-lifecycle";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const ended: BatchProbe = { retrieved: true, archivedAt: null, processingStatus: "ended" };
const processing: BatchProbe = {
  retrieved: true,
  archivedAt: null,
  processingStatus: "in_progress",
};

describe("batchDisposition", () => {
  describe("a finished batch stays collectable however late the page is opened", () => {
    // The regression this file exists for: the collect route used to fail
    // every batch older than 30 hours before asking Anthropic anything, so a
    // class submitted overnight and opened a day and a half later was thrown
    // away while Anthropic still held its results.
    it.each([
      ["straight away", 0],
      ["after one night", 12 * HOUR],
      ["at the old 30-hour cliff", 30 * HOUR],
      ["just past the old cliff", 30 * HOUR + 1],
      ["after a long weekend", 3 * DAY],
      ["after four weeks", 28 * DAY],
    ])("collects %s", (_label, ageMs) => {
      expect(batchDisposition(ageMs, ended)).toEqual({ kind: "collect" });
    });

    it("collects right up to the retention boundary", () => {
      expect(batchDisposition(RESULTS_RETENTION_MS, ended)).toEqual({ kind: "collect" });
    });

    it("gives up only once the results are past retention", () => {
      expect(batchDisposition(RESULTS_RETENTION_MS + 1, ended)).toEqual({
        kind: "give-up",
        message: GIVE_UP_MESSAGES.pastRetention,
      });
    });
  });

  describe("a batch still processing", () => {
    it("waits inside the processing window", () => {
      expect(batchDisposition(HOUR, processing)).toEqual({ kind: "wait" });
      expect(batchDisposition(STUCK_PROCESSING_MS, processing)).toEqual({ kind: "wait" });
    });

    it("is declared stuck past the 24h ceiling Anthropic guarantees", () => {
      expect(batchDisposition(STUCK_PROCESSING_MS + 1, processing)).toEqual({
        kind: "give-up",
        message: GIVE_UP_MESSAGES.stuck,
      });
    });

    it("treats 'canceling' as unfinished, not as collectable", () => {
      const canceling: BatchProbe = {
        retrieved: true,
        archivedAt: null,
        processingStatus: "canceling",
      };
      expect(batchDisposition(HOUR, canceling)).toEqual({ kind: "wait" });
    });
  });

  describe("results Anthropic no longer holds", () => {
    it("gives up when the batch reports itself archived, however young", () => {
      const archived: BatchProbe = {
        retrieved: true,
        archivedAt: "2026-09-14T20:19:28Z",
        processingStatus: "ended",
      };
      expect(batchDisposition(HOUR, archived)).toEqual({
        kind: "give-up",
        message: GIVE_UP_MESSAGES.archived,
      });
    });

    it("gives up on a 404, which means the batch itself is gone", () => {
      expect(batchDisposition(2 * DAY, { retrieved: false, notFound: true })).toEqual({
        kind: "give-up",
        message: GIVE_UP_MESSAGES.notFound,
      });
    });
  });

  describe("a retrieve that simply failed", () => {
    // The distinction that matters: a blip, a 429 or a 500 must never end a
    // batch whose results are still sitting at Anthropic.
    it("retries rather than giving up, at any age inside retention", () => {
      const blip: BatchProbe = { retrieved: false, notFound: false };
      expect(batchDisposition(0, blip)).toEqual({ kind: "retry" });
      expect(batchDisposition(2 * DAY, blip)).toEqual({ kind: "retry" });
      expect(batchDisposition(28 * DAY, blip)).toEqual({ kind: "retry" });
    });

    it("still gives up past retention, since nothing can be read by then", () => {
      expect(
        batchDisposition(RESULTS_RETENTION_MS + 1, { retrieved: false, notFound: false })
      ).toEqual({ kind: "give-up", message: GIVE_UP_MESSAGES.pastRetention });
    });
  });
});
