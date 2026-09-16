/**
 * na-packet-save.test.ts
 * -----------------------------------------------------------------------------
 * The bug this covers shipped and stayed invisible because it was unreachable
 * by the suite: the write lived inline in a Next.js API route, and AGENTS.md
 * forbids unit tests for those. `.upsert(row, { onConflict: "course_id,
 * section_code" })` type-checked, compiled, passed every test, and failed on
 * EVERY real save -- the conflict target is a PARTIAL index and PostgREST
 * cannot name one. Moving the branching into lib/ is what makes these cases
 * possible at all.
 *
 * The fake client below models PostgREST's shapes, not Supabase's whole API:
 * a builder that collects .eq() filters and resolves at .maybeSingle(). Each
 * test scripts the exact sequence of responses a scenario produces, so the
 * assertions are about the BRANCH TAKEN, which is the thing that was wrong.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { savePacketRow, SAVED_PACKET_COLUMNS } from "./na-packet-save";

type Reply = { data: unknown; error: { code?: string; message: string; details?: string } | null };

/** One recorded operation, so a test can assert which branch ran and in what order. */
type Op = { verb: "select" | "insert" | "update"; filters: Record<string, string> };

function fakeClient(replies: Reply[]) {
  const ops: Op[] = [];
  let i = 0;
  const next = (): Reply => {
    if (i >= replies.length) throw new Error(`fake client ran out of replies after ${i}`);
    return replies[i++];
  };

  const builder = (verb: Op["verb"]) => {
    const op: Op = { verb, filters: {} };
    ops.push(op);
    const chain = {
      select: () => chain,
      eq: (col: string, val: string) => {
        op.filters[col] = val;
        return chain;
      },
      maybeSingle: async () => next(),
      single: async () => next(),
    };
    return chain;
  };

  const client = {
    from: () => ({
      select: () => builder("select"),
      insert: () => builder("insert"),
      update: () => builder("update"),
    }),
  } as unknown as SupabaseClient;

  return { client, ops, used: () => i };
}

const PACKET = {
  id: "na-1",
  slug: "products-of-linear-expressions",
  section_code: "B.4",
  grade_level: "Grade 9",
  is_published: false,
};
const ROW = { slug: PACKET.slug, title: "Products of Linear Expressions" };
const PARAMS = { row: ROW, courseId: "course-1", sectionCode: "B.4" };

const found = { data: { id: "na-1" }, error: null };
const notFound = { data: null, error: null };
const ok = { data: PACKET, error: null };
const dup = (msg: string, details?: string) => ({
  data: null,
  error: { code: "23505", message: msg, details },
});

describe("savePacketRow — the ordinary paths", () => {
  it("inserts when the section has no packet yet", async () => {
    const { client, ops } = fakeClient([notFound, ok]);
    const res = await savePacketRow(client, PARAMS);

    expect(res).toEqual({ ok: true, packet: PACKET, created: true });
    expect(ops.map((o) => o.verb)).toEqual(["select", "insert"]);
  });

  it("updates in place when the section already has one", async () => {
    const { client, ops } = fakeClient([found, ok]);
    const res = await savePacketRow(client, PARAMS);

    expect(res).toEqual({ ok: true, packet: PACKET, created: false });
    expect(ops.map((o) => o.verb)).toEqual(["select", "update"]);
    // Updating by id, not by (course, section) -- keeps the packet's id stable,
    // which na_rubric_items and the whole scan chain are keyed to.
    expect(ops[1].filters).toEqual({ id: "na-1" });
  });

  it("looks the packet up by course AND section", async () => {
    const { client, ops } = fakeClient([notFound, ok]);
    await savePacketRow(client, PARAMS);
    expect(ops[0].filters).toEqual({ course_id: "course-1", section_code: "B.4" });
  });
});

