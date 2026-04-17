'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { useEffect, useState } from 'react';
import type { UserRole } from '@/types/database';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  { href: '/textbook',    label: 'Textbook',     icon: '📖', roles: ['teacher', 'student', 'admin'] },
  { href: '/assignments', label: 'Assignments',   icon: '📝', roles: ['teacher', 'student', 'admin'] },
  { href: '/questions',   label: 'Question Bank', icon: '❓', roles: ['teacher', 'admin'] },
  { href: '/exams',       label: 'Exams',         icon: '📋', roles: ['teacher', 'admin'] },
  { href: '/grading',     label: 'Grading',       icon: '✏️', roles: ['teacher', 'admin'] },
  { href: '/gradebook',   label: 'Gradebook',     icon: '📊', roles: ['teacher', 'admin'] },
  { href: '/progress',    label: 'My Progress',   icon: '📈', roles: ['student', 'parent', 'teacher', 'admin'] },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('student');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email ?? null);

        // Check role from profiles table
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('email', user.email!)
          .single();

        if (profile) {
          setUserRole(profile.role as UserRole);
        }

        // Admin override for clevermathematics@gmail.com
        if (user.email === 'clevermathematics@gmail.com') {
          setUserRole('admin');
        }
      }
    }
    getUser();
  }, [supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  const visibleNav = navItems.filter((item) => item.roles.includes(userRole));

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Mobile menu toggle */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden p-2 text-slate-500 hover:text-slate-700"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Link href="/" className="text-lg font-bold text-indigo-700">
              CleverPlatform
            </Link>
            <span className="hidden sm:inline text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
              {userRole.toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500 hidden sm:inline">
              {userEmail}
            </span>
            <button
              onClick={handleSignOut}
              className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar Navigation */}
        <aside
          className={`
            fixed md:sticky top-14 left-0 z-40 h-[calc(100vh-3.5rem)] w-56 bg-white border-r border-slate-200
            transform transition-transform md:translate-x-0
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <nav className="p-4 space-y-1">
            {visibleNav.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                    ${isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}
                  `}
                >
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/20 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8 max-w-7xl">
          {children}
        </main>
      </div>
    </div>
  );
}
