alter table public.courses
  add column archived boolean not null default false;

comment on column public.courses.archived is 'Soft-archive flag. Archived courses are hidden from active course pickers/lists app-wide but remain directly accessible by ID (e.g. gradebook, Google Classroom links) and can be unarchived or deleted from the Archived Courses page.';;
