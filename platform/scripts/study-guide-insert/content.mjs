/**
 * The three vocabulary entries, written once, in the voice of each guide.
 *
 * Both registers set their mathematics as ordinary text -- italic letters, a
 * real minus sign (U+2212) in the Key Assessment guide, hyphen-minus in the
 * Formative one because that is what the rest of that document types. KaTeX was
 * tried first for the Key Assessment page, since the guide's own mathematics is
 * typeset, and it had to go: it positions every atom in its own box, so
 * pdf-parse pulls the symbols out of the sentence and dumps them at the foot of
 * the page. The stored extracted_text is what the assessment generator reads,
 * so a sentence that extracts as "In the numerator is ." costs more than a
 * built-up fraction is worth. Inline solidus fractions extract whole.
 */

/** Key Assessment 1 (summative) -- four columns: word / own words / precise / example. */
export const KA1_ROWS = [
  {
    word: "Numerator",
    own: "The top of the fraction.",
    precise:
      "The expression written above the fraction bar — the quantity being divided.",
    example:
      'In <span class="m">(3<i>x</i> − 1)/5</span> the numerator is <span class="m">3<i>x</i> − 1</span>.',
  },
  {
    word: "Denominator",
    own: "The bottom of the fraction.",
    precise:
      "The expression written below the fraction bar — the quantity you are dividing by. It may never take the value 0.",
    example:
      'In <span class="m">7/(<i>t</i> − 2)</span> the denominator is <span class="m"><i>t</i> − 2</span>, so <span class="m"><i>t</i> ≠ 2</span>.',
  },
  {
    word: "Subject",
    wordNote: "(also on page 2)",
    own: "The letter standing alone.",
    precise:
      "The variable isolated on one side of an equation or a formula, with every other quantity on the other side. Page 2 gives this for a formula; it reads the same way for any equation.",
    example:
      'Making <i>h</i> the subject of <span class="m"><i>A</i> = <i>bh</i>/2</span> gives <span class="m"><i>h</i> = 2<i>A</i>/<i>b</i></span>.',
  },
];

/** Formative 1 -- three columns: word / precise meaning / example. */
export const FORM1_ROWS = [
  {
    word: "Numerator",
    meaning:
      "The expression written above the fraction bar; the quantity being divided.",
    example: "In (3x - 1)/5, the numerator is 3x - 1.",
  },
  {
    word: "Denominator",
    meaning:
      "The expression written below the fraction bar; the quantity you are dividing by. A denominator may never equal 0.",
    example: "In 7/(x - 2), the denominator is x - 2, so x ≠ 2.",
  },
  {
    word: "Subject (of an equation)",
    meaning:
      "The variable left standing alone on one side, with every other quantity on the other side. To “make y the subject” is to rearrange until y stands alone.",
    example:
      "In A = (1/2)bh, A is the subject. Rearranged, h = 2A/b makes h the subject.",
  },
];
