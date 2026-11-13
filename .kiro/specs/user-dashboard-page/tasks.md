# Implementation Plan: User Dashboard Page

## Overview

This plan implements a comprehensive user dashboard page that serves as the central hub for authenticated users. The dashboard displays repository analysis history, subscription information, user profile details, and provides quick access to analyze new repositories. The implementation leverages existing authentication infrastructure (AuthContext, Supabase Auth, sessions table) and adds new subscription tracking capabilities.

**Key Technical Decisions:**
- **Language**: TypeScript with Next.js 16 App Router
- **Styling**: Tailwind CSS matching landing page theme
- **State Management**: React hooks with existing AuthContext
- **Data Layer**: Supabase with one new table (subscriptions)
- **Testing**: Property-based tests for URL validation, unit tests for components

## Tasks

- [x] 1. Set up database schema and types
  - Create Supabase migration for subscriptions table
  - Define TypeScript interfaces for dashboard data models
  - Set up Row Level Security policies for subscriptions table
  - Verify existing sessions table RLS policies
  - _Requirements: 3.1, 8.1-8.9_

- [ ] 2. Create subscription API endpoint
  - [-] 2.1 Implement GET /api/user/subscription route handler
    - Create `app/api/user/subscription/route.ts`
    - Verify user authentication using Supabase server client
    - Query subscriptions table with RLS filtering
    - Return default free subscription for new users
    - Handle errors with appropriate HTTP status codes
    - _Requirements: 3.1-3.9_
  
  - [ ]* 2.2 Write unit tests for subscription API endpoint
    - Test authentication requirement (401 for unauthenticated)
    - Test successful subscription retrieval
    - Test default subscription for new users
    - Test error handling for database failures
    - _Requirements: 3.1-3.9_

