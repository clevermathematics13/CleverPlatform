import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getApiTeacher } from "@/lib/auth";
import {
  validateNuancedAnalysisSpec,
} from "@/lib/nuanced-analysis-spec.schema";
import {
  loadEffectiveSpec,
  saveCanonicalSpec,
  saveOwnSpecVariant,
} from "@/lib/nuanced-analysis-spec.load";
import {
  compileSpecToChecklist,
  compileSpecToSystemPrompt,
} from "@/lib/nuanced-analysis-spec.compile";

export const runtime = "nodejs";

// Service-role client: the canonical row (owner_id IS NULL) is only writable by
// the service role under RLS, and reads must see it regardless of ownership.
// Teacher-gating happens above via getApiTeacher().
const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * GET /api/nuanced-analysis-spec
 * Returns the spec the calling teacher would generate with right now
 * (own variant → canonical row → built-in canonical), plus a human-readable
 * checklist and the size of the compiled generation prompt.
 */
export async function GET() {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  try {
    const effective = await loadEffectiveSpec(serviceClient, auth.user.id);
    return NextResponse.json({
      spec: effective.spec,
      source: effective.source,
      rowId: effective.rowId,
      specVersion: effective.spec.identity.specVersion,
      checklist: compileSpecToChecklist(effective.spec),
      compiledPromptChars: compileSpecToSystemPrompt(effective.spec).length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to load spec" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/nuanced-analysis-spec
 * Body: { spec: NuancedAnalysisSpec, scope?: "canonical" | "own" }
 *
 * Zod-validates the payload and saves it. "canonical" (the default) updates the
 * shared template that drives generation for the course; "own" saves a
 * per-teacher variant (the future per-course personalization path).
 * Invalid specs are rejected with per-field errors — nothing unvalidated ever
 * reaches the table.
 */
export async function PUT(request: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const scope: "canonical" | "own" = body?.scope === "own" ? "own" : "canonical";

    const validated = validateNuancedAnalysisSpec(body?.spec);
    if (!validated.success) {
      return NextResponse.json(
        {
          error: "Spec failed validation — not saved.",
          fieldErrors: validated.fieldErrors,
        },
        { status: 422 },
      );
    }

    const saved =
      scope === "own"
        ? await saveOwnSpecVariant(serviceClient, auth.user.id, validated.data)
        : await saveCanonicalSpec(serviceClient, validated.data);

    return NextResponse.json({
      success: true,
      scope,
      rowId: saved.rowId,
      specVersion: validated.data.identity.specVersion,
      checklist: compileSpecToChecklist(validated.data),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to save spec" },
      { status: 500 },
    );
  }
}
