# Quick Tab Bugs and Feature Enhancements - v1.5.8.16+

## Overview
This document details the bugs and feature requests for the copy-URL-on-hover extension version 1.5.8.16, focusing on Quick Tab functionality and the notification system. This document is optimized for GitHub Copilot Agent implementation while remaining human-readable.

---

## Bug #1: Quick Tab Flash in Top Left Corner

### Description
When opening a Quick Tab using the keyboard shortcut, the Quick Tab iframe briefly flashes/appears in the top-left corner of the viewport for approximately 1 millisecond before moving to its intended tooltip position.

### Root Cause
**File**: `src/content.js` or `content.js` (depending on modular vs monolithic structure)
**Function**: `createQuickTabWindow()` or similar Quick Tab creation function

The Quick Tab iframe is likely being:
1. Created and appended to the DOM with default positioning (top: 0, left: 0)
2. Position is calculated AFTER the element is already visible in the DOM
3. CSS transitions or positioning is applied after the initial render

### Fix Required

**Location**: Quick Tab creation function

**Current problematic pattern**:
```javascript
// BEFORE - Causes flash
const quickTab = document.createElement('iframe');
quickTab.className = 'quick-tab-iframe';
quickTab.src = url;
document.body.appendChild(quickTab); // ← Visible immediately at 0,0

// Calculate position AFTER it's visible
const position = calculateTooltipPosition();
quickTab.style.left = position.x + 'px';
quickTab.style.top = position.y + 'px';
```

**Corrected implementation**:
```javascript
// AFTER - No flash
const quickTab = document.createElement('iframe');
quickTab.className = 'quick-tab-iframe';
quickTab.src = url;

// Set initial position to invisible or off-screen
quickTab.style.visibility = 'hidden'; // Or use opacity: 0
quickTab.style.position = 'fixed';

document.body.appendChild(quickTab);

// Calculate position while hidden
const position = calculateTooltipPosition();
quickTab.style.left = position.x + 'px';
quickTab.style.top = position.y + 'px';

// Make visible only after positioning is complete
requestAnimationFrame(() => {
    quickTab.style.visibility = 'visible'; // Or opacity: 1 with transition
});
```

**Alternative approach using CSS**:
```css
/* Add to stylesheet */
.quick-tab-iframe {
    position: fixed;
    visibility: hidden; /* Hidden until positioned */
    transition: opacity 0.15s ease-in;
}

.quick-tab-iframe.positioned {
    visibility: visible;
    opacity: 1;
}
```

```javascript
// JavaScript
const quickTab = document.createElement('iframe');
quickTab.className = 'quick-tab-iframe';
quickTab.src = url;

const position = calculateTooltipPosition();
quickTab.style.left = position.x + 'px';
quickTab.style.top = position.y + 'px';

document.body.appendChild(quickTab);

// Add class after next paint
requestAnimationFrame(() => {
    quickTab.classList.add('positioned');
});
```

---

## Feature #2: Separate Notification Configurations

### Description
Currently, notifications for "Opening a Quick Tab" and "URL copied" appear to use the same configuration. The user wants:
- **Quick Tab opened notification**: Slide animation in top-right corner
- **URL copied notification**: Pop-up animation at tooltip/cursor position

### Implementation Strategy

**File**: `src/core/notifications.js` or `popup.js` (settings)

### Step 1: Update Settings Schema

Add separate notification configurations for each action type.

**Location**: Settings configuration object

```javascript
// Current (simplified)
const NOTIFICATION_CONFIG = {
    enabled: true,
    duration: 2000,
    position: 'top-right',
    animation: 'fade'
};

// NEW - Separate configs
const NOTIFICATION_CONFIGS = {
    quickTabOpened: {
        enabled: true,
        duration: 2000,
        position: 'top-right',        // User preference
        animation: 'slide',            // User preference
        animationDirection: 'left'     // Slide from right
    },
    urlCopied: {
        enabled: true,
        duration: 1500,
        position: 'tooltip',           // User preference: at tooltip/cursor
        animation: 'pop-up',           // User preference
        scale: 1.1                     // Pop-up effect scaling
    },
    textCopied: {
        enabled: true,
        duration: 1500,
        position: 'tooltip',
        animation: 'pop-up',
        scale: 1.1
    }
};
```

### Step 2: Update Settings UI (popup.html)

