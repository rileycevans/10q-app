-- A single post can yield multiple claims (round-up tweet), so a URL is NOT
-- globally unique across reports — it's unique PER claim. Replace the global
-- unique index with a composite (claim_id, source_url) one.
DROP INDEX IF EXISTS transfers.claim_reports_url_unique;

CREATE UNIQUE INDEX claim_reports_claim_url_unique
  ON transfers.claim_reports (claim_id, source_url)
  WHERE source_url IS NOT NULL;;