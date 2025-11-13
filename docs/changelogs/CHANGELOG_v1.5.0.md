# Changelog - Version 1.5.0

## New Features

### Quick Tab Persistence Across Browser Tabs

- **Quick Tabs now persist when switching between browser tabs!**
- Quick Tab state is stored in the background script and automatically restored when you return to a tab
- Enable/disable this feature in Quick Tabs settings
- When enabled, your Quick Tabs stay exactly where you left them, preserving:
  - Position and size
  - Currently loaded URL
  - Window state

### Quick Tab Resizing

- **Quick Tabs can now be resized!**
- Drag any edge or corner to resize Quick Tab windows
- 8 resize handles (4 corners + 4 edges) for full control
- Minimum size constraints (300px × 200px) prevent windows from becoming too small
- Resize functionality can be toggled on/off in Quick Tabs settings (enabled by default)
- Resized dimensions are preserved when Quick Tab persistence is enabled

## Bug Fixes

### Fixed Quick Tab Drag Glitch (#3)

- **Fixed:** Quick Tab windows no longer follow the mouse after releasing the drag
- **Fixed:** Improved drag behavior when mouse leaves the title bar area while dragging
- **Fixed:** Better handling of mouseup events that occur outside the browser window
- **Improved:** Added safety checks for lost mouseup events (checking e.buttons state)
- **Improved:** Added window blur and mouseleave handlers to ensure drag state is always reset properly

## Improvements

### Enhanced Drag & Drop

- More robust drag detection with button state validation
- Only left mouse button (button 0) initiates dragging
- Multiple safety mechanisms to prevent stuck drag states
- Better cross-browser compatibility

### Code Architecture

- Moved Quick Tab state management to background.js for better persistence
- Implemented message passing between content script and background script
- Cleaner separation of concerns between UI (content.js) and state management (background.js)
- Improved memory management with proper cleanup of event listeners

## Settings

### New Quick Tabs Settings

- **Enable Quick Tab resizing** - Toggle resize functionality on/off
- **Persist Quick Tabs across browser tabs** - Now fully functional (previously disabled)

## Technical Details

### Background Script Enhancements

- Quick Tab states are now stored per-tab in the background script
- Automatic state restoration when returning to a tab
- Automatic cleanup when tabs are closed
- Message-based communication with content scripts

### Performance

- Resize operations use requestAnimationFrame for smooth performance (drag was already using this)
- Efficient state updates only when persistence is enabled
- Minimal memory footprint for state storage

## Breaking Changes

None - all changes are backward compatible.

## Known Limitations

- Quick Tab iframes are still subject to same-origin and X-Frame-Options restrictions
- Some websites may block loading in iframes regardless of persistence settings
- Quick Tabs in one browser tab cannot be visible while viewing a different tab (browser security limitation)
  - However, they are now saved and automatically restored when you switch back!

## Notes

This version represents a significant improvement in Quick Tab functionality, addressing one of the most requested features (persistence across tabs) and fixing a long-standing drag behavior issue. The addition of resize functionality makes Quick Tabs even more flexible and user-friendly.
