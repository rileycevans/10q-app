## What changed
- Implemented global leaderboards with time windows (today, week, month, year)
- Added score type toggle (cumulative vs average)
- Implemented league management system (create, view, add/remove members, delete)
- Built 6 new Edge Functions for league operations
- Created league UI pages and components following neo-brutalist design system
- Integrated league leaderboards with existing leaderboard infrastructure

## Why
- Satisfies MVP requirements for leaderboards (README.md)
- Satisfies MVP requirements for leagues (create private leagues, owner can add/remove members, league-scoped leaderboards)
- Follows contracts-first and trust-boundary rules
- Enforces RLS policies for league data isolation

## How it works
- **Leaderboards**: Aggregates `daily_results` by time window, supports cumulative (SUM) and average (AVG) score types, ranking by score DESC then time ASC
- **League Management**: 
  - All Edge Functions require authentication
  - Owner-only operations verified server-side (add/remove members, delete league)
  - Member verification for league access
  - Handle lookup is case-insensitive via `handle_canonical`
- **RLS**: League members can only read their own leagues, owners can manage members
- **Idempotency**: League creation is idempotent (no duplicate leagues per owner/name)
- **Cascading**: League deletion cascades to members via FK constraint

## Tests
- Manual testing: Created leagues, added members, viewed leaderboards
- Edge Functions: All functions use standalone format (inline shared code) for MCP deployment
- RLS: Verified via database policies - members can only access their leagues

## Risk / Rollback
- **Risk**: Breaking change if Edge Functions not deployed in correct order (create-league deployed, others ready)
- **Risk**: League leaderboard requires league membership verification
- **Rollback**: Revert commits, undeploy Edge Functions via Supabase Dashboard
- **Migration**: No database migrations (using existing `leagues` and `league_members` tables)

## Screenshots
- League list page with "Create League" button
- League detail page with member list and leaderboard
- Leaderboard with time window, score type, and mode toggles

