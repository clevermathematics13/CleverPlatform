import { createClient } from '@/lib/supabase-server';
export const dynamic = 'force-dynamic';

export default async function GradebookPage() {
  const supabase = await createClient();

  // Fetch students list
  const { data: students } = await supabase
    .from('students')
    .select('*')
    .order('name');

  // Fetch recent grades
  const { data: grades } = await supabase
    .from('grades')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gradebook</h1>
          <p className="text-slate-500 mt-1">
            View and manage student grades across all assessments.
          </p>
        </div>
        <button className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors">
          Export CSV
        </button>
      </div>

      {students && students.length > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Student</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Accommodation</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Grades Recorded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((student) => {
                const studentGrades = grades?.filter(
                  (g) => g.student_email === student.email
                );
                return (
                  <tr key={student.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{student.name}</td>
                    <td className="px-4 py-3 text-slate-500">{student.email}</td>
                    <td className="px-4 py-3">
                      {student.accommodation_pct
                        ? `${Math.round(student.accommodation_pct * 100)}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-medium">
                        {studentGrades?.length ?? 0}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-4">📊</div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">No students yet</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Students will appear here after syncing from the MSA Grader.
            Run <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">syncStudentsToSupabase()</code> in
            the MSA project.
          </p>
        </div>
      )}
    </div>
  );
}
