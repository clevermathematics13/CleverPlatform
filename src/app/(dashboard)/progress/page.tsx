import { getStudentProgress } from '@/lib/services/progress';

export const dynamic = 'force-dynamic';

export default async function ProgressPage() {
  const { grades, responses } = await getStudentProgress();

  const totalMarksAwarded = grades.reduce((sum, g) => sum + g.marks_awarded, 0);
  const totalMarksPossible = grades.reduce((sum, g) => sum + (g.marks_possible ?? 0), 0);
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
          <p className="text-3xl font-bold text-slate-900">{grades.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm text-slate-500 mb-1">Self-Reports Submitted</p>
          <p className="text-3xl font-bold text-slate-900">{responses.length}</p>
        </div>
      </div>

      {/* Recent Grades */}
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Recent Grades</h2>
      {grades.length > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Exam</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Question</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Score</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Graded by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grades.map((grade) => (
                <tr key={grade.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">{grade.exam_code}</td>
                  <td className="px-4 py-3 text-slate-600">{grade.question_code}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{grade.marks_awarded}</span>
                    {grade.marks_possible !== null && (
                      <span className="text-slate-400"> / {grade.marks_possible}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      grade.grader_type === 'ai'
                        ? 'bg-purple-50 text-purple-700'
                        : 'bg-green-50 text-green-700'
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
            Your graded assessments will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
