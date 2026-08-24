
CREATE TABLE nuanced_analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL,
  title           text NOT NULL,
  subtitle        text,
  course          text NOT NULL DEFAULT 'IBDP Mathematics AA HL',
  syllabus_topics text[] NOT NULL DEFAULT '{}',
  prerequisites   text[] NOT NULL DEFAULT '{}',
  materials       text,
  vocabulary      text[] NOT NULL DEFAULT '{}',
  atl_statement   text,
  tok_provocations jsonb NOT NULL DEFAULT '[]',
  parts           jsonb NOT NULL DEFAULT '[]',
  teacher_companion jsonb,
  sort_order      integer NOT NULL DEFAULT 0,
  is_published    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE nuanced_analyses IS
  'Stores Nuanced Analysis structured investigation packets. Each row is one complete packet.';

COMMENT ON COLUMN nuanced_analyses.slug IS
  'URL-safe identifier, e.g. polynomial-analysis or quadratics-calculus-transition';
COMMENT ON COLUMN nuanced_analyses.parts IS
  'Ordered array of Part objects: {part_number, title, micro_box, questions[], geometric_reading}';
COMMENT ON COLUMN nuanced_analyses.tok_provocations IS
  'Array of exactly two TOK question strings per the Design Instructions spec';
COMMENT ON COLUMN nuanced_analyses.teacher_companion IS
  'Integration map, answer sketches, tiered deadlines, compulsory core list, differentiation notes';

CREATE INDEX nuanced_analyses_slug_idx ON nuanced_analyses (slug);
CREATE INDEX nuanced_analyses_sort_idx ON nuanced_analyses (sort_order);
;
