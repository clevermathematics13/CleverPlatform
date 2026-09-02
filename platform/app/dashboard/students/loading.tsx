export default function StudentsLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-32 rounded bg-da-hover" />
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-full bg-da-hover" />
          <div className="h-5 w-48 rounded bg-da-hover" />
          <div className="ml-auto h-5 w-24 rounded bg-da-hover" />
        </div>
      ))}
    </div>
  );
}
