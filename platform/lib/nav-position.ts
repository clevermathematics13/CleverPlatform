/**
 * Which screen edge the dashboard navigation docks to.
 *
 * The choice is a per-browser preference stored in a cookie rather than in
 * the database: it is a device-level ergonomics setting (a wide monitor wants
 * a side rail, a laptop may want a top bar), it must be known BEFORE the
 * first paint so the shell does not render on the left and then jump, and a
 * cookie is the one store both the server layout and the client shell can
 * read. No migration, no round trip.
 */

export const NAV_POSITIONS = ["left", "right", "top", "bottom"] as const;
export type NavPosition = (typeof NAV_POSITIONS)[number];

export const NAV_POSITION_COOKIE = "cp_nav_position";
export const DEFAULT_NAV_POSITION: NavPosition = "left";

export function isNavPosition(value: unknown): value is NavPosition {
  return typeof value === "string" && (NAV_POSITIONS as readonly string[]).includes(value);
}

/** Client-side: persist the choice for a year. */
export function writeNavPositionCookie(position: NavPosition): void {
  document.cookie = `${NAV_POSITION_COOKIE}=${position}; path=/; max-age=31536000; SameSite=Lax`;
}
