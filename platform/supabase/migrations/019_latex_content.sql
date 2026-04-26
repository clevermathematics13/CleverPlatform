-- 019: LaTeX content columns + full-text search index
-- Supports the Colab→Supabase ingestion pipeline where MathPix extracts
-- LaTeX from scanned IBDP exam PDFs. Adds:
--   • content_latex / markscheme_latex on question_parts
--   • latex_verified flag per question (toggled via the review UI)
--   • source_pdf_path + page_image_paths on ib_questions
--   • pg_trgm GIN index for fast ILIKE search over LaTeX content

-- ============================================
-- 1. Enable pg_trgm for LaTeX substring search
-- ============================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- 2. LaTeX content columns on question_parts
-- ============================================
ALTER TABLE public.question_parts
  ADD COLUMN IF NOT EXISTS content_latex     TEXT,
  ADD COLUMN IF NOT EXISTS markscheme_latex  TEXT;

-- ============================================
-- 3. Verification flag on question_parts
-- Set to true after a human reviewer confirms the LaTeX is accurate
-- ============================================
ALTER TABLE public.question_parts
  ADD COLUMN IF NOT EXISTS latex_verified BOOLEAN NOT NULL DEFAULT false;

-- ============================================
-- 4. PDF source tracking on ib_questions
-- source_pdf_path   — Supabase Storage path to the original flattened PDF
-- page_image_paths  — ordered Storage paths for per-page PNGs (used by review UI)
-- ============================================
ALTER TABLE public.ib_questions
  ADD COLUMN IF NOT EXISTS source_pdf_path   TEXT,
  ADD COLUMN IF NOT EXISTS page_image_paths  TEXT[];

-- ============================================
-- 5. GIN trigram indexes for fast LaTeX search
-- Supports ILIKE '%\binom{n}{r}%' style queries efficiently
-- ============================================
CREATE INDEX IF NOT EXISTS idx_qparts_content_latex_trgm
  ON public.question_parts USING gin (content_latex gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_qparts_markscheme_latex_trgm
  ON public.question_parts USING gin (markscheme_latex gin_trgm_ops);

-- ============================================
-- 6. Index for filtering unverified questions
-- ============================================
CREATE INDEX IF NOT EXISTS idx_qparts_latex_verified
  ON public.question_parts (latex_verified)
  WHERE latex_verified = false;
