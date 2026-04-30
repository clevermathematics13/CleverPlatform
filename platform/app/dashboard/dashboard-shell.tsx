"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ImpersonateMenu } from "./impersonate-menu";

interface NavigationItem {
  href: string;
  label: string;
  icon: string;
}

interface DashboardShellProps {
  children: React.ReactNode;
  navigation: NavigationItem[];
  settingsNavigation: NavigationItem[];
  profile: {
    role: string;
    display_name: string;
    avatar_url: string | null;
  };
  impersonating: string | null;
  impersonatedStudentName?: string | null;
}

export function DashboardShell({
  children,
  navigation,
  settingsNavigation,
  profile,
  impersonating,
  impersonatedStudentName,
}: DashboardShellProps) {
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHover, setSettingsHover] = useState(false);

  useEffect(() => {
    const handleExamBuilderOpen = () => setSidebarVisible(false);
    window.addEventListener("exam-builder-open", handleExamBuilderOpen);
    return () => {
      window.removeEventListener("exam-builder-open", handleExamBuilderOpen);
    };
  }, []);

  return (
    <div
      className="relative flex min-h-screen bg-gray-50"
      style={{
        ["--exam-builder-width" as string]: "28rem",
      }}
    >
      {/* Hover zone: thin strip that expands into the sidebar */}
      <div
        className="fixed left-0 top-0 h-full z-40 flex"
        style={{ width: sidebarVisible ? "16rem" : "6px" }}
        onMouseEnter={() => setSidebarVisible(true)}
        onMouseLeave={() => setSidebarVisible(false)}
      >
        {/* Strip indicator, visible only when sidebar is hidden */}
        {!sidebarVisible && (
          <div className="w-full h-full bg-gray-300/40 hover:bg-blue-400/40 transition-colors cursor-pointer" />
        )}

        {/* Sidebar panel */}
        <aside
          className={`absolute left-0 top-0 h-full flex flex-col border-r border-gray-200 bg-white shadow-xl transition-all duration-200 overflow-hidden ${
            sidebarVisible ? "w-64 opacity-100" : "w-0 opacity-0"
          }`}
        >
        <div className="flex h-16 items-center border-b border-gray-200 px-6">
          <Link href="/dashboard" className="text-xl font-bold text-gray-900">
            CleverPlatform
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Settings section */}
        <div
          className="relative border-t border-gray-200 flex-shrink-0"
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
            className="flex w-full items-center justify-between px-6 py-6 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors" // double py-3 to py-6
            style={{ minHeight: '6rem' }}
          >
            <span className="flex items-center gap-2">
              <span>⚙️</span> Settings
            </span>
            <span className="text-xs opacity-60">{settingsOpen ? "▲" : "▼"}</span>
          </button>

          {(settingsOpen || settingsHover) && (
            <div
              className="absolute bottom-full left-0 w-64 border border-gray-200 rounded-t-xl bg-white shadow-lg px-3 pb-2 pt-1 space-y-0.5 z-50 transition-all duration-200"
              style={{ minHeight: '16rem', height: 'auto' }} // double the height
            >
              {settingsNavigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              ))}

              <div className="pt-2 border-t border-gray-200 mt-1">
                <ImpersonateMenu
                  currentRole={profile.role}
                  impersonating={impersonating}
                  impersonatedStudentName={impersonatedStudentName ?? null}
                />
                <div className="flex items-center gap-3 px-3 py-2">
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="h-7 w-7 rounded-full" />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-700">
                      {profile.display_name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{profile.display_name}</p>
                    <p className="truncate text-xs text-gray-500 capitalize">
                      {impersonating && impersonatedStudentName
                        ? `Teacher (viewing: ${impersonatedStudentName})`
                        : impersonating
                        ? `Teacher (as ${impersonating})`
                        : profile.role}
                    </p>
                  </div>
                </div>
                <form action="/auth/signout" method="POST" className="px-3 pb-1">
                  <button
                    type="submit"
                    className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
        </aside>
      </div>

      <main className="flex-1 min-w-0 p-8">{children}</main>
    </div>
  );
}