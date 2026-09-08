"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type DriveStatus = {
  /** A Google token exists for this teacher. */
  connected: boolean;
  email: string | null;
  /** ...and it carries the scope the PowerSchool mirror needs to write. */
  canWrite: boolean;
  /** No refresh token: the connection cannot renew itself and will lapse. */
  fragile: boolean;
};

const card =
  "rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface";

export function SettingsClient({
  initialShowHiddenStudents,
  drive,
  initialDriveFolderId,
  exportOwnerEmail,
}: {
  initialShowHiddenStudents: boolean;
  drive: DriveStatus;
  initialDriveFolderId: string;
  /** Set only when the PowerSchool exports belong to a DIFFERENT account than
   *  the one signed in -- then this card is not the connection they use. */
  exportOwnerEmail: string | null;
}) {
  const router = useRouter();
  const [showHiddenStudents, setShowHiddenStudents] = useState(initialShowHiddenStudents);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [folderId, setFolderId] = useState(initialDriveFolderId);
  const [savedFolderId, setSavedFolderId] = useState(initialDriveFolderId);
  const [savingFolder, setSavingFolder] = useState(false);
  const [folderNote, setFolderNote] = useState<string | null>(null);

  async function toggle() {
    const next = !showHiddenStudents;
    setShowHiddenStudents(next);
    setSaving(true);
    setError(null);
    const res = await fetch("/api/teacher-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ show_hidden_students: next }),
    });
    setSaving(false);
    if (!res.ok) {
      setShowHiddenStudents(!next);
      setError("Could not save this setting.");
      return;
    }
    router.refresh();
  }

  async function saveFolder() {
    setSavingFolder(true);
    setFolderNote(null);
    const res = await fetch("/api/teacher-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ powerschool_drive_folder_id: folderId }),
    });
    setSavingFolder(false);
    if (!res.ok) {
      setFolderNote("Could not save the folder.");
      return;
    }
    const data = (await res.json()) as { powerschool_drive_folder_id: string | null };
    const stored = data.powerschool_drive_folder_id ?? "";
    setFolderId(stored);
    setSavedFolderId(stored);
    setFolderNote(stored ? "Saved." : "Saved — the Drive copy is now off.");
    router.refresh();
  }

  // Three states worth telling apart, because the fix differs.
  const driveState = !drive.connected
    ? "none"
    : drive.canWrite
      ? "full"
      : "read-only";

  return (
    <div className="space-y-6">
      {/* -- Google Drive ------------------------------------------------- */}
      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-da-text">Google Drive</h2>
          <span
            className={
              driveState === "full"
                ? "text-xs font-medium text-green-300"
                : driveState === "read-only"
                  ? "text-xs font-medium text-amber-300"
                  : "text-xs font-medium text-da-muted"
            }
          >
            {driveState === "full"
              ? "Connected"
              : driveState === "read-only"
                ? "Read-only"
                : "Not connected"}
          </span>
        </div>

        {exportOwnerEmail && (
          <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <p className="font-medium text-amber-300">
              This is not the connection the PowerSchool exports use.
            </p>
            <p className="mt-1 leading-snug">
              A Drive connection belongs to the account that made it, and the exports
              use <span className="font-medium">{exportOwnerEmail}</span>&apos;s &mdash;
              the teacher who owns the tests. Connecting or reconnecting here files the
              token against the account you are signed in as now, where the exports
              never look. Sign in as{" "}
              <span className="font-medium">{exportOwnerEmail}</span> to fix that one.
            </p>
          </div>
        )}

        {drive.email && (
          <p className="mt-1 text-xs text-da-muted">
            Connected as <span className="font-medium text-da-text">{drive.email}</span>
          </p>
        )}

        <p className="mt-3 text-sm text-da-muted">
          {driveState === "full" &&
            "Question-bank documents and images can be read, and the PowerSchool scores files are copied into the folder below."}
          {driveState === "read-only" &&
            "Documents and images can be read, but nothing can be written. The PowerSchool scores files stay in the app and report “The Drive connection is read-only” instead of reaching your folder. Reconnecting grants the write access and fixes it."}
          {driveState === "none" &&
            "Not connected yet. Connecting lets the app read question-bank documents and images, and copy the PowerSchool scores files into a folder of your choosing."}
        </p>

        {drive.connected && drive.fragile && (
          <p className="mt-2 text-xs text-amber-300">
            This connection has no refresh token, so it cannot renew itself and will
            eventually lapse. Reconnecting fixes that too.
          </p>
        )}

        <a
          href="/api/questions/connect-drive"
          className={`mt-4 inline-block rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
            driveState === "full"
              ? "border border-da-border text-da-muted hover:bg-da-hover hover:text-da-text"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {drive.connected ? "Reconnect Google Drive" : "Connect Google Drive"}
        </a>

        {/* The folder the PowerSchool exports are mirrored into. Read in two
            places and, until now, settable in none -- it had to be written
            straight into teacher_settings. */}
        <div className="mt-5 border-t border-da-border pt-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-da-muted">
              PowerSchool exports folder
            </span>
            <input
              type="text"
              value={folderId}
              onChange={(e) => {
                setFolderId(e.target.value);
                setFolderNote(null);
              }}
              placeholder="Paste the folder's link or its id"
              className="mt-1 w-full rounded-lg border border-da-border bg-da-bg px-3 py-2 text-sm text-da-text focus:border-da-accent focus:outline-none"
            />
          </label>
          <p className="mt-1 text-xs text-da-muted">
            Open the folder in Drive and paste its address — the id is taken out of it.
            Leave it empty to stop copying the files to Drive; they stay downloadable in
            the app either way.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveFolder}
              disabled={savingFolder || folderId.trim() === savedFolderId.trim()}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${
                !savingFolder && folderId.trim() !== savedFolderId.trim()
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "cursor-not-allowed bg-da-bg text-da-muted"
              }`}
            >
              {savingFolder ? "Saving…" : "Save folder"}
            </button>
            {folderNote && (
              <span role="status" className="text-xs text-da-muted">
                {folderNote}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* -- Preferences --------------------------------------------------- */}
      <div className={card}>
        {error && (
          <div className="mb-3 rounded-lg border border-da-danger/40 bg-da-danger/10 px-3 py-2 text-xs text-da-danger">
            {error}
          </div>
        )}
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span>
            <span className="block font-semibold text-da-text">Show hidden students</span>
            <span className="block text-xs text-da-muted">
              Include hidden roster entries (e.g. test accounts) in student counts and lists
              across the dashboard, gradebook, courses, and parents pages.
            </span>
          </span>
          <input
            type="checkbox"
            checked={showHiddenStudents}
            onChange={toggle}
            disabled={saving}
            className="h-5 w-5 shrink-0 rounded border-da-border text-da-accent focus:ring-da-accent"
          />
        </label>
      </div>
    </div>
  );
}
