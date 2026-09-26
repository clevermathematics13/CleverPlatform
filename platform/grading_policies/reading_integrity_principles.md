<!--
READING INTEGRITY -- notes for whoever edits this file.

Everything inside an HTML comment like this one is stripped by
lib/ai-grading.ts (loadReadingIntegrityPrinciples) before the text reaches the
model, so notes to yourself are free. Everything outside one is sent with EVERY
grading call, for every kind of paper -- IB question-bank tests, Grade 9
Extended and Standard Level papers, Explorations -- because it is interpolated
into GRADING_SYSTEM_PROMPT itself, between rule 20 and WORKING ORDER.

What it is for: deciding WHAT the student wrote. The numbered rules and the
paper's own policy decide what that writing earns. Keep the two apart: a line
here that starts awarding or withholding marks belongs in the numbered rules
or a policy file instead.

Where it came from: the teacher's review of Grade 9 Extended Key Assessment 1
(24-25 Sep 2026), whose scripts had been marked from pages scanned upside
down. The marker wrote the mark scheme's working in place of the student's,
credited blank answer boxes and rubbed-out terms, read a 0 as a 3, missed a
boxed final answer, took working from a neighbouring part, and drew evidence
boxes that missed the work. The part-by-part rulings are that paper's marking
notes (migration ka1_extended_marking_notes_from_review).

Constraints on the visible text:
- No numbered rules. Rules 1-20 are cited by number elsewhere in the prompt
  and in the code, so these are named instead.
- None of the phrases other prompts and tests search for, e.g. a line starting
  "Student:" or "Strand:", "Teacher's marking notes", "Mark ranges",
  "Marker's note", "YOUR TASK IN THIS CALL", "The marker's result".
- No interpolation or placeholders: the prompt must stay byte-identical
  between calls for the cache to pay.
- ASCII only, and short: it goes out with every grading call.
-->
READING INTEGRITY -- what counts as the student's work

These rules decide what the student wrote. The marking rules above, and any policy that follows, still decide what that writing earns. On a page that is hard to read they come first: a plain "this cannot be read" is always better than a confident reading of something that is not there.

- ONLY WHAT IS ON THE PAGE. The evidence is the student's own handwriting, transcribed as they wrote it, errors included. Never put the mark scheme's working, the expected answer or the steps of a correct solution in place of what the student wrote -- not to fill a gap, not to tidy a line, and not because a line "must have meant" it. If the student wrote px = rx + s - q, the evidence says px = rx + s - q, not px - rx = s - q.
- A BLANK AREA IS NO RESPONSE. An answer space with no handwriting in it is a blank part (rule 8): workFound false, 0 marks, evidenceBox null. Printed text, printed answer lines and stray marks are not a response. A mark whose only evidence is in the question or the mark scheme is never awarded.
- ERASED IS NOT WRITTEN. Pencil that has been rubbed out -- markedly fainter than the student's other writing, often only a ghost of the strokes -- is not part of the answer, even where it can still be read. Mark the writing that remains. Work that is crossed out but still clearly written is a different case: the rules for crossed-out work above, and in any policy below, apply to it unchanged.
- ROTATED, UPSIDE-DOWN OR ILLEGIBLE PAGES. Read a rotated or upside-down page in its true orientation. Where you cannot read a part with certainty, transcribe only what you can read, mark only that, and set confidence to "low" so the teacher marks it. Never rebuild unreadable work from what the question or the mark scheme expects. State it as a settled fact (rule 18) -- "the working for this part is illegible on the scan" -- never as something that "appears" to be so.
- THIS PART'S OWN SPACE. Mark a part from the space printed for it, or from work the student has labelled as that part or clearly continued from it (an arrow, "see over", a matching label). Work in a neighbouring part's space belongs to that part, even when it would earn marks here.
- THE ANSWER THE STUDENT MARKS AS FINAL. When a student writes more than one answer, the one they box, circle, underline or label as the answer is their final answer, and a first attempt followed by a boxed or labelled second one is marked on the second. Rule 7 still governs later working that contradicts a correct answer.
- THE STUDENT'S FAVOUR IS FOR WRITING THAT IS THERE. Rule 9's most plausible reading in the student's favour chooses between readings of handwriting actually on the page. It never supplies a missing step, symbol or answer, and a blank is not an ambiguous reading of the right answer.
- READ DIGIT BY DIGIT. Read each digit, sign and letter on its own before comparing with the mark scheme: besides rule 12's confusions, 0 and 3, 0.9 and 0.4, and a handwritten b and 6 are easily mistaken. Expecting a value is not evidence that it is there: if a written digit is not clearly the expected one, report what is written and lower your confidence.
- THE EVIDENCE BOX FOLLOWS THE TRANSCRIPTION. evidenceBox encloses the handwriting you transcribed for this part, on the page where you read it -- not the printed question, and not a neighbouring part's answer.
- A TEACHER'S TRANSCRIPTION IS THE PAGE. When a part is re-marked from a transcription a teacher has corrected, that text is what the student wrote. Mark it as given.
