import { classroom_v1, classroom } from "@googleapis/classroom";
import { OAuth2Client } from "google-auth-library";
import { cookies } from "next/headers";

const SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
];

const COOKIE_NAME = "google-classroom-token";

function getOAuth2Client() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl() {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCodeForToken(code: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function saveTokenToCookie(token: object) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, JSON.stringify(token), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export async function getTokenFromCookie(): Promise<object | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearTokenCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getClassroomClient(): Promise<classroom_v1.Classroom | null> {
  const token = await getTokenFromCookie();
  if (!token) return null;

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(token as Parameters<typeof oauth2Client.setCredentials>[0]);
  return classroom({ version: "v1", auth: oauth2Client });
}

export interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
  courseState?: string;
}

export interface ClassroomStudent {
  userId: string;
  fullName: string;
  email: string;
  photoUrl?: string;
}

export async function listCourses(): Promise<ClassroomCourse[]> {
  const classroom = await getClassroomClient();
  if (!classroom) return [];

  const res = await classroom.courses.list({
    teacherId: "me",
    courseStates: ["ACTIVE"],
    pageSize: 50,
  });

  return (res.data.courses ?? []).map((c) => ({
    id: c.id!,
    name: c.name!,
    section: c.section ?? undefined,
    courseState: c.courseState ?? undefined,
  }));
}

export async function listStudentsInCourse(
  courseId: string
): Promise<ClassroomStudent[]> {
  const classroom = await getClassroomClient();
  if (!classroom) return [];

  const students: ClassroomStudent[] = [];
  let pageToken: string | undefined;

  do {
    const res = await classroom.courses.students.list({
      courseId,
      pageSize: 100,
      pageToken,
    });

    for (const s of res.data.students ?? []) {
      if (s.profile?.emailAddress) {
        students.push({
          userId: s.userId!,
          fullName: s.profile.name?.fullName ?? s.profile.emailAddress,
          email: s.profile.emailAddress,
          photoUrl: s.profile.photoUrl ?? undefined,
        });
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return students;
}
