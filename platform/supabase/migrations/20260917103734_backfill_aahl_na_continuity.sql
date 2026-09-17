-- Backfill Nuanced Analysis continuity for the AA HL course (27AH,
-- 7abac7b1-2cf6-4c94-a12b-3e083ed139c3).
--
-- WHY. The Assignments Studio showed "No prior packets -- generating cold" for
-- AAHL even though three AA HL packets exist. They were authored in June/July
-- 2026, BEFORE course scoping landed (20260814182410), so all four of
-- course_id, grade_level, section_code and continuity_digest were NULL on them
-- -- exactly the rows that migration's own comment calls "the legacy
-- hand-curated AA HL rows that predate course scoping". Grade 9 got a
-- re-pointing migration for the same problem (20260820094752); AA HL never did,
-- so na_continuity held a single row, for Grade 9 Extended, and none for AA HL.
-- loadContinuity() returned null and every AA HL generation ran with no
-- prohibitions at all.
--
-- This migration does two things:
--   1. Scopes the three legacy packets onto the AA HL course and gives them
--      Season 0 section codes, in their existing sort_order (which is the
--      teaching order: binomial theorem -> quadratics -> polynomials, and
--      Polynomial Analysis's Part 5 does rely on the binomial expansion).
--      Season 0 is deliberate: it parks the pre-scoping packets without
--      claiming a season number the teacher may already use for real.
--   2. Creates the AA HL na_continuity row -- the three digests, derived by
--      reading each packet's draft_content, plus a Season 4 spine.
--
-- SEASON 4 is the trigonometry/circular-functions block: subtopics 3.7, 3.8,
-- 3.9 and 3.11, which syllabus_coverage still lists as uncovered for 27AH,
-- together with the 5.15 derivative/integral pair that belongs with the
-- reciprocal and inverse trig functions in 3.9.
--
-- ASSUMPTION, flagged so it can be corrected with one UPDATE: episodes E01-E06
-- are marked done and E07 next, inferred from the teacher generating S04E07.
-- No packets exist for E01-E06, so they contribute titles to the spine but no
-- prohibitions. If a title or status is wrong, edit unit_sequence; the packets
-- array is the part that must not be guessed at, and it is not.

---- 1. Scope the three legacy AA HL packets ---------------------------------

update public.nuanced_analyses
set course_id    = '7abac7b1-2cf6-4c94-a12b-3e083ed139c3',
    grade_level  = 'Grade 11',
    section_code = 'S00E01'
where id = '26a383e8-0e41-4ae0-ab03-0f9ed7ad1000';

update public.nuanced_analyses
set course_id    = '7abac7b1-2cf6-4c94-a12b-3e083ed139c3',
    grade_level  = 'Grade 11',
    section_code = 'S00E02'
where id = '6add8ddf-e51b-403c-b985-c04e00a0be27';

update public.nuanced_analyses
set course_id    = '7abac7b1-2cf6-4c94-a12b-3e083ed139c3',
    grade_level  = 'Grade 11',
    section_code = 'S00E03'
where id = 'd9897225-cae1-41b0-bde6-851c58ee7f94';

---- 2. Create the AA HL continuity record -----------------------------------

insert into public.na_continuity (course_id, packets, unit_sequence)
values (
  '7abac7b1-2cf6-4c94-a12b-3e083ed139c3',
  $packets$
[
  {
    "section": "S00E01",
    "slug": "the-binomial-theorem-from-pascal-s-triangle-to-fractional-powers",
    "title": "The Binomial Theorem: From Pascal's Triangle to Fractional Powers",
    "where_it_left_off": "Ends having established the binomial theorem for positive integer $n$ from Pascal's Triangle and $\\binom{n}{r}$, extracted named terms with the general term (including the term independent of $x$ and a coefficient-matching problem), then extended to the GENERAL binomial theorem for rational $n$ with its $|x|<1$ validity condition, finishing with a Broken Math critique of an expansion that failed to factor the leading constant out first. Did NOT cover: Maclaurin series (5.19), the binomial distribution as a probability topic in its own right (only one applied binomial-probability question appeared), or a proof of the theorem by induction.",
    "vocabulary_introduced": [
      "binomial coefficient",
      "Pascal's Triangle",
      "Pascal's Rule",
      "binomial theorem",
      "general term",
      "term independent of x",
      "general binomial theorem",
      "range of validity",
      "convergence",
      "ascending powers",
      "descending powers"
    ],
    "notation_conventions": [
      "$\\binom{n}{r}$ and $^{n}C_{r}$ both used for the binomial coefficient; the GDC $^{n}C_{r}$ function used to verify identities numerically",
      "Positive-integer expansions written in DESCENDING powers; general (rational $n$) expansions written in ASCENDING powers",
      "Every general binomial expansion is stated together with its condition on $|x|$ -- an expansion without a validity range is treated as incomplete",
      "Syllabus cited as IB topic references: Topic 1.9 (The Binomial Theorem), Topic 1.5 (Laws of exponents; sequences of partial sums)"
    ],
    "tok_provocations_used": [
      "Pascal's Triangle was documented in Persia (Al-Karaji), China (Yang Hui), and India centuries before Blaise Pascal's 1654 treatise -- when a mathematical structure is discovered independently by multiple cultures, does the person whose name it bears actually own the knowledge?",
      "The general binomial expansion of $(1-x)^{-3} = 1 + 3x + 6x^2 + 10x^3 + \\ldots$ is only true for $|x|<1$; outside that domain the series diverges to nonsense. Can a mathematical statement be considered true if its truth depends entirely on an unstated numerical restriction?"
    ],
    "misconceptions_planted": [
      "Part 4 Broken Math Critique, the 'Forgetting to Factor' error: expanding $(4+x)^{1/2}$ straight from the general binomial theorem instead of first writing it as $2(1+x/4)^{1/2}$, which produces an incorrect radius of convergence"
    ],
    "international_mindedness_used": [
      "Al-Karaji (Persia)",
      "Yang Hui (China)",
      "Blaise Pascal (1654, France)",
      "India, credited generically as an independent origin of Pascal's Triangle"
    ],
    "content_spent": [
      "SECTION HEADINGS SPENT (do not reuse or rephrase): Part 1 -- From Pascal's Triangle to the Binomial Theorem; Part 2 -- The General Term: Hunting for a Specific Coefficient; Part 3 -- Beyond Positive Integers: The General Binomial Theorem (HL Extension); Part 4 -- Broken Math Critique: The 'Forgetting to Factor' Error",
      "Worked expansions spent: $(2x-3)^4$; the constant term of $(2x^2 - 1/x)^9$; the coefficient of $x^3$ in $(1+kx)^7$ equal to $280$; $(1-x)^{-3}$; $\\sqrt{1.02}$ via $(1+0.02)^{1/2}$; $(4+x)^{1/2}$",
      "Pascal's Rule verified on the GDC as $\\binom{10}{3} + \\binom{10}{4} = \\binom{11}{4}$, and row $n=8$ of Pascal's Triangle written out",
      "Semiconductor quality-control context: batches of 12 microchips, each independently defective with probability $0.05$, exactly 2 defective via the relevant term of $(0.95+0.05)^{12}$"
    ]
  },
  {
    "section": "S00E02",
    "slug": "quadratics-the-calculus-transition",
    "title": "Quadratics & The Calculus Transition",
    "where_it_left_off": "Ends having derived the vertex $x = -b/(2a)$ by completing the square on the general standard form, worked domain, range, transformations and the inverse-on-a-restricted-domain for quadratics, reformulated the quadratic formula as $x = h \\pm d$ to give the discriminant a geometric reading, then crossed deliberately into calculus: secant slopes numerically and algebraically, the formal limit definition, a first-principles proof that the derivative of $ax^2+bx+c$ is $2ax+b$, and the equation of a tangent. Closed its own loop by setting $f'(x)=0$ to recover the Part 1 completing-the-square vertex. Did NOT cover: polynomials of degree above 2, polynomial division, complex roots, or concavity and inflexion beyond observing that $f''$ is the constant $2a$.",
    "vocabulary_introduced": [
      "standard form",
      "vertex form",
      "factored form",
      "vertex",
      "axis of symmetry",
      "discriminant",
      "domain",
      "range",
      "end behaviour",
      "inverse function",
      "domain restriction",
      "average rate of change",
      "secant line",
      "tangent line",
      "derivative",
      "first principles",
      "limit",
      "second derivative",
      "derivative sign graph"
    ],
    "notation_conventions": [
      "IB transformation terminology used precisely when describing the sequence mapping $y=x^2$ onto a given quadratic",
      "Lagrange notation $f'(x)$ and $f''(x)$ for derivatives; $\\Delta x$ for the increment in the limit definition",
      "Discriminant written $\\Delta$",
      "A derivative sign graph is the required justification for strictly increasing and strictly decreasing intervals",
      "GDC permitted for vertex and roots, but exact values must still be produced algebraically",
      "Syllabus cited as IB topic references: Topic 2 (Functions), Topic 5 (Calculus)"
    ],
    "tok_provocations_used": [
      "Do Newton and Leibniz's formulations of calculus represent a sudden paradigm shift in human knowledge, or simply the inevitable logical consequence of studying the rates of change in curves like quadratics?",
      "The quadratic formula produces exact answers from purely symbolic manipulation -- yet those answers describe physical reality (projectile motion, optics, acoustics). Does the unreasonable effectiveness of algebra suggest mathematics is discovered, not invented?"
    ],
    "misconceptions_planted": [
      "Q5 targets the assumption that every function has an inverse: $g(x)=2x^2-12x+10$ has none over $x \\in \\mathbb{R}$ until the domain is restricted. NOTE: this packet has no Broken Math Critique part -- it is the only one of the three that does not, so a flawed-solution critique is still unspent for quadratics."
    ],
    "international_mindedness_used": [
      "Isaac Newton and Gottfried Leibniz, credited jointly for the formulation of calculus"
    ],
    "content_spent": [
      "SECTION HEADINGS SPENT (do not reuse or rephrase): Part 1 -- The Architecture of the Quadratic; Part 2 -- Domain, Range, and Transformations; Part 3 -- Roots and Rates of Change; Part 4 -- The Calculus Transition",
      "Worked functions spent: $g(x)=2x^2-12x+10$ (used repeatedly for vertex, transformations, inverse and derivative sign graph); $q(x)=-x^2+4x+5$; $f(x)=-x^2+4x+5$ (average rate of change on $[1,4]$ and its secant); $p(x)=x^2-4x+5$ as the $\\Delta<0$ case; $f(x)=x^2-6x+8$ (secant to tangent at $x=4$ with $\\Delta x = 0.1$); $f(x)=3x^2-5x+2$ (tangent at $x=2$)",
      "The $x = h \\pm d$ reformulation of the quadratic formula, with $d$ read as the horizontal distance from the axis of symmetry to each root",
      "End-behaviour investigated by evaluating at $x=100$ and $x=-100$ and sketching with end-behaviour arrows",
      "Bridging the vertical stretch $a$ to constant acceleration via $f''(x)=2a$"
    ]
  },
  {
    "section": "S00E03",
    "slug": "polynomial-analysis",
    "title": "Polynomial Analysis",
    "where_it_left_off": "Ends having covered the graphical behaviour of polynomials (multiplicity deciding cross versus bounce), both long and synthetic division with the synthetic table explained cell by cell, the Factor and Remainder Theorems used together to solve for unknown coefficients, the Conjugate Root Theorem, sum and product of roots, a first-principles proof that the derivative of $x^n$ is $nx^{n-1}$ built on the binomial expansion from S00E01, concavity and points of inflexion via a second-derivative sign diagram, and GDC windowing for a function with extreme vertical scale. Did NOT cover: rational functions and their asymptotes, integration of polynomials, optimisation, or related rates. Its stated prerequisites name a 'Complex Numbers Part 1' packet that is NOT in this continuity record -- complex arithmetic is assumed fluent.",
    "vocabulary_introduced": [
      "multiplicity",
      "cross versus bounce at a root",
      "sign diagram",
      "long division of polynomials",
      "synthetic division",
      "quotient",
      "remainder",
      "Factor Theorem",
      "Remainder Theorem",
      "Conjugate Root Theorem",
      "complex conjugate",
      "sum and product of roots",
      "concave up",
      "concave down",
      "point of inflexion",
      "local extrema",
      "viewing window"
    ],
    "notation_conventions": [
      "The synthetic division table layout is taught explicitly, cell by cell, and students must be able to explain each entry rather than just execute it",
      "Missing degrees must be written in as $0$ coefficients before dividing",
      "A second-derivative sign diagram is the required justification for concavity and inflexion claims",
      "Greek letters $\\alpha, \\beta, \\gamma$ for the roots of a cubic",
      "$C(n,r)$ used in the first-principles binomial expansion of $(x+h)^n$",
      "Limit notation must be maintained on every line of a first-principles derivation",
      "GDC viewing window stated explicitly as Xmin, Xmax, Ymin, Ymax",
      "Syllabus cited as IB topic references: Topic 2 (Functions), Topic 5 (Calculus)"
    ],
    "tok_provocations_used": [
      "Polynomial division is a purely mechanical procedure yet it reveals the hidden factor structure of a polynomial with no prior knowledge of its roots. Does this algorithm suggest mathematical structure is discovered, or that we invented a powerful bookkeeping system?",
      "The Conjugate Root Theorem guarantees complex roots come in conjugate pairs, but only when coefficients are real. What does it mean that a constraint on inputs (real coefficients) forces a constraint on outputs (paired complex roots)? Is this a property of polynomials, or of the real number system itself?"
    ],
    "misconceptions_planted": [
      "Part 2 Broken Math Critique: solving $x^2-3x \\le 0$ by dividing both sides by $x$, obtaining $x \\le 3$, which loses the $x=0$ boundary and the correct solution set $0 \\le x \\le 3$ -- the error is dividing an inequality by a quantity whose sign is unknown"
    ],
    "international_mindedness_used": [],
    "content_spent": [
      "SECTION HEADINGS SPENT (do not reuse or rephrase): Part 1 -- Graphical Foundations of Polynomials; Part 2 -- The Broken Math Critique; Part 3 -- Polynomial Division and Complex Roots; Part 4 -- Polynomial Theorems; Part 5 -- Calculus Foundations: First Principles; Part 6 -- Calculus Connections and Concavity; Part 7 -- GDC Mastery",
      "Worked polynomials spent: $g(x)=-\\frac{1}{2}(x+4)(x-1)^2$; the multiplicity sketch family $(x+3)(x-2)$, $(x+3)^2(x-2)$, $-(x+3)^3(x-2)$, $-(x+3)^2(x-2)^2$; the cubic touching at $x=2$, crossing at $x=-3$, $y$-intercept $(0,24)$; $P(x)=x^3-4x^2+x+6$ with root $x=2$; $3x^4-5x^2+2x+4$ divided by $x+1$; $2x^4-7x^2+3$ divided by $x+1$; $H(x)=x^4-2x^3-7x^2+8x+12$; the cubic with real root $4$ and complex root $-1+2i$; $P(x)=2x^3+ax^2+bx-6$; $C(x)=3x^3-12x^2+kx-15$; $f(x)=2x^3-5x$ from first principles; $f(x)=\\frac{1}{4}x^4-2x^3+4x^2$ for concavity; $f(x)=x^3-50x^2+2$ for GDC windowing",
      "The $x^2-3x \\le 0$ divide-by-$x$ error is spent as a flawed-solution critique",
      "Deducing the even/odd multiplicity rule by comparing four sketches is spent as a discovery task"
    ]
  }
]
  $packets$::jsonb,
  $spine$
[
  {
    "section": "S04E01",
    "title": "From the Unit Circle to the Graph: sin x, cos x and tan x as Functions",
    "status": "done",
    "prep_note": "IB 3.7. NOTE ON THIS SPINE: Season 4 was seeded on 2026-09-17 from syllabus_coverage, which lists 3.7, 3.8, 3.9 and 3.11 as still uncovered for this cohort. E01-E06 are marked done because the teacher is generating E07; no packets exist for them, so they contribute titles and ordering but no prohibitions. Correct any title or status here directly.",
    "prep_already_shipped": false
  },
  {
    "section": "S04E02",
    "title": "Amplitude, Period and Principal Axis: the Shape of a Sinusoid",
    "status": "done",
    "prep_note": "IB 3.7.",
    "prep_already_shipped": false
  },
  {
    "section": "S04E03",
    "title": "Transformations of the Sinusoid: f(x) = a sin(b(x + c)) + d",
    "status": "done",
    "prep_note": "IB 3.7. Composite form; connects to the transformation language already established in S00E02.",
    "prep_already_shipped": false
  },
  {
    "section": "S04E04",
    "title": "The Tangent Function, Its Period and Its Asymptotes",
    "status": "done",
    "prep_note": "IB 3.7.",
    "prep_already_shipped": false
  },
  {
    "section": "S04E05",
    "title": "Modelling Periodic Phenomena in Context",
    "status": "done",
    "prep_note": "IB 3.7, real-life contexts.",
    "prep_already_shipped": false
  },
  {
    "section": "S04E06",
    "title": "Solving Trigonometric Equations Graphically and Analytically",
    "status": "done",
    "prep_note": "IB 3.8, over a finite interval.",
    "prep_already_shipped": false
  },
  {
    "section": "S04E07",
    "title": "Trigonometric Equations Reducing to Quadratics",
    "status": "next",
    "prep_note": "IB 3.8, the second half: equations leading to a quadratic in sin x, cos x or tan x. VERIFY THIS TITLE before generating -- it was inferred, not supplied. RESERVED FOR LATER, do not pre-empt: the reciprocal ratios sec, csc and cot and the extended Pythagorean identities belong to E08; the inverse functions arcsin, arccos and arctan belong to E09; their derivatives and integrals belong to E10 and E11. Unspent Broken Math territory: S00E02 is the only prior packet with no flawed-solution critique, and losing roots by dividing through by a trig factor (the direct analogue of the S00E03 divide-by-x error, which IS spent) is the obvious candidate -- if used, it must be framed as a new context, not a repeat. Mathematicians already credited across S00E01-S00E03: Al-Karaji, Yang Hui, Pascal, Newton, Leibniz; pick someone new (Hipparchus, Aryabhata, Madhava and al-Battani are all unspent and fit this content).",
    "prep_already_shipped": false
  },
  {
    "section": "S04E08",
    "title": "Reciprocal Ratios: sec, csc, cot and the Extended Pythagorean Identities",
    "status": "planned",
    "prep_note": "IB 3.9, first half: definitions of the reciprocal ratios and the identities 1 + tan^2 = sec^2 and 1 + cot^2 = csc^2.",
    "prep_already_shipped": false
  },
  {
    "section": "S04E09",
    "title": "Inverse Trigonometric Functions: arcsin, arccos and arctan",
    "status": "planned",
    "prep_note": "IB 3.9, second half: the inverse functions with their domains, ranges and graphs. The domain-restriction argument from S00E02 Q5 is the direct precedent -- reactivate it rather than re-teaching it.",
    "prep_already_shipped": false
  },
  {
    "section": "S04E10",
    "title": "Derivatives of the Reciprocal and Inverse Trigonometric Functions",
    "status": "planned",
    "prep_note": "IB 5.15, differentiation half.",
    "prep_already_shipped": false
  },
  {
    "section": "S04E11",
    "title": "Integrals Yielding Inverse Trigonometric Functions",
    "status": "planned",
    "prep_note": "IB 5.15, integration half.",
    "prep_already_shipped": false
  },
  {
    "section": "S04E12",
    "title": "Symmetry Relationships Between the Trigonometric Functions",
    "status": "planned",
    "prep_note": "IB 3.11, the closing synthesis of the season.",
    "prep_already_shipped": false
  }
]
  $spine$::jsonb
)
on conflict (course_id) do update
set packets       = excluded.packets,
    unit_sequence = excluded.unit_sequence;