**Location**: `popup.html` → Appearance tab

Add notification customization section:

```html
<div class="settings-section">
    <h3>Notification Settings</h3>
    
    <!-- Quick Tab Notification -->
    <div class="notification-config-group">
        <h4>Quick Tab Opened</h4>
        
        <label>
            <span>Enable Notification</span>
            <input type="checkbox" id="quicktab-notification-enabled" checked>
        </label>
        
        <label>
            <span>Position</span>
            <select id="quicktab-notification-position">
                <option value="top-left">Top Left</option>
                <option value="top-right" selected>Top Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-right">Bottom Right</option>
                <option value="tooltip">At Cursor/Tooltip</option>
            </select>
        </label>
        
        <label>
            <span>Animation</span>
            <select id="quicktab-notification-animation">
                <option value="fade">Fade</option>
                <option value="slide" selected>Slide</option>
                <option value="pop-up">Pop-up</option>
                <option value="bounce">Bounce</option>
            </select>
        </label>
        
        <label>
            <span>Duration (ms)</span>
            <input type="number" id="quicktab-notification-duration" value="2000" min="500" max="10000" step="100">
        </label>
    </div>
    
    <!-- URL Copied Notification -->
    <div class="notification-config-group">
        <h4>URL Copied</h4>
        
        <label>
            <span>Enable Notification</span>
            <input type="checkbox" id="urlcopy-notification-enabled" checked>
        </label>
        
        <label>
            <span>Position</span>
            <select id="urlcopy-notification-position">
                <option value="top-left">Top Left</option>
                <option value="top-right">Top Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-right">Bottom Right</option>
                <option value="tooltip" selected>At Cursor/Tooltip</option>
            </select>
        </label>
        
        <label>
            <span>Animation</span>
            <select id="urlcopy-notification-animation">
                <option value="fade">Fade</option>
                <option value="slide">Slide</option>
                <option value="pop-up" selected>Pop-up</option>
                <option value="bounce">Bounce</option>
            </select>
        </label>
        
        <label>
            <span>Duration (ms)</span>
            <input type="number" id="urlcopy-notification-duration" value="1500" min="500" max="10000" step="100">
        </label>
    </div>
</div>
```

### Step 3: Implement Animation System

**File**: Create `src/ui/notification-animations.js` or add to existing notification module

