
-- Question Studio design/settings persistence table
-- Stores all UI preferences, feature toggles, and design settings
-- for the Question Studio window, keyed by setting_key.
-- Supports per-user rows in future via user_id (nullable for global defaults).

CREATE TABLE IF NOT EXISTS question_studio_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key     text NOT NULL,
  setting_value   jsonb NOT NULL DEFAULT '{}',
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (setting_key, user_id)
);

-- Index for fast per-user + key lookups
CREATE INDEX IF NOT EXISTS idx_qss_user_key
  ON question_studio_settings (user_id, setting_key);

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION update_question_studio_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qss_updated_at ON question_studio_settings;
CREATE TRIGGER trg_qss_updated_at
  BEFORE UPDATE ON question_studio_settings
  FOR EACH ROW EXECUTE FUNCTION update_question_studio_settings_updated_at();

-- Enable RLS
ALTER TABLE question_studio_settings ENABLE ROW LEVEL SECURITY;

-- Teachers can read and write their own settings; global settings (user_id IS NULL) are readable by all
CREATE POLICY "Users read own or global settings"
  ON question_studio_settings FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users write own settings"
  ON question_studio_settings FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users update own settings"
  ON question_studio_settings FOR UPDATE
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users delete own settings"
  ON question_studio_settings FOR DELETE
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Seed global default settings that the Question Studio UI will read on first load
INSERT INTO question_studio_settings (setting_key, setting_value, user_id)
VALUES
  ('window', $j${
    "width": "90vw",
    "height": "90vh",
    "title": "Question Studio"
  }$j$::jsonb, NULL),
  ('image_display', $j${
    "thumbnail_height_px": 1140,
    "grid_cols": { "default": 1, "sm": 2, "lg": 2 },
    "lightbox_enabled": true,
    "lightbox_arrows": true,
    "lightbox_keyboard_nav": true
  }$j$::jsonb, NULL),
  ('toolbar', $j${
    "show_minimise": true,
    "show_delete": true,
    "show_doc_links": true
  }$j$::jsonb, NULL),
  ('parts', $j${
    "show_latex_preview": true,
    "show_command_terms": true,
    "show_subtopics": true,
    "show_mark_type_badges": true
  }$j$::jsonb, NULL)
ON CONFLICT (setting_key, user_id) DO NOTHING;
;
