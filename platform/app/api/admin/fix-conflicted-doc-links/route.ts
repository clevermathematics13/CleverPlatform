import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveTokenFromCookie } from "@/lib/google-drive";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

export const maxDuration = 300;

const QUESTION_FOLDER_ID = "18vwi-jz_0vur8MjixNnTkKdb0lHygNV3";
const MARKSCHEME_FOLDER_ID = "1GDGql-mIeH2YoD1OfnFa0UhxUdaXsY4D";

type QuestionRow = {
  id: string;
  code: string;
  google_doc_id: string | null;
  google_ms_id: string | null;
};

type LinkIssue = {
  id: string;
  code: string;
  google_doc_id: string | null;
  google_ms_id: string | null;
  clearGoogleDocId: boolean;
  clearGoogleMsId: boolean;
  reasons: string[];
};

type FileTreeInfo = {
  inQuestionTree: boolean;
  inMarkschemeTree: boolean;
  missing: boolean;
};

function getAuthedClient(token: Record<string, unknown>) {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials(token);
  return oauth2;
}

function isDriveFileNotFound(err: unknown): boolean {
  const status =
    (err as { code?: number; response?: { status?: number } } | null)?.code ??
    (err as { response?: { status?: number } } | null)?.response?.status;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return status === 404 || /file not found|requested entity was not found/i.test(msg);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "teacher") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const token = (await getDriveTokenFromCookie()) as Record<string, unknown> | null;
    if (!token) {
      return NextResponse.json({ error: "Google Drive not connected" }, { status: 401 });
    }

    const auth = getAuthedClient(token);
    const drive = google.drive({ version: "v3", auth });

    async function getFileWithRetry(fileId: string, attempt = 0) {
      try {
        return await drive.files.get({
          fileId,
          fields: "id, parents",
          supportsAllDrives: true,
        });
      } catch (error) {
        const status =
          (error as { response?: { status?: number } })?.response?.status;
        const retryable =
          status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
        if (retryable && attempt < 4) {
          const backoffMs = 400 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          return getFileWithRetry(fileId, attempt + 1);
        }
        throw error;
      }
    }

    const body = (await request.json().catch(() => ({}))) as {
      dryRun?: boolean;
      limit?: number;
    };

    const dryRun = body.dryRun ?? true;
    const sampleLimit = Math.max(1, Math.min(body.limit ?? 50, 200));

    const PAGE_SIZE = 1000;
    const allRows: QuestionRow[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("ib_questions")
        .select("id, code, google_doc_id, google_ms_id")
        .or("google_doc_id.not.is.null,google_ms_id.not.is.null")
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!data || data.length === 0) break;
      allRows.push(...(data as QuestionRow[]));

      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    const fileInfoCache = new Map<string, FileTreeInfo>();
    const parentCache = new Map<string, string[]>();

    async function getParents(fileId: string): Promise<string[]> {
      if (parentCache.has(fileId)) return parentCache.get(fileId)!;
      const res = await getFileWithRetry(fileId);
      const parents = (res.data.parents ?? []).filter((p): p is string => Boolean(p));
      parentCache.set(fileId, parents);
      return parents;
    }

    async function classifyFile(fileId: string): Promise<FileTreeInfo> {
      if (fileInfoCache.has(fileId)) return fileInfoCache.get(fileId)!;

      const visited = new Set<string>();
      const queue: string[] = [fileId];
      let inQuestionTree = false;
      let inMarkschemeTree = false;

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        if (current === QUESTION_FOLDER_ID) inQuestionTree = true;
        if (current === MARKSCHEME_FOLDER_ID) inMarkschemeTree = true;

        if (inQuestionTree && inMarkschemeTree) break;

        if (current === fileId) {
          try {
            const parents = await getParents(current);
            queue.push(...parents);
          } catch (err) {
            if (isDriveFileNotFound(err)) {
              const info = { inQuestionTree: false, inMarkschemeTree: false, missing: true };
              fileInfoCache.set(fileId, info);
              return info;
            }
            throw err;
          }
        } else {
          const parents = await getParents(current).catch(() => [] as string[]);
          queue.push(...parents);
        }
      }

      const info = { inQuestionTree, inMarkschemeTree, missing: false };
      fileInfoCache.set(fileId, info);
      return info;
    }

    const issues: LinkIssue[] = [];
    for (const row of allRows) {
      const reasons: string[] = [];
      let clearGoogleDocId = false;
      let clearGoogleMsId = false;

      if (row.google_doc_id && row.google_ms_id && row.google_doc_id === row.google_ms_id) {
        clearGoogleDocId = true;
        reasons.push("question_doc_equals_markscheme_doc");
      }

      if (row.google_doc_id) {
        const info = await classifyFile(row.google_doc_id);
        if (info.missing) {
          clearGoogleDocId = true;
          reasons.push("question_doc_missing_in_drive");
        } else {
          if (info.inMarkschemeTree) {
            clearGoogleDocId = true;
            reasons.push("question_doc_is_in_markscheme_tree");
          }
          if (!info.inQuestionTree) {
            clearGoogleDocId = true;
            reasons.push("question_doc_not_in_question_tree");
          }
        }
      }

      if (row.google_ms_id) {
        const info = await classifyFile(row.google_ms_id);
        if (info.missing) {
          clearGoogleMsId = true;
          reasons.push("markscheme_doc_missing_in_drive");
        } else if (!info.inMarkschemeTree) {
          clearGoogleMsId = true;
          reasons.push("markscheme_doc_not_in_markscheme_tree");
        }
      }

      if (clearGoogleDocId || clearGoogleMsId) {
        issues.push({
          id: row.id,
          code: row.code,
          google_doc_id: row.google_doc_id,
          google_ms_id: row.google_ms_id,
          clearGoogleDocId,
          clearGoogleMsId,
          reasons,
        });
      }
    }

    const sample = issues.slice(0, sampleLimit).map((row) => ({
      id: row.id,
      code: row.code,
      google_doc_id: row.google_doc_id,
      google_ms_id: row.google_ms_id,
      clearGoogleDocId: row.clearGoogleDocId,
      clearGoogleMsId: row.clearGoogleMsId,
      reasons: row.reasons,
    }));

    const clearDocOnly = issues.filter((i) => i.clearGoogleDocId && !i.clearGoogleMsId).length;
    const clearMsOnly = issues.filter((i) => !i.clearGoogleDocId && i.clearGoogleMsId).length;
    const clearBoth = issues.filter((i) => i.clearGoogleDocId && i.clearGoogleMsId).length;

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        scannedRowsWithAnyId: allRows.length,
        issuesFound: issues.length,
        wouldClearGoogleDocId: issues.filter((i) => i.clearGoogleDocId).length,
        wouldClearGoogleMsId: issues.filter((i) => i.clearGoogleMsId).length,
        wouldClearDocOnly: clearDocOnly,
        wouldClearMsOnly: clearMsOnly,
        wouldClearBoth: clearBoth,
        sample,
        action: "Would clear wrong-field links based on Drive folder ancestry",
      });
    }

    let updatedRows = 0;
    let clearedGoogleDocId = 0;
    let clearedGoogleMsId = 0;

    for (let i = 0; i < issues.length; i += 200) {
      const batch = issues.slice(i, i + 200);
      const clearDocIds = batch.filter((b) => b.clearGoogleDocId).map((b) => b.id);
      const clearMsIds = batch.filter((b) => b.clearGoogleMsId).map((b) => b.id);

      if (clearDocIds.length > 0) {
        const { error } = await supabase
          .from("ib_questions")
          .update({ google_doc_id: null })
          .in("id", clearDocIds);

        if (error) {
          return NextResponse.json(
            {
              error: `Failed clearing google_doc_id: ${error.message}`,
              updatedRows,
            },
            { status: 500 }
          );
        }
        clearedGoogleDocId += clearDocIds.length;
      }

      if (clearMsIds.length > 0) {
        const { error } = await supabase
          .from("ib_questions")
          .update({ google_ms_id: null })
          .in("id", clearMsIds);

        if (error) {
          return NextResponse.json(
            {
              error: `Failed clearing google_ms_id: ${error.message}`,
              updatedRows,
            },
            { status: 500 }
          );
        }
        clearedGoogleMsId += clearMsIds.length;
      }

      updatedRows += batch.length;
    }

    return NextResponse.json({
      dryRun: false,
      scannedRowsWithAnyId: allRows.length,
      issuesFound: issues.length,
      updatedRows,
      clearedGoogleDocId,
      clearedGoogleMsId,
      clearedDocOnly: clearDocOnly,
      clearedMsOnly: clearMsOnly,
      clearedBoth: clearBoth,
      sample,
      action: "Cleared wrong-field links based on Drive folder ancestry",
      nextStep: "Run Sync Google Doc IDs with Force re-link ON to relink correct question docs",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown cleanup error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