```javascript
/**
 * Notification Animation System
 * Handles different animation types for notifications
 */

class NotificationAnimator {
    /**
     * Show notification with specified animation
     * @param {HTMLElement} element - Notification element
     * @param {Object} config - Animation configuration
     */
    static show(element, config) {
        const { animation, position, duration } = config;
        
        // Position element
        this.position(element, position);
        
        // Apply animation
        switch (animation) {
            case 'fade':
                this.animateFade(element, true);
                break;
            case 'slide':
                this.animateSlide(element, true, config.animationDirection || 'left');
                break;
            case 'pop-up':
                this.animatePopUp(element, true, config.scale || 1.1);
                break;
            case 'bounce':
                this.animateBounce(element, true);
                break;
            default:
                this.animateFade(element, true);
        }
        
        // Auto-hide after duration
        setTimeout(() => this.hide(element, config), duration);
    }
    
    /**
     * Hide notification with reverse animation
     */
    static hide(element, config) {
        const { animation } = config;
        
        switch (animation) {
            case 'fade':
                this.animateFade(element, false);
                break;
            case 'slide':
                this.animateSlide(element, false, config.animationDirection || 'left');
                break;
            case 'pop-up':
                this.animatePopUp(element, false, config.scale || 1.1);
                break;
            case 'bounce':
                this.animateFade(element, false); // Bounce exit uses fade
                break;
        }
        
        // Remove from DOM after animation
        setTimeout(() => element.remove(), 300);
    }
    
    /**
     * Position notification
     */
    static position(element, position) {
        // Clear previous positioning
        element.style.top = '';
        element.style.bottom = '';
        element.style.left = '';
        element.style.right = '';
        
        if (position === 'tooltip') {
            // Position at cursor/tooltip
            const cursorPos = this.getCursorPosition();
            element.style.position = 'fixed';
            element.style.left = cursorPos.x + 10 + 'px'; // Offset from cursor
            element.style.top = cursorPos.y + 10 + 'px';
        } else {
            // Fixed corner position
            element.style.position = 'fixed';
            const [vertical, horizontal] = position.split('-');
            element.style[vertical] = '20px';
            element.style[horizontal] = '20px';
        }
    }
    
    /**
     * Fade animation
     */
    static animateFade(element, isShowing) {
        element.style.transition = 'opacity 0.3s ease';
        element.style.opacity = isShowing ? '1' : '0';
    }
    
    /**
     * Slide animation
     */
    static animateSlide(element, isShowing, direction) {
        element.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease';
        
        const slideDistance = '30px';
        let transform;
        
        if (isShowing) {
            // Slide in
            switch (direction) {
                case 'left': transform = 'translateX(0)'; break;
                case 'right': transform = 'translateX(0)'; break;
                case 'up': transform = 'translateY(0)'; break;
                case 'down': transform = 'translateY(0)'; break;
            }
            element.style.opacity = '1';
        } else {
            // Slide out
            switch (direction) {
                case 'left': transform = `translateX(-${slideDistance})`; break;
                case 'right': transform = `translateX(${slideDistance})`; break;
                case 'up': transform = `translateY(-${slideDistance})`; break;
                case 'down': transform = `translateY(${slideDistance})`; break;
            }
            element.style.opacity = '0';
        }
        
        element.style.transform = transform;
    }
    
    /**
     * Pop-up animation
     */
    static animatePopUp(element, isShowing, scale) {
        element.style.transition = 'transform 0.2s cubic-bezier(0.68, -0.55, 0.27, 1.55), opacity 0.2s ease';
        
        if (isShowing) {
            element.style.transform = 'scale(1)';
            element.style.opacity = '1';
        } else {
            element.style.transform = 'scale(0.8)';
            element.style.opacity = '0';
        }
    }
    
    /**
     * Bounce animation (entry only)
     */
    static animateBounce(element, isShowing) {
        if (isShowing) {
            element.style.animation = 'notification-bounce 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55)';
            element.style.opacity = '1';
        }
    }
    
    /**
     * Get current cursor position
     */
    static getCursorPosition() {
        return window.lastCursorPosition || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }
}

// Track cursor position globally
document.addEventListener('mousemove', (e) => {
    window.lastCursorPosition = { x: e.clientX, y: e.clientY };
});
```

**CSS animations** (add to `styles.css` or `notification.css`):

```css
@keyframes notification-bounce {
    0% {
        transform: scale(0) translateY(20px);
        opacity: 0;
    }
    50% {
        transform: scale(1.1) translateY(-5px);
    }
    70% {
        transform: scale(0.9) translateY(0);
    }
    100% {
        transform: scale(1) translateY(0);
        opacity: 1;
    }
}
```

### Step 4: Update Notification Trigger Points

**Location**: Wherever notifications are triggered (content.js, quick-tabs.js, etc.)

**Before**:
```javascript
// Generic notification
showNotification('Quick Tab Opened');
showNotification('URL Copied');
```

**After**:
```javascript
// Specific notification with config
showNotification('Quick Tab Opened', NOTIFICATION_CONFIGS.quickTabOpened);
showNotification('URL Copied', NOTIFICATION_CONFIGS.urlCopied);
```

**Updated `showNotification()` function**:
```javascript
/**
 * Show notification with custom configuration
 * @param {string} message - Notification message
 * @param {Object} config - Notification configuration
 */
function showNotification(message, config) {
    if (!config.enabled) return;
    
    const notification = document.createElement('div');
    notification.className = 'copy-url-notification';
    notification.textContent = message;
    
    // Set initial state (invisible)
    notification.style.opacity = '0';
    
    document.body.appendChild(notification);
    
    // Animate in
    NotificationAnimator.show(notification, config);
}
```

---

## Bug #3: Color Picker Issue in Appearance Tab

### Description
The colored box next to the hexadecimal input in the Appearance tab, when clicked, opens the browser's native color picker. However, this closes the extension popup menu, making it impossible to save the color selection since the extension menu is no longer open.

### Root Cause
Browser native `<input type="color">` opens a system dialog that causes the extension popup to lose focus and close (standard browser behavior for popups).

### Solution Options

#### Option A: Custom In-Popup Color Picker (Recommended)

Replace the native color input with a custom color picker that stays within the extension popup.

