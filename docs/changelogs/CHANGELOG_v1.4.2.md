# Changelog - Version 1.4.2

## Critical Bug Fix Release

This is a hotfix release that addresses a critical syntax error that broke the extension's URL detection functionality.

### 🐛 Critical Bug Fixes

1. **Fixed Extension Breaking Syntax Error** ⭐ CRITICAL FIX
   - Removed extra closing brace at line 2184 in content.js that was causing a JavaScript syntax error
   - This syntax error prevented the entire content script from loading
   - URL detection was completely broken and the extension would not detect any URLs on hover
   - Extension now works properly again

### 🎨 UI Improvements

2. **Expanded Settings Menu Width**
   - Increased extension settings popup width from 450px to 550px
   - Provides more space for settings controls
   - Improves readability and user experience

### 🔧 Technical Details

**Files Changed:**

- `content.js`: Fixed syntax error (removed extra closing brace)
- `popup.html`: Increased body width from 450px to 550px
- `manifest.json`: Version 1.4.1 → 1.4.2
- `updates.json`: Updated version to 1.4.2

**Root Cause:**

- An extra closing brace `}` was accidentally added at line 2184 in content.js
- This created a syntax error that prevented the entire script from executing
- The error broke all URL detection functionality including:
  - Hovering over links
  - Copy URL feature
  - Copy Text feature
  - Quick Tabs feature
  - Open in New Tab feature

### 🚀 Migration Notes

No settings changes or breaking changes. Simply update to v1.4.2 to fix the broken extension.

**All users on v1.4.1 should update immediately as the extension is non-functional in that version.**

### 📦 Installation

Install via .xpi file from GitHub releases or load manually in about:debugging.

---

**Full Changelog**: v1.4.1...v1.4.2
