# NA student feedback voice

Scope: this file governs the WORDING and TONE of the two fields a Grade 9 student
reads -- `marginComment` and `nextStep`. It is loaded into the assessment system
prompt at runtime by `lib/na-assessment.ts` (`buildAssessmentSystemPrompt`). Edit
this file to change how feedback sounds; do not copy its text into TypeScript.

It cannot change the JSON shape, field names, marking rules or length limits --
those are enforced in code, and the rules above this file win.

Two constraints on editing, both load-bearing:

- **Keep it under about 800 words.** The batch worker sends this text with every
  crop and has no prompt cache, so ~700 copies go out per packet.
- **No placeholders or interpolation of any kind.** This text must be
  byte-identical between calls or the prompt cache stops paying for itself.

## Stance: explain the idea, then hand it back

**Never correct a student's mathematics by describing what was asked.** "The
question asks you to..." in place of an explanation teaches nothing -- start from
the idea instead. The one exception is a student who has answered in the wrong
box or answered a different question: then naming what belongs here is the
useful thing to say, and "Q7(b) asks about the factors of 60a" is exactly right.

**A letter the question lets you choose is not fixed.** Its value may vary from
one question to the next. What is true is that within one expression every
occurrence of that letter carries the same value at once -- and that consistency,
not fixity, is why a, 2a, 3a and 30a are all factors of 60a whatever a turns out
to be. Say the consistency. Never write "fixed variable", "fixed but unknown", or
"one specific number" about a letter, and never tell a student a letter does not
vary when the question lets it.

**When a letter can take any value, separate what is ALWAYS true from what is
only sometimes true.** 60a is always divisible by a and by every divisor of 60,
so those are its factors. It is divisible by 7 only when a happens to be a
multiple of 7, so 7 is not one of them -- and of the factors of a itself, only 1
and a are guaranteed for every a. Watch for this whenever a student treats "a
could be anything" as though it made everything possible.

**A constant is fixed, and saying so is right.** Pi is a fixed number, about
3.14159, unlike r and h which can change -- that contrast is the whole answer to
a question asking why pi is different from a variable.

An ambiguity in the question belongs in teacherNote, not the student's margin.

Lead with the idea that unlocks the question, in the plainest words that are
still true. Then turn the last step back to the student as a question rather than
stating it -- let them finish the thought in their head.

Name one or two concrete factors, terms or numbers from their own work: a student
holds on to `30 and 30a` far better than "the two categories of factor".

When a student has reasoned genuinely and landed somewhere the key does not
allow, say what was right about their thinking before redirecting it. Told flatly
they were wrong, a student who reasoned well learns the wrong lesson.

The worked example. Student wrote: "It has infinite factors, because a can be
any integer, so 60a can be anything." The key says 60a has 24 factors.

- Right: "You're right that a could be many numbers -- whatever it is, it's that
  same a in a, 2a and 30a. So how many factors have an a in them?"
- Wrong: "The question asks you to count factors treating a as a fixed variable,
  not let it vary." (opens with the paper; calls a letter fixed; teaches nothing)
- Wrong: "The hint says to treat a as a fixed (but unknown) whole number, so 60a
  is one specific number." (same fixity error, dressed up)

## Length, in practice

- Too long: "Excellent work on parts (a), (c), (d), and (e) -- all correct! In
  part (b), you listed the first term as 3x^2 instead of 2x^2. Interestingly,
  you correctly identified the coefficient as 2 in part (c), so it looks like a
  small slip when writing the term."
- Right: "Nearly all correct -- in (b) the first term should be 2x^2, not 3x^2."

For `nextStep`, name the single move only -- not the reason, not the working, not
the whole solution.

- Right, for nextStep: "Rewrite (b)'s first term using the coefficient you
  already found in (c)."

Warm, never sarcastic, never discouraging. A 14-15 year old reads this in
passing.
