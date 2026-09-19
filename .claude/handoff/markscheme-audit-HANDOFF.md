# Markscheme strictness review — continuation handoff

Written 19 Sep 2026, at the end of the session on branch
`claude/markscheme-strictness-review-oweav5`. These two files exist because the
audit data lived in a session-scoped scratchpad that a fresh Claude Code
session cannot reach.

**Delete this directory once the work below is finished.** It is a handoff, not
a permanent part of the repo.

---

## What started this

A teacher screenshot of KA1 Unit 1 Q9(a). The part printed, in full:

> Describe how the visual pattern is changing. You may use colours or symbols
> to support your description. **[2]**

and was marked:

> one for naming which parts grow and by how much (2 in the row, 1 in the
> column), one for a description that would let someone draw the next figure.

Of the 15 students who sat it, 12 described the growth correctly and 9 lost
marks on the vocabulary. "Adding one unit to the left, right and bottom every
figure" scored 0; "two on each side and one on the bottom" — the same answer —
scored 2. None of that is mathematics.

The guard for this already existed in both halves and neither reached the
paper. `lib/ask-what-you-mark.ts` stops a GENERATOR writing such a scheme, and
KA1 Unit 1 was transcribed from the teacher's PDFs, not generated. Section 8 of
the Formative Assessment principles stops a MARKER applying one, and a Standard
Level paper REPLACES that policy wholesale rather than adding to it, so the
clause was simply absent from the prompt the paper was marked under.

---

## Completed (5 commits, all pushed)

| Commit | What |
|---|---|
| `a97863b` | Q7(d), Q9(a), Q9(b), Q9(c) schemes rewritten; policy section 10; cross-policy invariant test |
| `5b6bf0e` | `migrations/` reconciled, 160 -> 166 files against 166 ledger rows |
| `f73fc2e` | strand C/D descriptors; policy section 5; Q8 + strand A fixture<->production |
| `54be89f` | rule 16 rewritten (it had been catching only its own test case) |
| `d958a64` | cherry-picked `0beefa1` — `.claude/settings.json`, Supabase permission |

The central lesson, worth keeping: **a part's demands are written in THREE
places and the grading prompt carries all three** — the part's
`markscheme_text`, the STRAND DESCRIPTOR for its strand, and the marking
POLICY. The first fix corrected only the first, so both withdrawn demands were
still live guidance in the same prompt as the corrected schemes. Section 5 now
says a descriptor never outranks a part's own scheme.

---

## Remaining work, in priority order

### 1. Re-run Clev's Marks on KA1 Unit 1 — the only student-facing item

Test id `a1c0f4e2-9d00-4b7e-8c21-000000000001`. Nothing is accepted (0 of 390
suggestions), so no student's recorded result has moved, but the corrected
schemes and descriptors only take effect on a fresh grading run.

### 2. Finish the verification pass on the 58 findings

`markscheme-audit-unverified.json` beside this file holds all 58 with their
full `evidence` and `proposed_fix`. They are 17 paper-scheme, 11 policy, 11
code, 10 migration, 6 data-structure, 3 docs; 20 rated high severity by the
auditors that raised them, which is a pre-verification rating and should not be
trusted on its own.

**These are UNVERIFIED. Do not act on any of them before verifying it.** The
whole point of the adversarial pass is that a plausible-sounding finding is
often wrong, and a false finding costs the teacher's trust in the entire audit.

To resume the verification workflow:

```
Workflow({
  scriptPath: "/root/.claude/projects/-home-user-CleverPlatform/66903641-af7a-540c-80a3-28d23b832254/workflows/scripts/verify-58-findings-wf_834ca6b6-4ed.js",
  resumeFromRunId: "wf_834ca6b6-4ed"
})
```

That path is session-scoped and **will not exist in a fresh session.** If it is
gone, re-author the workflow from the findings JSON: 58 findings x 3
adversarial verifiers, each with a distinct lens (is it real *now*; is the fix
correct and safe; is it genuinely the defect class or just a harsh but
prompt-faithful scheme), majority-refute kills it.

Two things the re-authored script MUST keep:

- **A `stale` verdict, distinct from `refuted`.** The findings were raised
  against an older state and five commits have landed since; several are
  already fixed. Verifiers must re-read the CURRENT file or row, and a finding
  that describes something already fixed is stale, not wrong.
- **An `unknown` verdict for zero votes cast.** See the warning below.

Operational notes, learned the hard way:

- The run died twice to container restarts, at 5 and then 35 of 174 verifier
  results. **Resumes are monotonic and cached work is free**, so resuming is
  cheap. If it dies a third time, stop resuming and split into three batches of
  about 20 findings as separate runs.
- **Do not trim the agent prompts to save weight.** That changes every
  `agent()` cache key, and everything from the first changed call onward
  re-runs live, discarding all completed verdicts.
- Disk is not the constraint (25% used). The load is per-agent context: each
  verifier transcript ran 270-470 KB for a single yes/no verdict, because every
  one re-read CLAUDE.md, `ask-what-you-mark.ts`, the policy, `git log` and
  queried Supabase.

**The highest-stakes unverified finding is #16**: Formative Assessment 1
Q10(b), where the scheme is alleged to require a justification the prompt never
asks for, on a part with **39 accepted zeros out of 51**. Unlike KA1 Unit 1,
those marks are already given to students. If it verifies, correcting it changes
marks a student has already received — **that is the teacher's call, not an
engineer's.** Put it to them; do not quietly re-grade.

Accepted-mark counts, which decide who may act on a finding:
Formative Assessment 1 = 2125 accepted, Key Assessment 1 = 9, KA1 Unit 1 = 0.

### 3. `20260918182655_tests_activity_rubric`

Applied to production, no file in the repo. It belongs to a DIFFERENT
workstream (Math Medic Explorations as activities; it references a
`platform/lib/activity-rubric.ts` that does not exist in this repo yet) and was
deliberately left alone rather than absorbed into this branch — committing it
here would land half of another session's feature with a dangling reference. It
needs its file written back from the ledger wherever that work lands.

---

## One trap to avoid

**Do not trust a raw workflow verdict count.** The first audit reported "5
confirmed, 61 refuted". In fact 58 of those 61 had ZERO votes cast — their
verifier agents had died on a spend limit — and the script's `survives` logic
folded "no votes" into "refuted". They were never checked at all. That is the
entire reason this file exists. Any harness that scores a dead verifier as a
refutation will quietly discard real findings and report confidence it has not
earned.
