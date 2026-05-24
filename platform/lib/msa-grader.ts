/**
 * lib/msa-grader.ts
 *
 * Server-side helper for calling the MSA Grader GAS Web App from Next.js.
 *
 * Configuration (env vars):
 *   MSA_GRADER_URL                – The deployed GAS Web App URL
 *   MSA_GRADER_SERVICE_ACCOUNT_JSON – JSON string of the Google service account
 *                                    (optional; falls back to user OAuth token)
 *
 * The GAS Web App must be deployed with:
 *   Execute as: Me (owner)
 *   Who has access: Anyone with Google Account
 */

import { GoogleAuth } from "google-auth-library";

// ── Types ──────────────────────────────────────────────────────────────────

export interface GraderMarkEntry {
  questionNumber: number | null;
  partLabel: string;
  score: number;
  maxScore: number;
  autoGraded: true;
}

export interface GraderHealthResponse {
  ok: true;
  timestamp: string;
}

export interface GraderGradeResponse {
  ok: true;
  marks: GraderMarkEntry[];
  totalScore: number;
  maxScore: number;
}

// ── Auth ───────────────────────────────────────────────────────────────────

let _auth: GoogleAuth | null = null;

function getGoogleAuth(): GoogleAuth {
  if (_auth) return _auth;

  const saJson = process.env.MSA_GRADER_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    _auth = new GoogleAuth({
      credentials: JSON.parse(saJson),
      scopes: ["https://www.googleapis.com/auth/script.external_request"],
    });
  } else {
    // Application default credentials (works in GCP / local gcloud auth)
    _auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/script.external_request"],
    });
  }

  return _auth;
}

async function getAuthToken(): Promise<string> {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse.token;
  if (!token) throw new Error("Could not obtain Google OAuth token for MSA Grader");
  return token;
}

function getGraderUrl(): string {
  const url = process.env.MSA_GRADER_URL;
  if (!url) throw new Error("MSA_GRADER_URL is not set in environment variables");
  return url;
}

// ── Public helpers ─────────────────────────────────────────────────────────

/**
 * Ping the GAS Web App's health endpoint.
 * Used by GET /api/grader/health.
 */
export async function callGraderHealth(): Promise<GraderHealthResponse> {
  const url = getGraderUrl();
  const token = await getAuthToken();

  const res = await fetch(`${url}?action=health`, {
    headers: { Authorization: `Bearer ${token}` },
    // GAS web apps redirect to login for non-authenticated requests;
    // follow redirects so we reach the actual JSON response.
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`MSA Grader health check failed: HTTP ${res.status}`);
  }

  const json = (await res.json()) as { ok: boolean; timestamp?: string };
  if (!json.ok) throw new Error("MSA Grader health check returned ok=false");
  return json as GraderHealthResponse;
}

/**
 * Call the GAS grading pipeline for a single student's work file.
 * Used by POST /api/grader/grade.
 *
 * @param driveFileId  Google Drive file ID of the student's PDF/image.
 * @param examId       Drive folder ID or question doc ID of the exam
 *                     (used to locate the pre-processed markscheme).
 */
export async function callGradeStudentWork(
  driveFileId: string,
  examId: string
): Promise<GraderGradeResponse> {
  const url = getGraderUrl();
  const token = await getAuthToken();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "gradeStudentWork",
      payload: { driveFileId, examId },
    }),
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`MSA Grader returned HTTP ${res.status}`);
  }

  const json = (await res.json()) as { ok: boolean; error?: string } & Partial<GraderGradeResponse>;
  if (!json.ok) {
    throw new Error(`MSA Grader error: ${json.error ?? "unknown"}`);
  }

  return json as GraderGradeResponse;
}
