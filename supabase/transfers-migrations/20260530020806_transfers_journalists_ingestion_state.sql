-- Per-journalist ingestion cursor. last_seen_tweet_id is the tweet ID we've
-- already processed up to (exclusive). last_polled_at lets the scheduler pick
-- the staleest handles each tick.
ALTER TABLE transfers.journalists
  ADD COLUMN IF NOT EXISTS last_seen_tweet_id text,
  ADD COLUMN IF NOT EXISTS last_polled_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_poll_error text,
  ADD COLUMN IF NOT EXISTS consecutive_errors smallint NOT NULL DEFAULT 0;

-- Scheduler picks the staleest ACTIVE journalists. NULLs sort first so
-- never-polled handles get top priority on cold start.
CREATE INDEX IF NOT EXISTS journalists_poll_queue_idx
  ON transfers.journalists (last_polled_at ASC NULLS FIRST)
  WHERE active = true;;