# Changelog - Version 1.5.1

## New Features

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

### New Settings in Advanced Tab
- **Quick Tab Position Update Rate (Hz)** - Control how frequently Quick Tab positions update during dragging (default: 360 Hz)
  - Helpful description explains the trade-off between smoothness and CPU usage
  - Recommended values: 60 (standard), 144 (gaming), 240-360 (high refresh), 480+ (extreme)

## Technical Details

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
None - all changes are backward compatible.

## Known Limitations
- Quick Tab update rate limited by browser's event processing capabilities
- Very high update rates (>480 Hz) may not provide noticeable improvements
- Color pickers display browser's native color picker UI (varies by OS/browser)

## Notes
This version addresses user-reported issues with color input editing and Quick Tab dragging on high refresh rate monitors. The addition of native color pickers provides a more user-friendly way to customize notification colors without leaving the extension popup.
