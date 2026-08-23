# Nuanced Analysis: The Great Unification — From $i$ to $e^{i\pi}$

**Student Name:** ________________________  **Date:** ____________

**Course:** IBDP Mathematics — Analysis & Approaches HL
**Syllabus Topic(s):** Topic 1 (Number & Algebra, HL) · Topic 3 (Geometry & Trigonometry, HL) · Topic 5 (Calculus, HL)
**Prerequisites:** *Complex Numbers Part 1 & 2*, *Polynomial Analysis*, *Quadratics & The Calculus Transition*

*Materials needed: GDC (TI-84 Plus CE or equivalent) and graphing software capable of plotting on the Argand plane (GeoGebra or Desmos). A ruler. This packet is designed to be completed largely **without** a calculator, in the spirit of Paper 1.*

---

> **NOTE FOR CLAUDE CODE:** This file is the canonical exemplar of a completed Nuanced Analysis packet. Use it as the gold-standard reference for structure, tone, question design, and Teacher's Companion format when generating new NA activities. All design decisions here are intentional — study it before generating.

---

### Command Terms used in this analysis

| Term | What it demands of you |
|---|---|
| **Write down** | A short answer with **no** working required. |
| **Describe** | Give a detailed account. |
| **Explain** | Give a detailed account **including reasons or causes**. |
| **Deduce** | Reach a conclusion by logical reasoning from results already established. |
| **Show that** | Obtain a stated result; **every** logical step must appear. |
| **Prove** | Establish truth by a rigorous, complete chain of reasoning. |
| **Hence** | You **must** use the immediately preceding result. Starting over earns no marks. |
| **Hence or otherwise** | Use the previous result *or* any other valid method. |
| **Sketch** | A clear diagram showing key features and **relative** scale; label exact coordinates of intercepts, extrema, and special points. |

> **Command-Term Spotlight — "Show that" vs "Prove".**
> *Show that* fixes the target in advance and rewards the trail of steps that reaches it. *Prove* is the same rigour applied to a claim that must hold for **all** cases.

**Vocabulary:** modulus, argument, polar form, De Moivre's theorem, mathematical induction, root of unity, regular polygon, Maclaurin series, radius of convergence, Euler's formula, phasor.

**ATLs — Thinking & Transfer Skills:** You will repeatedly take a result proven *algebraically* and reinterpret it *geometrically*, then *analytically* (as a series). The skill being built is **representational fluency**: recognising one object wearing different clothing.

---

> ### TOK provocations (return to these in the final Reflection)
> - Euler's identity $e^{i\pi}+1=0$ is routinely voted "the most beautiful equation in mathematics." **Can aesthetic appeal be evidence of mathematical truth, or is beauty merely a property we project onto results we have already accepted?**
> - The number $i$ was introduced by *definition* ($i^2=-1$) to make unsolvable equations solvable. When centuries later it turned out to describe rotation, alternating current, and quantum states, was $i$ **discovered** to be real, or did we **invent** a tool that we then chose to apply? Does usefulness make something real?

> ### International-mindedness
> The geometric picture of a complex number you used in Part 1 was published independently by **Caspar Wessel** (Norwegian-Danish, 1799) and **Jean-Robert Argand** (Genevan-French, 1806) -- the diagram bears only Argand's name. The series you will meet in Part 5 were used by **Leonhard Euler** (Swiss), but the underlying trigonometry rests on a thousand years of work by Indian (Aryabhata, Madhava of Sangamagrama -- who found the sin/cos series ~250 years before Newton) and Islamic-world (al-Battani, Abu al-Wafa') mathematicians. Notation is a poor historian.

---

## Part 0 -- Activating Prior Knowledge (bridge from Part 1)

Recall from *Complex Numbers Part 1*: a non-zero complex number can be written in **polar (modulus-argument) form**
$$ z = r(\cos\theta + i\sin\theta), \qquad r = |z| = \sqrt{a^2+b^2}, \qquad \theta = \arg(z). $$

**1.** *Write down* the polar form of each, with $-\pi < \theta \le \pi$:
  (a) $z = 1 + i\sqrt{3}$   (b) $z = -1$   (c) $z = -2 - 2i$

**2.** *Describe*, in one sentence each, what the two numbers $r$ and $\theta$ tell you **geometrically** about where $z$ sits on the Argand plane.

---

## Part 1 -- The Geometry of Multiplication *(Conjecture before rule)*

Let $z_1 = r_1(\cos\alpha + i\sin\alpha)$ and $z_2 = r_2(\cos\beta + i\sin\beta)$.

