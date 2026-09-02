import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getApiTeacher } from "@/lib/auth";

/**
 * GET /api/health/anthropic
 *
 * Can the deployed ANTHROPIC_API_KEY actually complete a model call right
 * now? Answers { ok: true } or { ok: false, error }. Teacher-only.
 *
 * Exists because the account ran out of credit twice (25 Aug and 2 Sep 2026)
 * and nobody knew until a grading run failed -- and the 25 Aug failures were
 * only found in the database a week later. Every AI feature in the app
 * shares this one key, so when it stops working, all of them do, silently.
 * The AI-grade page calls this on load and shows a banner when it fails.
 *
 * A real (tiny) completion, not count_tokens: token counting is free and may
 * keep succeeding on an account that can no longer be billed, which is the
 * exact condition this needs to catch. Haiku, 1 output token, a few input
 * tokens -- a fraction of a hundredth of a cent per check. Results are held
 * for a minute per server instance so a page that reloads a few times does
 * not spam the API.
 */
const CACHE_MS = 60_000;
let cached: { at: number; body: HealthBody } | null = null;

interface HealthBody {
  ok: boolean;
  error?: string;
  checkedAt: string;
}

export async function GET() {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.body);
  }

  const checkedAt = new Date().toISOString();
  let body: HealthBody;

  if (!process.env.ANTHROPIC_API_KEY) {
    body = { ok: false, error: "ANTHROPIC_API_KEY is not configured on this deployment", checkedAt };
  } else {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
      await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
      body = { ok: true, checkedAt };
    } catch (e) {
      // The SDK's error message carries Anthropic's own text, e.g. the
      // "credit balance is too low" wording -- surface it verbatim so the
      // banner says what actually went wrong.
      body = { ok: false, error: e instanceof Error ? e.message : String(e), checkedAt };
    }
  }

  cached = { at: Date.now(), body };
  return NextResponse.json(body);
}
