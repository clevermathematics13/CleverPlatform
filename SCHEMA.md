# Database schema reference

Generated from the live Supabase project (`qnawglgnoojrlaivylou`, schema `public`) on
2 Sep 2026. 82 tables. This file replaced a 312-byte PostgREST error blob that had sat
here since a `get_schema` RPC was removed; `platform/CLAUDE.md` still pointed agents at
it as required reading.

**To refresh**, run this against the database (MCP `execute_sql` works) and paste the
`markdown` column below the horizontal rule:

```sql
with cols as (
  select c.table_name, c.ordinal_position,
         '| `' || c.column_name || '` | ' || c.data_type ||
         case when c.is_nullable = 'NO' then '' else ', nullable' end ||
         case when c.column_default is not null then ' | default `' || left(c.column_default, 40) || '`' else ' | ' end || ' |' as row
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public'
),
per_table as (
  select table_name,
         '### `' || table_name || '`' || E'\n' ||
         coalesce(E'\n' || obj_description(('public.' || quote_ident(table_name))::regclass, 'pg_class') || E'\n', '') ||
         E'\n| column | type | default |\n|---|---|---|\n' ||
         string_agg(row, E'\n' order by ordinal_position) || E'\n' as md
  from cols group by table_name
)
select string_agg(md, E'\n' order by table_name) as markdown, count(*) as tables from per_table;
```

Legend: a type without `nullable` is `NOT NULL`. Defaults are truncated at 40 characters.
Table comments (where the schema has them) appear under the table name. RLS is enabled on
every table; policies are not listed here -- read the migration that created the table.

For what the tables *mean* and which ones an agent actually touches, read
`platform/docs/HANDOFF.md` §4-5 first; this file is the column reference.

---

### `ai_grade_batches`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `test_id` | uuid |  |
| `created_by` | uuid |  |
| `status` | text | default `'uploaded'::text` |
| `source_storage_path` | text |  |
| `file_name` | text, nullable |  |
| `page_count` | integer, nullable |  |
| `proposed_segments` | jsonb | default `'[]'::jsonb` |
| `confirmed_segments` | jsonb, nullable |  |
| `unassigned_pages` | jsonb | default `'[]'::jsonb` |
| `error` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `blank_pages` | jsonb | default `'[]'::jsonb` — page numbers the segmentation model confidently identified as blank, distinct from unassigned_pages |
| `segmented_at` | timestamp with time zone, nullable |  |
| `split_at` | timestamp with time zone, nullable |  |
| `source_sha256` | text, nullable |  |

### `ai_grade_results`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `run_id` | uuid |  |
| `test_item_id` | uuid |  |
| `suggested_marks` | integer |  |
| `max_marks` | integer |  |
| `confidence` | text | default `'low'::text` |
| `markscheme_source` | text | default `'none'::text` |
| `work_found` | boolean | default `true` |
| `reasoning` | text, nullable |  |
| `evidence` | text, nullable |  |
| `mark_breakdown` | jsonb | default `'[]'::jsonb` |
| `accepted` | boolean | default `false` |
| `accepted_at` | timestamp with time zone, nullable |  |
| `accepted_by` | uuid, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `evidence_image_path` | text, nullable |  |
| `evidence_box` | jsonb, nullable |  |

### `ai_grade_runs`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `test_id` | uuid |  |
| `student_id` | uuid, nullable | FK profiles(id) — null for a run graded against an invited-only student; backfilled by `auto_enroll_from_invitations` on first login |
| `created_by` | uuid |  |
| `status` | text | default `'running'::text` |
| `model` | text, nullable |  |
| `source_storage_path` | text, nullable |  |
| `coverage` | jsonb | default `'{}'::jsonb` |
| `error` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `completed_at` | timestamp with time zone, nullable |  |
| `invited_student_id` | uuid, nullable | FK invited_students(id) on delete set null — set for every run created via the batch/invited-roster flow, regardless of registration status |

### `ai_usage_log`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `created_at` | timestamp with time zone | default `now()` |
| `pipeline` | text |  |
| `model` | text |  |
| `input_tokens` | integer | default `0` |
| `cache_creation_input_tokens` | integer | default `0` |
| `cache_read_input_tokens` | integer | default `0` |
| `output_tokens` | integer | default `0` |
| `batch` | boolean | default `false` |
| `ref_type` | text, nullable |  |
| `ref_id` | uuid, nullable |  |

### `archived_saved_exams`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `teacher_id` | uuid |  |
| `original_saved_exam_id` | uuid, nullable |  |
| `archived_by` | uuid, nullable |  |
| `archived_at` | timestamp with time zone | default `now()` |
| `exam_name` | text |  |
| `curriculum` | text, nullable |  |
| `level` | text, nullable |  |
| `paper` | integer, nullable |  |
| `course_id` | uuid, nullable |  |
| `exam_date` | text, nullable |  |
| `exam_time` | text, nullable |  |
| `questions` | jsonb | default `'[]'::jsonb` |
| `archived_payload` | jsonb | default `'{}'::jsonb` |