**Libraries to consider**:
- [Pickr](https://github.com/Simonwep/pickr) - Lightweight, no dependencies
- [vanilla-picker](https://github.com/Sphinxxxx/vanilla-picker) - Pure JavaScript
- Custom implementation

**Implementation with Pickr**:

1. **Install Pickr**:
```bash
npm install @simonwep/pickr
```

2. **Update popup.html**:
```html
<!-- Replace native color input -->
<div class="color-picker-container">
    <input type="text" 
           id="notification-color-hex" 
           class="color-hex-input" 
           value="#76FF03"
           pattern="^#[0-9A-Fa-f]{6}$"
           maxlength="7">
    <button type="button" class="color-picker-trigger" id="color-picker-btn">
        <span class="color-swatch" style="background-color: #76FF03;"></span>
    </button>
    <div class="color-picker-popup" id="color-picker-popup"></div>
</div>
```

3. **Update popup.js**:
```javascript
import Pickr from '@simonwep/pickr';
import '@simonwep/pickr/dist/themes/nano.min.css'; // Or your preferred theme

class ColorPickerManager {
    constructor() {
        this.pickers = new Map();
        this.initializeColorPickers();
    }
    
    initializeColorPickers() {
        const colorInputs = document.querySelectorAll('.color-hex-input');
        
        colorInputs.forEach(input => {
            const button = input.nextElementSibling;
            const container = input.parentElement.querySelector('.color-picker-popup');
            
            const pickr = Pickr.create({
                el: button,
                container: container,
                theme: 'nano',
                default: input.value,
                swatches: [
                    '#FF5722', '#E91E63', '#9C27B0', '#673AB7',
                    '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4',
                    '#009688', '#4CAF50', '#8BC34A', '#CDDC39',
                    '#FFEB3B', '#FFC107', '#FF9800', '#FF5722'
                ],
                components: {
                    preview: true,
                    opacity: false,
                    hue: true,
                    interaction: {
                        hex: true,
                        rgba: false,
                        hsla: false,
                        hsva: false,
                        cmyk: false,
                        input: true,
                        clear: false,
                        save: true
                    }
                }
            });
            
            // Update input when color changes
            pickr.on('save', (color) => {
                const hexColor = color.toHEXA().toString();
                input.value = hexColor;
                button.querySelector('.color-swatch').style.backgroundColor = hexColor;
                
                // Save to storage
                this.saveColorSetting(input.id, hexColor);
                
                pickr.hide();
            });
            
            // Update picker when input changes manually
            input.addEventListener('change', () => {
                const color = input.value;
                if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
                    pickr.setColor(color);
                    button.querySelector('.color-swatch').style.backgroundColor = color;
                    this.saveColorSetting(input.id, color);
                }
            });
            
            this.pickers.set(input.id, pickr);
        });
    }
    
    async saveColorSetting(settingId, color) {
        const setting = {};
        setting[settingId] = color;
        await browser.storage.sync.set(setting);
    }
}

// Initialize when popup loads
document.addEventListener('DOMContentLoaded', () => {
    new ColorPickerManager();
});
```

#### Option B: Keep Native Input + Side Panel

Use Firefox's sidebar API or a dedicated settings page instead of popup, where the color picker won't cause closure.

**manifest.json changes**:
```json
{
    "sidebar_action": {
        "default_panel": "popup.html",
        "default_title": "Copy URL Settings"
    },
    "browser_action": {
        "default_popup": "popup.html",
        "default_title": "Copy URL on Hover"
    }
}
```

Users can choose to open settings in sidebar (persists) or popup (quick access).

#### Option C: Hexadecimal-Only Input (Simplest)

Remove the color picker button entirely and rely only on the text input for hexadecimal values.

**Benefits**:
- No popup closure issues
- Lightweight (no extra libraries)
- Direct control

**Enhancement**: Add color preview swatch that updates as user types

```html
<div class="hex-color-input-group">
    <input type="text" 
           id="notification-color" 
           class="hex-input" 
           value="#76FF03"
           pattern="^#[0-9A-Fa-f]{6}$"
           maxlength="7"
           placeholder="#RRGGBB">
    <span class="color-preview" 
          style="background-color: #76FF03;"
          title="Color preview"></span>
</div>
```

```javascript
// Real-time preview update
document.getElementById('notification-color').addEventListener('input', function(e) {
    const hex = e.target.value;
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        e.target.nextElementSibling.style.backgroundColor = hex;
    }
});
```

---

## Feature #3: Dynamic Quick Tab Shortcut Display in Manager

### Description
The Quick Tabs Manager displays "Press Q while hovering over a link" even when the user has changed the Quick Tab shortcut from the default `Q` key. The message should dynamically reflect the user's configured shortcut.

### Implementation

**File**: `src/ui/quick-tabs-manager.js` or wherever the manager UI is created

### Step 1: Get Current Shortcut from Settings

```javascript
/**
 * Get the user's configured Quick Tab shortcut
 * @returns {Promise<string>} Formatted shortcut string
 */
async function getQuickTabShortcut() {
    const settings = await browser.storage.sync.get('quickTabShortcut');
    const shortcut = settings.quickTabShortcut || { key: 'q', ctrl: false, alt: false, shift: false };
    
    return formatShortcutDisplay(shortcut);
}

/**
 * Format shortcut for display
 * @param {Object} shortcut - Shortcut configuration
 * @returns {string} Human-readable shortcut (e.g., "Ctrl+Q", "Alt+Shift+E")
 */
function formatShortcutDisplay(shortcut) {
    const parts = [];
    
    if (shortcut.ctrl) parts.push('Ctrl');
    if (shortcut.alt) parts.push('Alt');
    if (shortcut.shift) parts.push('Shift');
    parts.push(shortcut.key.toUpperCase());
    
    return parts.join('+');
}
```

### Step 2: Update Manager Empty State Message

**Location**: Function that creates the "no Quick Tabs" message

**Before**:
```javascript
function createEmptyStateMessage() {
    const message = document.createElement('div');
    message.className = 'quick-tabs-empty-state';
    message.textContent = 'No Quick Tabs open. Press Q while hovering over a link to create one.';
    return message;
}
```

**After**:
```javascript
async function createEmptyStateMessage() {
    const message = document.createElement('div');
    message.className = 'quick-tabs-empty-state';
    
    const shortcut = await getQuickTabShortcut();
    message.textContent = `No Quick Tabs open. Press ${shortcut} while hovering over a link to create one.`;
    
    return message;
}
```

### Step 3: Update Message When Shortcut Changes

Listen for shortcut configuration changes and update the manager message in real-time.

```javascript
// Listen for settings changes
browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.quickTabShortcut) {
        updateQuickTabManagerShortcutDisplay();
    }
});

/**
 * Update the shortcut display in the Quick Tabs Manager
 */
async function updateQuickTabManagerShortcutDisplay() {
    const emptyState = document.querySelector('.quick-tabs-empty-state');
    if (emptyState) {
        const shortcut = await getQuickTabShortcut();
        emptyState.textContent = `No Quick Tabs open. Press ${shortcut} while hovering over a link to create one.`;
    }
}
```

### Step 4: Add to Manager Initialization

```javascript
class QuickTabsManager {
    async initialize() {
        // ... existing initialization code ...
        
        // Update empty state message with current shortcut
        await this.updateEmptyStateMessage();
        
        // Listen for shortcut changes
        browser.storage.onChanged.addListener(this.handleShortcutChange.bind(this));
    }
    
    async updateEmptyStateMessage() {
        const emptyState = this.container.querySelector('.quick-tabs-empty-state');
        if (emptyState) {
            const shortcut = await getQuickTabShortcut();
            emptyState.textContent = `No Quick Tabs open. Press ${shortcut} while hovering over a link to create one.`;
        }
    }
    
    handleShortcutChange(changes, areaName) {
        if (areaName === 'sync' && changes.quickTabShortcut) {
            this.updateEmptyStateMessage();
        }
    }
}
```

---

## Testing Checklist

### Bug #1: Quick Tab Flash
- [ ] Open Quick Tab with default shortcut (Q or custom)
- [ ] Verify NO flash appears in top-left corner
- [ ] Quick Tab appears smoothly at tooltip/cursor position
- [ ] Test on multiple websites (YouTube, Reddit, GitHub, Twitter)
- [ ] Test with different screen resolutions

### Feature #2: Notification Configurations
- [ ] Open extension settings → Appearance tab
- [ ] Verify separate notification settings for Quick Tab and URL Copy
- [ ] Configure Quick Tab notification: Top-right + Slide animation
- [ ] Configure URL Copy notification: Tooltip position + Pop-up animation
- [ ] Test Quick Tab notification appears in top-right with slide
- [ ] Test URL Copy notification appears at cursor with pop-up
- [ ] Verify all animation types work (fade, slide, pop-up, bounce)
- [ ] Test notification duration setting (500ms to 10000ms)
- [ ] Disable notifications and verify they don't appear

### Bug #3: Color Picker
- [ ] Open extension popup → Appearance tab
- [ ] Click color picker box/button
- [ ] Verify color picker opens WITHOUT closing extension popup
- [ ] Select a color
- [ ] Verify color updates in real-time
- [ ] Save settings
- [ ] Reopen extension and verify color persisted
- [ ] Manually type hexadecimal value
- [ ] Verify color swatch updates to match typed value

### Feature #3: Dynamic Shortcut Display
- [ ] Open Quick Tabs Manager with no tabs
- [ ] Verify message shows default shortcut "Press Q..."
- [ ] Change Quick Tab shortcut in settings (e.g., to Ctrl+E)
- [ ] Reopen/refresh Quick Tabs Manager
- [ ] Verify message updates to "Press Ctrl+E..."
- [ ] Test with various shortcut combinations (Alt+Q, Shift+T, Ctrl+Alt+Z)

---

## Documentation Updates Required

### README.md
Add section explaining:
- Customizable notifications per action type
- Color picker usage in settings
- Dynamic shortcut displays

### CHANGELOG.md
```markdown
## v1.5.8.17 - [Date]

### Fixed
- Quick Tab no longer flashes in top-left corner before positioning
- Color picker in Appearance tab now works without closing extension popup

### Added
- Separate notification configurations for Quick Tab opened vs URL copied
- Animation options: fade, slide, pop-up, bounce
- Position options for notifications (corners or at cursor/tooltip)
- Dynamic Quick Tab shortcut display in manager empty state

### Changed
- Improved Quick Tab creation performance
- Enhanced settings UI with per-action notification controls
```

---

## Implementation Priority

1. **High Priority** (User Experience Impact):
   - Bug #1: Quick Tab flash fix (most visible)
   - Bug #3: Color picker fix (blocks functionality)

2. **Medium Priority** (Feature Enhancement):
   - Feature #2: Notification configurations (nice-to-have customization)
   - Feature #3: Dynamic shortcut display (minor UX improvement)

---

## Browser Compatibility Notes

### Firefox
- Native `<input type="color">` causes popup closure (confirmed)
- Pickr library works perfectly in popup context
- Sidebar API available as alternative

### Chrome/Edge
- Similar popup closure behavior
- Pickr library compatible
- Side panel API available (Manifest V3)

### Recommendations
- Use Pickr (Option A) for best cross-browser compatibility
- Fallback to hex-only input if Pickr fails to load

---

## Related Files Reference

Based on repository structure analysis:

```
src/
├── content.js              # Quick Tab creation, notification triggers
├── core/
│   ├── config.js           # Settings schema
│   └── notifications.js    # Notification system
├── ui/
│   ├── quick-tabs-manager.js  # Manager UI, empty state message
│   └── notification-animations.js  # NEW: Animation system
├── popup.html             # Settings UI
├── popup.js               # Settings logic, color picker integration
└── styles/
    ├── notifications.css  # Notification styles
    └── popup.css          # Popup styles
```

---

## Additional Considerations

### Performance
- Use `requestAnimationFrame` for smooth animations
- Debounce color input validation
- Cache shortcut display string

### Accessibility
- Add ARIA labels to color picker
- Ensure keyboard navigation for color selection
- Provide visual feedback for notification animations
- Support prefers-reduced-motion for users with motion sensitivities

### Mobile/Touch
- Consider touch-friendly color picker interface
- Test notification positioning on mobile Firefox
- Adjust animation timings for mobile performance

---

## References

- [MDN: `<input type="color">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/color)
- [Pickr Documentation](https://github.com/Simonwep/pickr)
- [Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API)
- [Firefox Extension Popup Best Practices](https://extensionworkshop.com/documentation/develop/user-interface-components/)

---

*Document Version: 1.0*  
*Last Updated: 2025-11-14*  
*Target Repository Version: v1.5.8.16+*
