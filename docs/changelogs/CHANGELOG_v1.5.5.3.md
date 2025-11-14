# Changelog - v1.5.5.3

## Overview

Version 1.5.5.3 removes the experimental YouTube timestamp synchronization
feature introduced in v1.5.5.2 while preserving all critical bug fixes. This
release stabilizes the extension by removing problematic features that were
causing compatibility issues.

## Changes from v1.5.5.2

### Removed Features

#### YouTube Timestamp Synchronization (Removed)

**Reason**: The experimental YouTube timestamp sync feature introduced bugs and
compatibility issues across different YouTube page types and cross-origin
iframes. Due to browser security restrictions and limited applicability, this
feature has been removed to stabilize the extension.

**Removed Code**:

- `isYouTubeUrl()` function
- `getYouTubeTimestamp()` function
- `updateYouTubeUrlWithTimestamp()` function
- `saveYouTubeTimestamps()` function
- Periodic timestamp saving interval (5-second timer)
- YouTube timestamp sync on visibility change
- YouTube timestamp sync on window blur
- `quickTabYouTubeTimestampSync` configuration setting
- YouTube timestamp sync UI checkbox in settings
- Experimental features section in popup

### Critical Bug Fixes Preserved

#### 1. Quick Tabs Immediately Closing After Keyboard Shortcut (KEPT)

**Status**: ✅ This fix is preserved from v1.5.5.2

The critical bug fix that prevents Quick Tabs from immediately closing after
being opened with the keyboard shortcut remains in place.

**Implementation**:

- `isSavingToStorage` flag to track when the current tab is saving to storage
- Storage change listener ignores events initiated by the same tab
- Flag is set before saving and cleared after a 100ms delay

**Code Location**: `content.js` - Lines 144, 431-447, 532

#### 2. Pinned Tabs Not Working (KEPT)

**Status**: ✅ This fix is preserved from v1.5.5.2

The fix for pinned tabs functionality remains in place. Pin button now properly
toggles between pinned (only visible in current page) and unpinned (visible in
all tabs).

**Implementation**:

- `broadcastQuickTabUnpin()` function to notify other tabs when a Quick Tab is
  unpinned
- `unpinQuickTab` handler in broadcast message handler to create Quick Tabs when
  they're unpinned
- Pin button properly broadcasts unpin events to all tabs

**Code Location**: `content.js` - Lines 263, 370-380, 2784

## Files Modified

### content.js

- Removed all YouTube timestamp sync functions and code
- Removed `quickTabYouTubeTimestampSync` from DEFAULT_CONFIG
- Updated bug fix comments to reflect v1.5.5.3 changes
- Preserved `isSavingToStorage` flag and related code
- Preserved `broadcastQuickTabUnpin()` functionality

### popup.html

- Removed YouTube timestamp sync checkbox
- Removed experimental features section from info box
- Simplified Quick Tabs info box

### popup.js

- Removed `quickTabYouTubeTimestampSync` from DEFAULT_CONFIG
- Removed YouTube timestamp sync checkbox loading code
- Removed YouTube timestamp sync checkbox saving code

### manifest.json

- Updated version to 1.5.5.3

## What This Release Preserves

### ✅ Critical Bug Fixes from v1.5.5.2

1. Quick Tabs no longer immediately close after being opened (isSavingToStorage
   flag)
2. Pinned tabs work correctly (broadcastQuickTabUnpin functionality)

### ✅ All Features from v1.5.5.1

1. URL detection fixes
2. YouTube Quick Tab playback control (pause/resume on tab switch)
3. Quick Tab position/size persistence across tabs
4. Pin button functionality

### ✅ All Features from Earlier Versions

1. Quick Tabs with minimize/restore functionality
2. Cross-domain Quick Tab synchronization
3. Quick Tab navigation controls
4. Keyboard shortcuts for all features
5. Customizable settings
6. Dark mode support

## What This Release Removes

### ❌ Removed from v1.5.5.2

1. YouTube timestamp synchronization (experimental feature)
2. All YouTube timestamp sync helper functions
3. Periodic timestamp saving
4. YouTube timestamp sync settings UI

## Testing Recommendations

### Verify Bug Fixes Still Work

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

3. **Cross-Tab Synchronization**:
   - Open multiple Quick Tabs in Tab A
   - Resize and move them
   - Switch to Tab B - verify all Quick Tabs appear with correct position/size
   - Close one in Tab B - verify it closes in Tab A too

4. **Media Playback Control**:
   - Open Quick Tab with YouTube video in Tab A
   - Switch to Tab B - video should pause
   - Switch back to Tab A - video should resume (if same-origin)

5. **Browser Restart**:
   - Open several Quick Tabs with different configurations (pinned, minimized)
   - Close and restart browser
   - Verify all Quick Tabs restore correctly

### Verify YouTube Timestamp Sync is Gone

1. Open settings popup
2. Verify there is no YouTube timestamp sync checkbox
3. Verify there is no experimental features section in info box
4. Open Quick Tab with YouTube video
5. Play video for 30 seconds
6. Switch to another tab and back
7. Verify video does NOT update URL with timestamp (this feature is removed)

## Version Information

- **Version**: 1.5.5.3
- **Release Date**: November 9, 2025
- **Previous Version**: 1.5.5.2
- **Manifest Version**: 3

## Summary

Version 1.5.5.3 is essentially v1.5.5.1 with the critical bug fixes from
v1.5.5.2, but without the YouTube timestamp synchronization feature. This
provides a stable foundation with all essential functionality working correctly:

- ✅ Quick Tabs don't immediately close after creation (v1.5.5.2 fix preserved)
- ✅ Pinned tabs work correctly (v1.5.5.2 fix preserved)
- ✅ All v1.5.5.1 functionality preserved
- ❌ YouTube timestamp sync removed (was experimental and buggy)

This release prioritizes stability and reliability over experimental features.
