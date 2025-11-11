# Changelog - Version 1.5.5

## Overview
Version 1.5.5 addresses four critical bugs reported with Quick Tab functionality across different domains, including cross-domain close synchronization, enhanced debugging capabilities, pinned Quick Tab behavior, and media playback control.

## Bug Fixes

### 1. Quick Tab Close Not Syncing Across Different Domains
**Issue**: When closing a Quick Tab in one page (e.g., Wikipedia), it would close in other same-domain pages (other Wikipedia pages), but NOT in different-domain pages (e.g., YouTube, GitHub).

**Root Cause**: The `browser.storage.onChanged` listener only handled **creating** Quick Tabs from storage changes, but didn't detect when Quick Tabs were **removed** from storage.

**Solution**:
- Enhanced the `browser.storage.onChanged` listener to detect removed Quick Tabs
- Compares old and new storage values to identify which URLs were removed
- Automatically closes local Quick Tabs that no longer exist in storage
- Handles both individual Quick Tab closes and "close all" operations
- Works seamlessly across all domains (Wikipedia → YouTube → GitHub, etc.)

**Technical Details**:
```javascript
// Detect removed Quick Tabs by comparing URLs
const existingUrls = new Set(quickTabWindows.map(/* get iframe URLs */));
const newUrls = new Set(newValue.filter(t => !t.minimized).map(t => t.url));
const removedUrls = Array.from(existingUrls).filter(url => !newUrls.has(url));

// Close Quick Tabs that were removed
removedUrls.forEach(url => {
  const container = quickTabWindows.find(/* find by URL */);
  if (container) closeQuickTabWindow(container, false);
});
```

### 2. Enhanced Debug Mode for Drag and Resize Operations
**Issue**: No way to track Quick Tab position and size changes for debugging purposes.

**Implementation**:
- Added throttled console logging (every 0.5 seconds) during drag operations
- Added console logging during resize operations
- Logs only fire while actively dragging/resizing (not continuously)
- Includes Quick Tab URL, current position (x, y), and size (width × height)
- Debug logs only appear when `debugMode` is enabled in settings

**Example Debug Output**:
```
[CopyURLHover] [DRAG] Quick Tab drag started - URL: https://youtube.com/watch?v=xyz, Start Position: (100, 150)
[CopyURLHover] [DRAG] Quick Tab being moved - URL: https://youtube.com/watch?v=xyz, Position: (250, 300)
[CopyURLHover] [DRAG] Quick Tab move completed - URL: https://youtube.com/watch?v=xyz, Final Position: (320, 350)

[CopyURLHover] [RESIZE] Quick Tab resize started - URL: https://youtube.com/watch?v=xyz, Start Size: 800x600, Position: (320, 350)
[CopyURLHover] [RESIZE] Quick Tab being resized - URL: https://youtube.com/watch?v=xyz, Size: 650x450, Position: (320, 350)
[CopyURLHover] [RESIZE] Quick Tab resize completed - URL: https://youtube.com/watch?v=xyz, Final Size: 600x400, Position: (320, 350)
```

### 3. Pinned Quick Tabs Now Close All Other Instances
**Issue**: When pinning a Quick Tab to a specific page, other instances of the same Quick Tab would remain open in other tabs, causing confusion about which was the "pinned" one.

**Expected Behavior**: When a Quick Tab is pinned to a page, it should close ALL other instances of that Quick Tab across all tabs/webpages.

**Solution**:
- Added `broadcastQuickTabPin()` function to notify other tabs when a Quick Tab is pinned
- Added `pinQuickTab` broadcast message handler
- When pinning, broadcasts the pin action with the URL and pinned page
- Other tabs receive the broadcast and close their instance of that Quick Tab (if not on the pinned page)
- Storage sync ensures cross-domain tabs also close their instances
- When navigating back to the pinned page, the pinned Quick Tab reappears

