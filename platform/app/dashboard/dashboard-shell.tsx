"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImpersonateMenu } from "./impersonate-menu";
import type { ViewAsOption } from "@/lib/view-as";
import { useSearchParams } from "next/navigation";
import { deriveDashboardView } from "@/lib/dashboard-nav";
import { MandelbrotBg } from "@/components/MandelbrotBg";
import { Logo } from "@/components/brand/Logo";
import {
  DEFAULT_NAV_POSITION,
  NAV_POSITIONS,
  writeNavPositionCookie,
  type NavPosition,
} from "@/lib/nav-position";

interface NavigationItem {
  href: string;
  label: string;
  icon: string;
}

interface DashboardShellProps {
  children: React.ReactNode;
  navigation: NavigationItem[];
  settingsNavigation: NavigationItem[];
  gradebookCourses?: { id: string; name: string }[];
  profile: {
    role: string;
    display_name: string;
    avatar_url: string | null;
  };
  viewAsOptions: ViewAsOption[];
  /** Edge the navigation docks to; the layout reads it from the cookie. */
  navPosition?: NavPosition;
}

const NAV_POSITION_LABEL: Record<NavPosition, string> = {
  left: "Left",
  right: "Right",
  top: "Top",
  bottom: "Bottom",
};

/** A small glyph: a screen outline with a bar on the chosen edge. */
function NavPositionGlyph({ position }: { position: NavPosition }) {
  const bar =
    position === "left"
      ? { x: 2, y: 2, width: 4, height: 12 }
      : position === "right"
        ? { x: 10, y: 2, width: 4, height: 12 }
        : position === "top"
          ? { x: 2, y: 2, width: 12, height: 4 }
          : { x: 2, y: 10, width: 12, height: 4 };
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect {...bar} rx="1" fill="currentColor" />
    </svg>
  );
}

