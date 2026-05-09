import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveTokenFromCookie } from "@/lib/google-drive";
import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";

const QUESTION_FOLDER_ID = "18vwi-jz_0vur8MjixNnTkKdb0lHygNV3";
const MARKSCHEME_FOLDER_ID = "1GDGql-mIeH2YoD1OfnFa0UhxUdaXsY4D";

type DriveDoc = { id: string; name: string; webViewLink?: string };

function getAuthedClient(token: Record<string, unknown>) {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials(token);
  return oauth2;
}

function pickBestCandidate(code: string, candidates: DriveDoc[], avoidId?: string): DriveDoc | undefined {
  if (candidates.length === 0) return undefined;

  const unique: DriveDoc[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    unique.push(c);
  }

  const exact = unique.filter((c) => c.name.trim() === code);
  const pool = exact.length > 0 ? exact : unique;

  if (avoidId && pool.length > 1) {
    const alternative = pool.find((c) => c.id !== avoidId);
    if (alternative) return alternative;
  }

  return pool[0];
}

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

    const body = (await request.json().catch(() => ({}))) as { code?: string; force?: boolean };
    const code = (body.code ?? "").trim();
    const force = body.force ?? true;
    if (!code) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const { data: existing, error: existingErr } = await supabase
      .from("ib_questions")
      .select("id, code, google_doc_id, google_ms_id")
      .eq("code", code)
      .maybeSingle();

    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
    if (!existing) return NextResponse.json({ error: `Code not found in DB: ${code}` }, { status: 404 });

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
        const retryable =
          status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
        if (retryable && attempt < 4) {
          const backoffMs = 400 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          return listDriveFilesWithRetry(params, attempt + 1);
        }
        throw error;
      }
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
          const ids = (res.data.files ?? [])
            .map((f) => f.id)
            .filter((id): id is string => Boolean(id));
          all.push(...ids);
          queue.push(...ids);
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      }
      return all;
    }

    async function searchSingleCode(rootFolderId: string): Promise<DriveDoc[]> {
      const folderIds = await getAllSubfolderIds(rootFolderId);
      const BATCH = 20;
      const escapedCode = code.replace(/'/g, "\\'");
      const matches: DriveDoc[] = [];

      for (let i = 0; i < folderIds.length; i += BATCH) {
        const batch = folderIds.slice(i, i + BATCH);
        const parentClause = batch.map((id) => `'${id}' in parents`).join(" or ");
        let pageToken: string | undefined;
        do {
          const res = await listDriveFilesWithRetry({
            q: `mimeType='application/vnd.google-apps.document' and trashed=false and name contains '${escapedCode}' and (${parentClause})`,
            fields: "nextPageToken, files(id,name,webViewLink)",
            pageSize: 1000,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          });
          for (const f of res.data.files ?? []) {
            if (f.id && f.name) {
              matches.push({ id: f.id, name: f.name, webViewLink: f.webViewLink ?? undefined });
            }
          }
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      }

      return matches;
    }

    const [questionMatches, markschemeMatches] = await Promise.all([
      searchSingleCode(QUESTION_FOLDER_ID),
      searchSingleCode(MARKSCHEME_FOLDER_ID),
    ]);

    const msPick = pickBestCandidate(code, markschemeMatches);
    const qPick = pickBestCandidate(code, questionMatches, msPick?.id);

    const patch: Record<string, string> = {};
    if (qPick && (force || !existing.google_doc_id)) patch.google_doc_id = qPick.id;
    if (msPick && (force || !existing.google_ms_id)) patch.google_ms_id = msPick.id;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({
        code,
        message: "No updates needed",
        existing,
        questionMatches,
        markschemeMatches,
      });
    }

    const { error: updateErr } = await supabase.from("ib_questions").update(patch).eq("code", code);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    const { data: after, error: afterErr } = await supabase
      .from("ib_questions")
      .select("id, code, google_doc_id, google_ms_id")
      .eq("code", code)
      .maybeSingle();
    if (afterErr) return NextResponse.json({ error: afterErr.message }, { status: 500 });

    return NextResponse.json({
      code,
      updated: patch,
      before: existing,
      after,
      questionMatches,
      markschemeMatches,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
