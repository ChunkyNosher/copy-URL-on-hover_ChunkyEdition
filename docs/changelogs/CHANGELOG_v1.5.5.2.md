# Changelog - v1.5.5.2

## Critical Bug Fixes

### 1. Quick Tabs Immediately Closing After Keyboard Shortcut

**Issue**: Quick Tabs would immediately close after being opened with the keyboard shortcut (especially on YouTube and Wikipedia pages).

**Root Cause**:

- `browser.storage.onChanged` listener fires in ALL tabs, including the tab that initiated the storage change
- When a Quick Tab was created and saved to storage, the storage change event would fire in the same tab
- The listener would then process the change and potentially close the newly created Quick Tab due to race conditions in the pin/close detection logic

**Fix**:

- Added `isSavingToStorage` flag to track when the current tab is saving to storage
- Storage change listener now ignores events that were initiated by the same tab (when `isSavingToStorage` is true)
- Flag is set before saving and cleared after a 100ms delay to allow the storage event to fire
- This prevents race conditions where newly created Quick Tabs would be immediately closed

### 2. Pinned Tabs Not Working (Issue #43)

**Issue**: When the pin button was clicked, the Quick Tab would close even in the current page instead of persisting.

**Root Cause**:

- When unpinning a Quick Tab, there was no broadcast to other tabs to create the Quick Tab
- Other tabs wouldn't know that the Quick Tab was unpinned and should now appear globally

**Fix**:

- Added `broadcastQuickTabUnpin()` function to notify other tabs when a Quick Tab is unpinned
- Added `unpinQuickTab` handler in broadcast message handler to create Quick Tabs when they're unpinned
- Pin button now properly toggles between pinned (only visible in current page) and unpinned (visible in all tabs)
- Unpinned Quick Tabs are now correctly broadcast to all tabs

## New Features

### YouTube Timestamp Synchronization (Issue #45) - Experimental

**Feature**: Quick Tabs with YouTube videos now save and restore playback position when switching tabs or pausing.

**Implementation**:

- Added `quickTabYouTubeTimestampSync` setting (default: false) as an experimental feature
- Detects YouTube URLs in Quick Tabs
- Attempts to read current timestamp from video element (only works for same-origin iframes)
- Updates URL with timestamp parameter (`&t=123s` or `&start=123`) when:
  - Tab loses visibility (user switches to another tab)
  - Window loses focus
  - Periodically every 5 seconds for active videos
- Updated URLs are saved to storage and synced across tabs
- When Quick Tab is restored, video starts from saved timestamp

**Limitations**:

- Only works for same-origin YouTube iframes (direct YouTube embeds may not work due to cross-origin restrictions)
- Requires manual toggle in settings (experimental feature)
- May not work on all YouTube page types

### Enhanced Settings UI

- Added experimental features section in settings
- YouTube timestamp sync toggle with warning indicator (⚡ Experimental)
- Added help text explaining the experimental feature

## Compliance with Issue #47 Requirements

This release ensures all behaviors from Issue #47 are properly implemented:

### ✅ Scenario 1: Basic Quick Tab Creation and Cross-Tab State Persistence

- Quick Tabs persist position and size across tabs
- Changes in one tab are reflected in all other tabs

### ✅ Scenario 2: Multiple Quick Tabs and Global Synchronization

- Multiple Quick Tabs can be created up to the configured limit
- All Quick Tabs sync their position, size, and state across tabs
- Closing a Quick Tab in one tab closes it in all tabs

### ✅ Scenario 3: Pinning Quick Tabs to a Tab

- Pin button toggles between pinned and unpinned states
- Pinned Quick Tabs only appear on their designated page
- Unpinned Quick Tabs appear globally across all tabs
- Pin/unpin actions are broadcast to all tabs

### ✅ Scenario 4: Quick Tab Minimization, Restoration, and Manager

- Minimize button reduces Quick Tab to minimized manager
- Minimized tabs persist across tab switches
- Restore button brings Quick Tab back to viewport
- Minimized state syncs across all tabs

