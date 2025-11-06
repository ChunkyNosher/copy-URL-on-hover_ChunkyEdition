const DEFAULT_SETTINGS = {
  copyUrlKey: 'y',
  copyUrlCtrl: false,
  copyUrlAlt: false,
  copyUrlShift: false,
  
  copyTextKey: 'x',
  copyTextCtrl: false,
  copyTextAlt: false,
  copyTextShift: false,
  
  showNotification: true,
  notifColor: '#4CAF50',
  notifDuration: 2000,
  debugMode: false,
  darkMode: true
};

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
    
    document.getElementById('showNotification').checked = items.showNotification;
    document.getElementById('notifColor').value = items.notifColor;
    document.getElementById('notifDuration').value = items.notifDuration;
    document.getElementById('debugMode').checked = items.debugMode;
    document.getElementById('darkMode').checked = items.darkMode;
    
    applyTheme(items.darkMode);
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
    
    showNotification: document.getElementById('showNotification').checked,
    notifColor: document.getElementById('notifColor').value || '#4CAF50',
    notifDuration: parseInt(document.getElementById('notifDuration').value) || 2000,
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

// Load settings on popup open
loadSettings();