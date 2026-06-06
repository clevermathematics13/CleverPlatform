-- Add answerLineHeightMm field to assignment_templates table for customizable line spacing
alter table assignment_templates 
add column if not exists answer_line_height_mm numeric default 10 check (answer_line_height_mm >= 6 and answer_line_height_mm <= 16);

comment on column assignment_templates.answer_line_height_mm is 'Height of each answer line in mm (6-16, default 10)';
