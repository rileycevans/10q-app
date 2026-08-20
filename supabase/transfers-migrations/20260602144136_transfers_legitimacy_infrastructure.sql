-- ---------------------------------------------------------------------------
-- Enum: the legitimacy tier shown to users.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'legitimacy_tier' AND n.nspname = 'transfers') THEN
    CREATE TYPE transfers.legitimacy_tier AS ENUM (
      'speculative',   -- fan/amplifier only, no originator support
      'reported',      -- single Tier-3/Tier-4 originator, no corroboration
      'sourced',       -- single Tier-2 originator, no corroboration
      'well_sourced',  -- Tier-1 originator OR ≥3 independent Tier-2 corroborations
      'confirmed',     -- Tier-1 source at Fee Agreed / Medical / Done, no credible denial
      'disputed'       -- credible denial outweighs the claim
    );
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- Config table: legitimacy rule thresholds. Edit values here, never hardcode.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers.scoring_config (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  description text NOT NULL
);

INSERT INTO transfers.scoring_config (key, value, description) VALUES
  ('corroboration_window_hours',     48, 'Reports within this many hours of each other count as corroborating.'),
  ('staleness_days',                 14, 'After this many days with no new report, a claim is considered stale and degraded by one tier.'),
  ('min_tier2_for_well_sourced',      3, 'Number of independent Tier-2 originators required to reach well_sourced without a Tier-1 source.'),
  ('confirmed_min_stage_rank',        7, 'A claim needs current_stage_id rank >= this (Fee Agreed=7) plus a Tier-1 supporter to be confirmed.'),
  ('denial_tier_outweighs',           1, 'A denial from this tier or better outranks any non-Tier-1 claim and forces disputed.')
ON CONFLICT (key) DO UPDATE SET value = excluded.value, description = excluded.description;

-- ---------------------------------------------------------------------------
-- View: per-claim aggregated signals. The audit trail the legitimacy tier is
-- computed from. Joined into reports, journalists, stages.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW transfers.rumor_signals AS
SELECT
  c.id AS claim_id,
  c.player_id,
  c.destination_club_id,
  c.window_season,
  c.current_stage_id,
  cs.order_rank AS current_stage_rank,
  c.first_reported_at,
  c.last_reported_at,
  (EXTRACT(epoch FROM (now() - c.last_reported_at)) / 86400)::numeric(10,2) AS days_since_last_report,
  -- counts of NON-CONTRADICTING reports by tier (originators only)
  count(*) FILTER (WHERE NOT r.contradicts AND j.source_class='originator' AND j.credibility_tier=1) AS tier1_reports,
  count(*) FILTER (WHERE NOT r.contradicts AND j.source_class='originator' AND j.credibility_tier=2) AS tier2_reports,
  count(*) FILTER (WHERE NOT r.contradicts AND j.source_class='originator' AND j.credibility_tier=3) AS tier3_reports,
  count(*) FILTER (WHERE NOT r.contradicts AND j.source_class='originator' AND j.credibility_tier=4) AS tier4_reports,
  count(DISTINCT j.id) FILTER (WHERE NOT r.contradicts AND j.source_class='originator' AND j.credibility_tier=2) AS distinct_tier2_journos,
  count(*) FILTER (WHERE j.source_class='amplifier') AS amplifier_reports,
  count(*) FILTER (WHERE j.source_class='fan')       AS fan_reports,
  count(*) FILTER (WHERE j.source_class='official')  AS official_reports,
  -- denials, by tier
  count(*) FILTER (WHERE r.contradicts AND j.source_class='originator' AND j.credibility_tier=1) AS tier1_denials,
  count(*) FILTER (WHERE r.contradicts AND j.source_class='originator' AND j.credibility_tier=2) AS tier2_denials,
  -- best (lowest-numbered = strongest) tier among supporters
  min(j.credibility_tier) FILTER (WHERE NOT r.contradicts AND j.source_class='originator') AS strongest_supporter_tier,
  min(j.credibility_tier) FILTER (WHERE r.contradicts     AND j.source_class='originator') AS strongest_denier_tier,
  -- highest stage reached by any non-denial originator report
  max(rs.order_rank) FILTER (WHERE NOT r.contradicts AND j.source_class='originator') AS max_supporter_stage_rank
