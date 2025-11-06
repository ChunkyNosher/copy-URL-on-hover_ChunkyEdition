# Firefox Extension: Copy URL on Hover

This is a complete, customizable Firefox extension that allows you to copy URLs or link text by pressing keyboard shortcuts while hovering over links.

## Files Included

1. **manifest.json** - Extension configuration file
2. **content.js** - Main script that runs on web pages
3. **popup.html** - Settings popup interface
4. **popup.js** - Settings popup logic
5. **background.js** - Background script for content injection

## Installation Instructions

### Step 1: Create the Folder Structure

Create a folder named `copy-url-hover-extension` anywhere on your computer (Desktop or Documents recommended).

Inside that folder, create this structure:

```
copy-url-hover-extension/
├── manifest.json
├── content.js
├── popup.html
├── popup.js
├── background.js
└── icons/
    └── icon.png
```

### Step 2: Add Files

Copy all the provided files (manifest.json, content.js, popup.html, popup.js, background.js) into the `copy-url-hover-extension` folder.

### Step 3: Create Icon

Create an `icons` folder inside `copy-url-hover-extension`. Add a 96x96 PNG image named `icon.png` inside it.

**Quick icon solution:** You can download a free link icon from:
- https://www.flaticon.com/
- https://material.io/resources/icons/
- Or create a simple one using Paint/Preview

### Step 4: Load the Extension in Firefox

1. Open Firefox and navigate to: `about:debugging`
2. Click **"This Firefox"** on the left sidebar
3. Click **"Load Temporary Add-on"** button
4. Navigate to your `copy-url-hover-extension` folder
5. Select the **`manifest.json`** file and click "Open"
6. The extension is now loaded!

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
✓ Works on all websites (except restricted Mozilla pages)  
✓ Debug mode for troubleshooting  
✓ Automatic settings sync across all tabs  

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

- This extension was entirely coded by AI; I am not a programmer or software engineer in any capacity.
- The extension respects Content Security Policies and won't work on restricted Mozilla pages (like about:addons).

Enjoy copying URLs quickly and easily!