**3. Numerical investigation (no formula yet).** Using $z_1 = 2(\cos 30° + i\sin 30°)$ and $z_2 = 3(\cos 45° + i\sin 45°)$, compute the product $z_1 z_2$ and rewrite it in polar form. *Write down* its modulus and its argument.

**4. Conjecture.** Based on Q3, *write* a conjecture relating the modulus and argument of a product $z_1 z_2$ to the moduli and arguments of $z_1$ and $z_2$.

**5. Demonstrate.** *Show that* your conjecture is correct in general by multiplying the two polar forms and applying the **compound-angle formulae**.

> **Geometric reading.** Multiplying by a complex number is a **rotation** (by its argument) combined with a **scaling** (by its modulus). Multiplication *is* a similarity transformation.

---

## Part 2 -- De Moivre's Theorem *(Conjecture -> Proof by Induction)*

**6.** Restrict to the unit circle by setting every modulus to $1$. Using your Part 1 result repeatedly, *write* a conjecture for $(\cos\theta + i\sin\theta)^{n}$, $n \in \mathbb{Z}^{+}$.

**7. Prove De Moivre's Theorem by mathematical induction.** *Prove* that for all $n \in \mathbb{Z}^{+}$,
$$ (\cos\theta + i\sin\theta)^{n} = \cos n\theta + i\sin n\theta. $$
A three-part scaffold:
- **Base case:** verify the statement for $n = 1$.
- **Inductive step:** *assume* the statement holds for $n = k$. Then write $(\cos\theta+i\sin\theta)^{k+1}$ and use the assumption **together with your Part 1 result** to finish.
- **Conclusion:** *write* the standard induction closing sentence.

**8.** *Deduce* the full-modulus version, $[r(\cos\theta+i\sin\theta)]^{n} = r^{n}(\cos n\theta + i\sin n\theta)$.

> ### The Broken Math Critique
> A student writes: $[2(\cos 30° + i\sin 30°)]^{4} = \cos 120° + i\sin 120° = -1/2 + (\sqrt{3}/2)i.$
> **9.** (a) *Explain* the fatal error and the HL misconception it reveals. (b) *Determine* the correct value, in Cartesian form.

---

## Part 3 -- Where Trigonometric Identities Come From

**10.** Apply De Moivre with $n = 2$. *Show that* $\cos 2\theta = \cos^2\theta - \sin^2\theta$ and $\sin 2\theta = 2\sin\theta\cos\theta$.

**11.** Now use $n = 3$ and the binomial expansion. *Show that* $\cos 3\theta = 4\cos^3\theta - 3\cos\theta$ and $\sin 3\theta = 3\sin\theta - 4\sin^3\theta$.

**12. Reflect.** *Explain* why this is **not** circular reasoning.

---

## Part 4 -- Roots of Unity

**13.** *Solve* $z^{3} = 1$ over $\mathbb{C}$.

**14.** *Sketch* the three roots on an Argand diagram. *Describe* the polygon they form.

**15. Generalise.** *Write* a general formula for the $n$ solutions of $z^{n} = 1$, and *describe* their geometric arrangement.

**16.** (a) *Show that* the sum of all $n$ roots of unity is $0$ for every $n \ge 2$. (b) *Explain* this geometrically. (c) *Explain* why non-real roots occur in conjugate pairs.

**17. Technology.** In GeoGebra or Desmos, plot the $n = 6$ roots of unity. *Describe* one feature easier to see graphically than algebraically, and one easier to prove algebraically than to see.

---

## Part 5 -- The Calculus Bridge: Series

**18.** *Explain* why it matters that the series for $e^{x}$ converges for **all** real $x$ before we substitute an imaginary number into it.

> ### Find the Fatal Error
> A set of revision notes reaches the conclusion $e^{i\theta} = \cos\theta + i\sinh\theta$.
> **19.** (a) *Explain* the geometric reason this **cannot** be right. (b) *Determine* the line where the error is introduced and *show that* correcting it changes the imaginary series into an alternating one.

