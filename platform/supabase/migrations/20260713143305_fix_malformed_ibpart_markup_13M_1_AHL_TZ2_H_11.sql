UPDATE question_parts qp
SET
  content_latex = trim(both E'\n' from regexp_replace(
    regexp_replace(
      regexp_replace(qp.content_latex, '\\begin\{IBPart\}\{(\([a-zA-Z]+\))\}', E'\n\\1', 'g'),
      '\\end\{IBPart\}', '', 'g'
    ),
    '\n{3,}', E'\n\n', 'g'
  )),
  markscheme_latex = trim(both E'\n' from regexp_replace(
    regexp_replace(qp.markscheme_latex, '\\begin\{IBPart\}|\\end\{IBPart\}', '', 'g'),
    '\n{3,}', E'\n\n', 'g'
  ))
FROM ib_questions iq
WHERE qp.question_id = iq.id
  AND iq.code = '13M.1.AHL.TZ2.H_11';;
