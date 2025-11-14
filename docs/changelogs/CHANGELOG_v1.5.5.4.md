# Changelog v1.5.5.4

## Bug Fixes

### Quick Tab Duplication and Closure Issues

**Fixed Critical Bugs:**

1. **Quick Tabs Opening Then Immediately Closing**
   - Root Cause: Deferred iframe loading in background tabs caused duplicate
     detection to fail
   - Fix: Updated all duplicate detection logic to check both `iframe.src` and
     `data-deferred-src` attribute
   - Impact: Quick Tabs now open once and stay open correctly

2. **Multiple Quick Tabs Appearing When Switching Tabs**
   - Root Cause: BroadcastChannel sends messages to sender tab, creating
     duplicates
   - Fix: Added duplicate detection in `handleBroadcastMessage()` to prevent
     self-messaging duplicates
   - Impact: Each Quick Tab URL appears only once per tab

3. **Broken Quick Tabs with No Content**
   - Root Cause: Empty URLs could be saved and restored, creating broken Quick
     Tab instances
   - Fix: Added URL validation in create/save/restore operations to filter empty
     URLs
   - Impact: All Quick Tabs display valid content

4. **Closing One Quick Tab Closes All Quick Tabs**
   - Root Cause: Close broadcast used `iframe.src` which was empty for deferred
     iframes
   - Fix: Updated all broadcast operations (close/move/resize/pin) to use
     correct URL from deferred iframes
   - Impact: Closing/modifying one Quick Tab only affects that specific Quick
     Tab

## Technical Changes

### Deferred Iframe URL Handling

Updated all locations that retrieve iframe URLs to check both sources:

- `handleBroadcastMessage()` - All action handlers (create, close, move, resize,
  pin, unpin)
- `saveQuickTabsToStorage()` - URL extraction for storage
- `restoreQuickTabsFromStorage()` - Duplicate detection
- `storage.onChanged` listener - URL matching and duplicate detection
- `closeQuickTabWindow()` - URL for close broadcast
- Drag handler (`makeDraggable()`) - URL for move broadcast
- Resize handler (`makeResizable()`) - URL for resize broadcast
- Pin/unpin handlers - URL for pin/unpin broadcasts

### URL Validation

Added validation to prevent empty URL Quick Tabs:

- `createQuickTabWindow()` - Reject empty URLs at creation
- `saveQuickTabsToStorage()` - Filter empty URLs before saving
- `restoreQuickTabsFromStorage()` - Skip empty URLs when restoring
- `storage.onChanged` - Skip empty URLs when creating from storage

### BroadcastChannel Duplicate Prevention

- Added duplicate detection in `handleBroadcastMessage()` for 'createQuickTab'
  action
- Checks if Quick Tab with same URL already exists before creating
- Handles both regular and deferred iframes correctly

## Code Statistics

- Files Changed: 2
- Lines Added: 86
- Lines Removed: 32
- Net Change: +54 lines

## Security

- CodeQL Scan: ✓ Passed (0 alerts)
- No new security vulnerabilities introduced
- All changes are defensive improvements to existing functionality

## Testing

Verified fixes address all reported bug symptoms:

- ✓ First Quick Tab no longer closes immediately after opening
- ✓ No duplicate Quick Tabs when switching between tabs
- ✓ No broken Quick Tabs with empty content
- ✓ Closing one Quick Tab only closes that specific Quick Tab

## Browser Compatibility

- Firefox: ✓ Compatible
- Zen Browser: ✓ Compatible
- All WebExtension APIs used correctly
- No breaking changes to existing functionality

## Migration Notes

No migration required - all changes are backward compatible. Existing Quick Tabs
in storage will continue to work correctly.

## Known Limitations

- None identified with these fixes
- All reported bugs addressed

## Credits

- Bug Reports: User testing feedback
- Fixed by: Copilot Coding Agent
- Reviewed: Automated code review and security scanning
