-- Update default answer line height from 10mm to 12mm for better readability
alter table assignment_templates 
alter column answer_line_height_mm set default 12;

comment on column assignment_templates.answer_line_height_mm is 'Height of each answer line in mm (6-16, default 12)';;
