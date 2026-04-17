import { createClient } from '@/lib/supabase-server';
export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';

export default async function ProgressPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch student's grades
  const { data: grades } = await supabase
    .from('grades')
    .select('*')
    .eq('student_email', user.email!)
    .order('created_at', { ascending: false });

  // Fetch student's self-reported responses
  const { data: responses } = await supabase
    .from('student_responses')
    .select('*')
    .eq('student_email', user.email!)
    .order('created_at', { ascending: false });

  // Compute summary stats
  const totalGrades = grades?.length ?? 0;
  const totalMarksAwarded = grades?.reduce((sum, g) => sum + g.marks_awarded, 0) ?? 0;
  const totalMarksPossible = grades?.reduce((sum, g) => sum + (g.marks_possible ?? 0), 0) ?? 0;
  const overallPercentage = totalMarksPossible > 0
    ? Math.round((totalMarksAwarded / totalMarksPossible) * 100)
    : null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">My Progress</h1>
        <p className="text-slate-500 mt-1">
          Track your grades, goals, and assigned work.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm text-slate-500 mb-1">Overall Score</p>
          <p className="text-3xl font-bold text-indigo-700">
            {overallPercentage !== null ? `${overallPercentage}%` : '—'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {totalMarksAwarded}/{totalMarksPossible} marks
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm text-slate-500 mb-1">Assessments Graded</p>
          <p className="text-3xl font-bold text-slate-900">{totalGrades}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm text-slate-500 mb-1">Self-Reports Submitted</p>
          <p className="text-3xl font-bold text-slate-900">{responses?.length ?? 0}</p>
        </div>
      </div>

      {/* Recent Grades */}
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Recent Grades</h2>
      {grades && grades.length > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Exam</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Question</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Score</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Graded By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grades.slice(0, 20).map((grade) => (
                <tr key={grade.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{grade.exam_code}</td>
                  <td className="px-4 py-3 font-mono text-sm">{grade.question_code}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium">
                      {grade.marks_awarded}/{grade.marks_possible ?? '?'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      grade.grader_type === 'ai'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {grade.grader_type === 'ai' ? 'AI' : 'Teacher'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-4">📈</div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">No grades yet</h2>
          <p className="text-sm text-slate-500">
            Your grades will appear here as assessments are completed and graded.
          </p>
        </div>
      )}
    </div>
  );
}
