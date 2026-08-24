
-- ── platform_design_settings ─────────────────────────────────────────────────
-- Stores persistent UI/UX design preferences for the CleverPlatform teacher
-- interface. Each row represents one named feature/section of the platform,
-- with a JSONB settings blob so new fields can be added without schema changes.
--
-- Seed rows are inserted for every current configurable surface. New surfaces
-- should insert a row here when they are introduced.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_design_settings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key     text        NOT NULL UNIQUE,          -- machine-readable key
  display_name    text        NOT NULL,                 -- human-readable label
  description     text,                                 -- what this controls
  settings        jsonb       NOT NULL DEFAULT '{}',    -- the actual config blob
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION platform_design_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_design_settings_updated_at
  ON platform_design_settings;

CREATE TRIGGER trg_platform_design_settings_updated_at
  BEFORE UPDATE ON platform_design_settings
  FOR EACH ROW EXECUTE FUNCTION platform_design_settings_updated_at();

-- Enable Row Level Security (teachers only — adjust policy to match auth model)
ALTER TABLE platform_design_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON platform_design_settings
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated write" ON platform_design_settings
  FOR ALL USING (auth.role() = 'authenticated');

-- ── Seed: one row per major configurable UI surface ──────────────────────────
INSERT INTO platform_design_settings (feature_key, display_name, description, settings)
VALUES

  -- Question Studio modal
  ('question_studio_modal', 'Question Studio Modal', 
   'Settings for the full-screen question editor modal (Question Studio). Controls modal width, image thumbnail height, lightbox behaviour, and panel layout.',
   '{
     "modal_width_vw": 90,
     "modal_max_height_vh": 92,
     "image_thumbnail_height_px": 1140,
     "image_grid_cols_lg": 2,
     "image_grid_gap": 6,
     "lightbox_enabled": true,
     "lightbox_keyboard_nav": true,
     "lightbox_dot_indicators": true,
     "title": "Question Studio"
   }'::jsonb),

  -- Question Bank table
  ('question_bank_table', 'Question Bank Table',
   'Column visibility, row density, and sort preferences for the main question bank table.',
   '{
     "row_density": "comfortable",
     "visible_columns": ["code","session","paper","level","timezone","parts","marks","images","section","notes"],
     "default_sort": "code_asc",
     "page_size": 50
   }'::jsonb),

  -- ExamBuilder panel
  ('exam_builder_panel', 'ExamBuilder Panel',
   'Layout and behaviour settings for the right-hand ExamBuilder (TestBuilderPanel).',
   '{
     "panel_width_px": 400,
     "show_subtopic_tags": true,
     "show_section_labels": true,
     "default_answer_box_mode": "auto",
     "default_answer_box_mm": 52
   }'::jsonb),

  -- Image lightbox / viewer
  ('image_lightbox', 'Image Lightbox Viewer',
   'Controls the full-screen image viewer that opens when a thumbnail is clicked.',
   '{
     "max_width_vw": 88,
     "max_height_vh": 82,
     "show_nav_arrows": true,
     "arrow_size": "lg",
     "show_dot_strip": true,
     "show_caption_bar": true,
     "backdrop_opacity": 0.85,
     "close_on_backdrop_click": true,
     "keyboard_nav": true
   }'::jsonb),

  -- Nuanced Analysis activity builder
  ('nuanced_analysis_builder', 'Nuanced Analysis Builder',
   'Layout, layer visibility, and PDF rendering options for the Nuanced Analysis activity builder.',
   '{
     "preview_width": "full",
     "visible_layers": [1,2,3,4,5,6,7,8],
     "default_typst_theme": "light",
     "show_layer_labels": true,
     "auto_inject_oral_flags": false
   }'::jsonb),

  -- Assignment Studio
  ('assignment_studio', 'Assignment Studio',
   'Defaults and layout preferences for the Assignment Studio and reflection generator.',
   '{
     "default_reflection_depth": "standard",
     "show_atl_fields": true,
     "show_tok_connections": true,
     "pdf_page_size": "A4"
   }'::jsonb),

  -- Gradebook
  ('gradebook', 'Gradebook',
   'Grade boundary display, colour coding, and column layout for the dynamic gradebook.',
   '{
     "show_boundaries": true,
     "boundary_colour_scheme": "default",
     "disagreement_threshold_pct": 20,
     "show_disagreement_highlight": true,
     "default_view": "class"
   }'::jsonb),

  -- PDF pipeline
  ('pdf_pipeline', 'PDF Generation Pipeline',
   'Chromium binary, render timeout, and output quality settings for the PDF pipeline.',
   '{
     "chromium_binary_url": "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar",
     "render_timeout_ms": 30000,
     "pdf_scale": 1.0,
     "print_background": true,
     "margin_top_mm": 10,
     "margin_bottom_mm": 10
   }'::jsonb)

ON CONFLICT (feature_key) DO NOTHING;
;