describe("savePacketRow — the failures the upsert used to absorb", () => {
  it("surfaces a failed lookup instead of silently inserting", async () => {
    // The defect every reviewer caught in the first draft: a discarded lookup
    // error reads as "no such packet", takes the insert branch, and returns a
    // duplicate-key 500 blaming a cause that never happened.
    const { client, ops } = fakeClient([
      { data: null, error: { message: "canceling statement due to statement timeout" } },
    ]);
    const res = await savePacketRow(client, PARAMS);

    expect(res).toEqual({
      ok: false,
      error: "canceling statement due to statement timeout",
      status: 500,
    });
    expect(ops.map((o) => o.verb)).toEqual(["select"]);
  });

  it("re-inserts when the packet is deleted between the lookup and the update", async () => {
    // Another tab's delete. An upsert would have re-inserted; a bare .single()
    // would 500 with "Cannot coerce the result to a single JSON object".
    const { client, ops } = fakeClient([found, notFound, notFound, ok]);
    const res = await savePacketRow(client, PARAMS);

    expect(res).toEqual({ ok: true, packet: PACKET, created: true });
    expect(ops.map((o) => o.verb)).toEqual(["select", "update", "select", "insert"]);
  });

  it("updates instead of failing when it loses a race to insert", async () => {
    // Two saves of the same section: both lookups miss, the loser's insert hits
    // the unique index. The index is the backstop, not the arbiter -- so the
    // retry finds the winner's row and updates it, as the upsert would have.
    const { client, ops } = fakeClient([
      notFound,
      dup('duplicate key value violates unique constraint "uq_nuanced_analyses_course_section"'),
      found,
      ok,
    ]);
    const res = await savePacketRow(client, PARAMS);

    expect(res).toEqual({ ok: true, packet: PACKET, created: false });
    expect(ops.map((o) => o.verb)).toEqual(["select", "insert", "select", "update"]);
  });

  it("gives up after two attempts rather than looping", async () => {
    const { client, used } = fakeClient([
      notFound,
      dup('duplicate key value violates unique constraint "uq_nuanced_analyses_course_section"'),
      notFound,
      dup('duplicate key value violates unique constraint "uq_nuanced_analyses_course_section"'),
    ]);
    const res = await savePacketRow(client, PARAMS);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(409);
    expect(res.error).toContain("B.4");
    expect(used()).toBe(4);
  });
});

describe("savePacketRow — a slug clash is not a section clash", () => {
  // slug carries its own non-partial UNIQUE and is derived from the TITLE, so
  // retrying can never resolve it; the teacher has to change the title. Postgres
  // reports whichever index it checked first, so the two must be told apart by
  // the constraint named rather than by which branch failed.
  it("reports a slug collision on insert as an actionable 409, without retrying", async () => {
    const { client, ops } = fakeClient([
      notFound,
      dup(
        'duplicate key value violates unique constraint "nuanced_analyses_slug_key"',
        "Key (slug)=(products-of-linear-expressions) already exists.",
      ),
    ]);
    const res = await savePacketRow(client, PARAMS);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(409);
    expect(res.error).toContain("products-of-linear-expressions");
    expect(res.error).toContain("title");
    // No retry: a second pass would fail identically.
    expect(ops.map((o) => o.verb)).toEqual(["select", "insert"]);
  });

  it("reports a slug collision on update too", async () => {
    const { client } = fakeClient([
      found,
      dup('duplicate key value violates unique constraint "nuanced_analyses_slug_key"'),
    ]);
    const res = await savePacketRow(client, PARAMS);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(409);
    expect(res.error).toContain("title");
  });

  it("does not mistake a section clash for a slug clash", async () => {
    const { client } = fakeClient([
      notFound,
      dup(
        'duplicate key value violates unique constraint "uq_nuanced_analyses_course_section"',
        "Key (course_id, section_code)=(course-1, B.4) already exists.",
      ),
      found,
      ok,
    ]);
    const res = await savePacketRow(client, PARAMS);
    expect(res.ok).toBe(true);
  });
});

describe("savePacketRow — other errors pass straight through", () => {
  it("returns a non-unique-violation insert error as a 500", async () => {
    const { client } = fakeClient([
      notFound,
      { data: null, error: { code: "42501", message: 'new row violates row-level security policy' } },
    ]);
    const res = await savePacketRow(client, PARAMS);

    expect(res).toEqual({
      ok: false,
      error: "new row violates row-level security policy",
      status: 500,
    });
  });

  it("returns a non-unique-violation update error as a 500", async () => {
    const { client } = fakeClient([
      found,
      { data: null, error: { code: "42703", message: 'column "nope" does not exist' } },
    ]);
    const res = await savePacketRow(client, PARAMS);

    expect(res).toEqual({ ok: false, error: 'column "nope" does not exist', status: 500 });
  });

  it("does not claim success when the insert reports neither row nor error", async () => {
    const { client } = fakeClient([notFound, { data: null, error: null }]);
    const res = await savePacketRow(client, PARAMS);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(500);
  });
});

describe("the columns the route hands back", () => {
  it("still selects everything the response promises", () => {
    // The route returns `saved` to the sandbox, which reads section_code and
    // is_published off it. Dropping one here would be a silent undefined.
    for (const col of ["id", "slug", "section_code", "grade_level", "is_published"]) {
      expect(SAVED_PACKET_COLUMNS).toContain(col);
    }
  });
});
