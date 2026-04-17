import { createClient } from '@/lib/supabase-server';
export const dynamic = 'force-dynamic';

export default async function QuestionsPage() {
  const supabase = await createClient();

  // Fetch questions from MSA Supabase database
  const { data: questions, count } = await supabase
    .from('questions')
    .select('*', { count: 'exact' })
    .order('year', { ascending: false })
    .limit(50);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Question Bank</h1>
        <p className="text-slate-500 mt-1">
          Browse IB past paper questions.
          {count !== null && ` ${count} questions in database.`}
        </p>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex flex-wrap gap-3">
          <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Levels</option>
            <option value="HL">HL</option>
            <option value="SL">SL</option>
            <option value="AH">AH (AAHL)</option>
          </select>
          <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Papers</option>
            <option value="1">Paper 1</option>
            <option value="2">Paper 2</option>
            <option value="3">Paper 3</option>
          </select>
          <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Years</option>
            {Array.from({ length: 10 }, (_, i) => 2024 - i).map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search by code..."
            className="flex-1 min-w-[200px] px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Questions Table */}
      {questions && questions.length > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Code</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Year</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Session</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Paper</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Level</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Marks</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {questions.map((q) => (
                <tr key={q.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-indigo-700">{q.code}</td>
                  <td className="px-4 py-3">{q.year}</td>
                  <td className="px-4 py-3">{q.session}</td>
                  <td className="px-4 py-3">{q.paper}</td>
                  <td className="px-4 py-3">
                    <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-medium">
                      {q.level}
                    </span>
                  </td>
                  <td className="px-4 py-3">{q.total_marks}</td>
                  <td className="px-4 py-3 text-slate-500">{q.source_list}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-4">❓</div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">No questions found</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Questions will appear here after they are synced from the MSA Grader question database.
            Run <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">syncQuestionsToSupabase()</code> in
            the MSA Google Apps Script project.
          </p>
        </div>
      )}
    </div>
  );
}
