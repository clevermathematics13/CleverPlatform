import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MarkAttributionSchema = z.object({
  partId: z.string().uuid("partId must be a valid UUID"),
  tokenId: z.string().min(1, "tokenId is required"),
  subtopicCode: z.string().nullable(),
  source: z.enum(["manual", "ai"]),
  rationale: z.string().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Parse + validate request body
    const json = await req.json();
    const parsed = MarkAttributionSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { partId, tokenId, subtopicCode, source, rationale } = parsed.data;

    // Fetch current mark_attributions for the part
    const { data: part, error: fetchError } = await supabase
      .from("question_parts")
      .select("mark_attributions")
      .eq("id", partId)
      .single();

    if (fetchError || !part) {
      return NextResponse.json({ error: "Part not found" }, { status: 404 });
    }

    const current =
      (part.mark_attributions as Record<
        string,
        { subtopicCode: string; source: string; rationale?: string }
      >) ?? {};

    // Build the updated attributions map
    let updated: typeof current;
    if (subtopicCode === null) {
      // Remove attribution for this token
      const { [tokenId]: _removed, ...rest } = current;
      updated = rest;
    } else {
      updated = {
        ...current,
        [tokenId]: {
          subtopicCode,
          source,
          ...(rationale !== undefined ? { rationale } : {}),
        },
      };
    }

    const { error: updateError } = await supabase
      .from("question_parts")
      .update({ mark_attributions: updated })
      .eq("id", partId);

    if (updateError) {
      console.error("[mark-attribution] update error:", updateError);
      return NextResponse.json({ error: "DB update failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, mark_attributions: updated });
  } catch (err) {
    console.error("[mark-attribution] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