### `archived_tests`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `teacher_id` | uuid |  |
| `original_test_id` | uuid, nullable |  |
| `deleted_by` | uuid, nullable |  |
| `deleted_at` | timestamp with time zone | default `now()` |
| `test_name` | text |  |
| `course_id` | uuid, nullable |  |
| `test_date` | date, nullable |  |
| `exam_time` | time without time zone, nullable |  |
| `release_at` | timestamp with time zone, nullable |  |
| `total_marks` | integer, nullable |  |
| `hidden` | boolean | default `false` |
| `paper_url` | text, nullable |  |
| `mark_scheme_url` | text, nullable |  |
| `archived_payload` | jsonb | default `'{}'::jsonb` |

### `assignment_templates`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `user_id` | uuid |  |
| `template_name` | text |  |
| `grade_level` | text |  |
| `document_kind` | text |  |
| `formatting_requirements` | jsonb, nullable |  |
| `assignment_input` | jsonb, nullable |  |
| `created_at` | timestamp with time zone, nullable | default `now()` |
| `updated_at` | timestamp with time zone, nullable | default `now()` |
| `answer_line_height_mm` | numeric, nullable | default `12` |
| `draft_content` | jsonb, nullable |  |

### `assignments`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `title` | text |  |
| `description` | text, nullable |  |
| `course_id` | uuid, nullable |  |
| `question_ids` | ARRAY | default `'{}'::uuid[]` |
| `assigned_to` | ARRAY | default `'{}'::uuid[]` |
| `due_date` | timestamp with time zone, nullable |  |
| `status` | text | default `'draft'::text` |
| `created_at` | timestamp with time zone | default `now()` |

### `box_coordinates`

| column | type | default |
|---|---|---|
| `id` | bigint |  |
| `exam_code` | text |  |
| `question_code` | text |  |
| `position` | text, nullable |  |
| `x_pct` | numeric, nullable | default `0` |
| `y_pct` | numeric, nullable | default `0` |
| `width_pct` | numeric, nullable | default `0` |
| `height_pct` | numeric, nullable | default `0` |
| `x_pts` | numeric, nullable | default `0` |
| `y_pts` | numeric, nullable | default `0` |
| `width_pts` | numeric, nullable | default `0` |
| `height_pts` | numeric, nullable | default `0` |
| `created_at` | timestamp with time zone, nullable | default `now()` |

### `command_terms`

IB-approved command terms. term is the canonical display form (e.g. "Write down"). Modifications to this table must be mirrored in platform/lib/command-terms.ts.

| column | type | default |
|---|---|---|
| `term` | text |  |
| `sort_order` | integer |  |
| `is_active` | boolean | default `true` |
| `created_at` | timestamp with time zone | default `now()` |

### `correction_checks`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `student_id` | uuid |  |
| `test_id` | uuid |  |
| `pdf_upload_id` | uuid |  |
| `status` | text | default `'pending'::text` |
| `extracted_latex` | jsonb, nullable |  |
| `question_feedback` | jsonb, nullable |  |
| `error_message` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |

### `course_google_classroom_links`

Maps a CleverPlatform course to a Google Classroom course. One CP course links to at most one GC course; a GC course may be linked from multiple CP courses (e.g. one GC class split into Extended/Standard CP courses). Used to scope the Classroom grading page's course picker and (in future) to drive roster sync.

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `course_id` | uuid |  |
| `google_course_id` | text |  |
| `google_course_name` | text |  |
| `google_course_section` | text, nullable |  |
| `linked_by` | uuid, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |

### `courses`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `name` | text |  |
| `description` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `archived` | boolean | default `false` |

### `debug_log`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `user_id` | uuid, nullable |  |
| `action` | text |  |
| `details` | jsonb, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `exam_questions`

| column | type | default |
|---|---|---|
| `id` | bigint |  |
| `exam_id` | bigint, nullable |  |
| `question_code` | text |  |
| `position` | integer, nullable |  |

### `exam_templates`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `curriculum` | text |  |
| `level` | text |  |
| `paper` | integer |  |
| `slide_presentation_id` | text |  |
| `name_field_x` | double precision, nullable |  |
| `name_field_y` | double precision, nullable |  |
| `name_field_w` | double precision, nullable |  |
| `name_field_h` | double precision, nullable |  |
| `updated_at` | timestamp with time zone | default `now()` |

### `exams`

