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

### Implementation Details

#### Storage Migration
- **From**: `localStorage` (origin-specific)
- **To**: `browser.storage.local` (extension-wide, cross-origin)
- Benefits:
  - Works across all domains (Wikipedia, YouTube, etc.)
  - Persists across browser restarts
  - Syncs in real-time across all tabs/windows
  - More reliable than localStorage for extension data

#### Duplicate Prevention
- Added URL-based deduplication when restoring Quick Tabs
- Checks existing Quick Tab URLs before creating new ones
- Also checks minimized Quick Tab URLs to prevent duplicates in minimized state
- Prevents multiple Quick Tabs with the same URL from being created

#### Storage Event Handling
- `browser.storage.onChanged` replaces `window.storage` event listener
- Handles cross-domain storage changes
- Creates Quick Tabs only if they don't already exist locally
- Works in conjunction with BroadcastChannel for same-origin sync

## Bug Fixes
1. Fixed Quick Tab duplication when navigating between pages on same domain
2. Fixed Quick Tabs not persisting across different domains
3. Added duplicate URL detection to prevent multiple instances

## Technical Changes
- Replaced `localStorage.setItem()` with `browser.storage.local.set()`
- Replaced `localStorage.getItem()` with `browser.storage.local.get()`
- Replaced `localStorage.removeItem()` with `browser.storage.local.remove()`
- Replaced `window.addEventListener('storage', ...)` with `browser.storage.onChanged.addListener(...)`
- Added `fromBroadcast=true` parameter when restoring Quick Tabs from storage
- Added URL set comparison for duplicate detection

## Known Issues
- None reported for this release

## Upgrade Notes
- Existing Quick Tabs stored in localStorage will not be automatically migrated to browser.storage.local
- Users may need to close and reopen Quick Tabs after upgrading
- This is a one-time migration; subsequent updates will preserve Quick Tab state

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
1. Open a Quick Tab on a Wikipedia page
2. Navigate to another Wikipedia page or reload
3. Verify no duplicate Quick Tabs are created
4. Open a Quick Tab on Wikipedia
5. Navigate to YouTube (different domain)
6. Verify Quick Tab persists and is visible on YouTube
7. Test with multiple tabs open across different domains
