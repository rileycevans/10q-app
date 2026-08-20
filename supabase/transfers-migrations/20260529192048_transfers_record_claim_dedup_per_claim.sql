CREATE OR REPLACE FUNCTION transfers.record_claim(
  p_player           text,
  p_destination_club text,
  p_source_club      text DEFAULT NULL,
  p_stage            text DEFAULT NULL,
  p_transfer_type    transfers.transfer_type DEFAULT NULL,
  p_confidence       smallint DEFAULT NULL,
  p_contradicts      boolean DEFAULT false,
  p_journalist_handle text DEFAULT NULL,
  p_outlet           text DEFAULT NULL,
  p_source_url       text DEFAULT NULL,
  p_source_platform  transfers.source_platform DEFAULT 'x',
  p_raw_text         text DEFAULT NULL,
  p_reported_at      timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_player_id      uuid;
  v_dest_id        uuid;
  v_src_id         uuid;
  v_journalist_id  uuid;
  v_stage_id       smallint;
  v_stage_rank     smallint;
  v_window         text := transfers.window_for(p_reported_at);
  v_claim_id       uuid;
  v_claim_existed  boolean := false;
  v_cur_stage_id   smallint;
  v_cur_rank       smallint;
  v_report_id      uuid;
  v_dup            boolean := false;
BEGIN
  IF coalesce(trim(p_player),'') = '' OR coalesce(trim(p_destination_club),'') = '' THEN
    RAISE EXCEPTION 'player and destination_club are required';
  END IF;

  v_dest_id := transfers.resolve_or_create_club(p_destination_club);
  IF p_source_club IS NOT NULL AND trim(p_source_club) <> '' THEN
    v_src_id := transfers.resolve_or_create_club(p_source_club);
  END IF;
  v_player_id := transfers.resolve_or_create_player(p_player);

  IF p_journalist_handle IS NOT NULL THEN
    SELECT id INTO v_journalist_id FROM transfers.journalists
    WHERE lower(x_handle) = lower(trim(p_journalist_handle))
    LIMIT 1;
  END IF;

  IF p_stage IS NOT NULL THEN
    SELECT id, order_rank INTO v_stage_id, v_stage_rank
    FROM transfers.claim_stages WHERE name = p_stage;
    IF v_stage_id IS NULL THEN
      RAISE EXCEPTION 'unknown stage: %', p_stage;
    END IF;
  END IF;

  SELECT id, current_stage_id INTO v_claim_id, v_cur_stage_id
  FROM transfers.claims
  WHERE player_id = v_player_id
    AND destination_club_id = v_dest_id
    AND window_season = v_window;

  IF v_claim_id IS NULL THEN
    INSERT INTO transfers.claims (
      player_id, destination_club_id, source_club_id, transfer_type,
      current_stage_id, status, window_season, first_reported_at, last_reported_at
    ) VALUES (
      v_player_id, v_dest_id, v_src_id, p_transfer_type,
      CASE WHEN p_contradicts THEN NULL ELSE v_stage_id END,
      'active', v_window, p_reported_at, p_reported_at
    )
    RETURNING id INTO v_claim_id;
  ELSE
    v_claim_existed := true;
    SELECT order_rank INTO v_cur_rank FROM transfers.claim_stages WHERE id = v_cur_stage_id;

    UPDATE transfers.claims SET
      last_reported_at = greatest(last_reported_at, p_reported_at),
      first_reported_at = least(first_reported_at, p_reported_at),
      current_stage_id = CASE
        WHEN p_contradicts THEN current_stage_id
        WHEN v_stage_id IS NULL THEN current_stage_id
        WHEN v_cur_rank IS NULL OR v_stage_rank > v_cur_rank THEN v_stage_id
        ELSE current_stage_id
      END,
      source_club_id = coalesce(source_club_id, v_src_id),
      transfer_type = coalesce(transfer_type, p_transfer_type),
      updated_at = now()
    WHERE id = v_claim_id;
  END IF;

  -- Insert the report; dedupe is now per (claim_id, source_url).
  BEGIN
    INSERT INTO transfers.claim_reports (
      claim_id, journalist_id, outlet, stage_id, reported_at,
      source_url, source_platform, raw_text, confidence, contradicts
    ) VALUES (
      v_claim_id, v_journalist_id, p_outlet, v_stage_id, p_reported_at,
      p_source_url, p_source_platform, p_raw_text, p_confidence, p_contradicts
    )
    RETURNING id INTO v_report_id;
  EXCEPTION WHEN unique_violation THEN
    v_dup := true;
    SELECT id INTO v_report_id FROM transfers.claim_reports
    WHERE claim_id = v_claim_id AND source_url = p_source_url;
  END;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_dup THEN 'duplicate_report' ELSE 'recorded' END,
    'claim_id', v_claim_id,
    'claim_existed', v_claim_existed,
    'report_id', v_report_id,
    'player_id', v_player_id,
    'destination_club_id', v_dest_id,
    'source_club_id', v_src_id,
    'journalist_id', v_journalist_id,
    'window_season', v_window
  );
END;
$$;;