'use client';

import RouteError from '@/components/RouteError';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
        <RouteError error={error} reset={reset} />
      </body>
    </html>
  );
}
