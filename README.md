# CleverPlatform

Interactive educational platform for IB Diploma Programme mathematics courses (AAHL & AIHL).

📄 **[Full Project Specification →](PLATFORM_SPEC.md)** — Living document with all requirements, design decisions, and roadmap.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | [Next.js 16](https://nextjs.org/) (App Router, TypeScript) |
| CSS | [Tailwind CSS v4](https://tailwindcss.com/) |
| Database | [Supabase](https://supabase.com/) (PostgreSQL) — shared with MSA Grader |
| Auth | Supabase Auth (Google OAuth + email/password) |
| Math Rendering | KaTeX (in lesson pages) |

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com/) project

### Setup

```bash
# Install dependencies
npm install

# Copy environment template and fill in your Supabase credentials
cp .env.local.example .env.local

# Run the database migration
# → Copy supabase/migrations/001_initial_schema.sql into your Supabase SQL editor and run it

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

### Project Structure

```
src/
├── app/
│   ├── (auth)/login/          # Login page (Google SSO + parent email login)
│   ├── (dashboard)/           # Main app layout with sidebar navigation
│   │   ├── textbook/          # Interactive textbook pages
│   │   ├── assignments/       # Student assignments
│   │   ├── questions/         # Question bank (synced from MSA)
│   │   ├── exams/             # Exam management
│   │   ├── grading/           # AI-assisted grading review
│   │   ├── gradebook/         # Teacher gradebook
│   │   └── progress/          # Student progress page
│   └── auth/callback/         # OAuth callback handler
├── lib/                       # Supabase client utilities
├── types/                     # TypeScript types (database schema)
└── middleware.ts              # Auth middleware (protects routes)

public/lessons/                # Static HTML lesson files (legacy)
supabase/migrations/           # Database migration SQL
```

## Auto-push to GitHub

This repository includes a local watcher that can automatically commit and push every file change to `origin`.

### Run it

From the repository root:

```bash
./scripts/auto-push.sh
```

Or in VS Code, run the task named `Start auto-push watcher`.

### How it works

- Watches the repository for file changes using `inotifywait`
- Waits `2` seconds for edits to settle
- Runs `git add -A`
- Creates a commit like `chore: auto-sync 2026-04-07T12:34:56Z`
- Pushes to `origin` on the current branch

### Notes

- This creates a very noisy commit history by design.
- New files such as `index.html` will be included automatically.
- Stop the watcher with `Ctrl+C`.
- You can change the debounce time with `AUTO_PUSH_DEBOUNCE_SECONDS`, for example:

```bash
AUTO_PUSH_DEBOUNCE_SECONDS=5 ./scripts/auto-push.sh
```
