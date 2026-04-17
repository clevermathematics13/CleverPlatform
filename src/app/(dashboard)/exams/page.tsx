import { createClient } from '@/lib/supabase-server';
export const dynamic = 'force-dynamic';

export default async function ExamsPage() {
  const supabase = await createClient();

  const { data: exams } = await supabase
    .from('exams')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Exams</h1>
        <p className="text-slate-500 mt-1">
          View past and upcoming exams. Build new exams from the question bank.
        </p>
      </div>

      {exams && exams.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {exams.map((exam) => (
            <div
              key={exam.id}
              className="bg-white rounded-xl border border-slate-200 p-5"
            >
              <h3 className="font-semibold text-slate-900 mb-2">{exam.exam_code}</h3>
              <div className="space-y-1 text-sm text-slate-500">
                {exam.date && <p>Date: {exam.date}</p>}
                {exam.duration_minutes && <p>Duration: {exam.duration_minutes} minutes</p>}
                {exam.class_code && (
                  <span className="inline-block bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-xs font-medium">
                    {exam.class_code}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-4">📋</div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">No exams yet</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Exams synced from the MSA Grader will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