| column | type | default |
|---|---|---|
| `id` | bigint |  |
| `exam_code` | text |  |
| `class_code` | text, nullable |  |
| `date` | text, nullable |  |
| `time` | text, nullable |  |
| `duration_minutes` | integer, nullable |  |
| `created_at` | timestamp with time zone, nullable | default `now()` |

### `google_oauth_tokens`

Server-side Google OAuth token store. Replaces browser-cookie token storage so the Classroom/Drive connection survives device changes, cookie clears and background jobs.

| column | type | default |
|---|---|---|
| `profile_id` | uuid |  |
| `provider` | text | default `'google-classroom'::text` |
| `access_token` | text, nullable |  |
| `refresh_token` | text, nullable |  |
| `id_token` | text, nullable |  |
| `scope` | text, nullable |  |
| `token_type` | text, nullable |  |
| `expiry_date` | bigint, nullable |  |
| `google_email` | text, nullable |  |
| `last_error` | text, nullable |  |
| `last_refreshed_at` | timestamp with time zone, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |

### `grade_boundaries`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `set_id` | uuid |  |
| `grade` | integer |  |
| `min_proportion` | numeric |  |

### `grade_boundary_sets`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `name` | text |  |
| `description` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `grades`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `student_id` | uuid |  |
| `assessment_type` | text |  |
| `assessment_id` | uuid, nullable |  |
| `title` | text |  |
| `score` | numeric |  |
| `max_score` | numeric |  |
| `percentage` | numeric, nullable |  |
| `date` | date | default `CURRENT_DATE` |
| `created_at` | timestamp with time zone | default `now()` |

### `graph_crop_choice_associations`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `graph_crop_id` | uuid |  |
| `part_id` | uuid, nullable |  |
| `choice_key` | text |  |
| `is_correct` | boolean |  |
| `rationale` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `graph_extraction_queue`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `question_image_id` | uuid |  |
| `question_id` | uuid |  |
| `part_id` | uuid, nullable |  |
| `image_type` | text |  |
| `storage_path` | text |  |
| `status` | text |  |
| `confidence_level` | text, nullable |  |
| `manual_review_required` | boolean | default `true` |
| `extractor` | text | default `'cv_batch_v1'::text` |
| `graph_spec` | jsonb, nullable |  |
| `graph_meta` | jsonb, nullable |  |
| `metadata` | jsonb, nullable |  |
| `warnings` | jsonb, nullable |  |
| `feedback` | jsonb, nullable |  |
| `error` | text, nullable |  |
| `attempted_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |
| `reviewed_at` | timestamp with time zone, nullable |  |
| `reviewed_by` | uuid, nullable |  |
| `review_notes` | text, nullable |  |

### `graph_image_crops`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `question_id` | uuid |  |
| `question_image_id` | uuid |  |
| `part_id` | uuid, nullable |  |
| `storage_path` | text |  |
| `crop_bbox` | jsonb, nullable |  |
| `graph_spec` | jsonb, nullable |  |
| `graph_meta` | jsonb, nullable |  |
| `extractor` | text | default `'manual'::text` |
| `notes` | text, nullable |  |
| `created_by` | uuid, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `ib_questions`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `code` | text |  |
| `session` | text |  |
| `paper` | integer |  |
| `level` | text |  |
| `timezone` | text |  |
| `difficulty` | integer, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `google_doc_id` | text, nullable |  |
| `google_ms_id` | text, nullable |  |
| `curriculum` | ARRAY, nullable | default `ARRAY['AA'::text]` |
| `section` | text, nullable |  |
| `source_pdf_path` | text, nullable |  |
| `page_image_paths` | ARRAY, nullable |  |
| `stem_latex` | text, nullable |  |
| `stem_markscheme_latex` | text, nullable |  |
| `parts_draft_latex` | text, nullable |  |
| `parts_draft_markscheme_latex` | text, nullable |  |

### `invited_parents`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `email` | text |  |
| `full_name` | text, nullable |  |
| `student_id` | uuid, nullable |  |
| `registered` | boolean | default `false` |
| `profile_id` | uuid, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `invited_student_email` | text, nullable |  |
| `course_id` | uuid, nullable |  |

### `invited_students`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `email` | text |  |
| `full_name` | text, nullable |  |
| `course_id` | uuid |  |
| `registered` | boolean | default `false` |
| `profile_id` | uuid, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `hidden` | boolean | default `false` |
| `extra_time` | integer | default `0` |
| `nickname` | text, nullable |  |

### `lessons`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `topic_id` | uuid |  |
| `title` | text |  |
| `mdx_content_path` | text, nullable |  |
| `sort_order` | integer | default `0` |
| `created_at` | timestamp with time zone | default `now()` |

### `mark_changes`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `test_item_id` | uuid |  |
| `student_id` | uuid |  |
| `changed_by` | uuid |  |
| `old_marks` | integer, nullable |  |
| `new_marks` | integer |  |
| `reason` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `na_anchors`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `packet_version_id` | uuid |  |
| `qid` | text |  |
| `base_qid` | text |  |
| `part_label` | text, nullable |  |
| `page_index` | integer |  |
| `x0_pt` | numeric |  |
| `y0_pt` | numeric |  |
| `x1_pt` | numeric |  |
| `y1_pt` | numeric |  |
| `expand_max_x1_pt` | numeric, nullable |  |
| `expand_max_y1_pt` | numeric, nullable |  |
| `command_term` | text, nullable |  |
| `marks_available` | numeric, nullable |  |
| `answer_sketch` | text, nullable |  |
| `open_rubric` | text, nullable |  |
| `misconception_context` | text, nullable |  |
| `source` | text | default `'auto_fillrect'::text` |
| `sort_order` | integer | default `0` |
| `created_at` | timestamp with time zone | default `now()` |
| `question_text` | text, nullable |  |
| `question_marks` | integer, nullable |  |
| `question_answer` | text, nullable |  |
| `rubric_item_id` | uuid, nullable |  |
| `prompt_crop_storage_path` | text, nullable |  |

### `na_assessment_batches`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `anthropic_batch_id` | text |  |
| `packet_scan_id` | uuid |  |
| `status` | text | default `'submitted'::text` |
| `request_count` | integer |  |
| `submitted_at` | timestamp with time zone | default `now()` |
| `ended_at` | timestamp with time zone, nullable |  |
| `results_written_at` | timestamp with time zone, nullable |  |
| `error_message` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `na_batch_runs`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `batch_id` | uuid |  |
| `packet_version_id` | uuid |  |
| `teacher_id` | uuid, nullable |  |
| `stage` | text | default `'cropping'::text` |
| `total_students` | integer | default `0` |
| `students_done` | integer | default `0` |
| `student_ids_pending` | jsonb | default `'[]'::jsonb` |
| `status` | text | default `'active'::text` |
| `started_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |
| `finished_at` | timestamp with time zone, nullable |  |

