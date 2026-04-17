import { createClient } from '@/lib/supabase-server';
export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function DashboardHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">
        Welcome to CleverPlatform
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Quick access cards */}
        <Link
          href="/textbook"
          className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow"
        >
          <div className="text-3xl mb-3">📖</div>
          <h2 className="font-semibold text-slate-900 mb-1">Interactive Textbook</h2>
          <p className="text-sm text-slate-500">
            Explore lessons with interactive checkpoints, hints, and geometry tools.
          </p>
        </Link>

        <Link
          href="/assignments"
          className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow"
        >
          <div className="text-3xl mb-3">📝</div>
          <h2 className="font-semibold text-slate-900 mb-1">Assignments</h2>
          <p className="text-sm text-slate-500">
            View and complete assigned practice questions.
          </p>
        </Link>

        <Link
          href="/progress"
          className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow"
        >
          <div className="text-3xl mb-3">📈</div>
          <h2 className="font-semibold text-slate-900 mb-1">My Progress</h2>
          <p className="text-sm text-slate-500">
            Track your grades, goals, and assigned work.
          </p>
        </Link>

        <Link
          href="/questions"
          className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow"
        >
          <div className="text-3xl mb-3">❓</div>
          <h2 className="font-semibold text-slate-900 mb-1">Question Bank</h2>
          <p className="text-sm text-slate-500">
            Browse past paper questions by topic, year, and difficulty.
          </p>
        </Link>

        <Link
          href="/exams"
          className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow"
        >
          <div className="text-3xl mb-3">📋</div>
          <h2 className="font-semibold text-slate-900 mb-1">Exams</h2>
          <p className="text-sm text-slate-500">
            View exams and self-assessment results.
          </p>
        </Link>

        <Link
          href="/gradebook"
          className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow"
        >
          <div className="text-3xl mb-3">📊</div>
          <h2 className="font-semibold text-slate-900 mb-1">Gradebook</h2>
          <p className="text-sm text-slate-500">
            View and manage student grades across all assessments.
          </p>
        </Link>
      </div>

      {/* Existing Lessons (static HTML) */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Available Lessons (Legacy)
        </h2>
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          <a
            href="/lessons/mathematical-induction.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
          >
            <div>
              <h3 className="font-medium text-slate-900">Mathematical Induction</h3>
              <p className="text-sm text-slate-500">Interactive worksheet with student/mark scheme views</p>
            </div>
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
          <a
            href="/lessons/induction-inequalities.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
          >
            <div>
              <h3 className="font-medium text-slate-900">Induction with Inequalities</h3>
              <p className="text-sm text-slate-500">Proofs &amp; Logical Deduction worksheet</p>
            </div>
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
