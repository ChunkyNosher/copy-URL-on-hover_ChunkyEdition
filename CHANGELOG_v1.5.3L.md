# Changelog - Version 1.5.3L (Firefox Preferences Integration)

## Major Implementation Change - Firefox Preferences Method

This version replaces the postMessage bridge with the Firefox Preferences Method for Quick-Tabs integration, providing a more reliable and well-documented communication mechanism between the extension and the uc.js script.

### 🎉 Changes in This Release

1. **Firefox Preferences Bridge Implementation** ⭐ MAJOR CHANGE
   - Replaced postMessage bridge with Firefox Preferences method
   - Content script now sends hover messages to background script
   - Background script writes to `browser.storage.local` (maps to Firefox preferences)
   - Quick-Tabs uc.js script observes preferences via `Services.prefs.addObserver()`
   - Real-time preference change notifications
   - More reliable cross-boundary communication

2. **Preference Keys Used**
   - `quicktabs_hovered_url`: The URL of the hovered link
   - `quicktabs_hovered_title`: The title/text of the link
   - `quicktabs_hovered_state`: "hovering" or "idle"
   - `quicktabs_hover_timestamp`: Timestamp of last hover event

3. **Enhanced Logging**
   - Background script console logs for debugging
   - Clear indication when preferences are updated/cleared
   - Message passing status reporting

### 🔧 Technical Implementation

**Content Script Changes (content.js):**
- Modified `updateQuickTabs()` function to send messages to background script
- Added duplicate update prevention
- Sends `HOVER_DETECTED` messages with `SET_LINK` or `CLEAR_LINK` actions
- Improved error handling with catch blocks

**Background Script Changes (background.js):**
- Added message listener for `HOVER_DETECTED` messages
- Implements preference writing via `browser.storage.local.set()`
- Handles both SET_LINK and CLEAR_LINK actions
- Added REQUEST_LINK handler for Quick-Tabs to query current state
- Console logging for all preference operations
- Async response handling with proper `return true`

**Communication Flow:**
```
Webpage → Content Script → Background Script → Firefox Preferences → UC.JS Observer
```

### 📋 How It Works

1. **User hovers over a link on webpage**
   - Content script detects hover event
   - Extracts URL and title from link
   - Sends message to background script

2. **Background script receives message**
   - Writes URL, title, state, and timestamp to browser.storage.local
   - Firefox preference system is updated instantly

3. **Quick-Tabs uc.js script observes change**
   - Preference observer fires on change
   - Reads the new values
   - Stores them for Ctrl+E shortcut

4. **User presses Ctrl+E**
   - Quick-Tabs reads stored link data
   - Validates URL
   - Creates Quick Tab with the link

### 🌐 Compatibility

Works with all 100+ websites already supported by the extension:
- **Social Media**: Twitter/X, Reddit, LinkedIn, Instagram, Facebook, etc.
- **Video Platforms**: YouTube, Vimeo, Twitch, etc.
- **Developer Sites**: GitHub, GitLab, Stack Overflow, etc.
- **E-commerce**: Amazon, eBay, Etsy, etc.
- **And 90+ more!**

### 📦 Prerequisites

To use this feature, you need:
1. **Zen Browser** with [Fx-Autoconfig](https://github.com/MrOtherGuy/fx-autoconfig/)
2. **Quick Tabs uc.js** from https://github.com/ChunkyNosher/Quick-Tabs (with v1.5.3L integration code)
3. This extension (v1.5.3L) installed

### 🚀 Usage

1. Install this extension (v1.5.3L)
2. Update Quick-Tabs uc.js with the integration code from `QUICKTABS_INTEGRATION_GUIDE_v1.5.3L.md`
3. Navigate to any website
4. Hover over any link
5. Press **Ctrl+E**
6. Link opens in a Quick Tab!

### 🐛 Debugging

Enable debug mode in extension settings and check browser console:

**Extension logs:**
- `[CopyURL] Sent Quick Tabs hover message to background: <url>`
- `[CopyURL-BG] Preference updated: <url>`
- `[CopyURL-BG] Preference cleared`

**Quick-Tabs logs (see integration guide):**
- `[QuickTabs] Preference observer registered successfully`
- `[QuickTabs] Preference changed: quicktabs_hovered_url`
- `[QuickTabs] Extension link updated: {url, title, state}`

### 📝 Files Changed

**Modified:**
- `content.js`: Updated Quick Tabs integration to use message passing
- `background.js`: Added preference writing logic and message handlers
- `manifest.json`: Version 1.5.0 → 1.5.3
- `updates.json`: Updated version to 1.5.3

**New:**
- `QUICKTABS_INTEGRATION_GUIDE_v1.5.3L.md`: Comprehensive integration guide for Quick-Tabs repository
- `CHANGELOG_v1.5.3L.md`: This changelog

### 🔗 Related Links

- **Quick-Tabs Repository**: https://github.com/ChunkyNosher/Quick-Tabs
- **Issue #5 (Quick-Tabs)**: https://github.com/ChunkyNosher/Quick-Tabs/issues/5
- **Integration Guide**: See `QUICKTABS_INTEGRATION_GUIDE_v1.5.3L.md` in this repository

### ⚡ Performance

- **Minimal overhead**: Preference writes are fast and efficient
- **No polling**: Uses event-driven preference observers
- **Real-time updates**: Instant preference change notifications
- **Reliable**: Firefox preference system is battle-tested (20+ years)
- **No impact**: Works seamlessly even if Quick-Tabs is not installed

### 🎯 Advantages Over postMessage Method

✅ **More reliable**: Preference system is well-established and stable  
✅ **Better documented**: Clear API and usage patterns  
✅ **Real-time**: Instant notifications via observer pattern  
✅ **Secure**: Uses Firefox's built-in preference security  
✅ **Debuggable**: Easy to inspect preferences in about:config  
✅ **No timing issues**: No race conditions or message delivery problems  
✅ **Cross-boundary**: Works across content/chrome security boundaries

### 🔄 Migration Notes from v1.5.0

**Breaking Changes:**
- Quick-Tabs uc.js script must be updated to use preference observers instead of postMessage listeners
- See `QUICKTABS_INTEGRATION_GUIDE_v1.5.3L.md` for complete Quick-Tabs integration code

**No User Settings Changes:**
- All extension settings remain the same
- No configuration needed

**Installation:**
- Simply update to v1.5.3L
- Update Quick-Tabs uc.js script with new integration code
- Test with a page hover and Ctrl+E

### 📖 Documentation

A complete implementation guide for the Quick-Tabs side is included in this repository:
- **File**: `QUICKTABS_INTEGRATION_GUIDE_v1.5.3L.md`
- **Contents**:
  - How Firefox Preferences work
  - Complete code for Quick-Tabs integration
  - Step-by-step implementation instructions
  - Data flow diagrams
  - Debugging tips
  - Troubleshooting guide

### 🙏 Acknowledgments

This implementation is based on the Firefox Preferences Method guide generated for Quick-Tabs issue #5. The method leverages Firefox's native preference system for reliable cross-boundary communication.

---

**Full Changelog**: v1.5.0...v1.5.3L
