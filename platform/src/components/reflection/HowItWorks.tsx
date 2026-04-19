"use client";

import { useState } from "react";

export function HowItWorks() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-sm font-semibold text-blue-800">
          📘 How It Works
        </h3>
        <span className="text-blue-600">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ol className="mt-3 space-y-2 text-sm text-blue-900">
          <li>
            <strong>Step 1 — Self-Grade:</strong> Go through each question and
            enter the marks you think you earned, based on the mark scheme.
          </li>
          <li>
            <strong>Step 2 — Compare:</strong> See your self-assessment
            side-by-side with your teacher&apos;s marks. Identify where your
            understanding differs.
          </li>
          <li>
            <strong>Step 3 — Upload Corrections:</strong> Upload a PDF of your
            corrections for any questions you got wrong.
          </li>
          <li>
            <strong>Step 4 — Done!</strong> Your reflection is complete. Check
            the Mastery page to see your progress over time.
          </li>
        </ol>
      )}
    </div>
  );
}
