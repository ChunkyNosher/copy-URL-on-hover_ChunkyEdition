// Browser API compatibility shim for Firefox/Chrome cross-compatibility
if (typeof browser === 'undefined') {
  var browser = chrome;
}

const DEFAULT_SETTINGS = {
  copyUrlKey: 'y',
  copyUrlCtrl: false,
  copyUrlAlt: false,
  copyUrlShift: false,
  
  copyTextKey: 'x',
  copyTextCtrl: false,
  copyTextAlt: false,
  copyTextShift: false,
  
  // Open Link in New Tab settings
  openNewTabKey: 'o',
  openNewTabCtrl: false,
  openNewTabAlt: false,
  openNewTabShift: false,
  openNewTabSwitchFocus: false,
  
  // Quick Tab settings
  quickTabKey: 'q',
  quickTabCtrl: false,
  quickTabAlt: false,
  quickTabShift: false,
  quickTabCloseKey: 'Escape',
  quickTabMaxWindows: 3,
  quickTabDefaultWidth: 800,
  quickTabDefaultHeight: 600,
  quickTabPosition: 'follow-cursor',
  quickTabCustomX: 100,
  quickTabCustomY: 100,
  quickTabCloseOnOpen: false,
  quickTabEnableResize: true,
  quickTabUpdateRate: 360, // Position updates per second (Hz) for dragging
  
  showNotification: true,
  notifDisplayMode: 'tooltip',
  
  // Tooltip settings
  tooltipColor: '#4CAF50',
  tooltipDuration: 1500,
  tooltipAnimation: 'fade',
  
  // Notification settings
  notifColor: '#4CAF50',
  notifDuration: 2000,
  notifPosition: 'bottom-right',
  notifSize: 'medium',
  notifBorderColor: '#000000',
  notifBorderWidth: 1,
  notifAnimation: 'slide',
  
  debugMode: false,
  darkMode: true,
  menuSize: 'medium'
};

// Helper function to safely parse integer with fallback
function safeParseInt(value, fallback) {
  const parsed = parseInt(value);
  return isNaN(parsed) ? fallback : parsed;
}

// Helper function to validate and normalize hex color
function validateHexColor(color, fallback = DEFAULT_SETTINGS.tooltipColor) {
  if (!color) return fallback;
  // Remove whitespace
  color = color.trim();
  // Add # if missing
  if (!color.startsWith('#')) {
    color = '#' + color;
  }
  // Validate hex format (6-character format only)
  if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return color.toUpperCase();
  }
  return fallback;
}

// Color input to settings mapping
const COLOR_INPUTS = [
  { textId: 'tooltipColor', pickerId: 'tooltipColorPicker', settingKey: 'tooltipColor' },
  { textId: 'notifColor', pickerId: 'notifColorPicker', settingKey: 'notifColor' },
  { textId: 'notifBorderColor', pickerId: 'notifBorderColorPicker', settingKey: 'notifBorderColor' }
];

// Update color preview box (deprecated - now using native color input)
function updateColorPreview(inputId, previewId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (input && preview) {
    const settingKey = COLOR_DEFAULTS[inputId];
    const defaultColor = settingKey ? DEFAULT_SETTINGS[settingKey] : DEFAULT_SETTINGS.tooltipColor;
    const color = validateHexColor(input.value, defaultColor);
    input.value = color;
    preview.style.backgroundColor = color;
  }
}

// Sync text input with color picker
function syncColorInputs(textInput, colorPicker) {
  if (!textInput || !colorPicker) return;
  
  const color = validateHexColor(textInput.value);
  textInput.value = color;
  colorPicker.value = color;
}

