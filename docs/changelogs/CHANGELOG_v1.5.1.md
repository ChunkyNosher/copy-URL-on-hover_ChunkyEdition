# Changelog - Version 1.5.1

## New Features

### Sidebar/Side Panel API Integration

- **Added browser sidebar support** for Quick Tabs (Firefox and Chrome)
- New optional sidebar mode that displays Quick Tabs in the browser's sidebar panel
- **Configurable in Quick Tabs settings**: Choose between floating windows or sidebar mode
- Sidebar Quick Tabs persist across all browser tabs automatically
- Sidebar includes:
  - List of all open Quick Tabs with favicons
  - Active Quick Tab iframe display
  - Navigation controls (back, forward, reload, open in new tab)
  - Settings button for quick access
- Works with Firefox's `sidebar_action` and Chrome's `sidePanel` APIs
- Backward compatible: Existing floating window mode still available

### Color Picker Integration in Appearance Settings

- **Added native HTML5 color pickers** for all color settings in the Appearance tab
- Color pickers appear alongside hex input fields for easy color selection
- **Fixed hex input fields** - they are now fully editable and functional
- Real-time synchronization between hex text input and color picker
- Both input methods update each other automatically

### Configurable Quick Tab Update Rate

- **New setting in Advanced tab**: Quick Tab Position Update Rate (Hz)
- Default set to 360 Hz for smooth dragging on high refresh rate monitors
- Prevents Quick Tabs from "slipping out" from under the cursor during fast movements
- Users can customize the update rate based on their monitor refresh rate and preferences
- Higher values (e.g., 360-480) provide smoother dragging
- Lower values (e.g., 60-120) use less CPU

## Improvements

### Sidebar Mode Benefits

- Quick Tabs truly persist across all browser tabs (not just saved state)
- No need for DOM manipulation in content scripts when using sidebar
- Cleaner architecture with sidebar handling UI, content scripts handling link detection
- Better memory management (single iframe in sidebar vs. multiple floating windows)
- Native browser integration (sidebar icon appears in browser UI)

### Enhanced Quick Tab Drag Performance

- **Fixed "slip out" issue** on high refresh rate monitors (300Hz+)
- Position updates now use time-based throttling instead of requestAnimationFrame
- Immediate position updates when threshold is met for responsive dragging
- Better tracking of mouse movement even at high poll rates
- Smoother dragging experience across all monitor refresh rates

### Color Input Improvements

- Hex color inputs now validate and auto-format to uppercase
- Added helpful placeholder text for all color fields
- Color pickers styled to match the extension's dark theme
- Seamless integration between manual hex entry and visual color picking

## Bug Fixes

### Fixed Color Input Fields Not Editable

- **Fixed:** Hex color input fields in Appearance settings are now fully editable
- **Fixed:** Removed conflicting CSS that prevented text input
- **Fixed:** Color validation now properly handles user input

## Settings

### New Settings in Quick Tabs Tab

- **Use browser sidebar for Quick Tabs (experimental)** - Toggle between floating windows and sidebar mode
  - When enabled, Quick Tabs open in browser sidebar
  - Provides true cross-tab persistence
  - Access via browser's sidebar menu or extension icon

### New Settings in Advanced Tab

- **Quick Tab Position Update Rate (Hz)** - Control how frequently Quick Tab positions update during dragging (default: 360 Hz)
  - Helpful description explains the trade-off between smoothness and CPU usage
  - Recommended values: 60 (standard), 144 (gaming), 240-360 (high refresh), 480+ (extreme)

## Technical Details

### Sidebar Implementation

- New files: `sidebar.html`, `sidebar.js`, `sidebar.css`
- Added `sidebar_action` (Firefox) and `side_panel` (Chrome) to manifest.json
- Added `sidePanel` permission for Chrome compatibility
- Background script now forwards Quick Tab creation messages to sidebar
- Sidebar uses browser.storage.local for persistence (separate from floating windows)
- Content script detects `quickTabUseSidebar` setting and routes accordingly

### Drag Performance Optimization

- Replaced requestAnimationFrame with time-based update throttling
- Uses `performance.now()` for high-precision timing
- Update interval calculated as `1000 / updateRate` milliseconds
- Prevents position lag on monitors faster than 60 Hz

### Color Picker Implementation

- Native HTML5 `<input type="color">` for gradient/color selection
- Bidirectional sync between text input and color picker
- Maintains backward compatibility with existing hex-only configuration
- No external dependencies required

## Breaking Changes

None - all changes are backward compatible. Sidebar mode is opt-in via settings.

## Known Limitations

- Sidebar mode requires manual activation (Firefox: View > Sidebar menu, Chrome: extension icon)
- Some websites may block iframe loading in sidebar due to X-Frame-Options headers
- Sidebar API not available in older browser versions (graceful fallback to floating windows)
- Quick Tab update rate limited by browser's event processing capabilities
- Very high update rates (>480 Hz) may not provide noticeable improvements
- Color pickers display browser's native color picker UI (varies by OS/browser)

## Browser Compatibility

- **Firefox**: Full sidebar support via `sidebar_action` API
- **Chrome/Edge**: Full sidebar support via `sidePanel` API (version 114+)
- **Older browsers**: Automatic fallback to floating window mode

## Migration Notes

- Existing users will continue using floating window mode by default
- To enable sidebar mode: Settings > Quick Tabs > Check "Use browser sidebar for Quick Tabs"
- Sidebar Quick Tabs and floating window Quick Tabs use separate storage
- Both modes can be used (just not simultaneously)

## Notes

This version addresses user-requested features for sidebar integration while maintaining backward compatibility with the existing floating window system. Users can choose their preferred mode based on their workflow. The addition of native color pickers and improved drag performance for high refresh rate monitors enhances the overall user experience.
