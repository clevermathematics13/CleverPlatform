import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveTokenFromCookie } from "@/lib/google-drive";
import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";

export const maxDuration = 300;
const QUESTION_FOLDER_ID = "18vwi-jz_0vur8MjixNnTkKdb0lHygNV3";
const MARKSCHEME_FOLDER_ID = "1GDGql-mIeH2YoD1OfnFa0UhxUdaXsY4D";

// IB question code pattern: e.g. 24M.1.AHL.TZ2.H_7
const CODE_RE = /^\d{2}[MN]\.\d\.[A-Z]+\.TZ\d[A-Z]?\.\w+_\d+$/;
const CODE_TOKEN_RE = /(\d{2}[MN]\.\d\.[A-Z]+\.TZ\d[A-Z]?\.\w+_\d+)/;

function extractCodeToken(name: string): string | null {
  const trimmed = name.trim();
  if (CODE_RE.test(trimmed)) return trimmed;
  const m = trimmed.match(CODE_TOKEN_RE);
  return m ? m[1] : null;
}

type DriveDoc = { id: string; name: string };

function pickBestCandidate(code: string, candidates: DriveDoc[], avoidId?: string): DriveDoc | undefined {
  if (candidates.length === 0) return undefined;

  const unique: DriveDoc[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    unique.push(c);
  }

  // Prefer exact filename matches over token matches embedded in longer names.
  const exact = unique.filter((c) => c.name.trim() === code);
  const pool = exact.length > 0 ? exact : unique;

  if (avoidId && pool.length > 1) {
    const alternative = pool.find((c) => c.id !== avoidId);
    if (alternative) return alternative;
  }

  return pool[0];
}

function getAuthedClient(token: Record<string, unknown>) {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials(token);
  return oauth2;
}