### `na_comment_bank`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `anchor_id` | uuid, nullable |  |
| `body` | text |  |
| `use_count` | integer | default `0` |
| `created_by` | uuid, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `na_continuity`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `course_id` | uuid |  |
| `unit_sequence` | jsonb | default `'[]'::jsonb` |
| `packets` | jsonb | default `'[]'::jsonb` |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |

### `na_feedback`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `crop_id` | uuid |  |
| `ai_attempted` | boolean, nullable |  |
| `ai_transcription` | text, nullable |  |
| `ai_verdict` | text, nullable |  |
| `ai_marks_awarded` | numeric, nullable |  |
| `ai_marks_available` | numeric, nullable |  |
| `ai_misconception_tags` | ARRAY, nullable |  |
| `ai_margin_comment` | text, nullable |  |
| `ai_next_step` | text, nullable |  |
| `ai_confidence` | numeric, nullable |  |
| `ai_teacher_note` | text, nullable |  |
| `ai_raw_response` | jsonb, nullable |  |
| `ai_validation_error` | text, nullable |  |
| `final_verdict` | text, nullable |  |
| `final_marks_awarded` | numeric, nullable |  |
| `final_margin_comment` | text, nullable |  |
| `final_next_step` | text, nullable |  |
| `teacher_edited` | boolean | default `false` |
| `approved_by` | uuid, nullable |  |
| `approved_at` | timestamp with time zone, nullable |  |
| `released_at` | timestamp with time zone, nullable |  |
| `student_flagged_misread` | boolean | default `false` |
| `student_flag_note` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |
| `ai_student_attempted` | boolean, nullable |  |

### `na_packet_scans`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `batch_id` | uuid |  |
| `packet_version_id` | uuid |  |
| `packet_seq` | integer |  |
| `student_profile_id` | uuid, nullable |  |
| `name_crop_storage_path` | text, nullable |  |
| `id_confidence` | numeric, nullable |  |
| `id_status` | text | default `'pending'::text` |
| `status` | text | default `'pending'::text` |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |
| `invited_student_id` | uuid, nullable |  |
| `split_storage_path` | text, nullable |  |

### `na_packet_versions`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `nuanced_analysis_id` | uuid, nullable |  |
| `version_label` | text |  |
| `page_count` | integer |  |
| `master_pdf_storage_path` | text, nullable |  |
| `anchor_source` | text | default `'auto_fillrect'::text` |
| `anchors_locked` | boolean | default `false` |
| `created_by` | uuid, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `na_response_crops`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `packet_scan_id` | uuid |  |
| `anchor_id` | uuid |  |
| `storage_path` | text |  |
| `ink_density` | numeric, nullable |  |
| `is_blank` | boolean | default `false` |
| `boundary_expanded` | boolean | default `false` |
| `created_at` | timestamp with time zone | default `now()` |
| `possibly_truncated` | boolean | default `false` |
| `pending_assessment_batch_id` | uuid, nullable |  |

