-- 043: Add mark_attributions JSONB column to question_parts
-- Stores token-level subtopic attribution for markscheme marks.
-- Schema: { [tokenId: string]: { subtopicCode: string; source: "manual" | "ai"; rationale?: string } }

ALTER TABLE question_parts
  ADD COLUMN IF NOT EXISTS mark_attributions JSONB NOT NULL DEFAULT '{}';