/**
 * POST /api/admin/sync-drive-docs
 *
 * Searches Google Drive for all Docs whose titles match the IB question code
 * pattern, then updates ib_questions.google_doc_id / google_ms_id where they
 * are currently NULL.
 *
 * Body (all optional):
 *   questionFolderId?: string   – restrict question doc search to this folder
 *   msFolderId?:       string   – restrict mark-scheme doc search to this folder
 *   dryRun?:           boolean  – if true, return what would be updated without writing
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

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

    const body = (await request.json().catch(() => ({}))) as {
      dryRun?: boolean;
      force?: boolean;
    };
    const { dryRun = false, force = false } = body;

    const auth = getAuthedClient(token);
    const drive = google.drive({ version: "v3", auth });

    async function listDriveFilesWithRetry(
      params: drive_v3.Params$Resource$Files$List,
      attempt = 0
    ) {
      try {
        return await drive.files.list(params);
      } catch (error) {
        const status =
          (error as { response?: { status?: number } })?.response?.status;
        const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
        if (retryable && attempt < 4) {
          const backoffMs = 400 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          return listDriveFilesWithRetry(params, attempt + 1);
        }
        throw error;
      }
    }

    const { data: questions, error: qErr } = await supabase
      .from("ib_questions")
      .select("id, code, google_doc_id, google_ms_id");

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
    if (!questions?.length) {
      return NextResponse.json({ error: "No questions in database" }, { status: 404 });
    }

    const needsUpdate = new Map<string, { id: string; needsDoc: boolean; needsMs: boolean }>();
    for (const q of questions) {
      const needsDoc = force ? true : !q.google_doc_id;
      const needsMs = force ? true : !q.google_ms_id;
      if (needsDoc || needsMs) {
        needsUpdate.set(q.code, { id: q.id, needsDoc, needsMs });
      }
    }

    if (needsUpdate.size === 0) {
      return NextResponse.json({ message: "All questions already have Google Doc IDs linked", updated: 0 });
    }

    async function getAllSubfolderIds(rootId: string): Promise<string[]> {
      const all: string[] = [rootId];
      const queue: string[] = [rootId];
      while (queue.length > 0) {
        const parentId = queue.shift()!;
        let pageToken: string | undefined;
        do {
          const res = await listDriveFilesWithRetry({
            q: `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
            fields: "nextPageToken, files(id)",
            pageSize: 1000,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          });
          const ids = (res.data.files ?? []).map((f) => f.id).filter((id): id is string => Boolean(id));
          all.push(...ids);
          queue.push(...ids);
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      }
      return all;
    }

    async function searchFolderRecursive(rootFolderId: string): Promise<DriveDoc[]> {
      const folderIds = await getAllSubfolderIds(rootFolderId);
      const results: DriveDoc[] = [];
      const BATCH = 20;
      const PARALLEL_BATCHES = 4;

      for (let i = 0; i < folderIds.length; i += BATCH * PARALLEL_BATCHES) {
        const batchWindow = folderIds.slice(i, i + BATCH * PARALLEL_BATCHES);
        const chunks: string[][] = [];
        for (let j = 0; j < batchWindow.length; j += BATCH) {
          chunks.push(batchWindow.slice(j, j + BATCH));
        }

        const chunkResults = await Promise.all(
          chunks.map(async (chunk) => {
            const found: DriveDoc[] = [];
            const parentClause = chunk.map((id) => `'${id}' in parents`).join(" or ");
            let pageToken: string | undefined;
            do {
              const res = await listDriveFilesWithRetry({
                // IB question docs always contain TZ in the code token, which reduces scan volume.
                q: `mimeType='application/vnd.google-apps.document' and trashed=false and name contains 'TZ' and (${parentClause})`,
                fields: "nextPageToken, files(id, name)",
                pageSize: 1000,
                pageToken,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
              });
              for (const f of res.data.files ?? []) {
                if (f.id && f.name) found.push({ id: f.id, name: f.name });
              }
              pageToken = res.data.nextPageToken ?? undefined;
            } while (pageToken);
            return found;
          })
        );

        for (const found of chunkResults) {
          for (const file of found) {
            results.push(file);
          }
        }
      }

      return results;
    }

    const [qFiles, msFiles] = await Promise.all([
      searchFolderRecursive(QUESTION_FOLDER_ID),
      searchFolderRecursive(MARKSCHEME_FOLDER_ID),
    ]);

    const questionCandidates = new Map<string, DriveDoc[]>();
    const msCandidates = new Map<string, DriveDoc[]>();

    for (const f of qFiles) {
      const code = extractCodeToken(f.name);
      if (code && needsUpdate.get(code)?.needsDoc) {
        const arr = questionCandidates.get(code) ?? [];
        arr.push(f);
        questionCandidates.set(code, arr);
      }
    }
    for (const f of msFiles) {
      const code = extractCodeToken(f.name);
      if (code && needsUpdate.get(code)?.needsMs) {
        const arr = msCandidates.get(code) ?? [];
        arr.push(f);
        msCandidates.set(code, arr);
      }
    }

    const updates: { code: string; docId?: string; msId?: string }[] = [];
    for (const [code] of needsUpdate) {
      const msPick = pickBestCandidate(code, msCandidates.get(code) ?? []);
      const qPick = pickBestCandidate(code, questionCandidates.get(code) ?? [], msPick?.id);
      // Skip if the same doc was picked for both — it means the MS doc is stored
      // in the question folder too; don't overwrite google_doc_id with wrong data.
      const docId = (qPick && qPick.id !== msPick?.id) ? qPick.id : undefined;
      const msId = msPick?.id;
      if (!docId && !msId) continue;
      updates.push({ code, ...(docId ? { docId } : {}), ...(msId ? { msId } : {}) });
    }

    if (!dryRun) {
      for (const u of updates) {
        const patch: Record<string, string> = {};
        if (u.docId) patch.google_doc_id = u.docId;
        if (u.msId) patch.google_ms_id = u.msId;
        const { error } = await supabase.from("ib_questions").update(patch).eq("code", u.code);
        if (error) {
          return NextResponse.json({ error: `Failed updating ${u.code}: ${error.message}` }, { status: 500 });
        }
      }
    }

    return NextResponse.json({
      scanned: needsUpdate.size,
      found: updates.length,
      updated: dryRun ? 0 : updates.length,
      dryRun,
      updates: updates.map((u) => ({
        code: u.code,
        ...(u.docId ? { google_doc_id: u.docId } : {}),
        ...(u.msId ? { google_ms_id: u.msId } : {}),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
