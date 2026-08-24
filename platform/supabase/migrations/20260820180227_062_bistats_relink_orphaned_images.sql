-- 062: relink question_images that were extracted before question_parts
-- existed (part_id was null) to the parts created in migration 061 -- only
-- for the two single-part questions where the link is unambiguous.
-- 18M.2.SL.TZ1.S_8 is deliberately left with part_id=null: it has 3 real
-- parts but only 1 markscheme image, so that image almost certainly holds
-- all three parts' schemes together and should not be force-linked to a
-- single part label. Re-extraction after the mark scheme doc is confirmed
-- complete should resolve this properly.

UPDATE public.question_images
SET part_id = '13cb285e-cbb3-4802-a332-4091199169c9'
WHERE question_id = '879d01e0-5be1-402c-a3f5-92350a2f826a' AND part_id IS NULL;

UPDATE public.question_images
SET part_id = '6ce19fa3-21cc-4f88-b161-3cbe246d57bc'
WHERE question_id = '53d5f42c-f9ce-424f-ad5b-20538670d75a' AND part_id IS NULL;;