- [ ] 3. Build repository URL validation utility
  - [-] 3.1 Create URL validation function in lib/validation.ts
    - Implement validateRepoUrl function
    - Support HTTPS format (https://github.com/owner/repo)
    - Support SSH format (git@github.com:owner/repo.git)
    - Support short-form format (owner/repo)
    - Normalize all formats to owner/repo
    - Validate owner and repo name constraints (1-100 chars, alphanumeric/hyphen/underscore)
    - Return structured result with valid flag, normalized string, and error message
    - _Requirements: 5.2, 5.3, 5.7_
  
  - [ ]* 3.2 Write property-based tests for URL validation
    - **Property 1: URL Validation Normalization** - All valid formats normalize to owner/repo
    - **Validates: Requirements 5.2, 5.3**
    - Generate random valid owner/repo combinations
    - Test HTTPS, SSH, and short-form formats
    - Assert normalized output matches expected owner/repo format
  
  - [ ]* 3.3 Write property-based tests for whitespace handling
    - **Property 2: Whitespace Handling** - Leading/trailing whitespace produces same result
    - **Validates: Requirements 5.3**
    - Generate URLs with random whitespace padding
    - Assert trimmed and untrimmed inputs produce identical results
  
  - [ ]* 3.4 Write property-based tests for invalid input rejection
    - **Property 3: Invalid Input Rejection** - Non-matching formats are rejected
    - **Validates: Requirements 5.6, 5.7**
    - Test empty strings, wrong hosts, missing components
    - Assert all invalid inputs return valid: false with error message
  
  - [ ]* 3.5 Write property-based tests for length constraints
    - **Property 4: Owner and Repo Length Constraints** - Names exceeding 100 chars are rejected
    - **Validates: Requirements 5.2**
    - Generate strings exceeding 100 characters
    - Assert validation rejects overly long owner or repo names

- [ ] 4. Create dashboard data fetching utilities
  - [-] 4.1 Create lib/api/dashboard.ts with API client functions
    - Implement fetchUserSubscription() for subscription data
    - Implement submitRepositoryAnalysis() for analyze submissions
    - Add timeout handling (10 second timeout)
    - Add typed error handling with APIError class
    - Document that repository history uses existing getSessions() function
    - _Requirements: 1.7, 1.8, 10.10_
  
  - [ ]* 4.2 Write unit tests for API utilities
    - Test successful subscription fetch
    - Test timeout handling
    - Test error response parsing
    - Test network error handling
    - _Requirements: 10.8, 10.10_

- [ ] 5. Build core dashboard components
  - [~] 5.1 Create UserProfileSection component
    - Create `components/dashboard/UserProfileSection.tsx`
    - Display user avatar with 48px mobile, 96px desktop sizing
    - Display full name or email as fallback
    - Handle missing avatar with default placeholder
    - Add click handler for navigation to account settings
    - Apply Tailwind CSS styling matching landing page theme
    - _Requirements: 4.1-4.7_
  
  - [~] 5.2 Create AnalyzeRepoField component
    - Create `components/dashboard/AnalyzeRepoField.tsx`
    - Implement text input with 2048 character max length
    - Add placeholder text "Enter repository URL"
    - Add "Analyze" submit button
    - Implement real-time validation using validateRepoUrl utility
    - Display error messages below input field
    - Clear errors on typing
    - Add loading state with disabled input during submission
    - Support Enter key submission
    - _Requirements: 5.1-5.12_
  
  - [~] 5.3 Create RepositoryHistory component
    - Create `components/dashboard/RepositoryHistory.tsx`
    - Fetch data using existing getSessions() from lib/sessions.ts
    - Display repository list in reverse chronological order
    - Show repository name as "owner/repo" format
    - Show relative time for each entry (e.g., "2 hours ago")
    - Implement pagination with 50 items per page
    - Handle empty state with "No repositories analyzed yet" message
    - Add click handlers to navigate to /repo/{owner}/{repo}
    - Display loading skeleton with 20 placeholder items
    - Handle errors with retry button
    - _Requirements: 2.1-2.8_
  
  - [~] 5.4 Create SubscriptionSection component
    - Create `components/dashboard/SubscriptionSection.tsx`
    - Display plan name prominently
    - Display status badge with color coding (active=green, expired=red, trial=blue, cancelled=yellow)
    - Show conditional messaging based on status (billing date, trial days remaining, expiration, cancellation)
    - Display usage metrics with progress bars (repositories analyzed, API calls used)
    - Add link to subscription management
    - Handle loading state with skeleton
    - Handle errors with retry button
    - _Requirements: 3.1-3.9_

- [~] 6. Checkpoint - Component functionality verification
  - Ensure all components render without errors
  - Verify components handle loading and error states
  - Test component interactions (clicks, input changes)
  - Ask the user if questions arise

- [ ] 7. Build error handling components
  - [-] 7.1 Create ErrorBoundary component
    - Create `components/dashboard/ErrorBoundary.tsx`
    - Catch React errors with componentDidCatch
    - Display user-friendly error message with reload button
    - Log errors to console for debugging
    - _Requirements: 1.7, 1.8, 1.9, 10.8, 10.9_
  
  - [ ] 7.2 Create loading skeleton components
    - Create `components/dashboard/skeletons.tsx`
    - Implement ProfileSkeleton with avatar and text placeholders
    - Implement RepositoryListSkeleton with 20 item placeholders
    - Implement SubscriptionSkeleton with card layout
    - Apply Tailwind animate-pulse for loading animation
    - _Requirements: 10.6, 10.7_

- [ ] 8. Create main dashboard orchestration component
  - [~] 8.1 Create DashboardClient component
    - Create `components/dashboard/DashboardClient.tsx` as client component
    - Accept user props (userId, email, avatarUrl, fullName, isFirstTime)
    - Manage state for sessions, subscription, loading, and errors
    - Fetch sessions using existing getSessions() function
    - Fetch subscription using fetchUserSubscription() utility
    - Implement independent error handling per section
    - Display onboarding modal if isFirstTime flag is true
    - Handle analyze submission with optimistic updates
    - Navigate to /repo/{owner}/{repo} after successful analysis
    - Arrange sections: Profile → Analyze Field → Repository History → Subscription
    - _Requirements: 1.1-1.9, 5.8-5.12, 7.6_
  
  - [ ]* 8.2 Write unit tests for DashboardClient
    - Test component renders all sections
    - Test independent section error handling
    - Test optimistic repository addition
    - Test onboarding modal display for first-time users
    - Mock fetch functions and getSessions
    - _Requirements: 1.1-1.9, 10.9_

- [ ] 9. Create dashboard page route
  - [~] 9.1 Create app/dashboard/page.tsx server component
    - Create Dashboard page as Next.js server component
    - Verify authentication using Supabase server client
    - Redirect to /login?redirect=/dashboard if not authenticated
    - Extract user data from Supabase auth
    - Detect first-time user from searchParams.firstTime
    - Render DashboardClient with user props
    - Handle server-side errors gracefully
    - _Requirements: 8.1-8.9_
  
  - [ ]* 9.2 Write integration tests for dashboard page
    - Test authenticated user access succeeds
    - Test unauthenticated user redirects to login
    - Test first-time user flag passes to client
    - Test server-side error handling
    - _Requirements: 8.1, 8.2_

- [ ] 10. Implement responsive layout
  - [~] 10.1 Add responsive grid layout to DashboardClient
    - Use sticky header for profile and analyze field
    - Implement two-column grid for desktop (≥768px): 2/3 width for history, 1/3 for subscription
    - Implement single-column layout for mobile (<768px)
    - Ensure all interactive elements meet 44x44px touch target on mobile
    - Prevent horizontal scrolling on all viewport sizes (min 390px)
    - Add container max-width and padding for proper spacing
    - _Requirements: 9.1-9.7_
  
  - [ ]* 10.2 Write responsive layout tests
    - Test two-column layout at 1024px viewport
    - Test single-column layout at 375px viewport
    - Test touch target sizes on mobile
    - Test no horizontal overflow
    - Use testing-library with custom viewport sizes
    - _Requirements: 9.1-9.7_

- [ ] 11. Update landing page navigation logic
  - [~] 11.1 Update landing page analyze button handler
    - Locate landing page component (likely `components/landing/LandingPage.tsx` or `app/page.tsx`)
    - Import useAuth from lib/auth-context
    - Check user authentication status from AuthContext
    - If authenticated: validate input and navigate to /repo/{owner}/{repo}
    - If unauthenticated: store destination in sessionStorage and redirect to /login
    - Display error for empty or invalid repository input
    - _Requirements: 6.1, 6.3, 6.5, 6.9, 6.10_
  
  - [~] 11.2 Add dashboard button handler to landing page
    - Add handleDashboard function
    - Check user authentication status from AuthContext
    - If authenticated: navigate to /dashboard
    - If unauthenticated: store destination in sessionStorage and redirect to /login
    - Ensure button exists in landing page UI
    - _Requirements: 6.2, 6.4, 6.6_

- [ ] 12. Update login page post-authentication flow
  - [~] 12.1 Update login page redirect logic
    - Locate login page component (likely `app/login/page.tsx`)
    - Check for URL redirect parameter (searchParams.redirect)
    - Check for stored destination in sessionStorage (postLoginDestination)
    - Default to /dashboard if no redirect specified
    - Clear sessionStorage after reading
    - Detect first-time users and add firstTime=true query parameter
    - Implement redirect in useEffect when user authenticates
    - _Requirements: 7.1-7.6, 6.7, 6.8_

- [ ] 13. Verify middleware protection
  - [~] 13.1 Ensure dashboard routes are protected
    - Check middleware.ts config.matcher includes '/dashboard/:path*'
    - Add dashboard matcher if missing
    - Verify middleware redirects unauthenticated users to /login
    - Test that redirect parameter is preserved
    - _Requirements: 8.1, 8.3_

- [~] 14. Checkpoint - Navigation flow testing
  - Test landing page → login → dashboard flow for unauthenticated users
  - Test landing page → dashboard direct navigation for authenticated users
  - Test landing page → analyze flow with auth check
  - Verify sessionStorage destination handling
  - Verify first-time user onboarding display
  - Ask the user if questions arise

- [ ] 15. Add session verification (optional security enhancement)
  - [~] 15.1 Create useSessionVerification hook
    - Create `hooks/useSessionVerification.ts`
    - Monitor AuthContext user state
    - Redirect to /login if user becomes null
    - Set up interval for periodic checks (every 5 minutes)
    - Clean up interval on unmount
    - _Requirements: 8.6, 8.7_
  
  - [~] 15.2 Integrate session verification in DashboardClient
    - Import and call useSessionVerification hook
    - Ensure hook runs only on client side
    - Test session timeout behavior
    - _Requirements: 8.2, 8.7, 8.9_

- [ ] 16. Implement performance optimizations
  - [~] 16.1 Add browser caching for subscription data
    - Use Next.js fetch with revalidate: 60 for subscription API
    - Cache profile data from AuthContext (already provided by context)
    - Implement cache invalidation on subscription updates
    - _Requirements: 10.2, 10.3, 10.4_
  
  - [~] 16.2 Add timeout handling for API requests
    - Implement fetchWithTimeout utility with AbortController
    - Set 10-second timeout for all dashboard API calls
    - Display timeout error message to user
    - _Requirements: 10.10_
  
  - [~] 16.3 Optimize initial page load performance
    - Ensure server component renders container structure immediately
    - Display loading skeletons while fetching data
    - Lazy load non-critical components if needed
    - Verify initial render within 2 seconds on 5Mbps connection
    - _Requirements: 10.1, 10.6, 10.7_

- [x] 17. Create config file for spec metadata
  - [x] 17.1 Create .config.kiro file
    - Create `.kiro/specs/user-dashboard-page/.config.kiro`
    - Set specId to unique UUID
    - Set workflowType to "requirements-first"
    - Set specType to "feature"
    - Use JSON format as specified in workflow

- [ ] 18. Final integration and testing
  - [~] 18.1 Run full authentication flow end-to-end
    - Test unauthenticated user accessing /dashboard directly
    - Test login → dashboard redirect
    - Test landing page dashboard button with auth
    - Test landing page analyze button with auth
    - Verify session timeout redirect
    - _Requirements: 6.1-6.10, 7.1-7.6, 8.1-8.9_
  
  - [~] 18.2 Test dashboard data display
    - Verify profile section displays user data correctly
    - Verify repository history loads from sessions table
    - Verify subscription section displays plan info
    - Test analyze field submission and navigation
    - Test error states for each section independently
    - _Requirements: 1.1-1.9, 2.1-2.8, 3.1-3.9, 4.1-4.7, 5.1-5.12_
  
  - [~] 18.3 Test responsive behavior
    - Verify layout at 390px (mobile minimum)
    - Verify layout at 768px (tablet breakpoint)
    - Verify layout at 1024px+ (desktop)
    - Test touch target sizes on mobile device
    - Verify no horizontal scroll at any breakpoint
    - _Requirements: 9.1-9.7_
  
  - [~] 18.4 Verify performance targets
    - Measure initial page render time (target: <2s)
    - Measure session data load time (target: <800ms)
    - Measure subscription data load time (target: <600ms)
    - Verify loading indicators display during fetch
    - Verify timeout handling at 10 seconds
    - _Requirements: 10.1-10.10_

- [~] 19. Final checkpoint - Production readiness
  - All unit tests passing
  - All property-based tests passing
  - Integration tests passing
  - Manual testing complete for all user flows
  - Responsive layout verified on multiple devices
  - Performance targets met
  - Security checklist verified (RLS policies, auth checks, middleware)
  - Ask the user if questions arise

## Notes

### Implementation Strategy

- **Tasks marked with `*` are optional** and can be skipped for faster MVP delivery. Core functionality remains intact without them.
- **Property-based tests** (tasks 3.2-3.5) validate universal correctness properties for URL validation logic using fast-check library.
- **Checkpoints** (tasks 6, 14, 19) provide natural break points to verify progress and address questions.

### Existing Infrastructure (DO NOT RECREATE)

The following already exist and should be reused:
- ✅ `AuthContext` in `lib/auth-context.tsx` - provides user, session, loading, signOut
- ✅ `sessions` table in Supabase - tracks repository analysis history
- ✅ `getSessions()` function in `lib/sessions.ts` - fetches user's analysis history
- ✅ Supabase authentication with Google OAuth
- ✅ Middleware for route protection
- ✅ Backend analyze endpoint

### New Components to Create

The following are NEW and must be implemented:
- 🆕 `subscriptions` table in Supabase (task 1)
- 🆕 Dashboard page at `app/dashboard/page.tsx` (task 9)
- 🆕 Dashboard components in `components/dashboard/` (tasks 5, 7, 8)
- 🆕 Subscription API route at `app/api/user/subscription/route.ts` (task 2)
- 🆕 Validation utilities in `lib/validation.ts` (task 3)
- 🆕 Dashboard API utilities in `lib/api/dashboard.ts` (task 4)

### Requirements Coverage

Each task explicitly references the requirements it implements:
- **Authentication & Access**: Tasks 9, 11, 12, 13, 15 (Requirements 6.1-6.10, 7.1-7.6, 8.1-8.9)
- **Profile Display**: Task 5.1 (Requirements 4.1-4.7)
- **Repository History**: Task 5.3 (Requirements 2.1-2.8)
- **Subscription Info**: Tasks 2, 5.4 (Requirements 3.1-3.9)
- **Analyze Field**: Tasks 3, 5.2 (Requirements 5.1-5.12)
- **Dashboard Layout**: Tasks 8, 10 (Requirements 1.1-1.9, 9.1-9.7)
- **Performance**: Task 16 (Requirements 10.1-10.10)

### Testing Approach

- **Property-Based Tests**: URL validation (4 properties testing normalization, whitespace, rejection, length constraints)
- **Unit Tests**: Individual components, API utilities, error handling
- **Integration Tests**: API routes, authentication flows
- **Manual Testing**: Responsive layout, end-to-end user flows, performance verification

### Technical Dependencies

- Next.js 16 with App Router
- React 19.2.4
- TypeScript (strict mode)
- Tailwind CSS (existing theme)
- Supabase (auth + database)
- Radix UI components (existing pattern)
- fast-check for property-based testing
- Vitest for unit testing

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "17.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "7.1", "7.2"] },
    { "id": 2, "tasks": ["2.2", "3.2", "3.3", "3.4", "3.5", "4.2", "5.1", "5.2", "5.3", "5.4"] },
    { "id": 3, "tasks": ["8.1"] },
    { "id": 4, "tasks": ["8.2", "9.1"] },
    { "id": 5, "tasks": ["9.2", "10.1"] },
    { "id": 6, "tasks": ["10.2", "11.1", "11.2", "12.1"] },
    { "id": 7, "tasks": ["13.1", "15.1", "16.1", "16.2"] },
    { "id": 8, "tasks": ["15.2", "16.3"] },
    { "id": 9, "tasks": ["18.1", "18.2", "18.3", "18.4"] }
  ]
}
```
