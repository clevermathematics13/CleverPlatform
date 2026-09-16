/**
 * generation-ticket.ts -- a durable handle on a generation the browser started.
 * -----------------------------------------------------------------------------
 * The packet is produced by a durable workflow and written to
 * nuanced_generation_runs. The browser is only a window onto that, and the
 * window can close: a shut laptop, a dropped connection, a reloaded tab. When
 * it does, the run carries on and finishes, and until now nothing remembered
 * the id needed to go and collect it.
 *
 * A ticket is that memory. It is written to localStorage BEFORE anything can
 * go wrong with the socket, and it is what lets a reopened tab ask
 * /api/claude/status the one question that matters: did the thing I started
 * ever finish?
 *
 * THREE DECISIONS THAT LOOK ARBITRARY AND ARE NOT.
 *
 * Keyed by generationId, not one slot. A single "current ticket" key means a
 * second Send silently overwrites the handle on the first run, stranding a
 * paid multi-pass generation with no way back to it. Two tabs do the same
 * thing to each other.
 *
 * Scoped by gradeLevel. ActivityGeneratorPanel is mounted once per grade tab,
 * so up to five live instances share this storage. Without a scope, whichever
 * panel happens to mount first would collect a packet meant for another one
 * and hand it to the wrong sandbox.
 *
 * A seven-day life, not a day. The whole promise is "start it, close the lid,
 * come back later". A Friday evening run has to still be collectable on
 * Monday morning, and a day-long expiry quietly breaks exactly the case this
 * exists for.
 *
 * Every read is defensive. localStorage is shared, survives deploys, and can
 * hold anything a previous version wrote; a throw in here would break the
 * generator on load, which is far worse than losing a ticket.
 * -----------------------------------------------------------------------------
 */

export const TICKET_STORAGE_KEY = "cleverplatform.na-generation.v1";

/** How long a ticket stays worth checking. */
export const TICKET_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Keeps one bad actor from filling the quota. */
const MAX_TICKETS = 12;

export type GenerationTicket = {
  v: 1;
  /** The key /api/claude/status is polled by. */
  generationId: string;
  /** Resumable workflow run, when the POST reported one. */
  runId: string | null;
  startedAt: number;
  /** Which panel started it -- see the scoping note above. */
  gradeLevel: string;
  /** The teacher's own words, replayed as the user turn on recovery. */
  prompt: string;
};

function isTicket(value: unknown): value is GenerationTicket {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    t.v === 1 &&
    typeof t.generationId === "string" &&
    t.generationId.length > 0 &&
    (t.runId === null || typeof t.runId === "string") &&
    typeof t.startedAt === "number" &&
    Number.isFinite(t.startedAt) &&
    typeof t.gradeLevel === "string" &&
    typeof t.prompt === "string"
  );
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Private mode, blocked site data, a sandboxed frame.
    return null;
  }
}

/** Every live ticket, newest first. Never throws; bad data reads as none. */
export function readTickets(now: number, store: Storage | null = storage()): GenerationTicket[] {
  if (!store) return [];
  let raw: string | null = null;
  try {
    raw = store.getItem(TICKET_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(isTicket)
    .filter((t) => now - t.startedAt < TICKET_TTL_MS)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_TICKETS);
}

/** The newest live ticket started by this grade's panel, if any. */
export function readTicketForGrade(
  gradeLevel: string,
  now: number,
  store: Storage | null = storage(),
): GenerationTicket | null {
  return readTickets(now, store).find((t) => t.gradeLevel === gradeLevel) ?? null;
}

function write(tickets: GenerationTicket[], store: Storage | null): void {
  if (!store) return;
  try {
    store.setItem(TICKET_STORAGE_KEY, JSON.stringify(tickets.slice(0, MAX_TICKETS)));
  } catch {
    // Quota, or storage disabled mid-session. A missing ticket costs a
    // recovery; a throw here would cost the generation.
  }
}

/** Record a started run. Replaces any ticket with the same generationId. */
export function saveTicket(
  ticket: GenerationTicket,
  now: number,
  store: Storage | null = storage(),
): void {
  const rest = readTickets(now, store).filter((t) => t.generationId !== ticket.generationId);
  write([ticket, ...rest], store);
}

/** Forget one run. Safe to call for an id that was never stored. */
export function clearTicket(
  generationId: string,
  now: number,
  store: Storage | null = storage(),
): void {
  write(
    readTickets(now, store).filter((t) => t.generationId !== generationId),
    store,
  );
}
