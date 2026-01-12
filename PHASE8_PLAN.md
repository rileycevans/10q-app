# Phase 8: Category Performance & Polish

## Overview

Complete the remaining MVP features and polish the application for production readiness. Focus on category performance breakdown, error handling improvements, and deployment preparation.

## Current Status

✅ **Core Gameplay**: Complete (Phase 1-3)
✅ **Results Page**: Complete with question breakdown
✅ **Leaderboards**: Complete (global + league)
✅ **Leagues**: Complete (Phase 6)
✅ **Identity & Profile**: Complete (Phase 7)
❌ **Category Performance**: Not implemented (MVP requirement)
❌ **Error Handling**: Basic, needs improvement
❌ **Testing**: Limited coverage
❌ **Deployment**: Not configured

## MVP Requirements (from README.md)

### Remaining MVP Features
- Category performance breakdown ⏭️
- All-time best/worst score ✅ (in profile)
- Total games ✅ (in profile)

## Phase 8 Implementation Plan

### 1. Category Performance Breakdown

**MVP Requirement**: "Category performance" in stats

**Implementation**:
- Add category aggregation to `get-profile-by-handle` Edge Function
- Query `attempt_answers` joined with `question_tags` to get category-level stats
- Calculate per-category:
  - Total questions answered
  - Correct count
  - Accuracy percentage
  - Average score per question
  - Best score in category
- Display in profile page (`/u/[handle]`) with visual breakdown

**Edge Function Updates**:
- `get-profile-by-handle`: Add category stats aggregation
- Query structure:
  ```sql
  -- Get category performance from attempt_answers + question_tags
  SELECT 
    qt.tag as category,
    COUNT(*) as total_questions,
    SUM(CASE WHEN aa.is_correct THEN 1 ELSE 0 END) as correct_count,
    AVG(aa.total_points) as avg_score,
    MAX(aa.total_points) as best_score
  FROM attempt_answers aa
  JOIN questions q ON aa.question_id = q.id
  JOIN question_tags qt ON q.id = qt.question_id
  WHERE aa.attempt_id IN (
    SELECT id FROM attempts WHERE player_id = ?
  )
  GROUP BY qt.tag
  ```

**UI Component**:
- Create `CategoryPerformanceCard` component
- Display category breakdown with:
  - Category name
  - Accuracy percentage (correct/total)
  - Average score per question
  - Best score in category
- Visual bars or charts (neo-brutalist style)

### 2. Error Handling Improvements

**Current Issues**:
- Generic error messages
- No retry logic
- Network errors not handled gracefully
- Auth errors could be clearer

**Improvements**:
- Add retry logic for network failures (3 attempts with exponential backoff)
- Better error messages with actionable guidance
- Error boundaries for React components
- Loading states for all async operations
- Toast notifications for user feedback

**Implementation**:
- Create `lib/error-handling.ts` utility
- Add retry wrapper for Edge Function calls
- Update domain adapters to use retry logic
- Add error boundaries to key pages
- Create `Toast` component for notifications

### 3. Testing & Quality Assurance

**Test Coverage**:
- Unit tests for scoring formula ✅ (already exists)
- Integration tests for attempt lifecycle ✅ (exists)
- E2E tests for critical flows
- UI component tests

**Testing Tools**:
- Playwright for E2E tests
- React Testing Library for components
- Vitest for unit tests (already configured)

**Test Scenarios**:
1. Complete quiz flow (start → answer → finalize)
2. Resume interrupted attempt
3. View results page
4. View leaderboard
5. Create league and add members
6. Update handle
7. View profile page

### 4. Performance Optimizations

**Current Issues**:
- No caching for leaderboards
- No prefetching for likely next pages
- Large bundle size

**Optimizations**:
- Add React Query or SWR for caching
- Prefetch leaderboard data
- Code splitting for routes
- Image optimization (if any)
- Lazy load heavy components

### 5. Mobile Responsiveness

**Current Status**:
- Design is mobile-first
- Need to verify all pages work on mobile

**Verification**:
- Test all pages on mobile viewport
- Ensure touch targets are 44px minimum
- Verify scrolling works correctly
- Check form inputs on mobile keyboards

### 6. Deployment Preparation

**Requirements**:
- Environment variable documentation
- Deployment checklist
- Production build verification
- Supabase Edge Functions deployment guide

**Documentation**:
- `DEPLOYMENT.md` with step-by-step guide
- Environment variable reference
- Database migration guide
- Edge Function deployment steps

## Implementation Steps

### Step 1: Category Performance
1. Update `get-profile-by-handle` Edge Function with category aggregation
2. Update Profile interface to include category stats
3. Create `CategoryPerformanceCard` component
4. Add category breakdown to profile page

### Step 2: Error Handling
1. Create error handling utilities
2. Add retry logic to Edge Function client
3. Add error boundaries to pages
4. Create Toast notification component
5. Update all domain adapters with better error handling

### Step 3: Testing
1. Set up Playwright
2. Write E2E tests for critical flows
3. Add component tests for key UI elements
4. Run full test suite

### Step 4: Polish
1. Performance optimizations
2. Mobile responsiveness verification
3. Accessibility audit
4. Code cleanup and documentation

### Step 5: Deployment Prep
1. Create deployment documentation
2. Verify production build
3. Test Edge Functions in production
4. Create deployment checklist

## Acceptance Criteria

- ✅ Category performance breakdown displayed on profile page
- ✅ Error handling with retry logic and clear messages
- ✅ E2E tests for critical user flows
- ✅ All pages mobile-responsive
- ✅ Production build succeeds
- ✅ Deployment documentation complete
- ✅ All UI follows neo-brutalist design system

## Database Changes

No schema changes required. Category performance uses existing `question_tags` table.

## Files to Create/Modify

### Edge Functions
- `supabase/functions/get-profile-by-handle/index.ts` - Add category aggregation

### Domain Adapters
- `apps/web/src/domains/profile/index.ts` - Update Profile interface

### UI Components
- `apps/web/src/components/CategoryPerformanceCard.tsx` - New component
- `apps/web/src/components/Toast.tsx` - New component
- `apps/web/src/app/u/[handle]/page.tsx` - Add category breakdown

### Utilities
- `apps/web/src/lib/error-handling.ts` - New utility
- `apps/web/src/lib/api/edge-functions.ts` - Add retry logic

### Documentation
- `DEPLOYMENT.md` - New deployment guide
- `TESTING.md` - Update with E2E test instructions

## Notes

- Category performance should aggregate across all attempts, not just recent ones
- Error handling should be non-intrusive but informative
- Testing should focus on critical paths first
- Deployment should be straightforward with clear documentation

