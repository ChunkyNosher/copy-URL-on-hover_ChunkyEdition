# Changelog - Version 1.5.0L (Quick Tabs Integration)

## Major Feature Release - Quick Tabs Integration

This is a major feature release that adds integration with the Quick Tabs Zen Browser mod, allowing users to open hovered links in Quick Tabs by pressing Ctrl+E (or other configured shortcuts).

### 🎉 New Features

1. **Quick Tabs Integration via DOM Marker Bridge** ⭐ MAJOR FEATURE
   - Added DOM marker bridge that allows Quick Tabs uc.js script to detect hovered links
   - Creates hidden marker element (`quicktabs-link-marker`) on each webpage
   - Updates marker with hovered link URL and title in real-time
   - Clears marker when mouse moves away from links
   - Enables Quick Tabs to open hovered links via Ctrl+E shortcut
   - Works seamlessly with all 100+ supported websites
   - Solves issue #5 in the Quick Tabs repository

### 🔧 Technical Implementation

**DOM Marker Bridge:**
- Creates a hidden `<div id="quicktabs-link-marker">` element on page load
- Sets three data attributes when hovering over links:
  - `data-hovered-url`: The detected link URL
  - `data-hovered-title`: The link text or title
  - `data-state`: "hovering" when over a link, "idle" when not
- Quick Tabs uc.js script observes this marker using MutationObserver
- Communication works across content/chrome security boundary

**Integration Points:**
- Marker initialization on page load and DOM ready
- Marker updates in mouseover event handler
- Marker clearing in mouseout event handler
- Console logging for debugging and verification

### 📋 How It Works

1. **Extension Side:**
   - Detects when user hovers over a link (using existing 100+ site-specific handlers)
   - Updates the marker element with the link's URL and title
   - Clears the marker when user moves mouse away

2. **Quick Tabs Side:**
   - Observes the marker element for changes
   - Captures the hovered link URL and title
   - Makes the link available for Ctrl+E shortcut
   - Opens the link in a Quick Tab when user presses the shortcut

### 🌐 Supported Websites

Works with all 100+ websites already supported by the extension, including:
- **Social Media**: Twitter/X, Reddit, LinkedIn, Instagram, Facebook, TikTok, and more
- **Video Platforms**: YouTube, Vimeo, Twitch, and more
- **Developer Sites**: GitHub, GitLab, Stack Overflow, and more
- **E-commerce**: Amazon, eBay, Etsy, and more
- **And 90+ more websites!**

### 📦 Prerequisites

To use this feature, you need:
1. **Zen Browser** with [Fx-Autoconfig](https://github.com/MrOtherGuy/fx-autoconfig/) installed
2. **Quick Tabs uc.js** from https://github.com/ChunkyNosher/Quick-Tabs
3. This extension (v1.5.0) installed

### 🚀 Usage

1. Install and load this extension in Zen Browser
2. Install Quick Tabs uc.js in your Zen profile's chrome/JS/ directory
3. Navigate to any website (e.g., YouTube, Twitter, Reddit)
4. Hover your mouse over any link
5. Press **Ctrl+E** (or your configured shortcut)
6. The link opens in a Quick Tab floating window!

### 🐛 Debugging

Enable debug mode in the extension settings to see console logs:
- `CopyURL: Quick Tabs marker created` - Marker element initialized
- `CopyURL: Updated Quick Tabs marker: <url>` - Link detected and marker updated
- `CopyURL: Cleared Quick Tabs marker` - Mouse moved away from link

On the Quick Tabs side (browser console - Ctrl+Shift+J):
- `QuickTabs: Marker element found, setting up observer` - Quick Tabs found the marker
- `QuickTabs: Link hover detected from extension: <url>` - Quick Tabs captured the link

### 📝 Files Changed

**Modified:**
- `content.js`: Added Quick Tabs marker bridge code (initialization, update, and clear functions)
- `manifest.json`: Version 1.4.6.1 → 1.5.0
- `updates.json`: Updated version to 1.5.0

**New:**
- `CHANGELOG_v1.5.0.md`: This changelog

### 🔗 Related Links

- Quick Tabs Repository: https://github.com/ChunkyNosher/Quick-Tabs
- Issue #5 (Quick Tabs): https://github.com/ChunkyNosher/Quick-Tabs/issues/5
- Integration Guide: https://github.com/ChunkyNosher/Quick-Tabs/blob/main/COPY_URL_INTEGRATION_GUIDE.md

### ⚡ Performance

- Minimal overhead - marker element is lightweight and hidden
- No polling or intervals - uses efficient event listeners
- MutationObserver on Quick Tabs side is lightweight and targeted
- No impact on websites without Quick Tabs installed

### 🎯 Benefits

✅ Open any link in Quick Tabs with simple hover + Ctrl+E  
✅ Works on 100+ popular websites with site-specific handlers  
✅ No need to right-click or drag-and-drop  
✅ Fast and intuitive workflow  
✅ Leverages existing extension infrastructure  
✅ Security-compliant implementation  
✅ Clean separation of concerns

### 🔄 Migration Notes

No breaking changes or settings changes. Simply update to v1.5.0 to enable Quick Tabs integration.

**Note:** This version is labeled as "1.5.0L" where "L" signifies it's a "Lite" version without the full Quick Tabs iframe implementation inside the extension itself, relying instead on the external Quick Tabs uc.js script.

---

**Full Changelog**: v1.4.6.1...v1.5.0
