"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ImpersonateMenu } from "./impersonate-menu";
import type { ViewAsOption } from "@/lib/view-as";
import { useSearchParams } from "next/navigation";
import { deriveDashboardView } from "@/lib/dashboard-nav";
import { MandelbrotBg } from "@/components/MandelbrotBg";
import { Logo } from "@/components/brand/Logo";

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
}

export function DashboardShell({
  children,
  gradebookCourses,
  profile,
  navigation: teacherNavigation,
  settingsNavigation: teacherSettingsNavigation,
  viewAsOptions,
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

  useEffect(() => {
    const handleExamBuilderOpen = () => setSidebarVisible(false);
    window.addEventListener("exam-builder-open", handleExamBuilderOpen);
    return () => {
      window.removeEventListener("exam-builder-open", handleExamBuilderOpen);
    };
  }, []);

  // Collapse the Gradebook submenu whenever the sidebar itself closes,
  // so it doesn't reopen "for free" the next time the sidebar shows.
  useEffect(() => {
    if (!sidebarVisible) setGradebookOpen(false);
  }, [sidebarVisible]);

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
       * box — and this div is only `min-h-screen` tall, i.e. exactly one
       * viewport, while <main>'s actual content routinely runs much longer.
       * Once a page is scrolled past that first viewport, this decorative
       * layer had already scrolled out of view, leaving raw, un-backgrounded
       * body underneath — which any `fixed` modal opened at that scroll
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
      {/* Hover zone: thin strip that expands into the sidebar */}
      <div
        className="fixed left-0 top-0 h-full z-40 flex"
        style={{ width: sidebarVisible ? "16rem" : "6px" }}
        onMouseEnter={() => setSidebarVisible(true)}
        onMouseLeave={() => setSidebarVisible(false)}
      >
        {/* Strip indicator, visible only when sidebar is hidden */}
        {!sidebarVisible && (
          <div className="w-full h-full bg-da-surface hover:bg-da-hover border-r border-da-accent/30 hover:border-da-accent/60 transition-colors cursor-pointer" />
        )}

        {/* Sidebar panel */}
        <aside
          className={`wood-surface relative left-0 top-0 h-full flex flex-col border-r border-da-border shadow-xl shadow-black/60 transition-all duration-200 overflow-hidden ${
            sidebarVisible ? "w-64 opacity-100" : "w-0 opacity-0"
          }`}
          style={{ backgroundColor: "var(--color-da-surface)" }}
        >
          <MandelbrotBg />
          <div className="relative z-10 flex h-16 items-center border-b border-da-border px-6">
            <Link href="/dashboard" className="text-da-accent" aria-label="CleverMathematics dashboard">
              <Logo size={30} variant="embossed" />
            </Link>
          </div>

        <nav className="relative z-10 flex-1 space-y-1 px-3 py-4 overflow-y-auto">
          {navigation.map((item) => {
            const isGradebook =
              item.label === "Gradebook" &&
              gradebookCourses &&
              gradebookCourses.length > 0;

            if (isGradebook) {
              return (
                <div key={item.href}>
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
                      className="ml-4 mt-0.5 space-y-0.5 border-l border-da-border pl-3 pb-1"
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
              <Link
                key={item.href}
                href={withViewAs(item.href)}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-da-text/80 transition-colors hover:bg-da-hover hover:text-da-accent"
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Settings section */}
        <div
          className="relative z-10 border-t border-da-border shrink-0"
          onMouseEnter={() => {
            setSettingsHover(true);
            setSettingsOpen(true);
          }}
          onMouseLeave={() => {
            setSettingsHover(false);
            setSettingsOpen(false);
          }}
          style={{ minHeight: '6rem' }} // double the height (was ~3rem)
        >
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-6 py-6 text-sm font-semibold text-da-muted hover:bg-da-hover transition-colors" // double py-3 to py-6
            style={{ minHeight: '6rem' }}
          >
            <span className="flex items-center gap-2">
              <span>⚙️</span> Settings
            </span>
            <span className="text-xs opacity-60">{settingsOpen ? "▲" : "▼"}</span>
          </button>

          {(settingsOpen || settingsHover) && (
            <div
              className="absolute overflow-hidden bottom-full left-0 w-64 border border-da-border rounded-t-xl shadow-lg shadow-black/40 px-3 pb-2 pt-1 space-y-0.5 z-50 transition-all duration-200"
              style={{ minHeight: '16rem', height: 'auto', backgroundColor: 'var(--color-da-surface)' }} // double the height
            >
              <MandelbrotBg />
              <div className="relative z-10">
              {settingsNavigation.map((item) => (
                <Link
                  key={item.href}
                  href={withViewAs(item.href)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-da-text/80 transition-colors hover:bg-da-hover hover:text-da-accent"
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              ))}

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
              </div>{/* end z-10 wrapper */}
            </div>
          )}
        </div>
        </aside>
      </div>

      <main className="flex-1 min-w-0 p-8 text-da-text">{children}</main>
    </div>
  );
}
