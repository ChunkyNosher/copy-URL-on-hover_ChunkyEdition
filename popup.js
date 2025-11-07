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
  
  // Quick Tab on Hover settings
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
  quickTabPersistAcrossTabs: false,
  quickTabCloseOnOpen: false,
  
  showNotification: true,
  notifColor: '#4CAF50',
  notifDuration: 2000,
  notifPosition: 'bottom-right',
  notifSize: 'medium',
  notifBorderColor: '#000000',
  notifBorderWidth: 1,
  notifAnimation: 'slide',
  debugMode: false,
  darkMode: true
};

// Helper function to safely parse integer with fallback
function safeParseInt(value, fallback) {
  const parsed = parseInt(value);
  return isNaN(parsed) ? fallback : parsed;
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
    
    // Quick Tab on Hover settings
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
    document.getElementById('quickTabPersistAcrossTabs').checked = items.quickTabPersistAcrossTabs;
    document.getElementById('quickTabCloseOnOpen').checked = items.quickTabCloseOnOpen;
    
    document.getElementById('showNotification').checked = items.showNotification;
    document.getElementById('notifColor').value = items.notifColor;
    document.getElementById('notifDuration').value = items.notifDuration;
    document.getElementById('notifPosition').value = items.notifPosition;
    document.getElementById('notifSize').value = items.notifSize;
    document.getElementById('notifBorderColor').value = items.notifBorderColor;
    document.getElementById('notifBorderWidth').value = items.notifBorderWidth;
    document.getElementById('notifAnimation').value = items.notifAnimation;
    document.getElementById('debugMode').checked = items.debugMode;
    document.getElementById('darkMode').checked = items.darkMode;
    
    applyTheme(items.darkMode);
    toggleCustomPosition(items.quickTabPosition);
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
    
    // Quick Tab on Hover settings
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
    quickTabPersistAcrossTabs: document.getElementById('quickTabPersistAcrossTabs').checked,
    quickTabCloseOnOpen: document.getElementById('quickTabCloseOnOpen').checked,
    
    showNotification: document.getElementById('showNotification').checked,
    notifColor: document.getElementById('notifColor').value || '#4CAF50',
    notifDuration: safeParseInt(document.getElementById('notifDuration').value, 2000),
    notifPosition: document.getElementById('notifPosition').value || 'bottom-right',
    notifSize: document.getElementById('notifSize').value || 'medium',
    notifBorderColor: document.getElementById('notifBorderColor').value || '#000000',
    notifBorderWidth: safeParseInt(document.getElementById('notifBorderWidth').value, 1),
    notifAnimation: document.getElementById('notifAnimation').value || 'slide',
    debugMode: document.getElementById('debugMode').checked,
    darkMode: document.getElementById('darkMode').checked
  };
  
  browser.storage.local.set(settings, function() {
    showStatus('✓ Settings saved! Reload tabs to apply changes.');
    applyTheme(settings.darkMode);
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

// Dark mode toggle
document.getElementById('darkMode').addEventListener('change', function() {
  applyTheme(this.checked);
});

// Tab switching logic
document.addEventListener('DOMContentLoaded', function() {
  // Quick Tab position change handler
  const positionSelect = document.getElementById('quickTabPosition');
  if (positionSelect) {
    positionSelect.addEventListener('change', function() {
      toggleCustomPosition(this.value);
    });
  }
  
  // Settings tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs and contents
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Show corresponding content
      const tabName = tab.dataset.tab;
      const content = document.getElementById(tabName + '-content');
      if (content) {
        content.classList.add('active');
      }
    });
  });
  
  // Load version from manifest
  const manifest = browser.runtime.getManifest();
  const footerElement = document.getElementById('footerVersion');
  if (footerElement) {
    footerElement.textContent = `Copy URL on Hover v${manifest.version}`;
  }
});

// Load settings on popup open
loadSettings();