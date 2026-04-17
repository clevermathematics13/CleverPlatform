import { createClient } from '@/lib/supabase-server';
export const dynamic = 'force-dynamic';

export default async function GradingPage() {
  const supabase = await createClient();

  const { data: submissions } = await supabase
    .from('submissions')
    .select('*')
    .eq('confirmed', false)
    .order('submitted_at', { ascending: false })
    .limit(20);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">AI-Assisted Grading</h1>
        <p className="text-slate-500 mt-1">
          Review AI-graded student submissions. Confirm or adjust grades before finalizing.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <span className="text-xl">🔗</span>
          <div>
            <h3 className="font-medium text-amber-900">MSA Grader Integration</h3>
            <p className="text-sm text-amber-700 mt-1">
              The AI grading engine from the MSA Grader project is connected to this platform.
              Grades synced from the MSA system will appear here for review and confirmation.
            </p>
          </div>
        </div>
      </div>

      {submissions && submissions.length > 0 ? (
        <div className="space-y-3">
          {submissions.map((sub) => (
            <div
              key={sub.id}
              className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between"
            >
              <div>
                <p className="font-medium text-slate-900">Submission #{sub.id.slice(0, 8)}</p>
                <p className="text-sm text-slate-500 mt-1">
                  AI Grade: {sub.ai_grade ?? 'Pending'} | Teacher Grade: {sub.teacher_grade ?? 'Not reviewed'}
                </p>
              </div>
              <button className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors">
                Review
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-4">✏️</div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">No submissions to review</h2>
          <p className="text-sm text-slate-500">
            Student work submissions requiring grading will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
