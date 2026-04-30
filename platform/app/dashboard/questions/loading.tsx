export default function QuestionsLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-40 rounded bg-gray-200" />
      <div className="h-10 w-full rounded bg-gray-200" />
      {[...Array(8)].map((_, i) => (
        <div key={i} className="h-16 w-full rounded-lg bg-gray-200" />
      ))}
    </div>
  );
}
