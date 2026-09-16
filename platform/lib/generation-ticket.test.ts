import { describe, it, expect } from "vitest";
import {
  readTickets,
  readTicketForGrade,
  saveTicket,
  clearTicket,
  TICKET_STORAGE_KEY,
  TICKET_TTL_MS,
  type GenerationTicket,
} from "./generation-ticket";

const NOW = 1_700_000_000_000;

function fakeStore(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(TICKET_STORAGE_KEY, initial);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    raw: () => map.get(TICKET_STORAGE_KEY) ?? null,
  };
}

function ticket(over: Partial<GenerationTicket> = {}): GenerationTicket {
  return {
    v: 1,
    generationId: "gen-1",
    runId: "run-1",
    startedAt: NOW,
    gradeLevel: "Grade 12",
    prompt: "Hypothesis testing",
    ...over,
  };
}

describe("round trip", () => {
  it("saves and reads a ticket back", () => {
    const s = fakeStore();
    saveTicket(ticket(), NOW, s);
    expect(readTickets(NOW, s)).toEqual([ticket()]);
  });

  it("keeps several runs at once rather than one slot", () => {
    // A second Send used to overwrite the handle on the first run, stranding
    // a paid multi-pass generation with no way back to it.
    const s = fakeStore();
    saveTicket(ticket({ generationId: "a", startedAt: NOW - 1000 }), NOW, s);
    saveTicket(ticket({ generationId: "b" }), NOW, s);
    expect(readTickets(NOW, s).map((t) => t.generationId)).toEqual(["b", "a"]);
  });

  it("replaces a ticket with the same id instead of duplicating it", () => {
    const s = fakeStore();
    saveTicket(ticket({ runId: null }), NOW, s);
    saveTicket(ticket({ runId: "run-2" }), NOW, s);
    const all = readTickets(NOW, s);
    expect(all).toHaveLength(1);
    expect(all[0].runId).toBe("run-2");
  });

  it("forgets one run and leaves the others", () => {
    const s = fakeStore();
    saveTicket(ticket({ generationId: "a" }), NOW, s);
    saveTicket(ticket({ generationId: "b" }), NOW, s);
    clearTicket("a", NOW, s);
    expect(readTickets(NOW, s).map((t) => t.generationId)).toEqual(["b"]);
  });

  it("clearing an unknown id is harmless", () => {
    const s = fakeStore();
    saveTicket(ticket(), NOW, s);
    expect(() => clearTicket("never-stored", NOW, s)).not.toThrow();
    expect(readTickets(NOW, s)).toHaveLength(1);
  });
});

describe("scoping to the panel that started the run", () => {
  it("returns only this grade's ticket", () => {
    // ActivityGeneratorPanel mounts once per grade tab, so up to five live
    // instances share this storage. Without the scope, the wrong panel
    // collects the packet.
    const s = fakeStore();
    saveTicket(ticket({ generationId: "g9", gradeLevel: "Grade 9", startedAt: NOW }), NOW, s);
    saveTicket(ticket({ generationId: "g12", gradeLevel: "Grade 12", startedAt: NOW - 500 }), NOW, s);
    expect(readTicketForGrade("Grade 12", NOW, s)?.generationId).toBe("g12");
    expect(readTicketForGrade("Grade 9", NOW, s)?.generationId).toBe("g9");
    expect(readTicketForGrade("Grade 11", NOW, s)).toBeNull();
  });

  it("returns the newest when a grade has more than one", () => {
    const s = fakeStore();
    saveTicket(ticket({ generationId: "old", startedAt: NOW - 10_000 }), NOW, s);
    saveTicket(ticket({ generationId: "new", startedAt: NOW }), NOW, s);
    expect(readTicketForGrade("Grade 12", NOW, s)?.generationId).toBe("new");
  });
});

describe("expiry", () => {
  it("still returns a ticket from the previous evening", () => {
    const s = fakeStore();
    saveTicket(ticket({ startedAt: NOW - 20 * 60 * 60 * 1000 }), NOW, s);
    expect(readTickets(NOW, s)).toHaveLength(1);
  });

  it("survives a weekend, which a 24h expiry would not", () => {
    // Friday evening -> Monday morning is the case the seven-day life exists
    // for; this is the assertion that keeps someone from shortening it.
    const s = fakeStore();
    saveTicket(ticket({ startedAt: NOW - 3 * 24 * 60 * 60 * 1000 }), NOW, s);
    expect(readTickets(NOW, s)).toHaveLength(1);
  });

  it("drops a ticket past its life", () => {
    const s = fakeStore();
    saveTicket(ticket({ startedAt: NOW - TICKET_TTL_MS - 1 }), NOW, s);
    expect(readTickets(NOW, s)).toEqual([]);
  });
});

describe("a bad store can never break the generator", () => {
  it.each([
    ["not json at all", "}{"],
    ["json that is not an array", '{"generationId":"x"}'],
    ["an array of junk", '[1,"two",null,{"nope":true}]'],
    ["an empty string", ""],
    ["a ticket from a future version", '[{"v":2,"generationId":"x"}]'],
    ["a ticket missing its id", '[{"v":1,"runId":null,"startedAt":1,"gradeLevel":"Grade 12","prompt":""}]'],
  ])("reads %s as no tickets, without throwing", (_label, raw) => {
    const s = fakeStore(raw);
    expect(() => readTickets(NOW, s)).not.toThrow();
    expect(readTickets(NOW, s)).toEqual([]);
  });

  it("keeps the good tickets out of a partly corrupt list", () => {
    const s = fakeStore(JSON.stringify([{ junk: true }, ticket(), null]));
    expect(readTickets(NOW, s).map((t) => t.generationId)).toEqual(["gen-1"]);
  });

  it("does nothing, quietly, when storage is unavailable", () => {
    // Private mode and blocked site data both land here.
    expect(readTickets(NOW, null)).toEqual([]);
    expect(readTicketForGrade("Grade 12", NOW, null)).toBeNull();
    expect(() => saveTicket(ticket(), NOW, null)).not.toThrow();
    expect(() => clearTicket("gen-1", NOW, null)).not.toThrow();
  });

  it("survives a store that throws on read and on write", () => {
    const hostile = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(readTickets(NOW, hostile)).toEqual([]);
    expect(() => saveTicket(ticket(), NOW, hostile)).not.toThrow();
  });
});