FROM transfers.claims c
JOIN transfers.claim_reports r ON r.claim_id = c.id
LEFT JOIN transfers.journalists j ON j.id = r.journalist_id
LEFT JOIN transfers.claim_stages cs ON cs.id = c.current_stage_id
LEFT JOIN transfers.claim_stages rs ON rs.id = r.stage_id
GROUP BY c.id, cs.order_rank;

-- ---------------------------------------------------------------------------
-- View: the legitimacy tier per claim, applying the rules. Returns one row
-- per claim, including the supporting signals and a short reason code.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW transfers.rumor_legitimacy AS
WITH cfg AS (
  SELECT
    (SELECT value::int FROM transfers.scoring_config WHERE key='min_tier2_for_well_sourced') AS min_t2,
    (SELECT value::int FROM transfers.scoring_config WHERE key='confirmed_min_stage_rank')   AS confirmed_stage,
    (SELECT value::int FROM transfers.scoring_config WHERE key='denial_tier_outweighs')      AS denial_outweighs,
    (SELECT value::int FROM transfers.scoring_config WHERE key='staleness_days')             AS stale_days
)
SELECT
  s.claim_id,
  CASE
    -- DISPUTED: any Tier-1 denial against a non-Tier-1 supporter,
    -- or any Tier-2 denial against a Tier-3/4-only claim.
    WHEN s.tier1_denials > 0 AND coalesce(s.strongest_supporter_tier, 9) > 1
      THEN 'disputed'::transfers.legitimacy_tier
    WHEN s.tier2_denials > 0 AND coalesce(s.strongest_supporter_tier, 9) >= 3
      THEN 'disputed'::transfers.legitimacy_tier
    -- CONFIRMED: Tier-1 supporter AND claim has reached Fee Agreed (rank 7) or further,
    -- with no Tier-1 denial.
    WHEN s.tier1_reports > 0
         AND coalesce(s.max_supporter_stage_rank, 0) >= (SELECT confirmed_stage FROM cfg)
         AND s.tier1_denials = 0
      THEN 'confirmed'::transfers.legitimacy_tier
    -- WELL_SOURCED: Tier-1 supporter (any stage) OR enough distinct Tier-2s within window.
    WHEN s.tier1_reports > 0
      OR s.distinct_tier2_journos >= (SELECT min_t2 FROM cfg)
      THEN 'well_sourced'::transfers.legitimacy_tier
    -- SOURCED: at least one Tier-2 originator.
    WHEN s.tier2_reports > 0
      THEN 'sourced'::transfers.legitimacy_tier
    -- REPORTED: only Tier-3/Tier-4 originator(s).
    WHEN s.tier3_reports > 0 OR s.tier4_reports > 0
      THEN 'reported'::transfers.legitimacy_tier
    -- SPECULATIVE: only amplifier/fan signals.
    ELSE 'speculative'::transfers.legitimacy_tier
  END AS legitimacy,
  -- Stale flag (display layer can show a clock icon).
  (s.days_since_last_report > (SELECT stale_days FROM cfg))::boolean AS is_stale,
  -- Pass the signal columns through so the UI can render the "why".
  s.tier1_reports, s.tier2_reports, s.tier3_reports, s.tier4_reports,
  s.distinct_tier2_journos, s.amplifier_reports, s.fan_reports, s.official_reports,
  s.tier1_denials, s.tier2_denials,
  s.strongest_supporter_tier, s.strongest_denier_tier,
  s.max_supporter_stage_rank, s.current_stage_rank,
  s.days_since_last_report
FROM transfers.rumor_signals s;;