### `na_rubric_items`

The marking rubric / answer key for a nuanced analysis, one row per question. First-class and editable, as opposed to being buried inside nuanced_analyses.parts JSONB. na_anchors.rubric_item_id links a physical answer box to its rubric entry.

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `nuanced_analysis_id` | uuid |  |
| `qid` | text |  |
| `base_qid` | text |  |
| `question_number` | integer |  |
| `question_text` | text, nullable |  |
| `answer_key` | text, nullable |  |
| `open_rubric` | text, nullable |  |
| `misconception_context` | text, nullable |  |
| `command_term` | text, nullable |  |
| `marks` | integer, nullable |  |
| `question_marks` | integer, nullable |  |
| `teacher_notes` | text, nullable |  |
| `source` | text | default `'generated'::text` |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |

### `na_scan_batches`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `packet_version_id` | uuid |  |
| `course_id` | uuid, nullable |  |
| `uploaded_by` | uuid, nullable |  |
| `source_filename` | text, nullable |  |
| `page_count` | integer, nullable |  |
| `status` | text | default `'uploaded'::text` |
| `error_message` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `source_storage_path` | text, nullable |  |
| `proposed_segments` | jsonb, nullable |  |
| `confirmed_segments` | jsonb, nullable |  |
| `unassigned_pages` | jsonb, nullable |  |
| `segmented_at` | timestamp with time zone, nullable |  |
| `split_at` | timestamp with time zone, nullable |  |
| `parent_batch_id` | uuid, nullable |  |
| `chunk_index` | integer, nullable |  |
| `chunk_count` | integer, nullable |  |
| `claimed_by` | text, nullable |  |
| `claimed_at` | timestamp with time zone, nullable |  |
| `is_bulk_upload` | boolean | default `false` |

### `na_scan_pages`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `batch_id` | uuid |  |
| `batch_page_index` | integer |  |
| `storage_path` | text |  |
| `detected_page_index` | integer, nullable |  |
| `match_confidence` | numeric, nullable |  |
| `transform_inliers` | integer, nullable |  |
| `page_rotation_deg` | numeric, nullable |  |
| `packet_seq` | integer, nullable |  |
| `is_overflow` | boolean | default `false` |
| `flagged` | boolean | default `false` |
| `flag_note` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `nuanced_analyses`

Stores Nuanced Analysis structured investigation packets. Each row is one complete packet.

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `slug` | text |  |
| `title` | text |  |
| `subtitle` | text, nullable |  |
| `course` | text | default `'IBDP Mathematics AA HL'::text` |
| `syllabus_topics` | ARRAY | default `'{}'::text[]` |
| `prerequisites` | ARRAY | default `'{}'::text[]` |
| `materials` | text, nullable |  |
| `vocabulary` | jsonb | default `'[]'::jsonb` |
| `atl_statement` | text, nullable |  |
| `tok_provocations` | jsonb | default `'[]'::jsonb` |
| `parts` | jsonb | default `'[]'::jsonb` |
| `teacher_companion` | jsonb, nullable |  |
| `sort_order` | integer | default `0` |
| `is_published` | boolean | default `false` |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |
| `latex_content` | text, nullable |  |
| `course_id` | uuid, nullable |  |
| `owner_id` | uuid, nullable |  |
| `grade_level` | text, nullable |  |
| `section_code` | text, nullable |  |
| `draft_content` | jsonb, nullable |  |
| `continuity_digest` | jsonb, nullable |  |

### `nuanced_analysis_specs`

Stores validated NuancedAnalysisSpec JSON (the pedagogical "feel" of a Nuanced Analysis). Canonical row (owner_id IS NULL, is_canonical = true) is seeded from CANONICAL_AAHL_SPEC and managed by the service role.

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `owner_id` | uuid, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |
| `programme` | text | default `'IBDP'::text` |
| `subject` | text | default `'Mathematics'::text` |
| `strand` | text |  |
| `level` | text |  |
| `name` | text |  |
| `spec_version` | text |  |
| `is_canonical` | boolean | default `false` |
| `spec` | jsonb |  |

### `nuanced_analysis_template_asts`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `owner_id` | uuid |  |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |
| `template_name` | text |  |
| `schema_version` | text |  |
| `ast` | jsonb |  |

### `nuanced_generation_logs`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `created_at` | timestamp with time zone | default `now()` |
| `source` | text |  |
| `pass` | text |  |
| `model` | text, nullable |  |
| `stop_reason` | text, nullable |  |
| `char_count` | integer, nullable |  |
| `raw_text` | text, nullable |  |
| `error` | text, nullable |  |

