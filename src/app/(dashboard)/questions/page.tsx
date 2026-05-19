import { getQuestions } from '@/lib/services/questions';

export const revalidate = 60;

export default async function QuestionsPage() {
  const { questions, count } = await getQuestions();

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
          </select>
          <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Papers</option>
            <option value="1">Paper 1</option>
            <option value="2">Paper 2</option>
          </select>
        </div>
      </div>

      {questions.length > 0 ? (
        <div className="space-y-3">
          {questions.map((question) => (
            <div
              key={question.id}
              className="bg-white rounded-xl border border-slate-200 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-slate-900">
                    {question.year} {question.session} — Paper {question.paper} Q{question.question_number}
                  </p>
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      {question.level}
                    </span>
                    {question.timezone && question.timezone !== 'TZ0' && (
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                        {question.timezone}
                      </span>
                    )}
                    <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                      {question.total_marks} marks
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-400 shrink-0">{question.code}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-4">❓</div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">No questions found</h2>
          <p className="text-sm text-slate-500">
            The question bank will populate once questions are imported.
          </p>
        </div>
      )}
    </div>
  );
}