export function DashboardShell({
  children,
  gradebookCourses,
  profile,
  navigation: teacherNavigation,
  settingsNavigation: teacherSettingsNavigation,
  viewAsOptions,
  navPosition: initialNavPosition = DEFAULT_NAV_POSITION,
}: DashboardShellProps) {
  // The viewed student is resolved HERE, on the client, from the URL --
  // not in the layout. A Next layout is not re-rendered when only search
  // params change, so a server-resolved view stayed stale on switch; a
  // client component reading useSearchParams re-renders every time.
  const params = useSearchParams();
  const viewAsId = params.get("viewAs");
  // Swap the whole menu to the student's own while viewing as them, so the
  // preview shows the nav they actually get rather than the teacher's.
  const { viewing, navigation, settingsNavigation } = deriveDashboardView({
    viewAsId,
    options: viewAsOptions,
    teacherNavigation,
    teacherSettingsNavigation,
  });
  // Every sidebar link carries ?viewAs= while impersonating. The view lives
  // in the URL (that is what makes it per-tab), so a link that dropped the
  // param would silently drop the teacher back into their own view
  // mid-navigation.
  const withViewAs = (href: string) =>
    viewAsId ? `${href}${href.includes("?") ? "&" : "?"}viewAs=${viewAsId}` : href;
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHover, setSettingsHover] = useState(false);
  const [gradebookOpen, setGradebookOpen] = useState(false);
  const [navPosition, setNavPosition] = useState<NavPosition>(initialNavPosition);

  // Every way the nav closes goes through here, so the Gradebook submenu is
  // collapsed at the same time and never reopens "for free" the next time
  // the nav shows. (Doing this in an effect keyed on sidebarVisible was the
  // previous shape; a state update inside an effect is a cascading render.)
  const closeSidebar = () => {
    setSidebarVisible(false);
    setGradebookOpen(false);
  };

  useEffect(() => {
    const handleExamBuilderOpen = () => {
      setSidebarVisible(false);
      setGradebookOpen(false);
    };
    window.addEventListener("exam-builder-open", handleExamBuilderOpen);
    return () => {
      window.removeEventListener("exam-builder-open", handleExamBuilderOpen);
    };
  }, []);

  const changeNavPosition = (position: NavPosition) => {
    setNavPosition(position);
    writeNavPositionCookie(position);
    // The rail re-anchors to a different edge; close it so the hover strip
    // there is what the user meets next, not a panel hanging mid-move.
    setSettingsOpen(false);
    setSettingsHover(false);
    closeSidebar();
  };

  // ---- Geometry per edge ---------------------------------------------------
  // The navigation is an overlay anchored to one screen edge: a 6px hover
  // strip that expands into the panel. <main> never reflows for it, which is
  // what lets the edge be a preference rather than a layout change.
  const vertical = navPosition === "left" || navPosition === "right";
  const zoneClass = {
    left: "left-0 top-0 h-full flex-row",
    right: "right-0 top-0 h-full flex-row-reverse",
    top: "top-0 left-0 w-full flex-col",
    bottom: "bottom-0 left-0 w-full flex-col-reverse",
  }[navPosition];
  const zoneStyle: React.CSSProperties = vertical
    ? { width: sidebarVisible ? "16rem" : "6px" }
    : { height: sidebarVisible ? "auto" : "6px" };
  // Border on the side that faces the content.
  const innerEdgeBorder = {
    left: "border-r",
    right: "border-l",
    top: "border-b",
    bottom: "border-t",
  }[navPosition];
  const asideOpenClass = vertical ? "w-64 opacity-100" : "w-full max-h-[70vh] opacity-100";
  const asideClosedClass = vertical ? "w-0 opacity-0" : "w-full max-h-0 opacity-0";
  // Settings popover: opens away from the edge, aligned to the rail's end.
  // In a side rail it is positioned inside the rail, which is tall enough to
  // hold it. In a top or bottom bar it would be clipped by the bar's own
  // overflow (the bar is only a few rows high and must clip to animate
  // closed), so there it is positioned against the viewport instead, from
  // the Settings control's measured box. It stays a DOM child of that
  // control, so hovering into it keeps the hover state alive.
  const settingsPopoverClass = {
    left: "absolute bottom-full left-0 w-64 rounded-t-xl",
    right: "absolute bottom-full right-0 w-64 rounded-t-xl",
    top: "fixed w-72 rounded-b-xl",
    bottom: "fixed w-72 rounded-t-xl",
  }[navPosition];
  const settingsRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const settingsShown = settingsOpen || settingsHover;
  // Measured at the moment the popover is opened (from the hover and click
  // handlers below), never from an effect: the bar is fully open whenever a
  // user can reach the Settings control, so the box is stable by then.
  const placePopover = () => {
    if (vertical || !settingsRef.current) return;
    const rect = settingsRef.current.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right);
    setPopoverStyle(
      navPosition === "top"
        ? { top: rect.bottom, right }
        : { bottom: window.innerHeight - rect.top, right },
    );
  };

  const navLinkClass =
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-da-text/80 transition-colors hover:bg-da-hover hover:text-da-accent";

  return (
    <div
      className="relative flex min-h-screen bg-da-bg"
      style={{
        ["--exam-builder-width" as string]: "28rem",
      }}
    >
      {/* Full-page subtle psychedelic background behind main content.
       *
       * FIXED, not absolute (2026-08-20): MandelbrotBg's own wrapper is
       * `position: absolute; inset: 0`, which anchors it to THIS div's own
       * box - and this div is only `min-h-screen` tall, i.e. exactly one
       * viewport, while <main>'s actual content routinely runs much longer.
       * Once a page is scrolled past that first viewport, this decorative
       * layer had already scrolled out of view, leaving raw, un-backgrounded
       * body underneath - which any `fixed` modal opened at that scroll
       * position (e.g. ContinuityDigestModal) would then render its
       * semi-transparent backdrop over, producing an unreadable panel with
       * page content bleeding through. `position: fixed` on this wrapping
       * div makes it track the viewport rather than the page, so it is
       * present and correct behind a fixed modal at any scroll position.
       * pointer-events: none preserves click-through to the real page
       * content, matching MandelbrotBg's own inner pointerEvents: "none". */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <MandelbrotBg subtle />
      </div>

      {/* Hover zone: thin strip on the chosen edge that expands into the nav */}
      <div
        className={`fixed z-40 flex ${zoneClass}`}
        style={zoneStyle}
        onMouseEnter={() => setSidebarVisible(true)}
        onMouseLeave={closeSidebar}
        data-nav-position={navPosition}
      >
        {/* Strip indicator, visible only when the nav is hidden */}
        {!sidebarVisible && (
          <div
            className={`w-full h-full bg-da-surface hover:bg-da-hover ${innerEdgeBorder} border-da-accent/30 hover:border-da-accent/60 transition-colors cursor-pointer`}
          />
        )}

        {/* Navigation panel */}
        <aside
          className={`wood-surface relative flex ${vertical ? "h-full flex-col" : "flex-row items-stretch"} ${innerEdgeBorder} border-da-border shadow-xl shadow-black/60 transition-all duration-200 overflow-hidden ${
            sidebarVisible ? asideOpenClass : asideClosedClass
          }`}
          style={{ backgroundColor: "var(--color-da-surface)" }}
        >
          <MandelbrotBg />

          {/* Brand. Sized by the width it may take, so the wordmark is always
              whole: 16rem rail minus 1rem padding each side. */}
          <div
            className={`relative z-10 flex items-center border-da-border px-4 ${
              vertical ? "h-16 border-b" : "h-14 border-r shrink-0"
            }`}
          >
            <Link href="/dashboard" className="text-da-accent" aria-label="CleverMathematics dashboard">
              <Logo width={vertical ? 224 : 196} variant="embossed" />
            </Link>
          </div>

          <nav
            className={`relative z-10 flex-1 ${
              vertical ? "space-y-1 px-3 py-4 overflow-y-auto" : "flex flex-row flex-wrap items-center gap-1 px-3 py-2"
            }`}
          >
            {navigation.map((item) => {
              const isGradebook =
                item.label === "Gradebook" &&
                gradebookCourses &&
                gradebookCourses.length > 0;

              if (isGradebook) {
                return (
                  <div key={item.href} className={vertical ? "" : "flex flex-wrap items-center gap-1"}>
                    <div className="flex items-center rounded-lg text-sm font-medium text-da-text/80 transition-colors hover:bg-da-hover hover:text-da-accent">
                      <Link
                        href={withViewAs(item.href)}
                        className="flex flex-1 items-center gap-3 px-3 py-2"
                      >
                        <span>{item.icon}</span>
                        {item.label}
                      </Link>
                      <button
                        type="button"
                        onClick={() => setGradebookOpen((v) => !v)}
                        aria-expanded={gradebookOpen}
                        aria-controls={`gradebook-submenu-${item.href}`}
                        className="px-3 py-2 text-xs text-da-muted/60 hover:text-da-accent"
                      >
                        {gradebookOpen ? "▾" : "▸"}
                      </button>
                    </div>
                    {gradebookOpen && (
                      <div
                        id={`gradebook-submenu-${item.href}`}
                        className={
                          vertical
                            ? "ml-4 mt-0.5 space-y-0.5 border-l border-da-border pl-3 pb-1"
                            : "flex flex-wrap items-center gap-1 border-l border-da-border pl-2"
                        }
                      >
                        {gradebookCourses!.map((course) => (
                          <Link
                            key={course.id}
                            href={withViewAs(`/dashboard/gradebook/${course.id}`)}
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-da-text/70 transition-colors hover:bg-da-hover hover:text-da-accent"
                          >
                            <span className="text-[10px] text-da-muted">📋</span>
                            {course.name}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <Link key={item.href} href={withViewAs(item.href)} className={navLinkClass}>
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Settings section */}
          <div
            ref={settingsRef}
            className={`relative z-10 border-da-border shrink-0 ${vertical ? "border-t" : "border-l flex items-center"}`}
            onMouseEnter={() => {
              placePopover();
              setSettingsHover(true);
              setSettingsOpen(true);
            }}
            onMouseLeave={() => {
              setSettingsHover(false);
              setSettingsOpen(false);
            }}
            style={vertical ? { minHeight: "6rem" } : undefined}
          >
            <button
              type="button"
              onClick={() => {
                placePopover();
                setSettingsOpen((v) => !v);
              }}
              className={`flex items-center justify-between text-sm font-semibold text-da-muted hover:bg-da-hover transition-colors ${
                vertical ? "w-full px-6 py-6" : "h-full gap-3 px-5"
              }`}
              style={vertical ? { minHeight: "6rem" } : undefined}
              aria-expanded={settingsOpen || settingsHover}
            >
              <span className="flex items-center gap-2">
                <span>⚙️</span> Settings
              </span>
              <span className="text-xs opacity-60">
                {navPosition === "top" ? (settingsOpen ? "▲" : "▼") : settingsOpen ? "▼" : "▲"}
              </span>
            </button>

            {settingsShown && (
              <div
                className={`overflow-hidden ${settingsPopoverClass} border border-da-border shadow-lg shadow-black/40 px-3 pb-2 pt-1 space-y-0.5 z-50 transition-all duration-200`}
                style={{ backgroundColor: "var(--color-da-surface)", ...(vertical ? {} : popoverStyle) }}
              >
                <MandelbrotBg />
                <div className="relative z-10">
                  {settingsNavigation.map((item) => (
                    <Link key={item.href} href={withViewAs(item.href)} className={navLinkClass}>
                      <span>{item.icon}</span>
                      {item.label}
                    </Link>
                  ))}

                  {/* Where the navigation docks. A device preference, kept in a
                      cookie so the next page renders on the chosen edge. */}
                  <div className="pt-2 border-t border-da-border mt-1 px-3 pb-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-da-muted">
                      Navigation position
                    </p>
                    <div
                      role="radiogroup"
                      aria-label="Navigation position"
                      className="mt-1.5 grid grid-cols-4 gap-1"
                    >
                      {NAV_POSITIONS.map((position) => {
                        const active = position === navPosition;
                        return (
                          <button
                            key={position}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => changeNavPosition(position)}
                            className={`flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[11px] font-medium transition-colors ${
                              active
                                ? "border-da-accent/50 bg-da-accent/20 text-da-accent"
                                : "border-da-border text-da-muted hover:bg-da-hover hover:text-da-text"
                            }`}
                          >
                            <NavPositionGlyph position={position} />
                            {NAV_POSITION_LABEL[position]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-da-border mt-1">
                    <ImpersonateMenu
                      currentRole={profile.role}
                      viewingName={viewing?.name ?? null}
                      viewingCourse={viewing?.courseName ?? null}
                      viewingHasAccount={viewing?.hasAccount ?? false}
                      options={viewAsOptions}
                    />
                    <div className="flex items-center gap-3 px-3 py-2">
                      {profile.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={profile.avatar_url} alt="" className="h-7 w-7 rounded-full" />
                      ) : (
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-da-accent/20 text-sm font-medium text-da-accent">
                          {profile.display_name?.[0]?.toUpperCase() ?? "?"}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-da-text">{profile.display_name}</p>
                        <p className="truncate text-xs text-da-muted capitalize">
                          {viewing
                            ? `Teacher (viewing: ${viewing.name})`
                            : viewAsId
                              ? `Teacher (viewing a student)`
                              : profile.role}
                        </p>
                      </div>
                    </div>
                    <form action="/auth/signout" method="POST" className="px-3 pb-1">
                      <button
                        type="submit"
                        className="w-full rounded-lg border border-da-border px-3 py-1.5 text-sm text-da-muted transition-colors hover:bg-da-hover hover:text-da-text"
                      >
                        Sign out
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <main className="flex-1 min-w-0 p-8 text-da-text">{children}</main>
    </div>
  );
}
