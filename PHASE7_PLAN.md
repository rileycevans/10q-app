# Phase 7: Identity & Profile Management

## Overview

Enhance identity system with Google OAuth, improved handle generation, handle customization, and user profiles.

## Current Status

✅ **Basic Anonymous Auth**: Working via Supabase anonymous auth
✅ **Basic Handle Generation**: `Player{userId.slice(0,8)}` exists
❌ **Google OAuth**: Not implemented
❌ **Handle Customization**: Not implemented
❌ **Profile Page**: Not implemented
❌ **Xbox-style Handles**: Not implemented (needs adjective + noun pattern)

## MVP Requirements (from README.md)

- Anonymous play by default ✅
- Auto-generated handles (Xbox-style) ⏭️
- Google sign-in upgrade ⏭️
- Handle customization (once every 30 days) ⏭️

## Phase 7 Implementation Plan

### 1. Handle Generation System

**Xbox-style Pattern**: `{adjective}{noun}{number}`
- Examples: `SwiftTiger42`, `BoldEagle17`, `CleverWolf93`
- Adjectives: 50+ options (Swift, Bold, Clever, Mighty, etc.)
- Nouns: 50+ options (Tiger, Eagle, Wolf, Phoenix, etc.)
- Number: 2-digit (00-99)

**Implementation**:
- Create `packages/contracts/src/handles.ts` with word lists
- Function: `generateXboxStyleHandle(): string`
- Update profile creation in Edge Functions to use new generator

### 2. Google OAuth Integration

**Supabase Auth Setup**:
- Configure Google OAuth provider in Supabase Dashboard
- Add Google Client ID/Secret to environment

**Frontend**:
- Update `AuthButton` to support both anonymous and Google sign-in
- Add Google sign-in button
- Handle OAuth callback
- Migrate existing anonymous users (optional, can be separate)

**Edge Functions**:
- Update `start-attempt` to handle both auth types
- Ensure profile creation works for Google OAuth users

### 3. Handle Customization

**Edge Function**: `update-handle`
- Verify user owns profile
- Check `handle_last_changed_at` (must be 30+ days ago)
- Validate handle format (alphanumeric, 3-20 chars, unique)
- Update `handle_display`, `handle_canonical`, `handle_last_changed_at`
- Return updated profile

**Database Migration**:
- Add `handle_last_changed_at TIMESTAMPTZ` to `profiles` table
- Add unique constraint on `handle_canonical`
- Add index on `handle_canonical` for lookups

**UI**:
- Profile settings page (`/settings` or `/profile`)
- Handle input with validation
- Show "Last changed: X days ago" or "Available now"
- Confirmation dialog

### 4. Profile Page

**Route**: `/u/[handle]`
- Lookup user by `handle_canonical`
- Display:
  - Handle
  - Join date
  - All-time stats (best score, worst score, total games)
  - Recent quiz results (last 10)
  - Category performance breakdown
- Link to their leagues (if public)

**Edge Function**: `get-profile-by-handle`
- Lookup by `handle_canonical`
- Return public profile data
- Include stats aggregation

### 5. Profile Domain Adapter

**`domains/profile/index.ts`**
- `getProfileByHandle(handle: string)`
- `updateHandle(newHandle: string)`
- `getMyProfile()`
- `getProfileStats(userId: string)`

## Implementation Steps

### Step 1: Database Migration
- Add `handle_last_changed_at` column
- Add unique constraint on `handle_canonical`
- Add index

### Step 2: Handle Generation
- Create word lists and generator function
- Update profile creation logic

### Step 3: Google OAuth
- Configure Supabase Google provider
- Update AuthButton component
- Test OAuth flow

### Step 4: Handle Customization
- Create `update-handle` Edge Function
- Build settings/profile page
- Add validation and rate limiting

### Step 5: Profile Page
- Create `get-profile-by-handle` Edge Function
- Build `/u/[handle]` page
- Display stats and recent results

## Acceptance Criteria

- ✅ Users can sign in with Google OAuth
- ✅ Anonymous users get Xbox-style handles automatically
- ✅ Users can customize handle (once per 30 days)
- ✅ Handle uniqueness enforced
- ✅ Profile page displays user stats and history
- ✅ All UI follows neo-brutalist design system

## Database Changes

```sql
-- Add handle customization tracking
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS handle_last_changed_at TIMESTAMPTZ;

-- Ensure unique handles
CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_canonical_unique 
  ON public.profiles(handle_canonical);

-- Index for handle lookups
CREATE INDEX IF NOT EXISTS profiles_handle_canonical_idx 
  ON public.profiles(handle_canonical);
```

## Notes

- Google OAuth requires Supabase Dashboard configuration
- Handle customization requires 30-day cooldown enforcement
- Profile page should be public (no auth required for viewing)
- Xbox-style handles should be memorable and avoid offensive combinations

