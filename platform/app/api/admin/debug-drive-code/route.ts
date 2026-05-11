import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveTokenFromCookie } from "@/lib/google-drive";
import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { filterDocsOutsideFolderTree } from "@/lib/drive-doc-matching";

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

    const body = (await request.json().catch(() => ({}))) as { code?: string };
    const code = (body.code ?? "").trim();
    if (!code) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

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

    async function searchSingleCode(rootFolderId: string) {
      const folderIds = await getAllSubfolderIds(rootFolderId);
      const BATCH = 20;
      const escapedCode = code.replace(/'/g, "\\'");
      const matches: Array<{ id: string; name: string; webViewLink?: string; parents?: string[] }> = [];

      for (let i = 0; i < folderIds.length; i += BATCH) {
        const batch = folderIds.slice(i, i + BATCH);
        const parentClause = batch.map((id) => `'${id}' in parents`).join(" or ");
        let pageToken: string | undefined;
        do {
          const res = await listDriveFilesWithRetry({
            q: `mimeType='application/vnd.google-apps.document' and trashed=false and name contains '${escapedCode}' and (${parentClause})`,
            fields: "nextPageToken, files(id,name,parents,webViewLink)",
            pageSize: 1000,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          });
          for (const f of res.data.files ?? []) {
            if (f.id && f.name) {
              matches.push({
                id: f.id,
                name: f.name,
                webViewLink: f.webViewLink ?? undefined,
                parents: f.parents ?? undefined,
              });
            }
          }
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      }

      return { folderCount: folderIds.length, folderIds, matches };
    }

    const [questionResult, markschemeResult, { data: dbRow }] =
      await Promise.all([
        searchSingleCode(QUESTION_FOLDER_ID),
        searchSingleCode(MARKSCHEME_FOLDER_ID),
        supabase
          .from("ib_questions")
          .select("id, code, google_doc_id, google_ms_id")
          .eq("code", code)
          .maybeSingle(),
      ]);

    const filteredQuestionMatches = filterDocsOutsideFolderTree(questionResult.matches, new Set(markschemeResult.folderIds));

    return NextResponse.json({
      code,
      db: dbRow ?? null,
      questionFolderCount: questionResult.folderCount,
      markschemeFolderCount: markschemeResult.folderCount,
      questionMatches: filteredQuestionMatches,
      markschemeMatches: markschemeResult.matches,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown debug error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
