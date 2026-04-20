import { OAuth2Client } from "google-auth-library";
import { cookies } from "next/headers";

// Drive OAuth is for clevermathematics@gmail.com (owns the question docs).
// Classroom OAuth is for the school account (pcleveng@amersol.edu.pe).
// These are separate Google accounts with separate tokens.

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const COOKIE_NAME = "google-drive-token";

function getOAuth2Client(redirectUri?: string) {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri ?? process.env.GOOGLE_REDIRECT_URI
  );
}

export function getDriveAuthUrl(redirectUri: string) {
  const oauth2Client = getOAuth2Client(redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    login_hint: "clevermathematics@gmail.com",
    state: "google-drive",
  });
}

export async function exchangeDriveCodeForToken(
  code: string,
  redirectUri: string
) {
  const oauth2Client = getOAuth2Client(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function saveDriveTokenToCookie(token: object) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, JSON.stringify(token), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 60 * 60 * 24 * 30, // 30 days (has refresh token)
  });
}

export async function getDriveTokenFromCookie(): Promise<object | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearDriveTokenCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getDriveAccessToken(): Promise<string | null> {
  const token = await getDriveTokenFromCookie();
  if (!token) return null;

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(
    token as Parameters<typeof oauth2Client.setCredentials>[0]
  );

  const { token: accessToken } = await oauth2Client.getAccessToken();
  return accessToken ?? null;
}
