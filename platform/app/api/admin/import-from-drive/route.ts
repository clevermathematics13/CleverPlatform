import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { getDriveTokenFromCookie } from "@/lib/google-drive";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { extractCodeToken, filterDocsOutsideFolderTree } from "@/lib/drive-doc-matching";

export const maxDuration = 300;

const QUESTION_FOLDER_ID = "18vwi-jz_0vur8MjixNnTkKdb0lHygNV3";
const MARKSCHEME_FOLDER_ID = "1GDGql-mIeH2YoD1OfnFa0UhxUdaXsY4D";

function parseCodeParts(code: string): { session: string; paper: number; level: string; timezone: string } | null {
  const parts = code.split(".");
  if (parts.length < 5) return null;
  const session = parts[0] as string;
  const paper = parseInt(parts[1] as string, 10);
  const level = parts[2] as string;
  const timezone = parts[3] as string;
  if (isNaN(paper)) return null;
  return { session, paper, level, timezone };
}

function getAuthedClient(token: Record<string, unknown>) {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials(token);
  return oauth2;
}

type DriveFile = { id: string; name: string; parents?: string[] };

export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";

  const token = await getDriveTokenFromCookie();
  if (!token) return NextResponse.json({ error: "Google Drive not connected" }, { status: 401 });

  const drive = google.drive({ version: "v3", auth: getAuthedClient(token as Record<string, unknown>) });

  // Fetch ALL existing rows with pagination (Supabase default limit is 1000)
  const allExisting: { id: string; code: string; google_doc_id: string | null; google_ms_id: string | null }[] = [];
  const PAGE_SIZE = 1000;
  let from = 0;
  while (true) {
    const qRes = await supabase
      .from("ib_questions")
      .select("id, code, google_doc_id, google_ms_id")
      .range(from, from + PAGE_SIZE - 1);
    if (qRes.error) return NextResponse.json({ error: qRes.error.message }, { status: 500 });
    const page = qRes.data ?? [];
    if (page.length === 0) break;
    allExisting.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const existingMap = new Map<string, { id: string; hasDocId: boolean; hasMsId: boolean }>(
    allExisting.map((r) => [r.code, { id: r.id, hasDocId: !!r.google_doc_id, hasMsId: !!r.google_ms_id }])
  );

  async function getAllSubfolderIds(rootId: string): Promise<string[]> {
    const all: string[] = [rootId];
    const queue: string[] = [rootId];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
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

  async function listAllDocs(folderIds: string[]): Promise<DriveFile[]> {
    const results: DriveFile[] = [];
    const BATCH = 20;
    for (let i = 0; i < folderIds.length; i += BATCH) {
      const chunk = folderIds.slice(i, i + BATCH);
      const parentClause = chunk.map((id) => `'${id}' in parents`).join(" or ");
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          // No name filter — pick up everything, parse code from name
          q: `mimeType='application/vnd.google-apps.document' and trashed=false and (${parentClause})`,
          fields: "nextPageToken, files(id, name, parents)",
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        for (const f of res.data.files ?? []) {
          if (f.id && f.name) results.push({ id: f.id, name: f.name });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    }
    return results;
  }

  // BFS both trees
  const [qFolderIds, msFolderIds] = await Promise.all([
    getAllSubfolderIds(QUESTION_FOLDER_ID),
    getAllSubfolderIds(MARKSCHEME_FOLDER_ID),
  ]);
  const [qFiles, msFiles] = await Promise.all([
    listAllDocs(qFolderIds),
    listAllDocs(msFolderIds),
  ]);

  // code → doc id maps
  const qMap = new Map<string, string>();
  const qFilesFiltered = filterDocsOutsideFolderTree(qFiles, new Set(msFolderIds));

  for (const f of qFilesFiltered) {
    const code = extractCodeToken(f.name);
    if (code !== null && !qMap.has(code)) qMap.set(code, f.id);
  }
  const msMap = new Map<string, string>();
  for (const f of msFiles) {
    const code = extractCodeToken(f.name);
    if (code !== null && !msMap.has(code)) msMap.set(code, f.id);
  }
  // If the same doc ID appears in both maps for the same code (markscheme doc
  // is stored in both folders), clear the question entry — it's wrong.
  for (const [code, qId] of qMap) {
    if (msMap.get(code) === qId) qMap.delete(code);
  }

  const allDriveCodes = new Set([...qMap.keys(), ...msMap.keys()]);

  const toCreate: { code: string; session: string; paper: number; level: string; timezone: string; google_doc_id: string | null; google_ms_id: string | null }[] = [];
  const toUpdate: { id: string; code: string; google_doc_id?: string; google_ms_id?: string }[] = [];

  for (const code of allDriveCodes) {
    const row = existingMap.get(code);
    if (row) {
      const patch: { google_doc_id?: string; google_ms_id?: string } = {};
      if (!row.hasDocId && qMap.has(code)) patch.google_doc_id = qMap.get(code)!;
      if (!row.hasMsId && msMap.has(code)) patch.google_ms_id = msMap.get(code)!;
      if (Object.keys(patch).length > 0) toUpdate.push({ id: row.id, code, ...patch });
    } else {
      const parsed = parseCodeParts(code);
      if (!parsed) continue;
      toCreate.push({ code, ...parsed, google_doc_id: qMap.get(code) ?? null, google_ms_id: msMap.get(code) ?? null });
    }
  }

  toCreate.sort((a, b) => a.code.localeCompare(b.code));

  // Always-returned debug info
  const debugInfo = {
    qFoldersScanned: qFolderIds.length,
    msFoldersScanned: msFolderIds.length,
    qDocsFound: qFiles.length,
    msDocsFound: msFiles.length,
    qCodesParsed: qMap.size,
    msCodesParsed: msMap.size,
    totalDriveCodes: allDriveCodes.size,
    existingInDb: allExisting.length,
    willCreate: toCreate.length,
    willUpdate: toUpdate.length,
    createCodes: toCreate.map((r) => r.code).slice(0, 30),
    updateCodes: toUpdate.map((r) => r.code).slice(0, 30),
    unparsedSample: [
      ...qFiles.filter((f) => !extractCodeToken(f.name)).map((f) => f.name),
      ...msFiles.filter((f) => !extractCodeToken(f.name)).map((f) => f.name),
    ].slice(0, 15),
    matches25N: [
      ...qFiles.filter((f) => f.name.includes("25N")).map((f) => `Q: ${f.name}`),
      ...msFiles.filter((f) => f.name.includes("25N")).map((f) => `MS: ${f.name}`),
    ].slice(0, 20),
  };

  if (dryRun) return NextResponse.json({ dryRun: true, debug: debugInfo });

  let created = 0;
  const errors: string[] = [];

  for (let i = 0; i < toCreate.length; i += 50) {
    const batch = toCreate.slice(i, i + 50).map((r) => ({
      code: r.code, session: r.session, paper: r.paper, level: r.level, timezone: r.timezone,
      curriculum: ["AA"], source_pdf_path: "drive-import",
      google_doc_id: r.google_doc_id, google_ms_id: r.google_ms_id,
    }));
    const insertRes = await supabase
      .from("ib_questions")
      .upsert(batch, { onConflict: "code", ignoreDuplicates: true })
      .select("id");
    if (insertRes.error) errors.push(`INSERT: ${insertRes.error.message}`);
    else created += (insertRes.data ?? []).length;
  }

  let updated = 0;
  for (const u of toUpdate) {
    const patch: Record<string, string> = {};
    if (u.google_doc_id) patch.google_doc_id = u.google_doc_id!;
    if (u.google_ms_id) patch.google_ms_id = u.google_ms_id!;
    const updateRes = await supabase.from("ib_questions").update(patch).eq("id", u.id);
    if (updateRes.error) errors.push(`UPDATE ${u.code}: ${updateRes.error.message}`);
    else updated++;
  }

  return NextResponse.json({ created, updated, errors: errors.length > 0 ? errors : undefined, debug: debugInfo });
}
