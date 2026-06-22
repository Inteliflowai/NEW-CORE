-- 0017_teacher_completion.sql
-- Epic 3b: small persistence for teacher Alerts (reconciled-on-read history) and High-Fives (sent notes).
-- No edits to existing tables. App-logic + object-level IDOR guards are the access backstop (consistent with V2).

-- ── Alerts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES public.schools(id)  ON DELETE CASCADE,
  class_id        uuid NOT NULL REFERENCES public.classes(id)  ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  source_kind     text NOT NULL
                    CHECK (source_kind in ('low_quiz','low_assignment','reteach_flag','reteach_review','strong_result')),
  source_ref      uuid NOT NULL,                 -- the attempt/redo row that raised it (per-occurrence identity)
  severity        text NOT NULL CHECK (severity in ('urgent','watch','info')),
  status          text NOT NULL DEFAULT 'open' CHECK (status in ('open','resolved')),
  resolved_by     uuid REFERENCES public.users(id),   -- null + resolved => auto-cleared
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- One alert per distinct triggering occurrence, ever (open or resolved):
-- DB-level dedup + makes manual/auto resolve sticky for that occurrence.
CREATE UNIQUE INDEX IF NOT EXISTS alerts_occurrence_uq
  ON public.alerts (student_id, class_id, source_kind, source_ref);
CREATE INDEX IF NOT EXISTS alerts_class_status_idx
  ON public.alerts (class_id, status, severity);

-- ── High-Fives (sent notes) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.high_fives (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id             uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id           uuid NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  author_id            uuid NOT NULL REFERENCES public.users(id),
  note_text            text NOT NULL,
  reason_hint          text,            -- which suggestion seeded it (persistence|recovery|effortful_success|consistency_rising|reteach_completed|stretch); null = blank composer
  ai_drafted           boolean NOT NULL DEFAULT false,
  viewed_by_student_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS high_fives_student_idx ON public.high_fives (student_id, created_at desc);
CREATE INDEX IF NOT EXISTS high_fives_class_idx   ON public.high_fives (class_id, created_at desc);
