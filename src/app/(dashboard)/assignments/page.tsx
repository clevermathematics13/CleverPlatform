import { createClient } from '@/lib/supabase-server';
export const dynamic = 'force-dynamic';

export default async function AssignmentsPage() {
  const supabase = await createClient();

  const { data: assignments } = await supabase
    .from('assignments')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Assignments</h1>
          <p className="text-slate-500 mt-1">View and complete assigned exercises.</p>
        </div>
      </div>

      {assignments && assignments.length > 0 ? (
        <div className="space-y-3">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between"
            >
              <div>
                <h3 className="font-medium text-slate-900">{assignment.title}</h3>
                {assignment.due_date && (
                  <p className="text-sm text-slate-500 mt-1">
                    Due: {new Date(assignment.due_date).toLocaleDateString()}
                  </p>
                )}
              </div>
              <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                Pending
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-4">📝</div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">No assignments yet</h2>
          <p className="text-sm text-slate-500">
            Assigned exercises will appear here when your teacher creates them.
          </p>
        </div>
      )}
    </div>
  );
}
