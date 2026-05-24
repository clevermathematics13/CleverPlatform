import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-da-bg px-4">
      <div className="max-w-md space-y-4 rounded-2xl border border-da-border bg-da-surface/90 p-8 text-center shadow-2xl shadow-black/55 wood-surface">
        <h1 className="font-serif text-4xl font-bold text-da-text">403</h1>
        <p className="text-lg text-da-muted">
          You don&apos;t have permission to access this page.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-lg border border-da-accent/40 bg-da-accent px-4 py-2 text-sm font-semibold text-[#2b1408] transition-colors hover:bg-da-amber"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
