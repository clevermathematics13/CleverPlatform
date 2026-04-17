# CleverPlatform — Project Specification & Running Design Document

> **Purpose:** This is a living document that captures every requirement, design decision, and specification for the CleverPlatform project. Update it continuously so that nothing is lost between sessions.
>
> **Last updated:** 2026-04-17

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Target Courses](#2-target-courses)
3. [Core Modules](#3-core-modules)
4. [Lesson Flow & Pedagogy](#4-lesson-flow--pedagogy)
5. [User Roles & Access Control](#5-user-roles--access-control)
6. [Authentication](#6-authentication)
7. [Existing Work & Assets](#7-existing-work--assets)
8. [Technology & Hosting](#8-technology--hosting)
9. [Data Model (High-Level)](#9-data-model-high-level)
10. [AI Integration](#10-ai-integration)
11. [Roadmap & Priorities](#11-roadmap--priorities)
12. [Open Questions & Decisions](#12-open-questions--decisions)
13. [Change Log](#13-change-log)

---

## 1. Project Overview

CleverPlatform is a web-based educational platform designed for IB Diploma Programme mathematics courses. It will be used **in class** and **at home** by students, teachers, and parents.

### Vision

A single, unified platform that replaces scattered tools and provides:

- Interactive digital textbook/lesson pages
- Practice-question database with AI marking
- Past-paper question database for assignments and exam building
- File upload for students and teacher
- Self-assessment tool for exams
- AI-assisted / human-checked grading tool (already built — needs integration)
- Gradebook
- Student progress page (grades, goals, assigned work)

---

## 2. Target Courses

The platform will **first** be designed for:

| Course | Abbreviation | Notes |
|---|---|---|
| IB Diploma Programme Analysis & Approaches Higher Level | **IBDP AAHL** | Primary launch target |
| IB Diploma Programme Applications & Interpretation Higher Level | **IBDP AIHL** | Secondary launch target |

Future expansion to other IB courses or grade levels is anticipated but not in scope for v1.

---

## 3. Core Modules

### 3.1 Interactive Textbook

Digital lesson pages for each topic in the IBDP AAHL / AIHL syllabus.

**Features per page:**

| Feature | Description |
|---|---|
| Interactive checkpoint problems | Self-checking problems embedded in the lesson; students get immediate feedback |
| AI-generated responses | AI provides hints, explanations, or follow-up questions when a student is stuck |
| Hint system | Progressive hints that guide without giving the answer away |
| Interactive geometry tools | Embedded geometry constructions (e.g., GeoGebra-style) for relevant topics |
| Animations | Visual animations to illustrate concepts (e.g., limits, transformations) |
| KaTeX / LaTeX math rendering | All mathematical notation rendered with KaTeX (already in use) |
| Print / PDF export | Clean print layout for offline use (already implemented in current pages) |

### 3.2 Practice-Question Database

- Teacher can **create / import** practice questions
- Teacher can **assign** questions to individual students or groups
- Students **complete and upload** their work
- AI marks student responses with teacher oversight

### 3.3 Past-Paper Question Database

- Searchable database of IB past-paper questions
- Teacher can:
  - Assign individual questions to students
  - Build a full exam from selected questions (exam builder)
- Questions tagged by: **topic, sub-topic, difficulty, paper, year, command term**

### 3.4 File Upload

- Students can upload files (photos of written work, PDFs, etc.)
- Teacher can upload files (resources, answer keys, rubrics)
- Files linked to the relevant assignment / lesson

### 3.5 Self-Assessment Tool for Exams

- Students review their own exam performance
- Structured reflection prompts
- Feeds into student progress page

### 3.6 AI-Assisted / Human-Checked Grading Tool

- **Already built** — needs to be integrated into CleverPlatform
- AI provides initial grade and feedback on written student work
- Teacher reviews, adjusts, and confirms the grade
- Supports IB-style mark schemes and rubrics

### 3.7 Gradebook

- Teacher view of all student grades
- Linked to assignments, exams, and self-assessments
- Export capability (format TBD)

### 3.8 Student Progress Page

- Visible to **student and parent**
- Shows:
  - Current grades
  - Goals (student-set and/or teacher-set)
  - Assigned work and completion status
  - Other relevant information (attendance notes, etc.)

---

## 4. Lesson Flow & Pedagogy

Each interactive textbook lesson follows a deliberate pedagogical sequence:

```
┌─────────────────────────────────────────────────┐
│  1. Pre-Assessment                              │
│     • Gauges prior knowledge                    │
│     • A lower score does NOT penalize students  │
│       who were absent for the lesson            │
│     • Displayed message reassures students      │
└───────────────────────┬─────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────┐
│  2. Lesson Content                              │
│     • Interactive textbook pages                │
│     • Embedded checkpoint problems              │
│     • Hints, AI responses, geometry tools,      │
│       animations                                │
└───────────────────────┬─────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────┐
│  3. Interactive Elements (throughout)            │
│     • Students interact with elements that      │
│       force them to look back through the       │
│       lesson to answer                          │
└───────────────────────┬─────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────┐
│  4. Reflection (End of Lesson)                  │
│     • Structured reflection activity            │
│     • Student self-assessment                   │
└─────────────────────────────────────────────────┘
```

### Key Pedagogical Principles

- **Pre-assessment** is low-stakes and diagnostic only
- **Absent students** are explicitly told that a lower pre-assessment score will not hurt their grade
- **Backward-referencing questions** are embedded to encourage re-reading and engagement with earlier content
- **Reflection** closes every lesson

---

## 5. User Roles & Access Control

### Roles

| Role | Description |
|---|---|
| **Teacher** | Currently only one teacher (you). Full access to everything. Can switch between teacher view and student view. |
| **Student** | Enrolled students in IBDP AAHL / AIHL courses |
| **Parent** | Parent/guardian of an enrolled student |
| **Admin** | Full admin access for all views — currently `clevermathematics@gmail.com` |

### Access Matrix

| Feature | Teacher | Student | Parent |
|---|:---:|:---:|:---:|
| Interactive Textbook | ✅ (teacher + student view) | ✅ | ❌ |
| Assigned Exercises | ✅ (assign + review) | ✅ (complete + submit) | ❌ |
| Practice Question DB | ✅ (full CRUD) | ✅ (assigned only) | ❌ |
| Past Paper Question DB | ✅ (full CRUD + exam builder) | ✅ (assigned only) | ❌ |
| File Upload | ✅ | ✅ | ❌ |
| Self-Assessment Tool | ✅ (review) | ✅ (complete) | ❌ |
| AI Grading Tool | ✅ (review + confirm) | ❌ | ❌ |
| Gradebook | ✅ | ❌ | ❌ |
| Student Progress Page | ✅ | ✅ (own data) | ✅ (linked child's data) |
| Admin Panel | ✅ (admin only) | ❌ | ❌ |

---

## 6. Authentication

### Student & Teacher Login

- **Method:** Google Workspace SSO (OAuth 2.0 / OpenID Connect)
- **Current domain:** `amersol.edu.pe`
- **Note:** The domain will change in the future — the system must support updating the allowed domain without major refactoring

### Admin Login

- `clevermathematics@gmail.com` has **full admin access** to all views
- This account is independent of the school's Google Workspace

### Parent Login

- Parents receive a **registration code** (generated by the teacher)
- Parents use the code to create their own account
- **No specific email provider required** — any email address works
- Parent accounts are linked to their child's student account

### Future Considerations

- Multi-factor authentication (TBD)
- Session management and timeout policies (TBD)
- API authentication for any external integrations (TBD)

---

## 7. Existing Work & Assets

### Currently in Repository

| File / Folder | Description | Status |
|---|---|---|
| `index.html` | Mathematical Induction interactive lesson/worksheet (~95 KB). Includes student worksheet and mark scheme tabs, print/PDF support, KaTeX rendering, canvas drawing workspace, Tailwind CSS styling. | ✅ Working |
| `cerulean-truffle-69e27a.netlify.app/index.html` | Duplicate of the induction lesson (Netlify deployment copy) | ✅ Working |
| `cerulean-truffle-69e27a.netlify.app/induction-inequalities.html` | Induction with Inequalities lesson page | ✅ Working |
| `scripts/auto-push.sh` | File watcher that auto-commits and pushes changes | ✅ Working |
| `.vscode/tasks.json` | VS Code task to launch auto-push | ✅ Working |

### External / Pre-Built Tools

| Tool | Description | Status |
|---|---|---|
| AI Grading Tool | AI-assisted / human-checked grading for written student work | ✅ Already built — needs integration |

### Technology Currently in Use

- **Math rendering:** KaTeX 0.16.8
- **CSS framework:** Tailwind CSS (via CDN)
- **Hosting:** Netlify (current deployment at `cerulean-truffle-69e27a.netlify.app`)
- **Version control:** GitHub (`clevermathematics13/CleverPlatform`)

---

## 8. Technology & Hosting

### Current Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS (Tailwind), JavaScript |
| Math rendering | KaTeX |
| Hosting | Netlify |
| Version control | GitHub |

### Planned / Under Consideration

| Layer | Options to Evaluate | Notes |
|---|---|---|
| Frontend framework | React, Next.js, or similar | Needed for SPA routing, state management, component reuse |
| Backend / API | Node.js + Express, Next.js API routes, or serverless functions | Needed for auth, grading, database access |
| Database | PostgreSQL, Firebase/Firestore, or Supabase | For questions, grades, user data |
| Authentication | Google OAuth 2.0, Firebase Auth, or NextAuth.js | Must support Google Workspace SSO + custom parent registration |
| File storage | AWS S3, Google Cloud Storage, or Supabase Storage | For student/teacher uploads |
| AI services | OpenAI API, Google Gemini, or similar | For AI grading, hints, and responses |
| Geometry tools | GeoGebra embed, JSXGraph, or custom | For interactive geometry |
| Hosting | Netlify, Vercel, or similar | Current: Netlify |

> **Decision needed:** Choose the full tech stack before major development begins. See [Open Questions](#12-open-questions--decisions).

---

## 9. Data Model (High-Level)

> This section will be refined as the tech stack is finalized.

### Core Entities

```
User
├── id, name, email, role (teacher | student | parent | admin)
├── google_id (for SSO users)
├── registration_code (for parent accounts)
└── linked_student_id (for parent accounts)

Course
├── id, name (e.g., "IBDP AAHL"), year, description
└── enrolled_students[]

Topic
├── id, course_id, name, order
└── sub_topics[]

Lesson
├── id, topic_id, title, content (interactive textbook page)
├── pre_assessment_id
├── reflection_id
└── checkpoints[]

Question
├── id, type (practice | past_paper | checkpoint | pre_assessment | reflection)
├── topic_id, sub_topic_id
├── difficulty, paper, year, command_term
├── content, solution, mark_scheme, hints[]
└── tags[]

Assignment
├── id, teacher_id, title, due_date
├── questions[], course_id
└── student_submissions[]

Submission
├── id, student_id, assignment_id, question_id
├── response (text / file URL), submitted_at
├── ai_grade, ai_feedback
├── teacher_grade, teacher_feedback, confirmed
└── files[]

Grade
├── id, student_id, assignment_id
├── score, max_score, percentage
└── category (formative | summative | self_assessment)

StudentProgress
├── student_id, course_id
├── current_grades{}, goals[], assigned_work[]
└── notes
```

---

## 10. AI Integration

### Use Cases

| Use Case | Description | Priority |
|---|---|---|
| **Checkpoint hints** | AI generates progressive hints for embedded lesson problems | High |
| **AI responses** | AI explains concepts or answers student questions within the textbook | High |
| **AI grading** | AI provides initial grade + feedback on written work (already built) | High — integration needed |
| **Exam marking** | AI marks practice/past-paper question submissions | Medium |
| **Question generation** | AI generates new practice questions from a topic/template | Low (future) |

### Principles

- AI is an **assistant**, not a replacement for teacher judgment
- All AI grades must be **reviewable and overridable** by the teacher
- AI hints should **guide**, not give away answers
- AI responses must be **mathematically accurate** — model selection and prompt engineering are critical

---

## 11. Roadmap & Priorities

> Update this section as decisions are made and work progresses.

### Phase 1 — Foundation

- [ ] Choose and set up tech stack (frontend framework, backend, database, auth)
- [ ] Set up project structure and build pipeline
- [ ] Implement authentication (Google SSO for teacher/students, registration code for parents)
- [ ] Create basic layout/navigation shell
- [ ] Migrate existing induction lessons into the new framework

### Phase 2 — Interactive Textbook

- [ ] Build lesson page template with the full pedagogical flow (pre-assessment → content → backward-referencing questions → reflection)
- [ ] Implement checkpoint problem component (self-checking, hints, AI response)
- [ ] Implement interactive geometry tool embedding
- [ ] Implement animations
- [ ] Build out IBDP AAHL lesson pages (topic by topic)
- [ ] Build out IBDP AIHL lesson pages

### Phase 3 — Question Database & Assignments

- [ ] Design and build practice-question database
- [ ] Design and build past-paper question database
- [ ] Implement assignment creation and distribution
- [ ] Implement student submission flow (complete + upload)
- [ ] Implement exam builder (select questions → generate exam)

### Phase 4 — Grading & Progress

- [ ] Integrate existing AI grading tool
- [ ] Build gradebook (teacher view)
- [ ] Build student progress page (student + parent view)
- [ ] Implement self-assessment tool for exams
- [ ] Implement file upload for students and teacher

### Phase 5 — Polish & Launch

- [ ] Parent registration and linking flow
- [ ] Responsive design / mobile optimization
- [ ] Accessibility audit
- [ ] Performance optimization
- [ ] User testing with students
- [ ] Production deployment

---

## 12. Open Questions & Decisions

> Add questions here as they come up. Mark them ✅ when resolved.

| # | Question | Status | Decision |
|---|---|---|---|
| 1 | What frontend framework to use? (React / Next.js / other) | ❓ Open | |
| 2 | What database to use? (PostgreSQL / Firebase / Supabase) | ❓ Open | |
| 3 | What AI provider for hints and grading? (OpenAI / Gemini / other) | ❓ Open | |
| 4 | What geometry tool to embed? (GeoGebra / JSXGraph / custom) | ❓ Open | |
| 5 | How is the existing AI grading tool built? (tech stack, API, deployment) | ❓ Open | Need details to plan integration |
| 6 | Should the platform support offline mode? | ❓ Open | |
| 7 | What is the expected number of students? (affects hosting and DB choices) | ❓ Open | |
| 8 | Will the Google Workspace domain change require re-authentication of all users? | ❓ Open | |
| 9 | What file types and size limits for student/teacher uploads? | ❓ Open | |
| 10 | Export format for gradebook? (CSV, PDF, integration with school SIS?) | ❓ Open | |
| 11 | Will AIHL and AAHL share question databases or be fully separate? | ❓ Open | |
| 12 | How should the pre-assessment "no penalty for absent students" logic work in the gradebook? | ❓ Open | |

---

## 13. Change Log

> Record major decisions and changes here so you have a history.

| Date | Change | Details |
|---|---|---|
| 2026-04-17 | Document created | Initial compilation of all project requirements and specifications |

---

## How to Use This Document

1. **Before each work session:** Review this document to refresh context
2. **During a session:** Add new decisions, answers to open questions, or design changes
3. **After a session:** Update the change log and any resolved items
4. **If starting a new conversation:** Share this document (or its URL on GitHub) so the AI assistant has full context

> This file lives at the root of the repository: `PLATFORM_SPEC.md`
