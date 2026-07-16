/**
 * POST /api/assignments/fetch-drive-pdf
 *
 * Fetches a PDF from Google Drive server-side and uploads it to Supabase
 * Storage, returning a storage path rather than raw base64. Returning base64
 * directly in the JSON response used to work for small files, but Vercel
 * serverless functions cap response bodies at ~4.5 MB same as request bodies
 * (see platform/app/api/claude/route.ts) — a large Drive PDF would have
 * failed silently past that size. Storing it server-side and handing back a
 * path keeps the response tiny regardless of file size.
 *
 * Body: { fileId: string }
 *   fileId – Google Drive file ID, or a full Drive URL (we parse the ID out).
 *
 * Returns: { path: string; name: string; sizeMb: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { getDriveTokenFromCookie } from "@/lib/google-drive";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPLOADS_BUCKET = "uploads";

function getAuthedClient(token: Record<string, unknown>) {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials(token);
  return oauth2;
}

/**
 * Extract a Drive file ID from a URL or return the raw ID string unchanged.
 * Handles:
 *   https://drive.google.com/file/d/<ID>/view
 *   https://drive.google.com/open?id=<ID>
 *   https://docs.google.com/...
 *   Plain IDs
 */
function parseFileId(input: string): string | null {
  const trimmed = input.trim();

  // Match /d/<ID>/ pattern (Drive file URLs and Docs URLs)
  const slashD = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (slashD) return slashD[1]!;

  // Match ?id=<ID> or &id=<ID>
  const queryId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryId) return queryId[1]!;

  // If it looks like a plain file ID (no slashes, no spaces, reasonable length)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;

  return null;
}

/** Keep storage paths predictable and safe: strip anything that isn't
 *  alphanumeric, dot, dash, or underscore. */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const { supabase, user } = auth;

    const token = (await getDriveTokenFromCookie()) as Record<string, unknown> | null;
    if (!token) {
      return NextResponse.json(
        { error: "Google Drive is not connected. Go to Settings → Connectors to connect it." },
        { status: 401 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as { fileId?: string };
    const rawInput = (body.fileId ?? "").trim();
    if (!rawInput) {
      return NextResponse.json({ error: "fileId is required" }, { status: 400 });
    }

    const fileId = parseFileId(rawInput);
    if (!fileId) {
      return NextResponse.json(
        { error: "Could not parse a valid Drive file ID from the provided URL or ID." },
        { status: 400 }
      );
    }

    const driveAuth = getAuthedClient(token);
    const drive = google.drive({ version: "v3", auth: driveAuth });

    // 1. Fetch file metadata to get the name and confirm it’s a PDF
    const metaRes = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, size",
      supportsAllDrives: true,
    });

    const meta = metaRes.data;
    const mimeType = meta.mimeType ?? "";
    const fileName = meta.name ?? "document.pdf";

    if (mimeType !== "application/pdf") {
      return NextResponse.json(
        {
          error: `The file "${fileName}" is not a PDF (detected: ${mimeType}). Please share a PDF file.`,
        },
        { status: 422 }
      );
    }

    const sizeBytes = parseInt(meta.size ?? "0", 10);
    const sizeMb = sizeBytes / (1024 * 1024);

    // 2. Download the file content
    const downloadRes = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );

    const buffer = Buffer.from(downloadRes.data as ArrayBuffer);

    // 3. Upload to Supabase Storage under the same convention the client-side
    //    attach flow uses, so /api/claude resolves either path identically.
    const storagePath = `activity-generator/${user.id}/${Date.now()}-${sanitizeFileName(fileName)}`;
    const { error: uploadError } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

    if (uploadError) {
      return NextResponse.json(
        { error: `Fetched the file from Drive but could not stage it: ${uploadError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { path: storagePath, name: fileName, sizeMb: Math.round(sizeMb * 10) / 10 },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Drive fetch failed";

    // Surface Drive 403 / 404 clearly
    const status =
      (err as { response?: { status?: number } })?.response?.status;

    if (status === 404) {
      return NextResponse.json(
        { error: "File not found. Make sure the file exists and is shared with your Google account." },
        { status: 404 }
      );
    }
    if (status === 403) {
      return NextResponse.json(
        { error: "Access denied. Make sure the file is shared with your Google account." },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