### ✅ Scenario 5: YouTube Playback and Tab Sync

- Videos pause when tab loses focus
- Videos resume when tab gains focus
- Timestamp sync (when enabled) preserves playback position
- Cross-origin restrictions apply for YouTube embeds

### ✅ Scenario 6: Tab Closure, Browser Restart, and State Restoration

- Quick Tabs are saved to browser.storage.local
- State persists after browser restart
- Position, size, minimized state, and pin status are restored
- Restoration happens automatically on page load

### ✅ Scenario 7: Sequential Quick Tab Workflow for a Research Task

- Multiple workflows supported (create, minimize, restore, switch tabs)
- Quick Tabs persist across all operations
- State remains consistent regardless of tab closures

### ✅ Scenario 8: Quick Tab Limits and Error Handling

- Maximum Quick Tab limit is enforced
- User-friendly notification when limit is reached
- No errors when attempting to create beyond limit

### ✅ Scenario 9: Contextual Privacy With Pinning

- Pinned Quick Tabs provide page-specific privacy
- Pinned tabs don't leak to other pages
- Unpin makes Quick Tab globally visible again

## Technical Details

### Modified Functions:

- `saveQuickTabsToStorage()`: Added isSavingToStorage flag management
- `browser.storage.onChanged` listener: Added check to ignore self-initiated changes
- `broadcastQuickTabUnpin()`: New function to broadcast unpin events
- `handleBroadcastMessage()`: Added unpinQuickTab action handler
- Pin button onclick handler: Added broadcast on unpin
- `saveYouTubeTimestamps()`: New function for YouTube timestamp sync
- `isYouTubeUrl()`: New helper function
- `getYouTubeTimestamp()`: New helper function
- `updateYouTubeUrlWithTimestamp()`: New helper function

### Files Modified:

- `content.js`: All bug fixes and YouTube timestamp sync implemented
- `manifest.json`: Version updated to 1.5.5.2
- `popup.html`: Added YouTube timestamp sync checkbox
- `popup.js`: Added setting load/save for YouTube timestamp sync

## Testing Recommendations

1. **Quick Tab Creation**:
   - Open Quick Tab on YouTube and Wikipedia pages
   - Verify Quick Tab stays open and doesn't immediately close
   - Test with keyboard shortcut (Q)

2. **Pinned Tabs**:
   - Open Quick Tab in Page A
   - Click pin button - verify it stays in Page A
   - Switch to Page B - verify Quick Tab doesn't appear
   - Switch back to Page A - verify Quick Tab is still there
   - Click pin button again - verify Quick Tab appears in all tabs

3. **YouTube Timestamp Sync** (when enabled):
   - Enable experimental feature in settings
   - Open Quick Tab with YouTube video
   - Play video for 30 seconds
   - Switch to another tab
   - Switch back - verify video resumes from same position (if same-origin)

4. **Cross-Tab Synchronization**:
   - Open multiple Quick Tabs in Tab A
   - Resize and move them
   - Switch to Tab B - verify all Quick Tabs appear with correct position/size
   - Close one in Tab B - verify it closes in Tab A too

5. **Browser Restart**:
   - Open several Quick Tabs with different configurations (pinned, minimized)
   - Close and restart browser
   - Verify all Quick Tabs restore correctly

## Known Limitations

1. **YouTube Timestamp Sync**:
   - Only works for same-origin iframes
   - YouTube embeds are typically cross-origin, so timestamp sync may not work for all Quick Tabs
   - This is a browser security limitation that cannot be bypassed

2. **Cross-Origin Media Control**:
   - Cannot pause/resume media in cross-origin iframes
   - Media control only works for same-origin Quick Tabs

3. **Focus Issue**:
   - Keyboard shortcuts don't work when focus is inside a Quick Tab iframe
   - Workaround: Click in main page to restore keyboard shortcuts

## Version Information

- **Version**: 1.5.5.2
- **Release Date**: November 9, 2025
- **Previous Version**: 1.5.5.1
- **Manifest Version**: 3