### `nuanced_generation_runs`

| column | type | default |
|---|---|---|
| `run_id` | text |  |
| `status` | text | default `'running'::text` |
| `phase` | text, nullable |  |
| `pass_count` | integer | default `0` |
| `char_count` | integer | default `0` |
| `result_text` | text, nullable |  |
| `error` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |

### `override_tokens`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `token` | text |  |
| `teacher_id` | uuid |  |
| `student_id` | uuid |  |
| `test_id` | uuid |  |
| `used` | boolean | default `false` |
| `created_at` | timestamp with time zone | default `now()` |
| `expires_at` | timestamp with time zone | default `(now() + '00:05:00'::interval)` |

### `parent_links`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `parent_profile_id` | uuid |  |
| `student_id` | uuid |  |
| `created_at` | timestamp with time zone | default `now()` |

### `pdf_uploads`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `student_id` | uuid |  |
| `test_id` | uuid |  |
| `storage_path` | text |  |
| `file_name` | text |  |
| `file_size` | integer, nullable |  |
| `uploaded_at` | timestamp with time zone | default `now()` |

### `placement_recommendations`

Final AISL/AASL/AAHL placement recommendation for a placement test, aggregated from placement_test_marks.

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `placement_test_id` | uuid |  |
| `recommended_curriculum` | text |  |
| `recommended_level` | text |  |
| `recommended_label` | text |  |
| `overall_percentage` | numeric |  |
| `reasoning` | text |  |
| `subtopic_breakdown` | jsonb | default `'{}'::jsonb` |
| `low_confidence_count` | integer | default `0` |
| `created_at` | timestamp with time zone | default `now()` |

### `placement_test_marks`

AI-graded mark for each placement test question. confidence = low flags for teacher review (fully automatic pipeline, confidence-flagged rather than review-gated).

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `placement_test_question_id` | uuid |  |
| `marks_awarded` | numeric |  |
| `max_marks` | integer |  |
| `confidence` | text |  |
| `confidence_notes` | text, nullable |  |
| `student_work_transcription` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `placement_test_questions`

AI-segmented questions detected within a placement test PDF. Markscheme is AI-inferred, not teacher-authored — this is a placement test, not a bank question.

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `placement_test_id` | uuid |  |
| `question_number` | integer |  |
| `page_numbers` | ARRAY | default `'{}'::integer[]` |
| `inferred_question_latex` | text, nullable |  |
| `inferred_markscheme_latex` | text, nullable |  |
| `inferred_max_marks` | integer | default `0` |
| `inferred_level_hint` | text, nullable |  |
| `sort_order` | integer | default `0` |
| `created_at` | timestamp with time zone | default `now()` |

### `placement_tests`

One row per uploaded scanned placement-test PDF. student_name is manually tagged by the teacher at upload time (no student account link required).

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `teacher_id` | uuid |  |
| `student_name` | text, nullable |  |
| `course_id` | uuid, nullable |  |
| `storage_path` | text |  |
| `file_name` | text |  |
| `status` | text | default `'uploaded'::text` |
| `error_message` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `completed_at` | timestamp with time zone, nullable |  |
| `student_name_source` | text | default `'manual'::text` |
| `student_name_confidence` | text, nullable |  |
| `student_name_notes` | text, nullable |  |
| `printed_grade_level` | integer, nullable |  |
| `grade_level` | integer, nullable |  |
| `grade_level_source` | text | default `'extracted'::text` |
| `grade_level_confidence` | text, nullable |  |
| `grade_level_notes` | text, nullable |  |

### `platform_design_settings`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `feature_key` | text |  |
| `display_name` | text |  |
| `description` | text, nullable |  |
| `settings` | jsonb | default `'{}'::jsonb` |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |

### `profiles`

| column | type | default |
|---|---|---|
| `id` | uuid |  |
| `email` | text |  |
| `display_name` | text |  |
| `avatar_url` | text, nullable |  |
| `role` | text | default `'student'::text` |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |
| `nickname` | text, nullable |  |

