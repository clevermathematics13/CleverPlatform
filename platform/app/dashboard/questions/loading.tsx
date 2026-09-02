export default function QuestionsLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-40 rounded bg-da-hover" />
      <div className="h-10 w-full rounded bg-da-hover" />
      {[...Array(8)].map((_, i) => (
        <div key={i} className="h-16 w-full rounded-lg bg-da-hover" />
      ))}
    </div>
  );
}