// Load settings
function loadSettings() {
  browser.storage.local.get(DEFAULT_SETTINGS, function(items) {
    document.getElementById('copyUrlKey').value = items.copyUrlKey;
    document.getElementById('copyUrlCtrl').checked = items.copyUrlCtrl;
    document.getElementById('copyUrlAlt').checked = items.copyUrlAlt;
    document.getElementById('copyUrlShift').checked = items.copyUrlShift;
    
    document.getElementById('copyTextKey').value = items.copyTextKey;
    document.getElementById('copyTextCtrl').checked = items.copyTextCtrl;
    document.getElementById('copyTextAlt').checked = items.copyTextAlt;
    document.getElementById('copyTextShift').checked = items.copyTextShift;
    
    // Open Link in New Tab settings
    document.getElementById('openNewTabKey').value = items.openNewTabKey;
    document.getElementById('openNewTabCtrl').checked = items.openNewTabCtrl;
    document.getElementById('openNewTabAlt').checked = items.openNewTabAlt;
    document.getElementById('openNewTabShift').checked = items.openNewTabShift;
    document.getElementById('openNewTabSwitchFocus').checked = items.openNewTabSwitchFocus;
    
    // Quick Tab settings
    document.getElementById('quickTabKey').value = items.quickTabKey;
    document.getElementById('quickTabCtrl').checked = items.quickTabCtrl;
    document.getElementById('quickTabAlt').checked = items.quickTabAlt;
    document.getElementById('quickTabShift').checked = items.quickTabShift;
    document.getElementById('quickTabCloseKey').value = items.quickTabCloseKey;
    document.getElementById('quickTabMaxWindows').value = items.quickTabMaxWindows;
    document.getElementById('quickTabDefaultWidth').value = items.quickTabDefaultWidth;
    document.getElementById('quickTabDefaultHeight').value = items.quickTabDefaultHeight;
    document.getElementById('quickTabPosition').value = items.quickTabPosition;
    document.getElementById('quickTabCustomX').value = items.quickTabCustomX;
    document.getElementById('quickTabCustomY').value = items.quickTabCustomY;
    document.getElementById('quickTabCloseOnOpen').checked = items.quickTabCloseOnOpen;
    document.getElementById('quickTabEnableResize').checked = items.quickTabEnableResize;
    document.getElementById('quickTabUpdateRate').value = items.quickTabUpdateRate || 360;
    toggleCustomPosition(items.quickTabPosition);
    
    document.getElementById('showNotification').checked = items.showNotification;
    document.getElementById('notifDisplayMode').value = items.notifDisplayMode;
    
    // Tooltip settings
    document.getElementById('tooltipColor').value = items.tooltipColor;
    document.getElementById('tooltipColorPicker').value = items.tooltipColor;
    document.getElementById('tooltipDuration').value = items.tooltipDuration;
    document.getElementById('tooltipAnimation').value = items.tooltipAnimation;
    
    // Notification settings
    document.getElementById('notifColor').value = items.notifColor;
    document.getElementById('notifColorPicker').value = items.notifColor;
    document.getElementById('notifDuration').value = items.notifDuration;
    document.getElementById('notifPosition').value = items.notifPosition;
    document.getElementById('notifSize').value = items.notifSize;
    document.getElementById('notifBorderColor').value = items.notifBorderColor;
    document.getElementById('notifBorderColorPicker').value = items.notifBorderColor;
    document.getElementById('notifBorderWidth').value = items.notifBorderWidth;
    document.getElementById('notifAnimation').value = items.notifAnimation;
    
    document.getElementById('debugMode').checked = items.debugMode;
    document.getElementById('darkMode').checked = items.darkMode;
    document.getElementById('menuSize').value = items.menuSize || 'medium';
    
    applyTheme(items.darkMode);
    applyMenuSize(items.menuSize || 'medium');
  });
}

