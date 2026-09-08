/**
 * Mirroring a PowerSchool export into the teacher's Google Drive.
 *
 * The file already lives in the powerschool-exports bucket and is served from
 * there. This puts a copy where the teacher already looks, so the current
 * scores file is in Drive without anyone opening the app.
 *
 * ## One file, many versions
 *
 * The obvious implementation uploads a new file each time and leaves the
 * folder holding 9C_Form1_7.csv, 9C_Form1_8.csv, 9C_Form1_9.csv -- three names
 * for the same thing, the newest not obviously the newest. Instead the Drive
 * file id is remembered and the SAME file is updated, which is what Drive's
 * own revision history is for: one file per class and assessment, with every
 * rebuild kept behind File > Version history. The name is rewritten on each
 * sync so it still carries the current completion count.
 *
 * ## Whose Drive
 *
 * The teacher's, named explicitly. This runs from a student's submit and from
 * background rebuilds, so there is no signed-in teacher to infer it from --
 * resolving the token from the request would find the student's Google
 * connection, which is to say none.
 *
 * ## Never fatal
 *
 * Google being unreachable, the token having expired, the folder having been
 * deleted -- none of that should cost the teacher the file. Every failure is
 * caught, described, and returned for storage in
 * powerschool_export_files.drive_error, where the gradebook shows it. The
 * export itself is complete either way.
 */

import { google } from "googleapis";
import { Readable } from "node:stream";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDriveAuthClientFor, getDriveWriteStatusFor } from "@/lib/google-drive";

export type DriveMirrorResult =
  | { ok: true; fileId: string }
  | { ok: false; error: string };

/** The CSV as a stream, which is what the Drive client wants for media. */
function body(csv: string): Readable {
  return Readable.from([Buffer.from(csv, "utf8")]);
}

/**
 * Put this content in Drive, as a new file or a new revision of an existing
 * one. `existingFileId` is what was written last time, or null the first time.
 *
 * A stored id that no longer resolves -- the teacher deleted the file, or
 * emptied the folder -- is not an error worth surfacing: the update comes back
 * 404, and we create a fresh file and return its id, so the next sync is
 * normal again.
 */
export async function mirrorExportToDrive(opts: {
  /** Service-role client: this runs where nobody relevant is signed in. */
  supabase: SupabaseClient;
  /** The teacher whose Drive and whose token. */
  teacherId: string;
  folderId: string;
  filename: string;
  csv: string;
  existingFileId: string | null;
}): Promise<DriveMirrorResult> {
  const { supabase, teacherId, folderId, filename, csv, existingFileId } = opts;

  try {
    const write = await getDriveWriteStatusFor(supabase, teacherId);
    if (!write.connected) {
      return { ok: false, error: "Google Drive is not connected." };
    }
    if (write.missingScopes.length > 0) {
      return {
        ok: false,
        error:
          "The Drive connection is read-only. Reconnect Google Drive to let the app write these files.",
      };
    }

    const auth = await getDriveAuthClientFor(supabase, teacherId);
    if (!auth) return { ok: false, error: "Google Drive is not connected." };
    const drive = google.drive({ version: "v3", auth });

    if (existingFileId) {
      try {
        const updated = await drive.files.update({
          fileId: existingFileId,
          // Renamed as well as rewritten: the count in the name moves.
          requestBody: { name: filename },
          media: { mimeType: "text/csv", body: body(csv) },
          fields: "id",
        });
        const id = updated.data.id;
        if (id) return { ok: true, fileId: id };
      } catch (e) {
        // Anything other than "that file is gone" is a real failure.
        if (!isNotFound(e)) throw e;
      }
    }

    const created = await drive.files.create({
      requestBody: { name: filename, parents: [folderId], mimeType: "text/csv" },
      media: { mimeType: "text/csv", body: body(csv) },
      fields: "id",
    });
    const id = created.data.id;
    if (!id) return { ok: false, error: "Drive accepted the file but returned no id." };
    return { ok: true, fileId: id };
  } catch (e) {
    return { ok: false, error: describeDriveError(e) };
  }
}

function isNotFound(e: unknown): boolean {
  const status = (e as { code?: number; status?: number } | null)?.code ??
    (e as { status?: number } | null)?.status;
  return status === 404;
}

/**
 * What went wrong, in words the teacher can act on. The raw Google error is a
 * wall of JSON, and the two failures that actually happen -- the token has
 * lost its grant, and the folder is gone -- both have a specific fix.
 */
function describeDriveError(e: unknown): string {
  const status = (e as { code?: number; status?: number } | null)?.code ??
    (e as { status?: number } | null)?.status;
  const message = e instanceof Error ? e.message : String(e);

  if (status === 401) return "Google Drive rejected the sign-in. Reconnect Google Drive.";
  if (status === 403) {
    return `Google Drive refused the write (${message}). Reconnect Google Drive to grant write access.`;
  }
  if (status === 404) {
    return "The Drive folder no longer exists. Set a new folder for PowerSchool exports.";
  }
  return `Drive sync failed: ${message}`;
}


/**
 * Put a one-off file in the same folder -- the zip of a download batch.
 *
 * Unlike the per-class CSVs this always creates rather than updates: each
 * batch is a record of what was taken at one moment, not a living document, so
 * they accumulate deliberately and each carries its own timestamp in the name.
 */
export async function uploadFileToDrive(opts: {
  supabase: SupabaseClient;
  teacherId: string;
  folderId: string;
  filename: string;
  mimeType: string;
  content: Uint8Array;
}): Promise<DriveMirrorResult> {
  const { supabase, teacherId, folderId, filename, mimeType, content } = opts;
  try {
    const write = await getDriveWriteStatusFor(supabase, teacherId);
    if (!write.connected) return { ok: false, error: "Google Drive is not connected." };
    if (write.missingScopes.length > 0) {
      return {
        ok: false,
        error:
          "The Drive connection is read-only. Reconnect Google Drive to let the app write these files.",
      };
    }
    const auth = await getDriveAuthClientFor(supabase, teacherId);
    if (!auth) return { ok: false, error: "Google Drive is not connected." };

    const created = await google.drive({ version: "v3", auth }).files.create({
      requestBody: { name: filename, parents: [folderId], mimeType },
      media: { mimeType, body: Readable.from([Buffer.from(content)]) },
      fields: "id",
    });
    const id = created.data.id;
    if (!id) return { ok: false, error: "Drive accepted the file but returned no id." };
    return { ok: true, fileId: id };
  } catch (e) {
    return { ok: false, error: describeDriveError(e) };
  }
}
