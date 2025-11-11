# Changelog - Version 1.5.2

## Bug Fixes

### Fixed Quick Tab Dragging Performance
- **Fixed mouse tracking during fast movements**: Quick Tabs now properly track cursor position even during rapid mouse movements
- **Implemented offset-based dragging**: Stores the click offset within the title bar to maintain consistent cursor positioning
- **Improved vertical dragging**: Fixed issue where Quick Tabs would "lose" the mouse during fast vertical movements due to the smaller height of the drag area
- Quick Tabs no longer slip out from under the cursor when dragging quickly in any direction

### Fixed Quick Tab Resizing Performance
- **Added requestAnimationFrame throttling**: Resize operations now use browser's animation frame for smoother updates
- **Fixed mouse tracking during resizing**: Quick Tabs maintain proper cursor tracking during fast resize operations
- Improved resize performance in all directions (horizontal, vertical, and diagonal)
- Resize handles no longer lose the mouse cursor during fast movements

### Fixed Sidebar API Implementation
- **Fixed sidebar Quick Tabs not appearing**: Sidebar API now properly creates Quick Tabs when enabled
- **Implemented message forwarding**: Background script now correctly forwards Quick Tab creation messages to the sidebar panel
- **Fixed message listener**: Sidebar properly acknowledges messages with return value
- Sidebar Quick Tabs now successfully open and persist across browser tabs

### Updated Sidebar API Descriptions
- **Clarified sidebar API functionality**: Updated setting description to explain it uses the sidebar API while maintaining Quick Tab features
- **Updated notification text**: Changed notification to "Quick Tab opened (sidebar API)" for clarity
- Better explanation that sidebar API achieves cross-tab persistence through browser's native sidebar panel

## Improvements

### Enhanced Dragging Algorithm
- Replaced delta-based position calculation with offset-based tracking
- Mouse position relative to element is now preserved throughout drag operation
- Eliminates cursor drift during high-speed dragging
- Works reliably on high refresh rate monitors (144Hz, 240Hz, 360Hz+)

### Enhanced Resizing Algorithm
- Implemented pending state pattern for resize operations
- Uses requestAnimationFrame for smooth visual updates
- Properly handles resize cleanup on mouseup
- Maintains element bounds during rapid resize operations

## Technical Details

### Dragging Implementation Changes
- Added `offsetX` and `offsetY` variables to store click position within element
- Changed from `initialX + dx` approach to `clientX - offsetX` approach
- Calculates offset once on mousedown: `offsetX = e.clientX - rect.left`
- Applies offset-adjusted position on mousemove: `newX = e.clientX - offsetX`

### Resizing Implementation Changes
- Added `animationFrameId` and `pendingResize` state variables
- Resize calculations separated from DOM updates
- Uses `requestAnimationFrame(applyResize)` for scheduled updates
- Immediately applies pending resize on mouseup to prevent lag

### Sidebar Message Flow
- Content script sends message to background script
- Background script forwards message to all extension pages (including sidebar)
- Sidebar receives message and creates Quick Tab entry
- Sidebar responds with success status
- Enhanced error handling for when sidebar is not open

## Known Limitations

### Sidebar API Behavior
- Sidebar panel must be manually opened via browser's sidebar menu or extension icon
- Sidebar Quick Tabs appear in the browser's sidebar panel, not as floating windows
- This is by design - browser security prevents floating DOM elements from persisting across tabs
- Use "Persist Quick Tabs across browser tabs" setting for floating window state restoration

### Cross-Tab Persistence
- Floating Quick Tab windows cannot persist across tabs due to browser security (each tab has isolated DOM)
- Two solutions available:
  1. **Sidebar API mode**: Quick Tabs open in sidebar panel which persists across all tabs
  2. **Persist mode**: Saves floating Quick Tab state and restores when returning to the tab
- For users who want floating windows with some persistence, use the "Persist Quick Tabs across browser tabs" option in settings

## Breaking Changes
None - all changes are backward compatible and improve existing functionality.

## Browser Compatibility
- Firefox: Full support
- Chrome/Edge: Full support (version 114+ for sidePanel API)
- All improvements work on both desktop and compatible mobile browsers

## Migration Notes
- No migration required
- All existing Quick Tabs will work with improved dragging and resizing
- Sidebar API users will now see Quick Tabs actually appear in the sidebar (previously broken)

## Notes
This version focuses on fixing the mouse tracking issues during Quick Tab manipulation and resolving the broken sidebar API implementation. The improved dragging algorithm ensures Quick Tabs stay under your cursor even during rapid movements on high refresh rate displays. The sidebar API fix enables true cross-tab persistence for users who prefer the sidebar approach.
