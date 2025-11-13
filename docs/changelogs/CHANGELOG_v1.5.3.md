# Changelog - Version 1.5.3

## Release Date

2025-11-09

## Changes

### Quick Tab Improvements

#### Fixed Mouse Tracking Issues

- **Expanded Hit Areas During Drag/Resize**: When dragging or resizing a Quick Tab, the entire viewport now acts as the active area
  - Prevents the mouse from "losing" the Quick Tab when moving quickly
  - Creates a fullscreen invisible overlay during drag/resize operations
  - Overlay automatically removed when mouse button is released
  - Greatly improves usability on high refresh rate monitors and fast mouse movements

#### Cross-Tab Persistence Overhaul (Issue #35)

- **New BroadcastChannel + localStorage Implementation**: Completely replaced the sidebar API approach with a more robust solution
  - **BroadcastChannel API**: Provides real-time synchronization across browser tabs with zero latency
    - Quick Tabs created in one tab instantly appear in all other tabs
    - Closing Quick Tabs in one tab closes them in all tabs
    - No flickering or delays
  - **localStorage API**: Ensures Quick Tabs persist across browser restarts
    - Quick Tabs are automatically saved to localStorage
    - Restored when you reopen the browser or navigate to a new page
    - Includes both open and minimized Quick Tabs
  - **Removed Sidebar API Solution**: The experimental sidebar implementation has been removed as it was unreliable
  - **Togglable Feature**: Controlled by existing "Persist Quick Tabs across browser tabs" setting in Quick Tabs tab
  - **Automatic Cleanup**: Storage is automatically cleared when all Quick Tabs are closed

### Appearance Settings

#### Hex Color Input Improvements

- **Manual Hex Value Entry**: Text input fields for hex color values remain fully functional
  - Type hex values directly (e.g., #4CAF50 or 4CAF50)
  - Automatically validated and formatted
  - Synchronized with color picker in real-time
- **No Extension Popup Closing**: Using the color picker no longer closes the extension settings popup
  - Standard HTML5 color input doesn't interfere with popup state

### Technical Details

#### BroadcastChannel Implementation

- Lightweight, event-based cross-tab communication
- Messages broadcast when:
  - Creating a Quick Tab
  - Closing all Quick Tabs
  - Clearing minimized tabs
- Automatic fallback if BroadcastChannel is not available

#### localStorage Persistence

- JSON-based state storage
- Stores Quick Tab properties:
  - URL
  - Title
  - Position (left, top)
  - Dimensions (width, height)
  - Minimized state
- Automatic restoration on page load (100ms delay for page readiness)

#### Drag/Resize Overlay System

- Creates temporary fullscreen overlay during operations
- High z-index (999999999) ensures overlay stays on top
- Proper cleanup on mouse release, blur, or window focus loss
- Prevents "escape" when mouse moves outside Quick Tab bounds

## Bug Fixes

- Fixed issue where Quick Tabs would lose mouse tracking during fast movements
- Fixed issue where resize handles would become unresponsive during quick resizing
- Removed unreliable sidebar API implementation

## Known Issues

- None reported for this release

## Upgrade Notes

- The "Use sidebar API for Quick Tabs" setting is now non-functional and will be removed in a future version
- Existing Quick Tab state from previous versions will not be automatically migrated
- Users should close all Quick Tabs before upgrading to ensure clean state

## Breaking Changes

- None

## Compatibility

- Firefox 100+
- Zen Browser (all versions)
- Any browser supporting:
  - BroadcastChannel API
  - localStorage API
  - WebExtensions Manifest V3