**Workflow**:
1. User opens Quick Tab on Wikipedia page A
2. User clicks pin button (📍 → 📌)
3. Extension broadcasts pin message to all tabs
4. Quick Tab closes in all other tabs (YouTube, GitHub, other Wikipedia pages)
5. Quick Tab remains only on Wikipedia page A (pinned page)
6. User navigates away from Wikipedia page A → Quick Tab disappears
7. User navigates back to Wikipedia page A → Quick Tab reappears

### 4. Video/Audio Playback Control in Quick Tabs
**Issue**: Quick Tabs with video or audio content (YouTube, Vimeo, etc.) would play media across ALL webpages simultaneously, even when those webpages were in background tabs.

**Expected Behavior**: Media in Quick Tabs should only play when the tab is active/visible.

**Solution**:
- Implemented Page Visibility API integration
- Added media pause/resume functions for iframes
- Automatically pauses all media when tab becomes hidden
- Automatically resumes media when tab becomes visible again
- Also responds to window blur/focus events for additional safety
- Marks paused media with `data-paused-by-extension` attribute to track what we paused
- Only resumes media that we explicitly paused (respects user-initiated pauses)

**Limitations**:
- Only works for **same-origin** iframes (e.g., Quick Tab opened from same domain)
- Cannot control media in **cross-origin** iframes due to browser security restrictions
- Cross-origin limitation documented in KNOWN LIMITATIONS section

**Technical Details**:
```javascript
// Listen for visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseAllQuickTabMedia(); // Tab hidden - pause all media
  } else {
    resumeAllQuickTabMedia(); // Tab visible - resume media we paused
  }
});

// Pause media in same-origin iframes
function pauseMediaInIframe(iframe) {
  const videos = iframeDoc.querySelectorAll('video');
  videos.forEach(video => {
    if (!video.paused) {
      video.pause();
      video.dataset.pausedByExtension = 'true'; // Mark for resume
    }
  });
}
```

## Files Modified

### content.js
**Changes**:
1. Enhanced `browser.storage.onChanged` listener (lines ~418-480)
   - Detects removed Quick Tabs from storage
   - Handles storage clear events
   - Closes Quick Tabs that no longer exist in storage

2. Added debug logging to `makeDraggable()` (lines ~2972-3170)
   - Added `lastDebugLogTime` variable
   - Debug log on drag start
   - Throttled debug log every 0.5s during drag
   - Debug log on drag completion

3. Added debug logging to `makeResizable()` (lines ~3171-3380)
   - Added `lastDebugLogTime` variable  
   - Debug log on resize start
   - Throttled debug log every 0.5s during resize
   - Debug log on resize completion

4. Enhanced pin button functionality (lines ~2573-2610)
   - Broadcasts pin action to close instances in other tabs
   - Saves to storage after pinning

5. Added `broadcastQuickTabPin()` function (lines ~285-295)
   - Sends pin broadcast message
   - Includes URL and pinned page URL

6. Added `pinQuickTab` message handler (lines ~214-233)
   - Receives pin broadcasts
   - Closes Quick Tab if current page is not the pinned page
   - Prevents re-broadcasting

7. Added media playback control (lines ~3577-3680)
   - `pauseMediaInIframe()` - Pause media in iframe
   - `resumeMediaInIframe()` - Resume media in iframe
   - `pauseAllQuickTabMedia()` - Pause all Quick Tab media
   - `resumeAllQuickTabMedia()` - Resume all Quick Tab media
   - Visibility change event listener
   - Window blur/focus event listeners

8. Updated bug fixes documentation (lines ~1-62)
   - Added v1.5.5 bug fixes
   - Added cross-origin media control limitation

### manifest.json
**Changes**:
- Version bumped from `1.5.4.1` to `1.5.5`

### CHANGELOG_v1.5.5.md
**New file** documenting all changes in this version

## Testing Checklist

### Test Case 1: Cross-Domain Quick Tab Close
- [x] Open Quick Tab on Wikipedia
- [x] Navigate to YouTube - verify Quick Tab appears
- [x] Navigate to GitHub - verify Quick Tab appears
- [x] Close Quick Tab on GitHub
- [x] Switch to YouTube - verify Quick Tab is closed
- [x] Switch to Wikipedia - verify Quick Tab is closed

