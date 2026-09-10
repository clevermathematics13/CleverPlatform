alter table public.assignment_templates
  add column nuanced_analysis_id uuid references public.nuanced_analyses(id) on delete set null;

create index if not exists assignment_templates_nuanced_analysis_id_idx
  on public.assignment_templates (nuanced_analysis_id);

create unique index if not exists assignment_templates_user_packet_uniq
  on public.assignment_templates (user_id, nuanced_analysis_id)
  where nuanced_analysis_id is not null;

comment on column public.assignment_templates.nuanced_analysis_id is
  'The nuanced_analyses packet this template is the working copy of, set by /api/assignments/from-nuanced-analysis. Null for a template authored directly in a grade sandbox, which keeps plain copy semantics. Where it is set the packet is the source of truth for CONTENT: opening the editor refreshes draft_content from the packet and saving writes content back to it, while formatting_requirements stays per-template. The partial unique index gives one working copy per teacher per packet, replacing the match on template_name that reuse relied on before. On delete set null rather than cascade so deleting a packet degrades the working copy to an ordinary template instead of destroying the teacher formatting stored on it.';