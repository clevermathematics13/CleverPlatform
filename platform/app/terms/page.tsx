export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-da-bg px-4 py-16">
      <div className="mx-auto max-w-3xl space-y-8 rounded-2xl border border-da-border bg-da-surface/90 p-8 shadow-2xl shadow-black/55 wood-surface">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-da-accent font-serif">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-da-muted">
            CleverPlatform — Last updated: August 2, 2026
          </p>
        </div>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            1. Acceptance of Terms
          </h2>
          <p>
            By accessing or using CleverPlatform, you agree to be bound by
            these Terms of Service. If you do not agree, please do not use the
            platform.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            2. Purpose of the Platform
          </h2>
          <p>
            CleverPlatform is provided to support IB Mathematics coursework,
            assessment management, and grading for students, parents, and
            teachers within its intended school community.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            3. Account Eligibility
          </h2>
          <p>
            Access is limited to invited students, their parents or guardians,
            and authorized teaching staff. Accounts are intended for
            individual use and should not be shared.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            4. Acceptable Use
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>Do not attempt to access accounts or data that are not your own.</li>
            <li>Do not use the platform to submit or share plagiarized or dishonest academic work.</li>
            <li>Do not attempt to disrupt, reverse-engineer, or misuse the platform&apos;s systems.</li>
          </ul>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            5. Academic Content
          </h2>
          <p>
            Assessments, feedback, and grades provided through the platform
            are for educational purposes and are subject to the academic
            policies of the school. Grades displayed on the platform are not
            final until confirmed through official school channels where
            applicable.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            6. Availability
          </h2>
          <p>
            The platform is provided on an as-available basis. We do not
            guarantee uninterrupted access and may modify, suspend, or
            discontinue features at any time.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            7. Limitation of Liability
          </h2>
          <p>
            CleverPlatform is provided &quot;as is&quot; without warranties of
            any kind. To the extent permitted by law, we are not liable for
            any indirect, incidental, or consequential damages arising from
            use of the platform.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            8. Changes to These Terms
          </h2>
          <p>
            These terms may be updated from time to time. Continued use of the
            platform after changes are posted constitutes acceptance of the
            revised terms.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            9. Contact
          </h2>
          <p>
            Questions about these terms can be directed to{" "}
            <a
              href="mailto:clevermathematics@gmail.com"
              className="text-da-accent underline hover:text-da-amber"
            >
              clevermathematics@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