### `question_images`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `question_id` | uuid |  |
| `part_id` | uuid, nullable |  |
| `image_type` | text |  |
| `storage_path` | text |  |
| `source_google_doc_id` | text, nullable |  |
| `sort_order` | integer | default `0` |
| `alt_text` | text, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `question_part_metadata_history`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `part_id` | uuid |  |
| `question_id` | uuid |  |
| `part_label` | text | default `''::text` |
| `marks` | integer | default `1` |
| `command_term` | text, nullable |  |
| `subtopic_codes` | ARRAY | default `'{}'::text[]` |
| `sort_order` | integer | default `0` |
| `changed_by` | uuid, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `question_parts`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `question_id` | uuid |  |
| `part_label` | text | default `''::text` |
| `marks` | integer | default `1` |
| `subtopic_codes` | ARRAY, nullable | default `'{}'::text[]` |
| `command_term` | text, nullable |  |
| `hints` | text, nullable |  |
| `content_images` | ARRAY, nullable | default `'{}'::text[]` |
| `markscheme_images` | ARRAY, nullable | default `'{}'::text[]` |
| `content_text` | text, nullable |  |
| `markscheme_text` | text, nullable |  |
| `sort_order` | integer | default `0` |
| `created_at` | timestamp with time zone | default `now()` |
| `content_latex` | text, nullable |  |
| `markscheme_latex` | text, nullable |  |
| `latex_verified` | boolean | default `false` |
| `is_hence` | boolean | default `false` |
| `is_hence_or_otherwise` | boolean | default `false` |
| `is_using` | boolean | default `false` |
| `is_deduce` | boolean | default `false` |
| `is_verify` | boolean | default `false` |
| `instructional_context_terms` | ARRAY | default `'{}'::text[]` |
| `command_terms` | ARRAY | default `'{}'::text[]` |
| `primary_subtopic_code` | text, nullable |  |
| `mark_attributions` | jsonb | default `'{}'::jsonb` |

### `question_studio_settings`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `setting_key` | text |  |
| `setting_value` | jsonb | default `'{}'::jsonb` |
| `user_id` | uuid, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |

### `questions`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `topic_id` | uuid, nullable |  |
| `type` | text | default `'short_answer'::text` |
| `content` | jsonb |  |
| `solution` | jsonb, nullable |  |
| `marks` | integer | default `1` |
| `source` | text, nullable |  |
| `tags` | ARRAY, nullable | default `'{}'::text[]` |
| `created_at` | timestamp with time zone | default `now()` |

### `registration_codes`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `code` | text |  |
| `student_id` | uuid |  |
| `used` | boolean | default `false` |
| `used_by` | uuid, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `expires_at` | timestamp with time zone, nullable |  |

### `saved_exams`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `teacher_id` | uuid |  |
| `name` | text |  |
| `curriculum` | text |  |
| `level` | text |  |
| `paper` | integer |  |
| `course_id` | uuid, nullable |  |
| `exam_date` | text, nullable |  |
| `questions` | jsonb | default `'[]'::jsonb` |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |
| `exam_time` | text, nullable |  |
| `notes` | text, nullable |  |

### `seating_assignments`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `timestamp` | timestamp with time zone | default `now()` |
| `date` | date | default `CURRENT_DATE` |
| `class_group` | text |  |
| `run_id` | text |  |
| `candidate_score` | numeric | default `0` |
| `student_id` | text |  |
| `name` | text | default `''::text` |
| `seat_id` | text |  |
| `pod_id` | text |  |
| `seat_role` | text | default `''::text` |
| `x` | numeric | default `0` |
| `y` | numeric | default `0` |

### `seating_current`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `date` | date | default `CURRENT_DATE` |
| `class_group` | text |  |
| `run_id` | text |  |
| `candidate_score` | numeric | default `0` |
| `student_id` | text |  |
| `name` | text | default `''::text` |
| `seat_id` | text |  |
| `pod_id` | text |  |
| `seat_role` | text | default `''::text` |
| `x` | numeric | default `0` |
| `y` | numeric | default `0` |

### `seating_layouts`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `class_group` | text |  |
| `name` | text |  |
| `seats` | jsonb |  |
| `created_at` | timestamp with time zone | default `now()` |
| `updated_at` | timestamp with time zone | default `now()` |

### `seating_rules`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `rule_type` | text |  |
| `class_group` | text | default `'*'::text` |
| `student_a` | text | default `''::text` |
| `student_b` | text | default `''::text` |
| `student_id` | text | default `''::text` |
| `pod_id` | text | default `''::text` |
| `weight` | numeric | default `0` |
| `active` | boolean | default `true` |
| `notes` | text | default `''::text` |
| `created_at` | timestamp with time zone | default `now()` |

### `seating_seats`

| column | type | default |
|---|---|---|
| `seat_id` | text |  |
| `class_group` | text | default `'*'::text` |
| `pod_id` | text |  |
| `seat_role` | text | default `'L'::text` |
| `x` | numeric | default `0` |
| `y` | numeric | default `0` |
| `active` | boolean | default `true` |

### `seating_settings`

| column | type | default |
|---|---|---|
| `key` | text |  |
| `value` | numeric |  |

### `seating_students`

| column | type | default |
|---|---|---|
| `student_id` | text |  |
| `name` | text |  |
| `class_group` | text |  |
| `active` | boolean | default `true` |
| `notes` | text | default `''::text` |

