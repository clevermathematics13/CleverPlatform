-- Add SEAT rule type: pins a student to a specific seat_id (hard constraint)
-- Extends the check constraint and adds a seat_id column.

ALTER TABLE public.seating_rules
  DROP CONSTRAINT IF EXISTS seating_rules_rule_type_check;

ALTER TABLE public.seating_rules
  ADD CONSTRAINT seating_rules_rule_type_check
  CHECK (rule_type IN ('PAIR', 'POD', 'SEAT'));

ALTER TABLE public.seating_rules
  ADD COLUMN IF NOT EXISTS seat_id TEXT NOT NULL DEFAULT '';
