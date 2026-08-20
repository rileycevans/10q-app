-- ---------------------------------------------------------------------------
-- Universe expansion: amplifiers + fan accounts.
--
-- These have source_class != 'originator' so the legitimacy view ignores them
-- for tier promotion. They still ingest and produce claim_reports, giving us
-- separate signals for propagation (amplifier_reports) and sentiment
-- (fan_reports). credibility_tier is NULL by design.
--
-- Handles are best-effort; the poller's consecutive_errors counter will
-- auto-skip any that are dead/private.
-- ---------------------------------------------------------------------------

INSERT INTO transfers.journalists
  (name, x_handle, primary_league, primary_clubs, country, language, source_type, source_class, credibility_tier, active)
VALUES
  -- ====== AMPLIFIERS (20) ======
  ('Transfer News Live',  '@TransferNewsLive', 'Multi (Global)',          NULL,                'UK',      'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Transfers Update',    '@TransfersUpdate',  'Multi (Global)',          NULL,                'UK',      'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Footy Accumulators',  '@FootyAccums',      'Multi (Global)',          NULL,                'UK',      'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('iMia San Mia',        '@iMiaSanMia',       'Bundesliga',              'Bayern Munich',     'Germany', 'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Sempre Inter',        '@SempreInter',      'Serie A',                 'Inter Milan',       'Italy',   'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Madrid Xtra',         '@MadridXtra',       'La Liga',                 'Real Madrid',       'Spain',   'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Barca Universal',     '@BarcaUniversal',   'La Liga',                 'Barcelona',         'Spain',   'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Barca Times',         '@BarcaTimes',       'La Liga',                 'Barcelona',         'Spain',   'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Away Fans',           '@AwayFans_',        'Multi (PL)',              NULL,                'UK',      'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('LDN Football',        '@LDNFootball',      'Premier League',          'Arsenal/Chelsea/Tottenham', 'UK', 'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Transfermarkt',       '@TransferMarkt',    'Multi (Global)',          NULL,                'Germany', 'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Transfers Live',      '@TransfersLive',    'Multi (Global)',          NULL,                'UK',      'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Here We Go Live',     '@HereWeGoLive',     'Multi (Global)',          NULL,                'Unknown', 'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Football Scout 24',   '@FootballScout24',  'Multi (Global)',          NULL,                'UK',      'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('FabriEnzo',           '@FabriEnzo',        'Multi (Serie A)',         NULL,                'Italy',   'Italian', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('The European Lad',    '@TheEuropeanLad',   'Multi (Global)',          NULL,                'UK',      'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Squawka News',        '@SquawkaNews',      'Multi (PL/Global)',       NULL,                'UK',      'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Football Talkk',      '@FootballTalkk',    'Multi (Global)',          NULL,                'UK',      'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Talk Transfer',       '@TalkTransferr',    'Multi (Global)',          NULL,                'UK',      'English', 'Transfer Aggregator', 'amplifier', NULL, true),
  ('Juventus Updates',    '@JuventusUpdates',  'Serie A',                 'Juventus',          'Italy',   'English', 'Transfer Aggregator', 'amplifier', NULL, true),

  -- ====== FAN ACCOUNTS (40) ======
  -- Premier League (16)
  ('Arsenal Loop',        '@AFC_Loop',         'Premier League', 'Arsenal',          'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('Man United Loop',     '@MUFC_Loop',        'Premier League', 'Manchester United','UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('LFC News 24/7',       '@LFC_News_24_7',    'Premier League', 'Liverpool',        'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('CFC Janty',           '@CFC_Janty',        'Premier League', 'Chelsea',          'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('The Red Academy',     '@TheRedAcademy',    'Premier League', 'Liverpool',        'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('Spurs Official Fan',  '@SpursOfficial_',   'Premier League', 'Tottenham',        'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('City Xtra',           '@CityXtra',         'Premier League', 'Manchester City',  'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('NUFC 360',            '@NUFC360',          'Premier League', 'Newcastle United', 'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('West Ham Central',    '@WestHam_Central',  'Premier League', 'West Ham',         'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('Arsenal Arsenal',     '@ArsenalArsenal',   'Premier League', 'Arsenal',          'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('Liverpool FRSN',      '@LiverpoolFRSN',    'Premier League', 'Liverpool',        'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('CFC Matters',         '@CFCMatters',       'Premier League', 'Chelsea',          'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('Chelsea FL',          '@Chelsea_FL',       'Premier League', 'Chelsea',          'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('Aston Villa Official Fan','@AVFCOfficial_','Premier League', 'Aston Villa',      'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('Saints FC News',      '@SaintsFC_News',    'Premier League', 'Southampton',      'UK',      'English', 'Fan Account', 'fan', NULL, true),
  ('COYS News',           '@COYS_news',        'Premier League', 'Tottenham',        'UK',      'English', 'Fan Account', 'fan', NULL, true),
  -- La Liga (8)
  ('R Madridista Real',   '@RMadridistaReal', 'La Liga',         'Real Madrid',      'Spain',   'English', 'Fan Account', 'fan', NULL, true),
  ('Real Madrid US',      '@RealMadridUS',    'La Liga',         'Real Madrid',      'Spain',   'English', 'Fan Account', 'fan', NULL, true),
  ('Cule 10',             '@_Cule10',         'La Liga',         'Barcelona',        'Spain',   'English', 'Fan Account', 'fan', NULL, true),
  ('FC Barcelona Fan',    '@FCBarcelona_FCB_','La Liga',         'Barcelona',        'Spain',   'English', 'Fan Account', 'fan', NULL, true),
  ('Atleti OTQ',          '@AtletiOTQ',       'La Liga',         'Atletico Madrid',  'Spain',   'English', 'Fan Account', 'fan', NULL, true),
  ('La Liga Insider',     '@LaLigaInsider',   'La Liga',          NULL,              'Spain',   'English', 'Fan Account', 'fan', NULL, true),
  ('Se Futbol ES',        '@SeFutbolES',      'La Liga',          NULL,              'Spain',   'Spanish', 'Fan Account', 'fan', NULL, true),
  ('Athletic Uni',        '@AthleticUni',     'La Liga',         'Athletic Club',    'Spain',   'English', 'Fan Account', 'fan', NULL, true),
  -- Bundesliga (6)
  ('FC Bayern EN',        '@FCBayernEN',      'Bundesliga',      'Bayern Munich',    'Germany', 'English', 'Fan Account', 'fan', NULL, true),
  ('BVB Loyal',           '@BVB_Loyal',       'Bundesliga',      'Borussia Dortmund','Germany', 'English', 'Fan Account', 'fan', NULL, true),
  ('RB Leipzig EN',       '@RBLeipzigEN_',    'Bundesliga',      'RB Leipzig',       'Germany', 'English', 'Fan Account', 'fan', NULL, true),
  ('Leverkusen USA',      '@LeverkusenUSA',   'Bundesliga',      'Bayer Leverkusen', 'Germany', 'English', 'Fan Account', 'fan', NULL, true),
  ('Stuttgart FCS',       '@Stuttgart_FCS',   'Bundesliga',      'VfB Stuttgart',    'Germany', 'English', 'Fan Account', 'fan', NULL, true),
  ('VfL Wolfsburg EN',    '@VfL_Wolfsburg_EN','Bundesliga',      'Wolfsburg',        'Germany', 'English', 'Fan Account', 'fan', NULL, true),
  -- Serie A (6)
  ('Inter Milan FC Fan',  '@InterMilan_FC',   'Serie A',         'Inter Milan',      'Italy',   'English', 'Fan Account', 'fan', NULL, true),
  ('AC Milan USA',        '@ACMilan_USA',     'Serie A',         'AC Milan',         'Italy',   'English', 'Fan Account', 'fan', NULL, true),
  ('Juventus FC EN',      '@JuventusFCEN',    'Serie A',         'Juventus',         'Italy',   'English', 'Fan Account', 'fan', NULL, true),
  ('Official AS Roma Fan','@OfficialASRoma_', 'Serie A',         'Roma',             'Italy',   'English', 'Fan Account', 'fan', NULL, true),
  ('Napoli ES',           '@NapoliES',        'Serie A',         'Napoli',           'Italy',   'Spanish', 'Fan Account', 'fan', NULL, true),
  ('Lazio Official Fr',   '@LazioOfficialFr','Serie A',          'Lazio',            'Italy',   'French',  'Fan Account', 'fan', NULL, true),
  -- Ligue 1 (4)
  ('PSG Inside',          '@PSG_inside',      'Ligue 1',         'PSG',              'France',  'English', 'Fan Account', 'fan', NULL, true),
  ('PSG Community',       '@PSGCommunity_',   'Ligue 1',         'PSG',              'France',  'English', 'Fan Account', 'fan', NULL, true),
  ('OL Insider',          '@OL_Insider',      'Ligue 1',         'Olympique Lyonnais','France', 'English', 'Fan Account', 'fan', NULL, true),
  ('Marseille Fans',      '@MarseilleFans',   'Ligue 1',         'Olympique de Marseille', 'France', 'English', 'Fan Account', 'fan', NULL, true)
ON CONFLICT (x_handle) DO NOTHING;

-- Audit
SELECT source_class::text, count(*) AS n
FROM transfers.journalists
GROUP BY source_class ORDER BY source_class;;