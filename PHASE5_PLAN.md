# Phase 5: Leaderboards System

## Overview

Build global and league leaderboards with time windows, ranking modes, and score type toggles.

## Requirements

### Leaderboard Windows

- `today`: Current quiz only (latest published quiz)
- `7d`: Rolling last 7 days (UTC time-based)
- `30d`: Rolling last 30 days (UTC time-based)
- `365d`: Rolling last 365 days (UTC time-based)

**Key**: Windows are time-based (UTC intervals), not "last N quizzes". Missing a day means no score for that day.

### Score Type Toggle

Players can toggle between:
- **Cumulative**: Sum of all scores in the time period
  - Example: Player played 5 days in 7d window with scores [80, 85, 90, 75, 88] → Cumulative = 418
- **Average**: Average of all scores in the time period
  - Example: Same player → Average = 83.6

**Ranking**: Uses the selected score type (cumulative or average) for ordering.

### Leaderboard Modes

1. **Top-N Mode**: Show top `limit` entries (e.g., top 100)
2. **Around-Me Mode**: Show entries around current player
   - If `user_rank <= 6`: return ranks 1–12
   - Otherwise: return slice centered on user (5 above, user, 6 below)
   - If user near bottom: return last 12
   - Always include user row (highlighted)

### Ranking Rules

Ordering is stable and deterministic:
1. `aggregated_score` DESC (cumulative SUM or average AVG based on toggle)
2. `total_time_ms` ASC (sum of all times in window)
3. `completed_at` ASC (earliest completion in window)
4. `player_id` ASC (tie-breaker)

### API Endpoints

**Global Leaderboards:**
- `GET /api/leaderboards/global?window=7d&mode=top&limit=100&score_type=cumulative`
- `GET /api/leaderboards/global?window=7d&mode=around&count=12&score_type=average`

**League Leaderboards:**
- `GET /api/leaderboards/league?league_id=...&window=7d&mode=top&limit=100&score_type=cumulative`
- `GET /api/leaderboards/league?league_id=...&window=7d&mode=around&count=12&score_type=average`

**Parameters:**
- `window`: `today` | `7d` | `30d` | `365d`
- `mode`: `top` | `around`
- `limit`: number (for top mode)
- `count`: number (for around mode, default 12)
- `score_type`: `cumulative` | `average` (default: `cumulative`)

### Response Format

**Top-N Mode:**
```json
{
  "ok": true,
  "data": {
    "window": "7d",
    "score_type": "cumulative",
    "mode": "top",
    "entries": [
      {
        "rank": 1,
        "player_id": "...",
        "handle_display": "Player123",
        "aggregated_score": 418,
        "attempt_count": 5,
        "total_time_ms": 125000,
        "earliest_completed_at": "2025-01-01T12:00:00Z"
      }
    ],
    "user_rank": 42,
    "user_entry": { ... } // if user is in top-N
  }
}
```

**Around-Me Mode:**
```json
{
  "ok": true,
  "data": {
    "window": "7d",
    "score_type": "average",
    "mode": "around",
    "user_rank": 50,
    "user_entry": { ... },
    "entries": [
      // Slice of entries around user
    ],
    "total_players": 12430
  }
}
```

## Implementation Plan

### 1. Edge Functions

**`get-global-leaderboard`**
- Query `daily_results` filtered by time window
- Aggregate scores (SUM or AVG based on `score_type`)
- Apply ranking rules
- Support top-N and around-me modes
- Return user's rank and entry

**`get-league-leaderboard`**
- Same as global, but filter by league membership
- Join with `league_members` table
- Verify user is member of league

### 2. SQL Queries

**Cumulative Score:**
```sql
SELECT 
  player_id,
  SUM(score) as aggregated_score,
  SUM(total_time_ms) as total_time_ms,
  COUNT(*) as attempt_count,
  MIN(completed_at) as earliest_completed_at
FROM daily_results
WHERE completed_at >= NOW() - INTERVAL '7 days'
GROUP BY player_id
ORDER BY aggregated_score DESC, total_time_ms ASC, earliest_completed_at ASC, player_id ASC
```

**Average Score:**
```sql
SELECT 
  player_id,
  AVG(score) as aggregated_score,
  SUM(total_time_ms) as total_time_ms,
  COUNT(*) as attempt_count,
  MIN(completed_at) as earliest_completed_at
FROM daily_results
WHERE completed_at >= NOW() - INTERVAL '7 days'
GROUP BY player_id
ORDER BY aggregated_score DESC, total_time_ms ASC, earliest_completed_at ASC, player_id ASC
```

### 3. UI Components

- Leaderboard page (`/leaderboard`)
- Window selector (today/7d/30d/365d)
- Score type toggle (Cumulative / Average)
- Mode toggle (Top-N / Around Me)
- Leaderboard table with rank, handle, score, attempts
- User row highlighting

### 4. Database

- `daily_results` table already exists with proper indexes
- Indexes support time-window queries efficiently
- No schema changes needed

## Acceptance Criteria

- ✅ Toggle between cumulative and average scores works
- ✅ Ranking updates correctly when toggling score type
- ✅ Top-N mode shows correct top entries
- ✅ Around-me mode shows correct slice around user
- ✅ User's rank is always shown, even if not in visible entries
- ✅ Ordering is stable and deterministic
- ✅ League leaderboards filter correctly
- ✅ Time windows use UTC intervals correctly

## Notes

- Cumulative rewards consistency (playing every day)
- Average rewards skill (high scores regardless of frequency)
- Both metrics are valuable for different player motivations
- Toggle allows players to see rankings from both perspectives

