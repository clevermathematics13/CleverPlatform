"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PdfUpload } from "@/lib/reflection-types";

interface UploadSectionProps {
  studentId: string;
  testId: string;
  existingUpload: PdfUpload | null;
}

export function UploadSection({
  studentId,
  testId,
  existingUpload,
}: UploadSectionProps) {
  const [upload, setUpload] = useState<PdfUpload | null>(existingUpload);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please select a PDF file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const supabase = createClient();
      const storagePath = `${studentId}/${testId}/${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("corrections")
        .upload(storagePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Upsert the record
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
      setUpload(data as PdfUpload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Upload Corrections</h3>
      <p className="text-sm text-gray-600">
        Upload a PDF of your corrections for the questions you got wrong.
      </p>

      {upload && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm text-green-800">
            ✅ Uploaded: <strong>{upload.file_name}</strong>
            {upload.file_size && (
              <span className="ml-2 text-green-600">
                ({(upload.file_size / 1024).toFixed(0)} KB)
              </span>
            )}
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="text-sm"
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : upload ? "Replace" : "Upload"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
