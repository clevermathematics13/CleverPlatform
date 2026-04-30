export default function StudentsLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-32 rounded bg-gray-200" />
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-full bg-gray-200" />
          <div className="h-5 w-48 rounded bg-gray-200" />
          <div className="ml-auto h-5 w-24 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}
