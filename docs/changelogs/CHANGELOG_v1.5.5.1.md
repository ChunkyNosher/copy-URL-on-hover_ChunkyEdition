# Changelog - v1.5.5.1

## Bug Fixes

### 1. URL Detection Bug

**Issue**: Keyboard shortcuts (Copy URL, Open Quick Tab) triggered even when not hovering over any link, copying/opening the current page URL instead.

**Root Cause**:

- `findWikipediaUrl()` always returned `window.location.href` regardless of hover state
- `findGenericUrl()` was too broad, searching for unrelated links in siblings
- Hover handler set `currentHoveredElement` even when no URL was found

**Fix**:

- Modified `findWikipediaUrl()` to use `findGenericUrl()` instead of defaulting to current page
- Restricted `findGenericUrl()` to only search within clear container elements (articles, posts, etc.)
- Removed sibling search from `findGenericUrl()` to prevent false positives
- Updated mouseover handler to clear hover state when no URL is found

### 2. YouTube Quick Tab Playback Bug

**Issue**: When opening a Quick Tab of a YouTube video in a second YouTube webpage, the video would play across all tabs with that Quick Tab, not just the current one.

**Root Cause**:

- When Quick Tab was created via broadcast in background tabs, the iframe would load immediately
- YouTube videos would autoplay in the background tab's Quick Tab iframe
- Cross-origin iframes (like YouTube) cannot be controlled via `pauseMediaInIframe()` due to browser security restrictions

**Fix**:

- Deferred iframe loading for Quick Tabs created via broadcast when tab is hidden
- Iframe only loads when tab becomes visible, preventing autoplay in background
- Added check in iframe load handler to pause media if tab is hidden

### 3. Quick Tab Position/Size Not Persisting

**Issue**: Position and size of Quick Tabs did not transfer when switching between webpages.

**Root Cause**:

- Storage listener only handled creating/closing Quick Tabs, not updating existing ones
- Position and size changes were saved to storage but not applied when storage changed

**Fix**:

- Enhanced storage change listener to update position and size of existing Quick Tabs
- Added logic to check for position/size changes and apply them to existing containers
- Position and size now properly sync across tabs when storage is updated

### 4. Pin Button Closes Quick Tab

**Issue**: When pinning a Quick Tab, it would close in the current page instead of persisting.

**Root Cause**:

- Storage listener checked if Quick Tabs were removed from storage entirely, but didn't properly handle Quick Tabs that were pinned to a different page
- When a Quick Tab was pinned in Tab A, the storage update would trigger the listener in Tab A itself, which would close the tab if the pin filtering logic was incorrect

**Fix**:

- Added logic in storage listener to check if existing Quick Tabs are now pinned to a different page
- These Quick Tabs are now properly closed in tabs where they shouldn't appear
- Pinned Quick Tabs now correctly persist only in the page they're pinned to

## Technical Details

### Modified Functions:

- `findWikipediaUrl()`: Changed to delegate to `findGenericUrl()`
- `findGenericUrl()`: Restricted search scope, removed sibling search
- Mouseover handler: Clears hover state when no URL found
- `createQuickTabWindow()`: Added deferred iframe loading for background tabs
- Storage change listener: Added position/size update logic and improved pin filtering
- Iframe load handler: Added media pause check for hidden tabs

### Files Modified:

- `content.js`: All bug fixes implemented
- `manifest.json`: Version updated to 1.5.5.1

## Testing Recommendations

1. **URL Detection**: Test keyboard shortcuts on various sites (Wikipedia, YouTube, etc.) while not hovering over any links. Should not copy/open current page URL.

2. **YouTube Playback**:
   - Open Quick Tab of YouTube video in YouTube Tab A
   - Switch to YouTube Tab B
   - Open Quick Tab of YouTube video in YouTube Tab B
   - Video should NOT play in Tab A when it's in the background

3. **Position/Size Persistence**:
   - Open Quick Tab in Page A
   - Resize and move it
   - Switch to Page B
   - Switch back to Page A
   - Quick Tab should maintain its position and size

4. **Pin Functionality**:
   - Open Quick Tab in Page A
   - Pin it to Page A
   - Quick Tab should stay open in Page A
   - Switch to Page B
   - Quick Tab should NOT appear in Page B
   - Switch back to Page A
   - Quick Tab should still be there
