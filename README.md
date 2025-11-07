# Firefox Extension: Copy URL on Hover - Lite Version

This is a lightweight version of the Copy URL on Hover extension, focused on core URL and text copying functionality **with Quick Tabs integration support**.

## ✨ Quick Tabs Integration (v1.5.0+)

**NEW!** This extension now integrates with the [Quick Tabs Zen Browser mod](https://github.com/ChunkyNosher/Quick-Tabs) to enable opening hovered links in Quick Tabs with a simple keyboard shortcut!

### How It Works
1. Hover your mouse over any link on a webpage
2. Press **Ctrl+E** (default shortcut in Quick Tabs)
3. The link opens in a Quick Tab floating window!

This works on **100+ websites** including YouTube, Twitter, Reddit, GitHub, and more!

### Prerequisites
- **Zen Browser** with [Fx-Autoconfig](https://github.com/MrOtherGuy/fx-autoconfig/)
- [Quick Tabs uc.js](https://github.com/ChunkyNosher/Quick-Tabs) installed
- This extension (v1.5.0+)

### Technical Details
The extension creates a hidden marker element in webpages that Quick Tabs observes. When you hover over a link, the marker updates with the link's URL and title, allowing Quick Tabs to open it when you press Ctrl+E. This solves [issue #5](https://github.com/ChunkyNosher/Quick-Tabs/issues/5) in the Quick Tabs repository.

## Features

### Core Features
✓ Copy URLs or link text by pressing keyboard shortcuts  
✓ Open links in new tabs with customizable focus behavior  
✓ Visual notifications with customizable colors, borders, and animations  
✓ Fully customizable through settings popup  
✓ **Supports 100+ websites** with site-specific optimized handlers  
✓ Works on all websites (except restricted Mozilla pages)  
✓ Debug mode for troubleshooting  
✓ Automatic settings sync across all tabs  
✓ Dark mode support

### Quick Tabs Integration
✓ DOM marker bridge for seamless Quick Tabs integration  
✓ Real-time link detection and sharing with Quick Tabs  
✓ Works with all 100+ supported websites  
✓ Minimal performance overhead  
✓ No impact if Quick Tabs is not installed

## Files Included

1. **manifest.json** - Extension configuration file
2. **content.js** - Main script that runs on web pages
3. **popup.html** - Settings popup interface
4. **popup.js** - Settings popup logic
5. **background.js** - Background script for content injection
6. **updates.json** - Auto-update configuration file

## Installation Instructions

### Easy Installation (Recommended - With Auto-Updates)

1. Go to the [Releases page](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/releases)
2. Download the latest `copy-url-hover-extension.xpi` file
3. Open your Firefox/Zen Browser
4. Navigate to `about:addons`
5. Click the gear icon (⚙️) and select "Install Add-on From File..."
6. Select the downloaded `.xpi` file
7. Click "Add" when prompted

**Note:** The extension will now automatically check for updates and notify you when a new version is available!

### Manual Installation (For Development)

If you want to manually load the extension for development:

1. Open Firefox and navigate to: `about:debugging`
2. Click **"This Firefox"** on the left sidebar
3. Click **"Load Temporary Add-on"** button
4. Navigate to the extension folder
5. Select the **`manifest.json`** file and click "Open"
6. The extension is now loaded!

**Note:** Temporary add-ons are removed when Firefox restarts and do not receive auto-updates.

### Customize Settings

Click the extension icon in your Firefox toolbar to open the settings popup. The settings are organized into **3 tabs**:

#### Copy URL Tab
- **Copy URL Key** - Default: `y`
- **Copy Text Key** - Default: `x`
- **Open in New Tab Key** - Default: `o`
- **Modifier Keys** - Add Ctrl, Alt, or Shift to any shortcut

#### Appearance Tab
- **Notifications** - Toggle on/off
- **Notification Color** - Background color
- **Border Color & Width** - Customize notification border
- **Animation** - Choose slide, pop, or fade animations
- **Position** - Where notifications appear
- **Size** - Small, medium, or large
- **Dark Mode** - Toggle dark/light theme

#### Advanced Tab
- **Debug Mode** - Enable console logging for troubleshooting

## Usage

### Quick Tabs Integration (Zen Browser)

**NEW in v1.7.0!** Open hovered links in Quick Tabs:

1. Install [Quick Tabs uc.js](https://github.com/ChunkyNosher/Quick-Tabs) in your Zen Browser
2. Load this extension (v1.7.0+)
3. Navigate to any website (YouTube, Twitter, Reddit, etc.)
4. Hover your mouse over any link
5. Press **Ctrl+E** (or your configured Quick Tabs shortcut)
6. The link opens in a Quick Tab floating window!

**Debugging**: Enable debug mode in settings to see console logs:
- `[CopyURLHover] Quick Tabs marker created` - Integration is active
- `[CopyURLHover] Updated Quick Tabs marker: <url>` - Link detected
- `[CopyURLHover] Cleared Quick Tabs marker` - Mouse moved away

### Basic Copy Functions
1. Hover your mouse over any link on a webpage
2. Press the configured key (default: **Y** to copy URL, **X** to copy text, **O** to open in new tab)
3. A notification will appear confirming the action
4. The URL or link text is now in your clipboard

## Customization

### Changing Default Keyboard Shortcuts

Edit `content.js` and modify these lines:

```javascript
const CONFIG = {
  COPY_URL_KEY: 'y',    // Change this to any key
  COPY_TEXT_KEY: 'x',   // Change this to any key
  // ... other settings
};
```

### Changing Notification Style

Still in `content.js`, modify the `CONFIG` object:

```javascript
const CONFIG = {
  SHOW_NOTIFICATION: true,
  NOTIFICATION_DURATION: 2000,      // milliseconds
  NOTIFICATION_COLOR: '#4CAF50',    // green
  NOTIFICATION_TEXT_COLOR: '#fff',  // white
  // ...
};
```

### Enabling Debug Mode

Edit `content.js`:

```javascript
const CONFIG = {
  // ...
  DEBUG_MODE: true  // Set to true for console logs
};
```

Then open Firefox Developer Tools (F12) to see debug messages.

## Features

✓ Copy URLs or link text by pressing keyboard shortcuts  
✓ Open links in new tabs with customizable focus behavior  
✓ **Quick Tabs integration** - Open hovered links in Quick Tabs (Zen Browser)  
✓ Visual notifications with customizable colors, borders, and animations  
✓ Fully customizable through settings popup  
✓ **Supports 100+ websites** with site-specific optimized handlers  
✓ Works on all websites (except restricted Mozilla pages)  
✓ Debug mode for troubleshooting  
✓ Automatic settings sync across all tabs  
✓ **Auto-update functionality** - Get notified when new versions are available  
✓ Dark mode support

### Notification Customization
✓ Border color and width customization  
✓ Three animation styles: Slide, Pop, or Fade  
✓ Six position options  
✓ Three size options  
✓ Customizable duration

## Supported Websites (100+)

The extension has unique, optimized handlers for over 100 popular websites across multiple categories:

### Social Media (13)
Twitter/X, Reddit, LinkedIn, Instagram, Facebook, TikTok, Threads, Bluesky, Mastodon, Snapchat, WhatsApp, Telegram

### Video Platforms (7)
YouTube, Vimeo, DailyMotion, Twitch, Rumble, Odysee, Bitchute

### Developer Platforms (12)
GitHub, GitLab, Bitbucket, Stack Overflow, Stack Exchange, Server Fault, Super User, CodePen, JSFiddle, Replit, Glitch, CodeSandbox

### Blogging Platforms (8)
Medium, Dev.to, Hashnode, Substack, WordPress, Blogger, Ghost, Notion

### E-commerce (12)
Amazon, eBay, Etsy, Walmart, Flipkart, AliExpress, Alibaba, Shopify, Target, Best Buy, Newegg, Wish

### Image & Design Platforms (13)
Pinterest, Tumblr, Dribbble, Behance, DeviantArt, Flickr, 500px, Unsplash, Pexels, Pixabay, ArtStation, Imgur, Giphy

### News & Discussion (8)
Hacker News, Product Hunt, Quora, Discord, Slack, Lobsters, Google News, Feedly

### Entertainment & Media (13)
Wikipedia, IMDb, Rotten Tomatoes, Netflix, Letterboxd, Goodreads, MyAnimeList, AniList, Kitsu, Last.fm, Spotify, SoundCloud, Bandcamp

### Gaming (6)
Steam Community, Steam Store, Epic Games, GOG, Itch.io, GameJolt

### Professional & Learning (7)
Coursera, Udemy, edX, Khan Academy, Skillshare, Pluralsight, Udacity

### Other (5)
Archive.org, Patreon, Ko-fi, Buy Me a Coffee, Gumroad

**Plus a generic fallback handler that works on any website!**

## Auto-Updates

This extension supports automatic updates when installed from a `.xpi` file:

- The extension checks for updates periodically
- When a new version is available, Firefox/Zen Browser will notify you
- You can manually check for updates in `about:addons` by clicking the gear icon and selecting "Check for Updates"

### For Developers: Releasing a New Version

To release a new version with auto-updates:

1. Update the `version` field in `manifest.json` (e.g., from `1.0.0` to `1.1.0`)
2. Update the `version` field in `updates.json` to match
3. Commit your changes
4. Create and push a new git tag:
   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```
5. GitHub Actions will automatically:
   - Build the `.xpi` file
   - Create a GitHub release
   - Upload the `.xpi` as a release asset
6. Users with the extension installed will be notified of the update

## Troubleshooting

**Extension doesn't appear in toolbar?**
- Make sure you're on the `about:debugging` page and loaded the extension correctly

**Shortcuts don't work?**
- Reload the webpage (F5) after changing settings
- Check that you're not in an input field or textarea
- Enable debug mode to see what keys are being pressed

**Settings don't save?**
- Make sure you clicked the "Save Settings" button
- Try resetting to defaults

## Notes

- This extension was entirely coded by AI and was only intended for my own personal use; I am not a programmer or software engineer in any capacity.
- The extension respects Content Security Policies and won't work on restricted Mozilla pages (like about:addons).

Enjoy copying URLs quickly and easily!
