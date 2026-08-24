UPDATE question_parts
SET markscheme_latex = regexp_replace(markscheme_latex, '^8\.\s+', '')
WHERE id = '35e61b86-aa6c-41a4-8463-4c6a658da96c'
  AND markscheme_latex LIKE '8. METHOD%';;
