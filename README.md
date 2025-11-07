# Firefox Extension: Copy URL on Hover

This is a complete, customizable Firefox extension that allows you to copy URLs or link text by pressing keyboard shortcuts while hovering over links.

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

### Step 5: Customize Settings

Click the extension icon in your Firefox toolbar to open the settings popup. You can customize:

- **Key to copy URL** - Default: `y`
- **Key to copy text** - Default: `x`
- **Show notifications** - Toggle copy confirmations
- **Notification color** - Change the notification appearance
- **Notification duration** - How long notifications display (in milliseconds)
- **Debug mode** - Enable console logging for troubleshooting

## Usage

1. Hover your mouse over any link on a webpage
2. Press the configured key (default: **Y** to copy URL, **X** to copy text)
3. A notification will appear confirming the copy
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
✓ Visual notifications confirm successful copies  
✓ Fully customizable through settings popup  
✓ **Supports 100+ websites** with site-specific optimized handlers  
✓ Works on all websites (except restricted Mozilla pages)  
✓ Debug mode for troubleshooting  
✓ Automatic settings sync across all tabs  
✓ **Auto-update functionality** - Get notified when new versions are available

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
