-- Create assignment_templates table
create table if not exists assignment_templates (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  template_name text not null,
  grade_level text not null check (grade_level in ('Grade 9', 'Grade 10', 'Grade 11', 'Grade 12')),
  document_kind text not null,
  formatting_requirements jsonb,
  assignment_input jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create index for faster lookups
create index idx_assignment_templates_user_id on assignment_templates(user_id);
create index idx_assignment_templates_grade_level on assignment_templates(grade_level);
create index idx_assignment_templates_user_grade on assignment_templates(user_id, grade_level);

-- Enable RLS
alter table assignment_templates enable row level security;

-- Create RLS policies
create policy "Users can read own templates"
  on assignment_templates
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own templates"
  on assignment_templates
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own templates"
  on assignment_templates
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own templates"
  on assignment_templates
  for delete
  using (auth.uid() = user_id);
