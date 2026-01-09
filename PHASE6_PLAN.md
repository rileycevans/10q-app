# Phase 6: Leagues Management System

## Overview

Build UI and Edge Functions for creating, managing, and viewing private leagues.

## Current Status

✅ **Database Schema**: `leagues` and `league_members` tables exist with RLS
✅ **League Leaderboard Edge Function**: `get-league-leaderboard` exists and deployed
❌ **League Management UI**: Not implemented
❌ **League Creation**: No Edge Function or UI
❌ **Member Management**: No Edge Functions or UI

## MVP Requirements (from README.md)

- Create private leagues
- Owner can add/remove members
- League-scoped leaderboards

## Phase 6 Implementation Plan

### 1. Edge Functions

**`create-league`**
- Create a new league with name
- Set creator as owner
- Add creator as first member
- Return league_id

**`get-my-leagues`**
- List all leagues user is a member of
- Include role (owner/member)
- Include member count

**`get-league-details`**
- Get league info (name, owner, created_at)
- List all members with roles
- Verify user is a member

**`add-league-member`**
- Add a member to a league (by handle or email)
- Verify requester is owner
- Return updated member list

**`remove-league-member`**
- Remove a member from a league
- Verify requester is owner
- Cannot remove owner

**`delete-league`**
- Delete a league
- Verify requester is owner
- Cascade deletes members

### 2. UI Pages

**`/leagues`** - League List Page
- Show all leagues user is a member of
- "Create League" button
- Link to each league's page

**`/leagues/[id]`** - League Detail Page
- League name and info
- Member list with roles
- League leaderboard (reuse LeaderboardTable component)
- Management controls (if owner):
  - Add member (by handle)
  - Remove member
  - Delete league

**`/leagues/create`** - Create League Page
- Form to create new league
- Name input
- Validation

### 3. UI Components

**`LeagueCard`** - Display league summary
- League name
- Member count
- Role badge (Owner/Member)
- Link to league page

**`LeagueMemberList`** - Display members
- Member handles
- Role badges
- Remove buttons (owner only)

**`AddMemberForm`** - Add member to league
- Handle/email input
- Validation
- Submit button

### 4. Domain Adapters

**`domains/league/index.ts`**
- `createLeague(name: string)`
- `getMyLeagues()`
- `getLeagueDetails(leagueId: string)`
- `addLeagueMember(leagueId: string, handle: string)`
- `removeLeagueMember(leagueId: string, memberId: string)`
- `deleteLeague(leagueId: string)`

## Acceptance Criteria

- ✅ User can create a league
- ✅ User can view all their leagues
- ✅ User can view league details and members
- ✅ Owner can add members (by handle)
- ✅ Owner can remove members
- ✅ Owner can delete league
- ✅ League leaderboard displays correctly
- ✅ RLS policies prevent unauthorized access
- ✅ All UI follows neo-brutalist design system

## Database

- ✅ `leagues` table exists
- ✅ `league_members` table exists
- ✅ RLS policies exist
- ⏭️ May need indexes for member lookups

## Notes

- League names should be unique per owner (or globally?)
- Member addition by handle requires handle lookup
- League deletion cascades to members (already handled by FK)
- League leaderboard reuses existing `get-league-leaderboard` Edge Function

