UPDATE question_parts qp
SET markscheme_latex =
  '(a)

(i)

' ||
  replace(
    replace(
      replace(
        replace(
          qp.markscheme_latex,
          $a4$$\boldsymbol{r}=\overrightarrow{\mathrm{OA}}+t \overrightarrow{\mathrm{AB}}$ (or equivalent)$a4$,
          $r4$(d)

$\boldsymbol{r}=\overrightarrow{\mathrm{OA}}+t \overrightarrow{\mathrm{AB}}$ (or equivalent)$r4$
        ),
        $a3$[5 marks]

attempt at the use of$a3$,
        $r3$[5 marks]

(c)

attempt at the use of$r3$
      ),
      $a2$[6 marks]

(i)

$$\overrightarrow{\mathrm{BC}}$a2$,
      $r2$[6 marks]

(b)

(i)

$$\overrightarrow{\mathrm{BC}}$r2$
    ),
    $a1$METHOD 1$a1$,
    $r1$(ii)

METHOD 1$r1$
  )
FROM ib_questions iq
WHERE qp.question_id = iq.id
  AND iq.code = '13M.1.AHL.TZ2.H_11';;