### Test Case 2: Debug Mode Logging
- [x] Enable debug mode in settings
- [x] Open Quick Tab
- [x] Drag Quick Tab around
- [x] Verify console logs appear every 0.5 seconds during drag
- [x] Verify final position logged on drag end
- [x] Resize Quick Tab
- [x] Verify console logs appear every 0.5 seconds during resize
- [x] Verify final size/position logged on resize end

### Test Case 3: Pinned Quick Tab Instance Closure
- [x] Open Quick Tab on Wikipedia page A
- [x] Open second tab with YouTube
- [x] Verify Quick Tab appears on YouTube
- [x] Switch to Wikipedia page A
- [x] Pin Quick Tab (📍 → 📌)
- [x] Switch to YouTube - verify Quick Tab is now closed
- [x] Open third tab with GitHub
- [x] Verify Quick Tab does NOT appear on GitHub
- [x] Switch back to Wikipedia page A
- [x] Verify Quick Tab still exists (pinned)

### Test Case 4: Pinned Quick Tab Persistence
- [x] Open and pin Quick Tab on Wikipedia page A
- [x] Navigate to Wikipedia page B
- [x] Verify pinned Quick Tab does NOT appear
- [x] Navigate back to Wikipedia page A
- [x] Verify pinned Quick Tab reappears
- [x] Reload page
- [x] Verify pinned Quick Tab still exists

### Test Case 5: Media Playback Control (Same-Origin)
- [x] Open Quick Tab with video content
- [x] Play video in Quick Tab
- [x] Switch to another tab
- [x] Verify video pauses (audio stops)
- [x] Switch back to original tab
- [x] Verify video resumes playing
- [x] Manually pause video
- [x] Switch tabs
- [x] Switch back
- [x] Verify video stays paused (respects manual pause)

### Test Case 6: Media Playback Control (Cross-Origin)
- [x] Open Quick Tab with cross-origin video (e.g., YouTube from Wikipedia)
- [x] Note: Media control will not work (limitation documented)
- [x] Verify no errors in console

## Known Limitations

### Cross-Origin Media Control
Due to browser security restrictions (Same-Origin Policy), the extension cannot directly control media playback in cross-origin iframes. For example:
- Opening a YouTube Quick Tab from Wikipedia = cross-origin (cannot control)
- Opening a Wikipedia Quick Tab from Wikipedia = same-origin (can control)

This is a browser security feature and cannot be bypassed. Users can work around this by:
1. Opening Quick Tabs from the same domain when possible
2. Using the "Open in New Tab" button to open cross-origin content in a real tab
3. Manually pausing media before switching tabs

## Performance Impact
- Minimal additional CPU usage from debug logging (only when enabled and actively dragging/resizing)
- Storage listener comparison operations are O(n) where n = number of Quick Tabs (typically < 10)
- Media pause/resume attempts are lightweight (single DOM query per iframe)
- No noticeable performance degradation

## Browser Compatibility
- Firefox 100+
- Zen Browser (all versions)
- Any browser supporting:
  - browser.storage.local API
  - BroadcastChannel API
  - Page Visibility API
  - WebExtensions Manifest V3

## Security Considerations
- Media control only attempts same-origin iframes (security compliant)
- Cross-origin access gracefully fails with debug log (no security violations)
- Pin broadcasts use existing secure channel (BroadcastChannel)
- No new permissions required
- No sensitive data logged (only URLs and coordinates)

## Future Improvements
Potential enhancements for future versions:
1. Add user preference to disable media auto-pause
2. Implement postMessage-based media control for cooperative cross-origin iframes
3. Add media playback indicators in Quick Tab title bar
4. Add pin management UI showing all pinned Quick Tabs
5. Add option to pin to URL patterns (e.g., all Wikipedia articles)
6. Add drag/resize performance metrics to debug mode
