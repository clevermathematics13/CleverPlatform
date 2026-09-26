<!--
IBDP AA HL -- writing lessons. Notes for whoever edits this file.

Everything inside an HTML comment like this one is stripped by
lib/generation-lessons.ts before the text reaches a model. Everything outside
one is appended to the system prompt of every generator that writes for AAHL:
the /admin/create packet generator (app/api/generate-packet/route.ts), the
practice question writer (lib/practice-question-generator.ts), the Nuanced
Analysis generator (lib/assignments.ts) for an AAHL course, and the Assessment
Creator (lib/formative-assessment-prompt.ts) for an AAHL course.

These are lessons from MARKING -- what made real scripts hard to mark --
turned into what to write differently. The grader's side of the same lessons
is grading_policies/reading_integrity_principles.md and each paper's marking
notes. The first ones came from the review of Key Assessment 1 (Grade 9
Extended, 24-25 Sep 2026); they are written here in IB terms.

AAHL markschemes follow IB conventions (M, A, R, AG, implied (M1) and (A1),
FT) and, on Paper 2, the accuracy policy in
grading_policies/ibdp_math_aa_hl_paper_2_numerical_accuracy.md. Grade 9
Extended and Standard have their own files; keep the three apart.

No placeholders or interpolation (the prompt must stay byte-identical between
calls), ASCII only, and short: it goes out with every generation.
-->
LESSONS FROM MARKING -- IBDP Mathematics: Analysis and Approaches HL

These come from marking real handwritten scripts. They apply to every packet, question and markscheme you write for this course, on top of the rules above. Write markschemes in IB conventions: M, A, R and AG marks, (M1) and (A1) for implied marks, and FT stated where it applies.

The markscheme
- Name the wrong routes candidates actually take, with what each earns, as the IB's own notes do ("Award M1A0 for ...", "Do not award A1 for ..."), so a marker never has to settle a common error alone.
- State follow-through explicitly: which later marks may be awarded from which earlier value, and where FT does not apply, such as a "Hence" part restarted from the given values.
- For an R mark, write the reason that earns it and what does not: a restated result, a verdict without a reason, or a numerical check built on a wrong model.
- Where accuracy matters, say which answers are accepted and to what accuracy, and mark an intermediate value that is a reference figure, not a required string, as such.

The page
- Give every part its own labelled space and keep the working of neighbouring parts visibly apart.
- Tell candidates to cross out work rather than erase it, and to make clear which answer is final.
- Do not introduce variable names that look like digits in handwriting, such as b (6), l (1), O (0), S (5), z (2) or q (9), unless the notation is standard for the topic.
