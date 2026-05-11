import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveTokenFromCookie } from "@/lib/google-drive";
import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import {
  extractCodeToken,
  filterDocsOutsideFolderTree,
  pickBestCandidate,
  type DriveDoc,
} from "@/lib/drive-doc-matching";

export const maxDuration = 300;
const QUESTION_FOLDER_ID = "18vwi-jz_0vur8MjixNnTkKdb0lHygNV3";
const MARKSCHEME_FOLDER_ID = "1GDGql-mIeH2YoD1OfnFa0UhxUdaXsY4D";

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
      focusCode?: string;
      focusQuestionId?: string;
    };
    const { dryRun = false, force = false } = body;
    const focusCode = body.focusCode?.trim() || null;
    const focusQuestionId = body.focusQuestionId?.trim() || null;

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

    const PAGE_SIZE = 1000;
    const questions: Array<{ id: string; code: string; google_doc_id: string | null; google_ms_id: string | null }> = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: batch, error: qErr } = await supabase
        .from("ib_questions")
        .select("id, code, google_doc_id, google_ms_id")
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
      if (!batch || batch.length === 0) break;
      questions.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }

    if (!questions.length) {
      return NextResponse.json({ error: "No questions in database" }, { status: 404 });
    }

    // Debug: Log focus parameters and what we find
    if (focusQuestionId) {
      console.log(`[SYNC FOCUS DEBUG] Looking for question ID: ${focusQuestionId}`);
      console.log(`[SYNC FOCUS DEBUG] Total questions loaded: ${questions.length}`);
      const match = questions.find((q) => q.id === focusQuestionId);
      if (match) {
        console.log(`[SYNC FOCUS DEBUG] ✓ Found question by ID: ${match.code}`);
      } else {
        console.log(`[SYNC FOCUS DEBUG] ✗ Question ID not found`);
        console.log(
          `[SYNC FOCUS DEBUG] First 3 IDs in DB: ${questions
            .slice(0, 3)
            .map((q) => q.id)
            .join(", ")}`
        );
      }
    }

    const needsUpdate = new Map<string, { id: string; needsDoc: boolean; needsMs: boolean }>();
    const existingByCode = new Map(
      questions.map((q) => [q.code, { google_doc_id: q.google_doc_id, google_ms_id: q.google_ms_id }])
    );
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

    async function searchFolderRecursive(rootFolderId: string): Promise<{ folderIds: string[]; files: DriveDoc[] }> {
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
                fields: "nextPageToken, files(id, name, parents)",
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

      return { folderIds, files: results };
    }

    const [qResult, msResult] = await Promise.all([
      searchFolderRecursive(QUESTION_FOLDER_ID),
      searchFolderRecursive(MARKSCHEME_FOLDER_ID),
    ]);

    const questionCandidates = new Map<string, DriveDoc[]>();
    const msCandidates = new Map<string, DriveDoc[]>();

    const qFilesFiltered = filterDocsOutsideFolderTree(qResult.files, new Set(msResult.folderIds));

    for (const f of qFilesFiltered) {
      const code = extractCodeToken(f.name);
      if (code && needsUpdate.get(code)?.needsDoc) {
        const arr = questionCandidates.get(code) ?? [];
        arr.push(f);
        questionCandidates.set(code, arr);
      }
    }
    for (const f of msResult.files) {
      const code = extractCodeToken(f.name);
      if (code && needsUpdate.get(code)?.needsMs) {
        const arr = msCandidates.get(code) ?? [];
        arr.push(f);
        msCandidates.set(code, arr);
      }
    }

    const updates: { code: string; docId?: string; msId?: string }[] = [];
    for (const [code] of needsUpdate) {
      const existing = existingByCode.get(code);
      const msPick = pickBestCandidate(code, msCandidates.get(code) ?? []);
      const avoidId = msPick?.id ?? existing?.google_ms_id ?? undefined;
      const qPick = pickBestCandidate(code, questionCandidates.get(code) ?? [], avoidId);
      // Skip if the same doc was picked for both — it means the MS doc is stored
      // in the question folder too; don't overwrite google_doc_id with wrong data.
      const docId = (qPick && qPick.id !== msPick?.id) ? qPick.id : undefined;
      const msId = msPick?.id;
      if (!docId && !msId) continue;
      updates.push({ code, ...(docId ? { docId } : {}), ...(msId ? { msId } : {}) });
    }

    const normalizeCode = (value: string) => value.trim().replace(/\s+/g, "").toUpperCase();
    const focusedQuestion =
      focusQuestionId
        ? questions.find((question) => question.id === focusQuestionId) ?? null
        : focusCode
          ? questions.find((question) => normalizeCode(question.code) === normalizeCode(focusCode)) ?? null
          : null;

    // Debug: Log focus lookup results
    if (focusCode || focusQuestionId) {
      if (focusQuestionId) {
        console.log(`[SYNC FOCUS LOOKUP] ID lookup for ${focusQuestionId}: ${focusedQuestion ? "✓ found" : "✗ not found"}`);
      }
      if (!focusedQuestion && focusCode) {
        console.log(`[SYNC FOCUS LOOKUP] Code fallback for "${focusCode}": normalized="${normalizeCode(focusCode)}"`);
        const codeMatch = questions.find((q) => normalizeCode(q.code) === normalizeCode(focusCode));
        console.log(`[SYNC FOCUS LOOKUP] Code lookup result: ${codeMatch ? `✓ found (id=${codeMatch.id})` : "✗ not found"}`);
      }
      console.log(`[SYNC FOCUS LOOKUP] Final: focusedQuestion=${focusedQuestion ? "found" : "null"}, code=${focusCode}, qId=${focusQuestionId}`);
    }

    const focusedCode = focusedQuestion?.code ?? focusCode;
    const focusedNeed = focusedCode ? needsUpdate.get(focusedCode) ?? null : null;
    const focusedQuestionMatches = focusedCode ? questionCandidates.get(focusedCode) ?? [] : [];
    const focusedMarkschemeMatches = focusedCode ? msCandidates.get(focusedCode) ?? [] : [];
    const focusedMsPick = focusedCode
      ? pickBestCandidate(focusedCode, focusedMarkschemeMatches)
      : undefined;
    const focusedExisting = focusedCode ? existingByCode.get(focusedCode) : undefined;
    const focusedAvoidId = focusedMsPick?.id ?? focusedExisting?.google_ms_id ?? undefined;
    const focusedQPick = focusedCode
      ? pickBestCandidate(focusedCode, focusedQuestionMatches, focusedAvoidId)
      : undefined;
    const focusedUpdate = focusedCode
      ? updates.find((update) => update.code === focusedCode) ?? null
      : null;

    let focusedStatus: string | null = null;
    if (focusCode || focusQuestionId) {
      if (!focusedQuestion) {
        focusedStatus = "code_not_in_db";
      } else if (!focusedNeed) {
        focusedStatus = "already_linked_no_force";
      } else if (focusedUpdate) {
        focusedStatus = dryRun ? "would_update" : "updated";
      } else if (focusedNeed.needsDoc && focusedQuestionMatches.length === 0) {
        focusedStatus = "no_question_doc_match_found";
      } else if (focusedNeed.needsMs && focusedMarkschemeMatches.length === 0) {
        focusedStatus = "no_markscheme_doc_match_found";
      } else if (focusedNeed.needsDoc && focusedMsPick && focusedQPick?.id === focusedMsPick.id) {
        focusedStatus = "question_match_conflicted_with_markscheme_match";
      } else {
        focusedStatus = "no_update_generated";
      }
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

    // Build debug info for focus lookups
    const focusDebug =
      focusCode || focusQuestionId
        ? {
            totalQuestionsLoaded: questions.length,
            focusRequestedQuestionId: focusQuestionId,
            focusRequestedCode: focusCode,
            idLookupResult: focusQuestionId
              ? questions.find((q) => q.id === focusQuestionId)
                ? "found"
                : "not_found"
              : "not_attempted",
            codeLookupResult: focusCode && !focusedQuestion
              ? questions.find(
                  (q) =>
                    q.code
                      .trim()
                      .replace(/\s+/g, "")
                      .toUpperCase() ===
                    focusCode
                      .trim()
                      .replace(/\s+/g, "")
                      .toUpperCase()
                )
                ? "found"
                : "not_found"
              : "not_attempted",
            finalLookupResult: focusedQuestion ? "found" : "not_found",
            sampleIds: questions.slice(0, 3).map((q) => q.id),
            // NEW: Also return questions with matching code (loose search) to help debug
            codesContaining25M: questions
              .filter((q) => q.code.includes("25M"))
              .slice(0, 5)
              .map((q) => ({ id: q.id, code: q.code })),
            // NEW: Also search for exact H_6 pattern to see if it exists anywhere
            codesContainingH6: questions
              .filter((q) => q.code.includes("H_6"))
              .slice(0, 5)
              .map((q) => ({ id: q.id, code: q.code })),
          }
        : undefined;

    return NextResponse.json({
      scanned: needsUpdate.size,
      found: updates.length,
      updated: dryRun ? 0 : updates.length,
      dryRun,
      ...(focusCode || focusQuestionId
        ? {
            focused: {
              code: focusedCode,
              status: focusedStatus,
              requestedFocus: {
                code: focusCode,
                questionId: focusQuestionId,
              },
              db: focusedQuestion
                ? {
                    id: focusedQuestion.id,
                    google_doc_id: focusedQuestion.google_doc_id,
                    google_ms_id: focusedQuestion.google_ms_id,
                  }
                : null,
              needs: focusedNeed
                ? {
                    doc: focusedNeed.needsDoc,
                    ms: focusedNeed.needsMs,
                  }
                : null,
              questionMatchCount: focusedQuestionMatches.length,
              markschemeMatchCount: focusedMarkschemeMatches.length,
              selectedQuestionDocId: focusedQPick?.id ?? null,
              selectedMarkschemeDocId: focusedMsPick?.id ?? null,
              questionMatches: focusedQuestionMatches.slice(0, 5).map((match) => ({
                id: match.id,
                name: match.name,
              })),
              markschemeMatches: focusedMarkschemeMatches.slice(0, 5).map((match) => ({
                id: match.id,
                name: match.name,
              })),
              _debug: focusDebug,
            },
          }
        : {}),
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
