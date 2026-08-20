-- Transfer Credibility System
-- Separate schema to avoid collisions with the quiz app in public

CREATE SCHEMA IF NOT EXISTS transfers;

-- ============================================================
-- REFERENCE TABLES
-- ============================================================

-- Football leagues (Premier League, La Liga, etc.)
CREATE TABLE transfers.leagues (
  id            smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name          text NOT NULL UNIQUE,
  country       text NOT NULL,
  tier          smallint NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Clubs
CREATE TABLE transfers.clubs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  short_name    text,
  aliases       text[] NOT NULL DEFAULT '{}',
  league_id     smallint REFERENCES transfers.leagues(id) ON DELETE SET NULL,
  country       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, league_id)
);
CREATE INDEX clubs_league_id_idx ON transfers.clubs(league_id);
CREATE INDEX clubs_aliases_gin_idx ON transfers.clubs USING GIN (aliases);

-- Football players
CREATE TABLE transfers.players (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  aliases           text[] NOT NULL DEFAULT '{}',
  nationality       text,
  position          text,
  date_of_birth     date,
  current_club_id   uuid REFERENCES transfers.clubs(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX players_current_club_idx ON transfers.players(current_club_id);
CREATE INDEX players_aliases_gin_idx ON transfers.players USING GIN (aliases);
CREATE INDEX players_name_idx ON transfers.players(name);

-- Journalists / sources (191 from our spreadsheet)
CREATE TABLE transfers.journalists (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  x_handle          text NOT NULL UNIQUE,
  primary_league    text,
  primary_clubs     text,
  country           text,
  language          text,
  source_type       text,
  credibility_tier  smallint,  -- computed later from track record
  notes             text,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journalists_primary_league_idx ON transfers.journalists(primary_league);
CREATE INDEX journalists_active_idx ON transfers.journalists(active);

-- Stage taxonomy
CREATE TABLE transfers.claim_stages (
  id            smallint PRIMARY KEY,
  name          text NOT NULL UNIQUE,
  order_rank    smallint NOT NULL UNIQUE,
  description   text
);

INSERT INTO transfers.claim_stages (id, name, order_rank, description) VALUES
  (1,  'Monitoring',     1,  'Club is watching/scouting the player'),
  (2,  'Interest',       2,  'Club has registered concrete interest internally'),
  (3,  'Agent Contact',  3,  'Club has spoken to the player''s agent/representatives'),
  (4,  'Talks',          4,  'Active discussions between clubs or with the player'),
  (5,  'Bid',            5,  'A formal bid has been submitted'),
  (6,  'Negotiation',    6,  'Bid received, both clubs negotiating terms'),
  (7,  'Fee Agreed',     7,  'Transfer fee between clubs has been agreed'),
  (8,  'Terms Agreed',   8,  'Personal terms with the player have been agreed'),
  (9,  'Medical',        9,  'Player undergoing medical examination'),
  (10, 'Done',           10, 'Transfer officially announced/completed');

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE transfers.claim_status AS ENUM ('active', 'resolved', 'dead');
CREATE TYPE transfers.transfer_type AS ENUM (
  'permanent',
  'loan',
  'loan_with_option',
  'loan_with_obligation',
  'free'
);
CREATE TYPE transfers.source_platform AS ENUM ('x', 'article', 'video', 'podcast', 'other');

-- ============================================================
-- CORE CLAIM TABLES
-- ============================================================

-- Canonical claims (one per player + destination + window)
CREATE TABLE transfers.claims (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id             uuid NOT NULL REFERENCES transfers.players(id) ON DELETE CASCADE,
  destination_club_id   uuid NOT NULL REFERENCES transfers.clubs(id) ON DELETE CASCADE,
  source_club_id        uuid REFERENCES transfers.clubs(id) ON DELETE SET NULL,
  transfer_type         transfers.transfer_type,
  current_stage_id      smallint REFERENCES transfers.claim_stages(id),
  status                transfers.claim_status NOT NULL DEFAULT 'active',
  window_season         text NOT NULL,  -- e.g. '2026-summer', '2027-winter'
  first_reported_at     timestamptz NOT NULL DEFAULT now(),
  last_reported_at      timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, destination_club_id, window_season)
);
CREATE INDEX claims_player_idx ON transfers.claims(player_id);
CREATE INDEX claims_destination_idx ON transfers.claims(destination_club_id);
CREATE INDEX claims_status_idx ON transfers.claims(status);
CREATE INDEX claims_window_idx ON transfers.claims(window_season);
CREATE INDEX claims_last_reported_idx ON transfers.claims(last_reported_at DESC);

-- Individual reports (every tweet/article/post about a claim)
CREATE TABLE transfers.claim_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id          uuid NOT NULL REFERENCES transfers.claims(id) ON DELETE CASCADE,
  journalist_id     uuid REFERENCES transfers.journalists(id) ON DELETE SET NULL,
  outlet            text,  -- fallback when not a tracked journalist (e.g. official club account)
  stage_id          smallint REFERENCES transfers.claim_stages(id),
  reported_at       timestamptz NOT NULL,
  source_url        text,
  source_platform   transfers.source_platform NOT NULL DEFAULT 'x',
  raw_text          text,
  confidence        smallint CHECK (confidence BETWEEN 0 AND 100),
  contradicts       boolean NOT NULL DEFAULT false,  -- denials ("no deal", "won't sign")
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_reports_claim_idx ON transfers.claim_reports(claim_id);
CREATE INDEX claim_reports_journalist_idx ON transfers.claim_reports(journalist_id);
CREATE INDEX claim_reports_reported_at_idx ON transfers.claim_reports(reported_at DESC);
CREATE UNIQUE INDEX claim_reports_url_unique ON transfers.claim_reports(source_url) WHERE source_url IS NOT NULL;

-- Outcomes: what actually happened (drives credibility scoring)
CREATE TABLE transfers.outcomes (
  claim_id                  uuid PRIMARY KEY REFERENCES transfers.claims(id) ON DELETE CASCADE,
  did_transfer              boolean NOT NULL,
  final_destination_club_id uuid REFERENCES transfers.clubs(id) ON DELETE SET NULL,
  transfer_fee              numeric(12, 2),
  transfer_fee_currency     text DEFAULT 'EUR',
  transfer_date             date,
  contract_length_years     numeric(3, 1),
  notes                     text,
  resolved_at               timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- SEED LEAGUES
-- ============================================================

INSERT INTO transfers.leagues (name, country, tier) VALUES
  ('Premier League', 'England',  1),
  ('La Liga',        'Spain',    1),
  ('Bundesliga',     'Germany',  1),
  ('Serie A',        'Italy',    1),
  ('Ligue 1',        'France',   1);

-- ============================================================
-- RLS: enable on all tables (policies to be added when building the read side)
-- For now: only service_role bypasses RLS, anon/authenticated have no access.
-- This is correct for the ingestion-only phase.
-- ============================================================

ALTER TABLE transfers.leagues        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers.clubs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers.players        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers.journalists    ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers.claim_stages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers.claims         ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers.claim_reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers.outcomes       ENABLE ROW LEVEL SECURITY;;