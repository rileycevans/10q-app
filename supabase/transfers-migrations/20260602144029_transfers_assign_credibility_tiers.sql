-- ---------------------------------------------------------------------------
-- Initial tier assignments. Conservative on Tier 1 (only proven breakers with
-- established club-source access).
--
-- Tier 1 (~13): the originators whose names lead breaks.
-- Tier 2:       beat reporters at major outlets + serious league reporters +
--               English-language experts on non-English leagues.
-- Tier 3:       institutional outlet handles + commentators/analysts.
-- Tier 4:       columnists, pundits, talk-radio personalities.
-- Official:     league/club official handles (treated separately).
--
-- The Bundesliga official handle gets source_class=official and no tier.
-- ---------------------------------------------------------------------------

-- Reset everyone first; we'll layer assignments by handle.
UPDATE transfers.journalists SET credibility_tier = NULL;

-- Tier 1 — the originators
UPDATE transfers.journalists SET credibility_tier = 1
WHERE x_handle IN (
  '@FabrizioRomano',     -- Romano
  '@David_Ornstein',     -- Ornstein
  '@DiMarzio',           -- Gianluca Di Marzio
  '@Plettigoal',         -- Plettenberg (Sky Germany)
  '@NicoSchira',         -- Schira
  '@AlfredoPedulla',     -- Pedullà
  '@cfbayern',           -- Christian Falk (Bild)
  '@JamesPearceLFC',     -- Pearce (Athletic/LFC)
  '@PhilHay_',           -- Phil Hay (Athletic/Leeds)
  '@_pauljoyce',         -- Joyce (Times)
  '@LoicTanzi',          -- Tanzi (L'Equipe)
  '@mohamedbouhafsi',    -- Bouhafsi (RMC)
  '@MatteMoretto'        -- Matteo Moretto
);

-- Tier 2 — established beat reporters + serious league reporters
UPDATE transfers.journalists SET credibility_tier = 2
WHERE x_handle IN (
  -- Premier League — Athletic / Guardian / Times / Telegraph beat + league
  '@gunnerblog', '@jaydmharris', '@lauriewhitwell', '@SamLee',
  '@ChrisDHWaugh', '@CaoimheSport', '@andy_naylor_', '@domfifield',
  '@liam_twomey', '@paddyboyland', '@AHunterGuardian', '@JamieJackson___',
  '@ChrisBascombe', '@Matt_Law_DT', '@hirstclass',
  '@AdamCrafton_', '@DTathletic', '@OliverKay', '@DHytner',
  '@JacobSteinberg', '@MiguelDelaney', '@JBurtTelegraph', '@Mike_McGrath_',
  '@SamWallaceTel', '@henrywinter', '@martynziegler', '@TomRoddy_',
  '@JNorthcroft', '@SkyKaveh', '@SamiMokbel81_DM', '@MarkOgden_',
  '@MelissaReddy_', '@sistoney67', '@philmcnulty',
  -- PL club beat at local papers + ESPN
  '@RobDawsonESPN', '@samuelluckhurst', '@StuBrennanMEN', '@StuartMathieson',
  '@JoeBrayMEN', '@ianjdoyle', '@ptgorst', '@ConnorDunnLE',
  '@lee_ryder', '@Ciaran_Kelly', '@BerenCross', '@ChrisWheelerDM',
  '@johncrossmirror', '@MirrorMcDonnell', '@AshPreeceBMail', '@AlanSmithJourno',
  '@charles_watts',
  -- La Liga — language experts + Marca/AS/Sport/MD beat + COPE/SER beat
  '@sidlowe', '@GuillemBalague', '@BumperGraham',
  '@EduPidal', '@HelenaCondis', '@antonmeana', '@SiqueRodriguez',
  '@AdrianaGarcia', '@JoseFelix_Diaz', '@JoseSanchez_M', '@miguelquintana_',
  '@rmartin1989', '@ferpolo', '@Alfremartinezz', '@lluismascaro',
  '@MarcGuillen10', '@TJuanmarti', '@BrunoAlemany',
  -- Bundesliga — beat at Bild/Kicker/Sky/AZ + English experts
  '@honigstein', '@stra_patrick', '@_LarsPollmann', '@TAltschaeffl',
  '@saschafligge', '@KerryHau', '@DKruempelmann',
  '@MarcBehrenbeck', '@PBergerBR', '@SebSB', '@larswallrodt',
  '@kevinhatchard',
  -- Serie A — beat + English experts + senior league reporters
  '@JamesHorncastle', '@Paolo_Bandini', '@Adz77',
  '@bonsignore_f', '@vinncasso', '@romeoagresti', '@FBiasin',
  '@MatteoPifferi', '@tancredipalmeri', '@SkySalvione',
  '@SusyFI', '@AleSchiavone', '@cgarganese',
  '@longoale', '@marcoconterio',
  -- Ligue 1 — beat + English experts + senior reporters
  '@LaurensJulien', '@Jon_LeGossip', '@andybrassell',
  '@DamienDegorre', '@HugoGuillemet', '@mathieucoureau', '@GSchneider_OL',
  '@F_Germain', '@Bilel_Ghazi', '@SebTarrago',
  '@RazikBrikh', '@Santi_J7', '@HadrienGrenier_',
  '@FrenchFooty', '@LukeEntwistle',
  -- Multi-league
  '@JacobsBen', '@RudyGaletti', '@Marcotti',
  '@romainmolina'  -- investigative
);

-- Tier 3 — institutional outlet handles + non-news contributors
UPDATE transfers.journalists SET credibility_tier = 3
WHERE x_handle IN (
  -- Major outlet handles (repost / aggregate more than originate)
  '@BBCSport', '@SkySportsNews', '@guardian_sport', '@TeleFootball',
  '@TheAthleticFC', '@TimesSport', '@MailSport', '@MirrorFootball',
  '@ESPNFC', '@goal',
  '@marca', '@diarioas', '@sport', '@mundodeportivo', '@relevo',
  '@BILD_Sport', '@kicker_BL', '@SkySportDE', '@SPORT1', '@GGFN_',
  '@Gazzetta_it', '@CorSport', '@tuttosport', '@SkySport',
  '@TuttoMercatoWeb', '@cmdotcom', '@footballitalia',
  '@lequipe', '@RMCsport', '@francefootball', '@le_Parisien',
  '@le10sport', '@sofoot', '@footmercato', '@GFFN',
  -- Commentators / tactics writers (good context, not breakers)
  '@archiert1', '@TobiasEscher', '@cre80s', '@saberdesfarges',
  -- Journos at smaller-circulation papers
  '@Ian_Ladyman_DM', '@Matt_HughesDM', '@Mike_Keegan_DM',
  '@TomAllnutt'
);

-- Tier 4 — columnists / pundits / talk-radio
UPDATE transfers.journalists SET credibility_tier = 4
WHERE x_handle IN (
  '@AlexCrookTalkSPORT', '@DeanJonesSoccer',
  '@barneyronay', '@jonathanliew',
  '@AlfredoRelano', '@santigimenez', '@TomasRoncero',
  '@RobertoPalomar', '@ramon_besa',
  '@jgallegofc', '@ManuCarreno', '@jpedrerol', '@gerardromero',
  '@Nabil_djellit', '@Duluc_Vincent', '@DanielRiolo', '@RothenJerome',
  '@Minarzouki'
);

-- Official accounts
UPDATE transfers.journalists
SET source_class = 'official', credibility_tier = NULL
WHERE x_handle = '@Bundesliga_EN';

-- Audit: how many in each tier, and any unclassified?
SELECT coalesce(credibility_tier::text, 'unassigned') AS tier,
       source_class::text,
       count(*) AS n
FROM transfers.journalists
GROUP BY 1, 2 ORDER BY 1, 2;;