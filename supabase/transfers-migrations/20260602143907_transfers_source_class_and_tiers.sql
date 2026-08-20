-- ---------------------------------------------------------------------------
-- Source class: orthogonal to credibility_tier. Tells the legitimacy scorer
-- which signal "bucket" a source belongs to.
--
--   originator: real journalist with claimed access to clubs/agents.
--   amplifier:  transfer-aggregator accounts; useful for propagation signal,
--               not legitimacy.
--   fan:        club-specific fan accounts; useful for sentiment, not
--               legitimacy.
--   official:   club/league official accounts; only source we trust blindly
--               for terminal "Done" confirmation.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'source_class' AND n.nspname = 'transfers') THEN
    CREATE TYPE transfers.source_class AS ENUM ('originator', 'amplifier', 'fan', 'official');
  END IF;
END$$;

ALTER TABLE transfers.journalists
  ADD COLUMN IF NOT EXISTS source_class transfers.source_class NOT NULL DEFAULT 'originator';

-- Tighten credibility_tier semantics from "vibe" to a structured 1..4 scale.
-- (Column already exists from the initial migration; we only constrain its
-- domain. Existing nulls remain valid — meaning "unassessed".)
ALTER TABLE transfers.journalists
  DROP CONSTRAINT IF EXISTS journalists_credibility_tier_range_chk;
ALTER TABLE transfers.journalists
  ADD CONSTRAINT journalists_credibility_tier_range_chk
  CHECK (credibility_tier IS NULL OR credibility_tier BETWEEN 1 AND 4);

COMMENT ON COLUMN transfers.journalists.credibility_tier IS
  '1 = originator with verified club access (rare, ~10 people). '
  '2 = beat reporter with access. '
  '3 = aggregator / major outlet that rarely originates. '
  '4 = pundits/talkers; near-zero legitimacy contribution.';

COMMENT ON COLUMN transfers.journalists.source_class IS
  'Bucket the source belongs to. Originator contributes directly to legitimacy; '
  'amplifier/fan feed separate signals; official is trusted blindly for Done.';

-- All 191 currently in the table are journalists, so default 'originator' is
-- correct. No explicit backfill needed because the DEFAULT applied on add.
SELECT count(*) AS originators FROM transfers.journalists WHERE source_class = 'originator';;