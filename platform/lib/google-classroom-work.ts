import { google, drive_v3 } from "googleapis";
import { classroom_v1, classroom } from "@googleapis/classroom";
import { OAuth2Client } from "google-auth-library";
import { loadToken, saveToken, ClassroomError } from "./google-classroom";

/* -------------------------------------------------------------------------- */
/*  Authorised clients                                                         */
/* -------------------------------------------------------------------------- */

const REFRESH_MARGIN_MS = 120_000;

/**
 * Returns an OAuth2Client carrying the stored Classroom credential, refreshing
 * and persisting it when it is close to expiry.
 *
 * NOTE: google-classroom.ts has an equivalent private helper. That file should
 * eventually import this one so there is a single refresh path; keeping them
 * separate for now avoids rewriting a working module.
 */
export async function getAuthClient(): Promise<OAuth2Client> {
  const token = await loadToken();
  if (!token || (!token.access_token && !token.refresh_token)) {
    throw new ClassroomError(
      "not_connected",
      "Google Classroom is not connected for this account."
    );
  }

  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  client.setCredentials({
    access_token: token.access_token ?? undefined,
    refresh_token: token.refresh_token ?? undefined,
    scope: token.scope ?? undefined,
    token_type: token.token_type ?? undefined,
    expiry_date: token.expiry_date ?? undefined,
  });

  client.on("tokens", (fresh) => {
    void saveToken(fresh).catch(() => undefined);
  });

  const stale =
    !token.expiry_date || token.expiry_date - Date.now() < REFRESH_MARGIN_MS;

  if (stale) {
    if (!token.refresh_token) {
      throw new ClassroomError(
        "reauth_required",
        "Access token expired and no refresh token is stored. Reconnect Google Classroom."
      );
    }
    try {
      await client.getAccessToken();
      await saveToken(client.credentials);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/invalid_grant|unauthorized_client|invalid_client/i.test(message)) {
        throw new ClassroomError(
          "reauth_required",
          "Google revoked this authorisation. Reconnect Google Classroom."
        );
      }
      throw new ClassroomError("upstream_error", message);
    }
  }

  return client;
}

async function api(): Promise<classroom_v1.Classroom> {
  return classroom({ version: "v1", auth: await getAuthClient() });
}

async function driveApi(): Promise<drive_v3.Drive> {
  return google.drive({ version: "v3", auth: await getAuthClient() });
}

/* -------------------------------------------------------------------------- */
/*  Coursework                                                                 */
/* -------------------------------------------------------------------------- */

export interface CourseWorkItem {
  id: string;
  title: string;
  description?: string;
  maxPoints?: number;
  workType?: string;
  state?: string;
  dueDate?: string;
  alternateLink?: string;
  creationTime?: string;
}

function formatDue(cw: classroom_v1.Schema$CourseWork): string | undefined {
  const d = cw.dueDate;
  if (!d?.year || !d.month || !d.day) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = cw.dueTime?.hours != null
    ? ` ${pad(cw.dueTime.hours)}:${pad(cw.dueTime.minutes ?? 0)}`
    : "";
  return `${d.year}-${pad(d.month)}-${pad(d.day)}${time}`;
}

