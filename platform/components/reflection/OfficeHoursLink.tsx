import { OFFICE_HOURS_URL } from "@/lib/office-hours";

/**
 * "Book office hours": the teacher's appointment page, in a new tab so the
 * student's place in the mark scheme and any marks they have typed are not
 * lost. Styled as a quiet button; the icon is decoration and the words say
 * what it does.
 */
export function OfficeHoursLink({
  label = "Book office hours",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={OFFICE_HOURS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-da-border bg-da-surface px-3 py-2 text-sm font-semibold text-da-text transition-colors hover:border-da-success/70 hover:bg-da-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-da-success ${className}`}
    >
      <span aria-hidden="true">📅</span>
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
