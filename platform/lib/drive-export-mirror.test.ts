import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The mirror kept writing into the Bin, and said it had worked.
 *
 * On 10 Sep 2026 a teacher asked why a student's self-assessment had not
 * produced an updated PowerSchool file in their Drive. It had: the export was
 * rebuilt within minutes of the submit, `drive_error` was null,
 * `drive_synced_at` was fresh, and the gradebook pill read "Google Drive:
 * copied 19:38:03". The file was in the Bin -- all four classes' were, with
 * the folder itself empty -- and had been for two days, quietly taking a new
 * revision on every rebuild.
 *
 * `files.update` on a trashed file returns 200. The recreate path was reached
 * only from a 404, which Drive raises for a permanently deleted file and not
 * for a binned one, so nothing ever noticed. Same shape if the file is moved
 * out of the folder, or the teacher points the setting at a different one.
 *
 * These tests are that gap: the update is only reused for a target that is
 * still untrashed and still in the configured folder.
 */

const files = {
  get: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
};

vi.mock("googleapis", () => ({
  google: { drive: () => ({ files }) },
}));

vi.mock("@/lib/google-drive", () => ({
  getDriveWriteStatusFor: async () => ({ connected: true, missingScopes: [] }),
  getDriveAuthClientFor: async () => ({}),
}));

const { mirrorExportToDrive } = await import("./drive-export-mirror");

const FOLDER = "folder-1";
const EXISTING = "file-1";

function mirror(existingFileId: string | null = EXISTING) {
  return mirrorExportToDrive({
    supabase: {} as SupabaseClient,
    teacherId: "teacher-1",
    folderId: FOLDER,
    filename: "9C_Form1_15.csv",
    csv: "Student Num,Student Name,Score\n30079,Raul SIUCHO,5\n",
    existingFileId,
  });
}

/** A googleapis error carries the HTTP status on `code`. */
function httpError(code: number) {
  return Object.assign(new Error(`status ${code}`), { code });
}

beforeEach(() => {
  files.get.mockReset();
  files.update.mockReset().mockResolvedValue({ data: { id: EXISTING } });
  files.create.mockReset().mockResolvedValue({ data: { id: "file-2" } });
});

describe("mirrorExportToDrive", () => {
  it("updates the stored file when it is untrashed and still in the folder", async () => {
    files.get.mockResolvedValue({ data: { trashed: false, parents: [FOLDER] } });

    await expect(mirror()).resolves.toEqual({ ok: true, fileId: EXISTING });
    expect(files.update).toHaveBeenCalledOnce();
    expect(files.create).not.toHaveBeenCalled();
  });

  // The bug. Drive answers an update on a binned file with 200, so nothing
  // downstream could tell this apart from a delivered export.
  it("creates a fresh file when the stored one is in the Bin", async () => {
    files.get.mockResolvedValue({ data: { trashed: true, parents: [FOLDER] } });

    await expect(mirror()).resolves.toEqual({ ok: true, fileId: "file-2" });
    expect(files.update).not.toHaveBeenCalled();
    expect(files.create).toHaveBeenCalledOnce();
    expect(files.create.mock.calls[0][0].requestBody.parents).toEqual([FOLDER]);
  });

  it("creates a fresh file when the stored one has been moved out of the folder", async () => {
    files.get.mockResolvedValue({ data: { trashed: false, parents: ["somewhere-else"] } });

    await expect(mirror()).resolves.toEqual({ ok: true, fileId: "file-2" });
    expect(files.update).not.toHaveBeenCalled();
    expect(files.create).toHaveBeenCalledOnce();
  });

  it("creates a fresh file when the stored id no longer resolves", async () => {
    files.get.mockRejectedValue(httpError(404));

    await expect(mirror()).resolves.toEqual({ ok: true, fileId: "file-2" });
    expect(files.update).not.toHaveBeenCalled();
    expect(files.create).toHaveBeenCalledOnce();
  });

  it("still creates on a 404 raised by the update itself", async () => {
    files.get.mockResolvedValue({ data: { trashed: false, parents: [FOLDER] } });
    files.update.mockRejectedValue(httpError(404));

    await expect(mirror()).resolves.toEqual({ ok: true, fileId: "file-2" });
    expect(files.create).toHaveBeenCalledOnce();
  });

  it("skips the check entirely on the first sync", async () => {
    await expect(mirror(null)).resolves.toEqual({ ok: true, fileId: "file-2" });
    expect(files.get).not.toHaveBeenCalled();
    expect(files.create).toHaveBeenCalledOnce();
  });

  // A check that cannot be completed is not a licence to bin the stored id --
  // it is a Drive failure, described and stored like any other.
  it("reports a check that fails for any reason other than a missing file", async () => {
    files.get.mockRejectedValue(httpError(401));

    await expect(mirror()).resolves.toEqual({
      ok: false,
      error: "Google Drive rejected the sign-in. Reconnect Google Drive.",
    });
    expect(files.update).not.toHaveBeenCalled();
    expect(files.create).not.toHaveBeenCalled();
  });
});