// Apply theme
function applyTheme(isDark) {
  if (isDark) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

// Apply menu size
function applyMenuSize(size) {
  document.body.classList.remove('menu-small', 'menu-large');
  if (size === 'small') {
    document.body.classList.add('menu-small');
  } else if (size === 'large') {
    document.body.classList.add('menu-large');
  }
}

// Toggle custom position fields visibility
function toggleCustomPosition(position) {
  const customFields = document.getElementById('customPositionFields');
  if (customFields) {
    customFields.style.display = position === 'custom' ? 'block' : 'none';
  }
}

// Show status message
function showStatus(message, isSuccess = true) {
  const statusMsg = document.getElementById('statusMsg');
  statusMsg.textContent = message;
  statusMsg.className = isSuccess ? 'status-msg success' : 'status-msg error';
  
  setTimeout(() => {
    statusMsg.className = 'status-msg';
  }, 3000);
}

// Save settings
document.getElementById('saveBtn').addEventListener('click', function() {
  const settings = {
    copyUrlKey: document.getElementById('copyUrlKey').value || 'y',
    copyUrlCtrl: document.getElementById('copyUrlCtrl').checked,
    copyUrlAlt: document.getElementById('copyUrlAlt').checked,
    copyUrlShift: document.getElementById('copyUrlShift').checked,
    
    copyTextKey: document.getElementById('copyTextKey').value || 'x',
    copyTextCtrl: document.getElementById('copyTextCtrl').checked,
    copyTextAlt: document.getElementById('copyTextAlt').checked,
    copyTextShift: document.getElementById('copyTextShift').checked,
    
    // Open Link in New Tab settings
    openNewTabKey: document.getElementById('openNewTabKey').value || 'o',
    openNewTabCtrl: document.getElementById('openNewTabCtrl').checked,
    openNewTabAlt: document.getElementById('openNewTabAlt').checked,
    openNewTabShift: document.getElementById('openNewTabShift').checked,
    openNewTabSwitchFocus: document.getElementById('openNewTabSwitchFocus').checked,
    
    // Quick Tab settings
    quickTabKey: document.getElementById('quickTabKey').value || 'q',
    quickTabCtrl: document.getElementById('quickTabCtrl').checked,
    quickTabAlt: document.getElementById('quickTabAlt').checked,
    quickTabShift: document.getElementById('quickTabShift').checked,
    quickTabCloseKey: document.getElementById('quickTabCloseKey').value || 'Escape',
    quickTabMaxWindows: safeParseInt(document.getElementById('quickTabMaxWindows').value, 3),
    quickTabDefaultWidth: safeParseInt(document.getElementById('quickTabDefaultWidth').value, 800),
    quickTabDefaultHeight: safeParseInt(document.getElementById('quickTabDefaultHeight').value, 600),
    quickTabPosition: document.getElementById('quickTabPosition').value || 'follow-cursor',
    quickTabCustomX: safeParseInt(document.getElementById('quickTabCustomX').value, 100),
    quickTabCustomY: safeParseInt(document.getElementById('quickTabCustomY').value, 100),
    quickTabCloseOnOpen: document.getElementById('quickTabCloseOnOpen').checked,
    quickTabEnableResize: document.getElementById('quickTabEnableResize').checked,
    quickTabUpdateRate: safeParseInt(document.getElementById('quickTabUpdateRate').value, 360),
    
    showNotification: document.getElementById('showNotification').checked,
    notifDisplayMode: document.getElementById('notifDisplayMode').value || 'tooltip',
    
    // Tooltip settings
    tooltipColor: validateHexColor(document.getElementById('tooltipColor').value, DEFAULT_SETTINGS.tooltipColor),
    tooltipDuration: safeParseInt(document.getElementById('tooltipDuration').value, 1500),
    tooltipAnimation: document.getElementById('tooltipAnimation').value || 'fade',
    
    // Notification settings
    notifColor: validateHexColor(document.getElementById('notifColor').value, DEFAULT_SETTINGS.notifColor),
    notifDuration: safeParseInt(document.getElementById('notifDuration').value, 2000),
    notifPosition: document.getElementById('notifPosition').value || 'bottom-right',
    notifSize: document.getElementById('notifSize').value || 'medium',
    notifBorderColor: validateHexColor(document.getElementById('notifBorderColor').value, DEFAULT_SETTINGS.notifBorderColor),
    notifBorderWidth: safeParseInt(document.getElementById('notifBorderWidth').value, 1),
    notifAnimation: document.getElementById('notifAnimation').value || 'slide',
    
    debugMode: document.getElementById('debugMode').checked,
    darkMode: document.getElementById('darkMode').checked,
    menuSize: document.getElementById('menuSize').value || 'medium'
  };
  
  browser.storage.local.set(settings, function() {
    showStatus('✓ Settings saved! Reload tabs to apply changes.');
    applyTheme(settings.darkMode);
    applyMenuSize(settings.menuSize);
  });
});

// Reset to defaults
document.getElementById('resetBtn').addEventListener('click', function() {
  if (confirm('Reset all settings to defaults?')) {
    browser.storage.local.set(DEFAULT_SETTINGS, function() {
      loadSettings();
      showStatus('✓ Settings reset to defaults!');
    });
  }
});

// Clear Quick Tab storage button
document.getElementById('clearStorageBtn').addEventListener('click', async function() {
  if (confirm('This will clear Quick Tab positions and state. Your settings and keybinds will be preserved. Are you sure?')) {
    try {
      // Only clear Quick Tab state, preserve all settings
      await browser.storage.sync.remove('quick_tabs_state_v2');
      
      // Clear session storage if available
      if (typeof browser.storage.session !== 'undefined') {
        await browser.storage.session.remove('quick_tabs_session');
      }
      
      showStatus('✓ Quick Tab storage cleared! Settings preserved.');
      
      // Notify all tabs to close their Quick Tabs
      browser.tabs.query({}).then(tabs => {
        tabs.forEach(tab => {
          browser.tabs.sendMessage(tab.id, {
            action: 'CLEAR_ALL_QUICK_TABS'
          }).catch(() => {
            // Content script might not be loaded in this tab
          });
        });
      });
      
    } catch (err) {
      showStatus('✗ Error clearing storage: ' + err.message);
      console.error('Error clearing Quick Tab storage:', err);
    }
  }
});

// Dark mode toggle
document.getElementById('darkMode').addEventListener('change', function() {
  applyTheme(this.checked);
});

// Menu size change
document.getElementById('menuSize').addEventListener('change', function() {
  applyMenuSize(this.value);
});

// Quick Tab position change
document.getElementById('quickTabPosition').addEventListener('change', function() {
  toggleCustomPosition(this.value);
});

// Tab switching logic
document.addEventListener('DOMContentLoaded', function() {
  // Settings tab switching
  document.querySelectorAll('.tab-button').forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs and contents
      document.querySelectorAll('.tab-button').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Show corresponding content
      const tabName = tab.dataset.tab;
      const content = document.getElementById(tabName);
      if (content) {
        content.classList.add('active');
      }
    });
  });
  
  // Set footer version dynamically
  const manifest = browser.runtime.getManifest();
  const footerElement = document.getElementById('footerVersion');
  if (footerElement) {
    footerElement.textContent = `${manifest.name} v${manifest.version}`;
  }
  
  // Add color input event listeners to sync text and picker inputs
  COLOR_INPUTS.forEach(({ textId, pickerId }) => {
    const textInput = document.getElementById(textId);
    const pickerInput = document.getElementById(pickerId);
    
    if (textInput && pickerInput) {
      // When text input changes, update picker
      textInput.addEventListener('input', () => {
        const color = validateHexColor(textInput.value);
        textInput.value = color;
        pickerInput.value = color;
      });
      
      textInput.addEventListener('blur', () => {
        const color = validateHexColor(textInput.value);
        textInput.value = color;
        pickerInput.value = color;
      });
      
      // When picker changes, update text input
      pickerInput.addEventListener('input', () => {
        const color = pickerInput.value.toUpperCase();
        textInput.value = color;
      });
    }
  });
});

// Load settings on popup open
loadSettings();