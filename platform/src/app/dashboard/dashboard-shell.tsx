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
  profile: {
    role: string;
    display_name: string;
    avatar_url: string | null;
  };
  impersonating: string | null;
}

export function DashboardShell({
  children,
  navigation,
  profile,
  impersonating,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    setSidebarOpen(desktopQuery.matches);

    const handleViewportChange = (event: MediaQueryListEvent) => {
      setSidebarOpen(event.matches);
    };

    desktopQuery.addEventListener("change", handleViewportChange);
    return () => desktopQuery.removeEventListener("change", handleViewportChange);
  }, []);

  return (
    <div
      className="relative flex min-h-screen bg-gray-50"
      style={{
        ["--exam-builder-width" as string]: sidebarOpen ? "20rem" : "28rem",
      }}
    >
      <aside
        className={`z-20 flex shrink-0 flex-col border-r border-gray-200 bg-white transition-all duration-200 ${
          sidebarOpen ? "w-64" : "w-0 overflow-hidden border-r-0"
        }`}
      >
        <div className="flex h-16 items-center border-b border-gray-200 px-6">
          <Link href="/dashboard" className="text-xl font-bold text-gray-900">
            CleverPlatform
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
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

        <div className="border-t border-gray-200 p-4">
          <ImpersonateMenu
            currentRole={profile.role}
            impersonating={impersonating}
          />
          <div className="flex items-center gap-3">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-8 w-8 rounded-full"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-700">
                {profile.display_name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">
                {profile.display_name}
              </p>
              <p className="truncate text-xs text-gray-500 capitalize">
                {impersonating ? `Teacher (as ${impersonating})` : profile.role}
              </p>
            </div>
          </div>
          <form action="/auth/signout" method="POST" className="mt-3">
            <button
              type="submit"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <button
        type="button"
        onClick={() => setSidebarOpen((v) => !v)}
        className={`absolute top-6 z-30 rounded-full border border-gray-300 bg-transparent px-2 py-1 text-sm text-gray-700 shadow-sm transition-all hover:bg-gray-100 ${
          sidebarOpen ? "left-[15.25rem]" : "left-3"
        }`}
        aria-label={sidebarOpen ? "Hide menu" : "Show menu"}
        title={sidebarOpen ? "Hide menu" : "Show menu"}
      >
        {sidebarOpen ? "←" : "→"}
      </button>

      <main className="flex-1 min-w-0 p-8">{children}</main>
    </div>
  );
}