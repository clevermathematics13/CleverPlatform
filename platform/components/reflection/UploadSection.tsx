"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PdfUpload } from "@/lib/reflection-types";

interface UploadSectionProps {
  studentId: string;
  testId: string;
  existingUpload: PdfUpload | null;
  /** Disagreement % — null means teacher hasn't graded yet */
  disagreement: number | null;
  /** Called after a successful upload or removal so parent can refresh */
  onChangeUpload?: (upload: PdfUpload | null) => void;
}

export function UploadSection({
  studentId,
  testId,
  existingUpload,
  disagreement,
  onChangeUpload,
}: UploadSectionProps) {
  const [upload, setUpload] = useState<PdfUpload | null>(existingUpload);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const isLocked = disagreement === null || disagreement > 0;

  // ── LOCKED STATE ─────────────────────────────────────────────
  if (isLocked && !upload) {
    return (
      <div className="rounded-lg border-2 border-orange-300 bg-orange-50 p-5 space-y-3">
        <p className="font-bold text-orange-800">
          🔒 Upload Locked — Judgement Disagreement Must Reach 0%
        </p>
        {disagreement === null ? (
          <p className="text-sm text-orange-700">
            Your teacher has not yet entered marks. Return here once grading is complete.
          </p>
        ) : (
          <div className="text-sm text-orange-700 space-y-2">
            <p>
              Current disagreement:{" "}
              <strong>{disagreement.toFixed(1)}%</strong>. The upload form
              unlocks only when this reaches exactly 0%.
            </p>
            <p className="font-semibold">Two permitted paths to consensus:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>
                <strong>Lower your &ldquo;Self&rdquo; mark</strong> for any question where
                you accept you over-awarded yourself — edit above and save.
              </li>
              <li>
                <strong>Challenge your teacher&apos;s mark</strong> with your exam
                paper and the official mark scheme — ask your teacher to use the
                override tool.
              </li>
            </ol>
          </div>
        )}
      </div>
    );
  }

  // ── COMPLETED STATE ────────────────────────────────────────
  if (upload) {
    return (
      <div className="rounded-lg border-2 border-green-300 bg-green-50 p-5 space-y-3">
        <h3 className="text-lg font-bold text-green-800">🎉 Corrections Uploaded!</h3>
        <p className="text-sm text-green-700">
          File: <strong>{upload.file_name}</strong>
          {upload.file_size && (
            <span className="ml-2 text-green-600">
              ({(upload.file_size / 1024 / 1024).toFixed(2)} MB)
            </span>
          )}
        </p>
        <button
          type="button"
          disabled={removing}
          onClick={async () => {
            if (
              !confirm(
                "Remove this upload and replace it with a new file? The old file will be deleted."
              )
            )
              return;
            setRemoving(true);
            setError(null);
            try {
              const res = await fetch("/api/reflection/upload", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ studentId, testId }),
              });
              if (!res.ok) throw new Error((await res.json()).error);
              setUpload(null);
              onChangeUpload?.(null);
              if (fileRef.current) fileRef.current.value = "";
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to remove");
            } finally {
              setRemoving(false);
            }
          }}
          className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {removing ? "Removing…" : "🗑 Remove & Re-upload"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  // ── UPLOAD FORM ───────────────────────────────────────────
  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please select a PDF file.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("File must be under 20 MB.");
      return;
    }

    setUploading(true);
    setError(null);
    setProgress(0);

    // Animate progress bar (fake, since Supabase Storage client is sync)
    const interval = setInterval(() => {
      setProgress((p) => (p < 90 ? p + 5 : p));
    }, 300);

    try {
      const supabase = createClient();
      const storagePath = `${studentId}/${testId}/${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("corrections")
        .upload(storagePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data, error: dbError } = await supabase
        .from("pdf_uploads")
        .upsert(
          {
            student_id: studentId,
            test_id: testId,
            storage_path: storagePath,
            file_name: file.name,
            file_size: file.size,
            uploaded_at: new Date().toISOString(),
          },
          { onConflict: "student_id,test_id" }
        )
        .select()
        .single();

      if (dbError) throw dbError;
      clearInterval(interval);
      setProgress(100);
      const newUpload = data as PdfUpload;
      setUpload(newUpload);
      onChangeUpload?.(newUpload);
    } catch (e) {
      clearInterval(interval);
      setProgress(0);
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 p-5 space-y-4">
      <h3 className="text-lg font-semibold text-blue-900">
        📤 Step 3: Upload Corrected Work
      </h3>
      <p className="text-sm text-blue-700">
        Disagreement is <strong>0%</strong> — upload a single PDF of all your
        corrected exam answers.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="text-sm text-gray-700 file:mr-3 file:rounded file:border file:border-blue-400 file:bg-white file:px-3 file:py-1 file:text-sm file:text-blue-700 file:cursor-pointer"
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "🚀 Upload"}
        </button>
      </div>

      {uploading && (
        <div className="space-y-1">
          <div className="h-2.5 w-full rounded-full bg-blue-200">
            <div
              className="h-2.5 rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-blue-600 text-center">{progress}%</p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