### `student_goals`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `student_id` | uuid |  |
| `goal_text` | text |  |
| `target_date` | date, nullable |  |
| `status` | text | default `'active'::text` |
| `created_at` | timestamp with time zone | default `now()` |

### `student_marks`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `test_item_id` | uuid |  |
| `student_id` | uuid |  |
| `marks_awarded` | integer | default `0` |
| `created_at` | timestamp with time zone | default `now()` |

### `student_responses`

| column | type | default |
|---|---|---|
| `id` | bigint |  |
| `exam_code` | text |  |
| `student_email` | text |  |
| `question_label` | text |  |
| `marks_reported` | numeric |  |
| `created_at` | timestamp with time zone, nullable | default `now()` |

### `student_self_scores`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `test_item_id` | uuid |  |
| `student_id` | uuid |  |
| `self_marks` | integer | default `0` |
| `submitted_at` | timestamp with time zone | default `now()` |
| `override_by` | uuid, nullable |  |
| `override_at` | timestamp with time zone, nullable |  |

### `students`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `profile_id` | uuid |  |
| `course_id` | uuid |  |
| `created_at` | timestamp with time zone | default `now()` |
| `hidden` | boolean | default `false` |
| `extra_time` | integer | default `0` |

### `submissions`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `assignment_id` | uuid |  |
| `student_id` | uuid |  |
| `answers` | jsonb, nullable |  |
| `file_urls` | ARRAY, nullable | default `'{}'::text[]` |
| `ai_grade` | jsonb, nullable |  |
| `human_grade` | jsonb, nullable |  |
| `status` | text | default `'in_progress'::text` |
| `submitted_at` | timestamp with time zone, nullable |  |
| `graded_at` | timestamp with time zone, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |

### `subtopics`

| column | type | default |
|---|---|---|
| `code` | text |  |
| `descriptor` | text |  |
| `section` | integer |  |
| `alt_code` | text, nullable |  |
| `parent_code` | text, nullable |  |

### `syllabus_coverage`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `course_id` | uuid |  |
| `subtopic_code` | text |  |
| `covered` | boolean | default `false` |
| `updated_at` | timestamp with time zone | default `now()` |

### `teacher_settings`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `teacher_id` | uuid |  |
| `show_corrections` | boolean | default `false` |
| `show_feedback` | boolean | default `false` |
| `updated_at` | timestamp with time zone | default `now()` |

### `test_items`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `test_id` | uuid |  |
| `question_number` | integer |  |
| `ib_question_code` | text, nullable |  |
| `part_label` | text | default `''::text` |
| `max_marks` | integer |  |
| `subtopic_codes` | ARRAY, nullable | default `'{}'::text[]` |
| `google_doc_id` | text, nullable |  |
| `google_ms_id` | text, nullable |  |
| `sort_order` | integer | default `0` |
| `created_at` | timestamp with time zone | default `now()` |
| `question_text` | text, nullable | inline teacher-authored question text, used when `source = 'custom'` |
| `markscheme_text` | text, nullable | inline free-text mark scheme (M/A/R/FT-style), used when `source = 'custom'` |
| `source` | text | default `'bank'::text` — `'bank'` (resolved via `ib_question_code`) or `'custom'` (inline content from the Formative Assessment creator) |

Unique on `(test_id, question_number, part_label)`.

### `tests`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `teacher_id` | uuid |  |
| `course_id` | uuid, nullable |  |
| `name` | text |  |
| `test_date` | date, nullable |  |
| `total_marks` | integer, nullable |  |
| `created_at` | timestamp with time zone | default `now()` |
| `paper_url` | text, nullable |  |
| `mark_scheme_url` | text, nullable |  |
| `hidden` | boolean | default `false` |
| `boundary_set_id` | uuid, nullable |  |
| `exam_time` | time without time zone, nullable |  |
| `custom_content` | jsonb, nullable | full authored draft for a Formative-Assessment-creator test; null for IB-bank/external tests |
| `release_at` | timestamp with time zone, nullable |  |

### `topics`

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `course_id` | uuid |  |
| `title` | text |  |
| `sort_order` | integer | default `0` |
| `created_at` | timestamp with time zone | default `now()` |

### `track_courses`

Maps a virtual track course (no roster of its own, e.g. Grade 9 Extended) to the real roster-bearing class courses that follow it (e.g. 9A, 9C, 9G). Used to resolve "which real students does this NA packet/track apply to" for roster matching, since NA content lives on the track course but rosters live on the real class courses.

| column | type | default |
|---|---|---|
| `id` | uuid | default `gen_random_uuid()` |
| `track_course_id` | uuid |  |
| `member_course_id` | uuid |  |
| `created_at` | timestamp with time zone | default `now()` |