**20. Show that** $e^{i\theta} = \cos\theta + i\sin\theta$ (Euler's formula).

---

## Part 6 -- Euler's Identity and the Synthesis

**21.** *Hence* evaluate $e^{i\pi}$, and *write down* the resulting identity.

**22.** *Show that* De Moivre's theorem is a **one-line consequence** of Euler's formula.

---

## Part 7 -- Interdisciplinary Application: Phasors

**23.** Two voltages: $v_1(t) = 3\cos(\omega t)$, $v_2(t) = 4\cos(\omega t + \pi/2)$.
(a) *Write down* the phasor for each. (b) *Determine* their sum. (c) *Hence* express the combined voltage in the form $R\cos(\omega t + \varphi)$. (d) *Explain* what feature of complex numbers makes this method work.

**24.** *Describe* how the appearance of $e^{i\theta}$ in a physical law bears on the TOK question about whether $i$ was discovered or invented.

---

## Part 8 -- GDC / Technology Mastery

**25.** Fix $\theta = \pi$. Compute partial sums $S_m = \sum_{n=0}^{m} (i\pi)^{n}/n!$ for $m = 0, 1, ..., 8$ and plot each as a point.
(a) *Describe* the path the points trace. (b) *Write down* the point the sequence is closing in on and *explain* how this confirms Q21. (c) *Determine* an appropriate viewing window.

---

## Reflection

**26.** *List* the major concepts this analysis has confirmed or connected (at least six, one from each of Topics 1, 3, and 5).

**27.** *Explain* what is gained by holding two independent proofs of one truth. Does a second proof make the result *more true*?

**28.** *Take and defend a position* on one of the two TOK provocations from page 1, using a specific result from this packet as evidence.

---

## Extension and IA-Seeding Branches *(optional)*

- **(Topic 4 -- Probability.)** **Random walk on the roots of unity.** Investigate the expected distance from the origin after $k$ steps.
- **(Computer Science / Geometry.)** **Newton's fractal.** Apply Newton's method to $z^{n} - 1 = 0$ and colour each starting point by which root it converges to.
- **(Topic 1 -- Number & Algebra.)** **Beyond unity.** Generalise Part 4 to the $n$-th roots of an arbitrary complex number $w$.

---
---

# Teacher's Companion

*Remove before distributing to students.*

### A. Integration Map

| IB element | Where it lives |
|---|---|
| Topic 1 (Number & Algebra, HL) | Polar form (Q1-2), De Moivre (Q6-8), induction (Q7), binomial (Q11), roots of unity (Q13-17), Vieta (Q16). |
| Topic 3 (Geometry & Trig, HL) | Multiplication as rotation (Q3-5), multiple-angle identities (Q10-11), regular polygons (Q14-15). |
| Topic 5 (Calculus, HL) | Maclaurin series (Q18-20), convergence (Q18), partial-sum convergence (Q25). |
| TOK | p.1 provocations; Q24, Q27, Q28. |
| International-mindedness | p.1 box (Wessel/Argand; Madhava; Islamic-world trigonometry). |
| Interdisciplinary | Part 7 phasors (physics/EE); extension fractals (CS). |
| Technology | Q17 (GeoGebra), Q25 (partial-sum spiral). |
| ATL skills | Representational fluency; Q12, Q22, Q27. |
| Command terms | Glossary + Show that/Prove spotlight; Hence in Q21-22. |
| IA seeding | Three extension branches. |
| Paper alignment | Non-calculator core mirrors Paper 1; investigation/proof arc mirrors Paper 3. |

### B. Pedagogical moves located

- Conjecture-before-rule: Q4, Q6, Q15.
- Worked-example to parallel practice: Q10 (n=2) -> Q11 (n=3).
- Planted error, both flavours: Q9 (Broken Math Critique), Q19 (Find the Fatal Error).
- Translation table: Part 4 (geometric <-> algebraic language).
- Command-term spotlight: Show that vs Prove (p.1).
- Rule of four: polar form, rotation, polygon, and series.
- Metacognitive reflection: Q26-28.

### C. Answer sketches

- Q1: (a) 2(cos pi/3 + i sin pi/3); (b) cos pi + i sin pi; (c) 2sqrt(2)(cos(-3pi/4) + i sin(-3pi/4)).
- Q3: z1z2 = 6(cos 75° + i sin 75°).
- Q9: Student forgot to raise modulus to 4th power. Correct: 16(cos 120° + i sin 120°) = -8 + 8sqrt(3)i.
- Q13: z = 1, -1/2 +/- sqrt(3)/2 i.
- Q15: z_k = cos(2pi k/n) + i sin(2pi k/n), k = 0,...,n-1.
- Q19: Slip is i^3 = i (correct: i^3 = -i). Correcting it makes the imaginary series alternating, giving sin theta.
- Q21: e^(i pi) = -1, hence e^(i pi) + 1 = 0.
- Q23: Phasors 3 and 4i; sum 3+4i; R=5, phi = arctan(4/3); combined 5cos(wt + 53.13°).
- Q25: Partial sums spiral inward toward (-1.00, 0.00), confirming e^(i pi) = -1.

### D. Design note

Topics 1, 3, and 5 integrate at depth. Probability & Statistics is handled at extension level only -- this is intentional. If full five-topic coverage is required, run alongside a separate statistics NA rather than diluting this one.
