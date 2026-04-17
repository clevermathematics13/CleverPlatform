import { createClient } from '@/lib/supabase-server';
export const dynamic = 'force-dynamic';

export default async function TextbookPage() {
  const supabase = await createClient();

  // Fetch topics from database (will be empty until seeded)
  const { data: topics } = await supabase
    .from('topics')
    .select('*')
    .order('order_index');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Interactive Textbook</h1>
        <p className="text-slate-500 mt-1">
          Explore lessons by topic. Each lesson includes pre-assessment, interactive content, and reflection.
        </p>
      </div>

      {topics && topics.length > 0 ? (
        <div className="space-y-4">
          {topics.map((topic) => (
            <div
              key={topic.id}
              className="bg-white rounded-xl border border-slate-200 p-6"
            >
              <h2 className="font-semibold text-slate-900">{topic.name}</h2>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-4">📖</div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            Textbook content coming soon
          </h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Interactive lesson pages for IBDP AAHL and AIHL topics are being developed.
            In the meantime, check out the legacy lessons on the dashboard.
          </p>
        </div>
      )}
    </div>
  );
}
