-- original = authored / AI primary quiz for the slot; recycled = replay / fallback (does not block "next" date for originals)
ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS content_source TEXT NOT NULL DEFAULT 'original'
    CHECK (content_source IN ('original', 'recycled'));

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS generation_meta JSONB;

UPDATE public.quizzes SET content_source = 'original' WHERE content_source IS NULL;

COMMENT ON COLUMN public.quizzes.content_source IS 'original blocks next-slot picker for new originals; recycled does not.';
COMMENT ON COLUMN public.quizzes.generation_meta IS 'Internal AI provenance (optional); not shown in player UI.';
