export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-da-bg px-4 py-16">
      <div className="mx-auto max-w-3xl space-y-8 rounded-2xl border border-da-border bg-da-surface/90 p-8 shadow-2xl shadow-black/55 wood-surface">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-da-accent font-serif">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-da-muted">
            CleverPlatform — Last updated: August 2, 2026
          </p>
        </div>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">1. Overview</h2>
          <p>
            CleverPlatform is an educational technology platform used to manage
            IB Mathematics coursework, assessments, and grading for students,
            parents, and teachers. This policy explains what information we
            collect, how we use it, and how it is protected.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            2. Information We Collect
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-semibold">Account information:</span> your
              name and email address, obtained via Google Sign-In.
            </li>
            <li>
              <span className="font-semibold">Academic data:</span> assignments,
              assessments, grades, and feedback associated with your account.
            </li>
            <li>
              <span className="font-semibold">Usage data:</span> basic
              interaction data (e.g. login times) used to maintain and improve
              the platform.
            </li>
          </ul>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            3. How We Use Google Account Information
          </h2>
          <p>
            When you sign in with Google, we request only your basic profile
            information (name, email address) to create and authenticate your
            account. We do not request access to your Gmail, Google Drive, or
            any other Google service data. We do not sell or share this
            information with third parties for advertising or marketing
            purposes.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            4. How We Use Your Information
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>To provide access to your coursework, assessments, and grades.</li>
            <li>To allow teachers to assign, grade, and provide feedback on student work.</li>
            <li>To allow parents to view their child&apos;s academic progress, where applicable.</li>
            <li>To maintain the security and integrity of the platform.</li>
          </ul>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            5. Data Storage and Security
          </h2>
          <p>
            Data is stored using Supabase, with access restricted through
            row-level security policies. We take reasonable technical measures
            to protect your data from unauthorized access, alteration, or
            disclosure.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            6. Data Sharing
          </h2>
          <p>
            We do not sell your personal information. Academic data may be
            visible to relevant teachers, school administrators, and (for
            students) their own parents or guardians, strictly for educational
            purposes.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            7. Data Retention
          </h2>
          <p>
            Academic records are retained for as long as necessary to support
            the student&apos;s enrollment and academic record-keeping needs.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            8. Your Rights
          </h2>
          <p>
            You may request access to, correction of, or deletion of your
            personal data by contacting us using the information below,
            subject to legitimate academic record-keeping requirements.
          </p>
        </section>

        <section className="space-y-3 text-sm leading-relaxed text-da-text">
          <h2 className="text-lg font-semibold text-da-accent">
            9. Contact
          </h2>
          <p>
            Questions about this policy can be directed to{" "}
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