export async function listCourseWork(
  courseId: string
): Promise<CourseWorkItem[]> {
  const cls = await api();
  const out: CourseWorkItem[] = [];
  let pageToken: string | undefined;

  do {
    const res = await cls.courses.courseWork.list({
      courseId,
      pageSize: 100,
      pageToken,
      orderBy: "updateTime desc",
    });
    for (const cw of res.data.courseWork ?? []) {
      if (!cw.id || !cw.title) continue;
      out.push({
        id: cw.id,
        title: cw.title,
        description: cw.description ?? undefined,
        maxPoints: cw.maxPoints ?? undefined,
        workType: cw.workType ?? undefined,
        state: cw.state ?? undefined,
        dueDate: formatDue(cw),
        alternateLink: cw.alternateLink ?? undefined,
        creationTime: cw.creationTime ?? undefined,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return out;
}

/* -------------------------------------------------------------------------- */
/*  Student submissions                                                        */
/* -------------------------------------------------------------------------- */

export interface SubmissionAttachment {
  driveFileId: string;
  title: string;
  alternateLink?: string;
  thumbnailUrl?: string;
}

export interface SubmissionItem {
  id: string;
  userId: string;
  state?: string;
  late: boolean;
  assignedGrade?: number;
  draftGrade?: number;
  alternateLink?: string;
  updateTime?: string;
  attachments: SubmissionAttachment[];
}

export async function listSubmissions(
  courseId: string,
  courseWorkId: string
): Promise<SubmissionItem[]> {
  const cls = await api();
  const out: SubmissionItem[] = [];
  let pageToken: string | undefined;

  do {
    const res = await cls.courses.courseWork.studentSubmissions.list({
      courseId,
      courseWorkId,
      pageSize: 100,
      pageToken,
    });

    for (const s of res.data.studentSubmissions ?? []) {
      if (!s.id || !s.userId) continue;
      const attachments: SubmissionAttachment[] = [];
      for (const att of s.assignmentSubmission?.attachments ?? []) {
        const f = att.driveFile;
        if (f?.id) {
          attachments.push({
            driveFileId: f.id,
            title: f.title ?? "Untitled",
            alternateLink: f.alternateLink ?? undefined,
            thumbnailUrl: f.thumbnailUrl ?? undefined,
          });
        }
      }
      out.push({
        id: s.id,
        userId: s.userId,
        state: s.state ?? undefined,
        late: Boolean(s.late),
        assignedGrade: s.assignedGrade ?? undefined,
        draftGrade: s.draftGrade ?? undefined,
        alternateLink: s.alternateLink ?? undefined,
        updateTime: s.updateTime ?? undefined,
        attachments,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return out;
}

/* -------------------------------------------------------------------------- */
/*  Attachment download                                                        */
/* -------------------------------------------------------------------------- */

export type VisionKind = "image" | "pdf" | "unsupported";

export interface FetchedAttachment {
  fileId: string;
  name: string;
  mimeType: string;
  kind: VisionKind;
  /** base64 payload, ready for the Anthropic API. Empty when unsupported. */
  base64: string;
  sizeBytes: number;
}

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function classify(mimeType: string): VisionKind {
  if (IMAGE_TYPES.has(mimeType)) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return "unsupported";
}

/**
 * Downloads a submitted Drive file as base64. Native Google formats (Docs,
 * Slides) are exported to PDF first, since Claude cannot read them directly.
 * Requires drive.readonly, which the teacher already holds over files students
 * have turned in.
 */
export async function fetchAttachment(
  fileId: string
): Promise<FetchedAttachment> {
  const drive = await driveApi();

  const meta = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, size",
    supportsAllDrives: true,
  });

  const name = meta.data.name ?? "Untitled";
  const sourceType = meta.data.mimeType ?? "application/octet-stream";

  // Google-native formats must be exported.
  if (sourceType.startsWith("application/vnd.google-apps.")) {
    const exportable =
      sourceType === "application/vnd.google-apps.document" ||
      sourceType === "application/vnd.google-apps.presentation" ||
      sourceType === "application/vnd.google-apps.drawing" ||
      sourceType === "application/vnd.google-apps.spreadsheet";

    if (!exportable) {
      return {
        fileId,
        name,
        mimeType: sourceType,
        kind: "unsupported",
        base64: "",
        sizeBytes: 0,
      };
    }

    const res = await drive.files.export(
      { fileId, mimeType: "application/pdf" },
      { responseType: "arraybuffer" }
    );
    const buf = Buffer.from(res.data as ArrayBuffer);
    return {
      fileId,
      name,
      mimeType: "application/pdf",
      kind: "pdf",
      base64: buf.toString("base64"),
      sizeBytes: buf.byteLength,
    };
  }

  const kind = classify(sourceType);
  if (kind === "unsupported") {
    return {
      fileId,
      name,
      mimeType: sourceType,
      kind,
      base64: "",
      sizeBytes: Number(meta.data.size ?? 0),
    };
  }

  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  const buf = Buffer.from(res.data as ArrayBuffer);

  return {
    fileId,
    name,
    mimeType: sourceType,
    kind,
    base64: buf.toString("base64"),
    sizeBytes: buf.byteLength,
  };
}

/* -------------------------------------------------------------------------- */
/*  Grade writeback                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Writes Clev's Marks back to a submission. draftGrade is visible only to the
 * teacher; assignedGrade is what the student sees, and only after the work is
 * returned in Classroom.
 */
export async function setSubmissionGrade(
  courseId: string,
  courseWorkId: string,
  submissionId: string,
  grades: { draftGrade?: number; assignedGrade?: number }
): Promise<void> {
  const cls = await api();
  const fields: string[] = [];
  if (grades.draftGrade !== undefined) fields.push("draftGrade");
  if (grades.assignedGrade !== undefined) fields.push("assignedGrade");
  if (fields.length === 0) return;

  await cls.courses.courseWork.studentSubmissions.patch({
    courseId,
    courseWorkId,
    id: submissionId,
    updateMask: fields.join(","),
    requestBody: grades,
  });
}
