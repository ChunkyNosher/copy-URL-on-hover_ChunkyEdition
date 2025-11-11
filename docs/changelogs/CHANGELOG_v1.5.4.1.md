# Changelog - Version 1.5.4.1

## Release Date
2025-11-09

## Changes

### Critical Bug Fixes

#### Fixed Quick Tab Duplication Bug
- **Issue**: Opening a Quick Tab on a Wikipedia page would create duplicates when switching to different Wikipedia pages or reloading the page
- **Root Cause**: When Quick Tabs were restored from storage, they were not marked with `fromBroadcast=true`, causing them to re-broadcast to other tabs and create an infinite duplication loop
- **Fix**: 
  - Modified `restoreQuickTabsFromStorage()` to pass `fromBroadcast=true` when creating Quick Tabs from storage
  - Added duplicate detection logic to check for existing Quick Tab URLs before creating new ones
  - This prevents the broadcast loop that was causing duplicates on page navigation/reload

#### Fixed Cross-Domain Quick Tab Persistence
- **Issue**: Quick Tabs were not persisting between websites with different domains (e.g., Wikipedia to YouTube)
- **Root Cause**: localStorage is origin-specific and cannot be shared across different domains
- **Fix**:
  - Replaced `localStorage` with `browser.storage.local` for Quick Tab persistence
  - `browser.storage.local` is shared across all tabs/windows regardless of origin
  - Added `browser.storage.onChanged` listener to handle cross-domain storage updates
  - Quick Tabs now properly sync across all domains

#### Fixed Quick Tab Position/Size Not Persisting
- **Issue**: When moving or resizing a Quick Tab and switching tabs, the position/size would revert to the original state
- **Root Cause**: BroadcastChannel handlers for move/resize were updating the Quick Tab visually but not saving to storage
- **Fix**:
  - Updated `handleBroadcastMessage` move and resize handlers to call `saveQuickTabsToStorage()`
  - Position and size changes now persist when switching tabs or reloading pages
  - Quick Tabs maintain their moved/resized state across all tabs

### New Features

#### Pin Quick Tab to Specific Page
- **Feature**: New pin button (📍/📌) in Quick Tab toolbar
- **Functionality**:
  - Click the pin button to pin a Quick Tab to the current page URL
  - Pinned Quick Tabs only appear on the specific page they're pinned to
  - Unpinned Quick Tabs appear across all tabs/domains as before
  - Visual indicator: 📍 (unpinned) changes to 📌 (pinned) with highlighted background
  - Pinned state persists across browser restarts
- **Use Case**: 
  - Open a reference Quick Tab on Wikipedia, pin it to that Wikipedia page
  - Open another unpinned Quick Tab on Wikipedia
  - Navigate to YouTube - only the unpinned Quick Tab follows you
  - Navigate back to Wikipedia - the pinned Quick Tab reappears

## Implementation Details

### Storage Migration
- **From**: `localStorage` (origin-specific)
- **To**: `browser.storage.local` (extension-wide, cross-origin)
- Benefits:
  - Works across all domains (Wikipedia, YouTube, etc.)
  - Persists across browser restarts
  - Syncs in real-time across all tabs/windows
  - More reliable than localStorage for extension data

### Duplicate Prevention
- Added URL-based deduplication when restoring Quick Tabs
- Checks existing Quick Tab URLs before creating new ones
- Also checks minimized Quick Tab URLs to prevent duplicates in minimized state
- Prevents multiple Quick Tabs with the same URL from being created

### Position/Size Persistence
- Move and resize broadcast handlers now save to storage
- Ensures Quick Tab position/size is preserved when switching tabs
- Works seamlessly with cross-domain sync

### Pin Feature Implementation
- Added `pinnedToUrl` field to Quick Tab storage structure
- Pin button toggles between pinned (📌) and unpinned (📍) states
- Quick Tab restore logic filters based on current page URL and pin status
- BroadcastChannel messages include pinnedToUrl for proper filtering
- Storage event handlers also filter by pin status

### Storage Event Handling
- `browser.storage.onChanged` replaces `window.storage` event listener
- Handles cross-domain storage changes
- Creates Quick Tabs only if they don't already exist locally
- Filters by pin status when creating from storage events
- Works in conjunction with BroadcastChannel for same-origin sync

## Bug Fixes
1. Fixed Quick Tab duplication when navigating between pages on same domain
2. Fixed Quick Tabs not persisting across different domains
3. Fixed Quick Tab position/size not persisting when switching tabs
4. Added duplicate URL detection to prevent multiple instances

## New Features
1. Pin Quick Tab to specific page feature with visual indicator
2. Quick Tabs can now be page-specific (pinned) or global (unpinned)

## Technical Changes
- Replaced `localStorage.setItem()` with `browser.storage.local.set()`
- Replaced `localStorage.getItem()` with `browser.storage.local.get()`
- Replaced `localStorage.removeItem()` with `browser.storage.local.remove()`
- Replaced `window.addEventListener('storage', ...)` with `browser.storage.onChanged.addListener(...)`
- Added `fromBroadcast=true` parameter when restoring Quick Tabs from storage
- Added URL set comparison for duplicate detection
- Added `saveQuickTabsToStorage()` calls to move/resize broadcast handlers
- Added `pinnedToUrl` parameter to `createQuickTabWindow()` function
- Added pin button to Quick Tab toolbar
- Updated broadcast functions to include pinnedToUrl
- Added pin filtering logic to restoration and broadcast handlers

## Known Issues
- None reported for this release

## Upgrade Notes
- Existing Quick Tabs stored in localStorage will not be automatically migrated to browser.storage.local
- Users may need to close and reopen Quick Tabs after upgrading
- This is a one-time migration; subsequent updates will preserve Quick Tab state
- Pin state is stored per Quick Tab and persists across browser restarts

## Breaking Changes
- None (backward compatible with v1.5.4 settings)

## Compatibility
- Firefox 100+
- Zen Browser (all versions)
- Any browser supporting:
  - browser.storage.local API
  - BroadcastChannel API
  - WebExtensions Manifest V3

## Testing Recommendations

### Test 1: Duplication Bug Fix
1. Open a Quick Tab on a Wikipedia page
2. Navigate to another Wikipedia page or reload
3. Verify no duplicate Quick Tabs are created

### Test 2: Cross-Domain Persistence
1. Open a Quick Tab on Wikipedia
2. Navigate to YouTube (different domain)
3. Verify Quick Tab persists and is visible on YouTube

### Test 3: Position/Size Persistence
1. Open a Quick Tab
2. Move it to a corner and/or resize it
3. Switch to another tab or reload
4. Verify Quick Tab maintains its new position and size

### Test 4: Pin Feature
1. Open a Quick Tab on Wikipedia Page A
2. Click the pin button (📍 → 📌)
3. Navigate to Wikipedia Page B
4. Verify pinned Quick Tab does NOT appear on Page B
5. Navigate back to Wikipedia Page A
6. Verify pinned Quick Tab reappears

### Test 5: Mixed Pinned/Unpinned
1. Open Quick Tab 1 on Wikipedia, pin it
2. Open Quick Tab 2 on Wikipedia, leave unpinned
3. Navigate to YouTube
4. Verify only Quick Tab 2 (unpinned) appears on YouTube
5. Navigate back to Wikipedia
6. Verify both Quick Tabs appear (Tab 1 pinned, Tab 2 unpinned)
