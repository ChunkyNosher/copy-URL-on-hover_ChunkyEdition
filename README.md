# Firefox Extension: Copy URL on Hover

**Version 1.5.5.10** - A feature-rich Firefox/Zen Browser extension for quick URL copying and advanced Quick Tab management.

This is a complete, customizable Firefox extension that allows you to copy URLs or link text by pressing keyboard shortcuts while hovering over links, plus powerful Quick Tabs for browsing links in floating, draggable iframe windows.

## 📁 Repository Structure

- **Source Files**: `manifest.json`, `content.js`, `popup.html`, `popup.js`, `background.js`, `state-manager.js`
- **Documentation**: `/docs/` folder organized by type:
  - `/docs/changelogs/` - Version changelogs
  - `/docs/implementation-summaries/` - Feature implementation notes
  - `/docs/security-summaries/` - Security audit reports
  - `/docs/manual/` - Guides and architecture documentation

## ✨ Key Features

### Core Features
✓ **Quick URL Copying** - Press keyboard shortcuts while hovering over links  
✓ **Quick Tabs** - Floating, draggable, resizable iframe windows with full navigation  
✓ **Cross-Tab Sync** - Quick Tabs persist across all browser tabs (BroadcastChannel + browser.storage)  
✓ **Pin to Page** - Pin Quick Tabs to specific pages  
✓ **Auto-Updates** - Automatic extension updates via GitHub releases  
✓ **100+ Site Handlers** - Optimized for popular websites  
✓ **Debug Mode** - Slot number tracking and enhanced logging  
✓ **Dark Mode** - Full dark theme support

### Quick Tabs v1.5.5.10 Features
✓ Navigation controls (back, forward, reload, open in new tab)  
✓ Drag to move, resize from any edge/corner  
✓ Minimize to floating manager  
✓ Pin tabs to specific pages  
✓ Multiple instances with unique ID tracking  
✓ **NEW**: Slot number labels in debug mode  
✓ **FIXED**: Position sync bugs (no more jumping to original position)  
✓ **FIXED**: Pin/unpin no longer causes tabs to close  
✓ **FIXED**: Duplicate instance handling with ID-based tracking

### State Management Architecture
- **browser.storage.sync** - Persistent cross-device state (quick_tabs_state_v2)
- **browser.storage.session** - Fast ephemeral state (Firefox 115+)
- **BroadcastChannel** - Real-time same-origin sync (<10ms latency)
- **Runtime Messaging** - Cross-origin sync via background script
- **ID-based Tracking** - Prevents duplicate instance conflicts

## 🚀 Installation

### Easy Installation (Recommended)

1. Go to the [Releases page](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/releases)
2. Download the latest `copy-url-hover-extension.xpi`
3. Open Firefox/Zen Browser → `about:addons`
4. Click gear icon (⚙️) → "Install Add-on From File..."
5. Select the `.xpi` file and confirm

**Auto-updates enabled** - You'll be notified when new versions are available.

### Manual Installation (Development)

1. Navigate to `about:debugging` in Firefox
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `manifest.json` from the extension folder
4. Extension loaded! (Removed on browser restart)

## 📖 Usage

### Basic Copy Functions
1. Hover over any link
2. Press:
   - **Y** - Copy URL
   - **X** - Copy link text
   - **O** - Open in new tab
3. Notification confirms the action

### Quick Tabs
1. Hover over a link
2. Press **Q** to open Quick Tab
3. Use controls:
   - **←→** Navigate (back/forward)
   - **↻** Reload
   - **📍** Pin to current page
   - **−** Minimize
   - **🔗** Open in new tab
   - **✕** Close
4. **Drag** title bar to move
5. **Drag** edges/corners to resize
6. **Pin** to keep Quick Tab only on specific pages
7. **Press Esc** to close all Quick Tabs

### Debug Mode
Enable in settings to see:
- **Slot numbers** on Quick Tab toolbars (e.g., "Slot 1", "Slot 2")
- Slot numbers reuse freed slots (lowest first)
- Enhanced console logging for troubleshooting

## ⚙️ Settings

Access settings by clicking the extension icon. Organized into 4 tabs:

### Copy URL Tab
- Keyboard shortcuts for copy URL, copy text, open in new tab
- Modifier keys (Ctrl, Alt, Shift)

### Quick Tabs Tab
- Quick Tab keyboard shortcut (default: Q)
- Close all shortcut (default: Escape)
- Max windows (1-10)
- Default size and position
- Cross-tab persistence toggle
- Close on open toggle

### Appearance Tab
- Notification style (tooltip or notification)
- Colors, borders, animations
- Position and size
- Dark mode toggle
- Debug mode toggle

### Advanced Tab
- Clear Quick Tab Storage (preserves settings!)
- Reset settings to defaults

## 🔒 Security Notice

**X-Frame-Options Bypass**: This extension removes X-Frame-Options and CSP frame-ancestors headers to allow Quick Tabs to display any website in iframes. This is necessary for universal compatibility but removes clickjacking protection for iframed content.

**Use at your own discretion.** Only open Quick Tabs from trusted websites or disable the extension when browsing untrusted sites.

## 🐛 Known Limitations

1. **Quick Tab Focus**: Clicking inside a Quick Tab iframe captures keyboard focus. Click the main page to restore shortcuts.

2. **Nested Quick Tabs**: Only works for same-origin iframes. Use "Open in New Tab" button for cross-origin links.

3. **Zen Browser Themes**: Cannot detect Zen workspace themes (requires native API access). Use built-in dark mode instead.

## 📚 Documentation

- **Changelogs**: See `/docs/changelogs/` for version history
- **Architecture**: See `/docs/manual/quick-tab-sync-architecture.md`
- **Bug Fixes**: See `/docs/manual/v1-5-5-9-critical-bug-analysis.md` for v1.5.5.10 fixes
- **Testing Guide**: See `/docs/manual/TESTING_GUIDE_ISSUE_51.md`

## 🛠️ Development

### Releasing a New Version

1. Update `version` in `manifest.json`
2. Commit changes
3. Create and push git tag:
   ```bash
   git tag v1.x.x
   git push origin v1.x.x
   ```
4. GitHub Actions builds `.xpi` and creates release
5. Users receive auto-update notifications

### Testing

See `/docs/manual/TESTING_GUIDE_ISSUE_51.md` for comprehensive testing procedures.

## 🌐 Supported Websites (100+)

Optimized handlers for:
- Social Media (Twitter/X, Reddit, LinkedIn, Instagram, Facebook, etc.)
- Video Platforms (YouTube, Vimeo, Twitch, etc.)
- Developer Platforms (GitHub, GitLab, Stack Overflow, etc.)
- E-commerce (Amazon, eBay, Etsy, etc.)
- News & Blogs (Medium, Dev.to, Hashnode, etc.)
- And many more!

**Plus generic fallback handler for any website.**

## 📝 Notes

- This extension was coded by AI as a personal project
- Not affiliated with Mozilla or Firefox
- Respects Content Security Policies (won't work on restricted Mozilla pages)

## 📄 License

See repository for license information.

---

**Current Version**: 1.5.5.10  
**Last Updated**: 2025-11-11  
**Repository**: [ChunkyNosher/copy-URL-on-hover_ChunkyEdition](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition)
