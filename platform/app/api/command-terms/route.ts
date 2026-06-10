/**
 * GET /api/command-terms
 *
 * Returns the list of IB-approved command terms from the database,
 * ordered by sort_order. Falls back to the hardcoded canonical list
 * if the DB query fails (e.g. during local development without the table).
 *
 * Response: { terms: string[] }
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_COMMAND_TERMS } from "@/lib/command-terms";

export const revalidate = 3600; // cache for 1 hour

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("command_terms")
      .select("term")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error || !data?.length) {
      // Graceful fallback to the canonical TS list
      return NextResponse.json({ terms: [...DEFAULT_COMMAND_TERMS] });
    }

    return NextResponse.json({ terms: data.map((r) => r.term) });
  } catch {
    return NextResponse.json({ terms: [...DEFAULT_COMMAND_TERMS] });
  }
}
