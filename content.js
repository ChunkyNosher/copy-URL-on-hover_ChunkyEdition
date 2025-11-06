// Default configuration
const DEFAULT_CONFIG = {
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
  notifPosition: 'bottom-right',
  notifSize: 'medium',
  debugMode: false,
  darkMode: true
};

let CONFIG = { ...DEFAULT_CONFIG };
let currentHoveredLink = null;

// Load settings from storage
function loadSettings() {
  browser.storage.local.get(DEFAULT_CONFIG, function(items) {
    CONFIG = items;
    debug('Settings loaded from storage');
  });
}

// Log helper for debugging
function debug(msg) {
  if (CONFIG.debugMode) {
    console.log('[CopyURLHover]', msg);
  }
}

// Track mouseover on links
document.addEventListener('mouseover', function(event) {
  let target = event.target;
  let link = null;
  
  if (target.tagName === 'A') {
    link = target;
  } else {
    link = target.closest('a');
  }
  
  if (link && link.href) {
    currentHoveredLink = link;
    debug('Link hovered: ' + link.href);
  }
}, true);

// Track mouseout
document.addEventListener('mouseout', function(event) {
  if (currentHoveredLink) {
    currentHoveredLink = null;
    debug('Link unhovered');
  }
}, true);

// Show notification
function showNotification(message) {
  if (!CONFIG.showNotification) return;
  
  try {
    const notif = document.createElement('div');
    notif.textContent = message;
    
    // Determine position styles based on notifPosition setting
    let positionStyles = '';
    let animationName = 'slideIn';
    
    switch(CONFIG.notifPosition) {
      case 'top-left':
        positionStyles = 'top: 20px; left: 20px;';
        animationName = 'slideInLeft';
        break;
      case 'top-right':
        positionStyles = 'top: 20px; right: 20px;';
        animationName = 'slideInRight';
        break;
      case 'top-center':
        positionStyles = 'top: 20px; left: 50%; transform: translateX(-50%);';
        animationName = 'slideInTop';
        break;
      case 'bottom-left':
        positionStyles = 'bottom: 20px; left: 20px;';
        animationName = 'slideInLeft';
        break;
      case 'bottom-right':
        positionStyles = 'bottom: 20px; right: 20px;';
        animationName = 'slideInRight';
        break;
      case 'bottom-center':
        positionStyles = 'bottom: 20px; left: 50%; transform: translateX(-50%);';
        animationName = 'slideInBottom';
        break;
      default:
        positionStyles = 'bottom: 20px; right: 20px;';
        animationName = 'slideInRight';
    }
    
    // Determine size styles based on notifSize setting
    let sizeStyles = '';
    switch(CONFIG.notifSize) {
      case 'small':
        sizeStyles = 'padding: 8px 14px; font-size: 12px;';
        break;
      case 'medium':
        sizeStyles = 'padding: 12px 20px; font-size: 14px;';
        break;
      case 'large':
        sizeStyles = 'padding: 16px 26px; font-size: 16px;';
        break;
      default:
        sizeStyles = 'padding: 12px 20px; font-size: 14px;';
    }
    
    notif.style.cssText = `
      position: fixed;
      ${positionStyles}
      background: ${CONFIG.notifColor};
      color: #fff;
      ${sizeStyles}
      border-radius: 6px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      animation: ${animationName} 0.3s ease-out;
    `;
    
    // Add animation styles
    if (!document.querySelector('style[data-copy-url]')) {
      const style = document.createElement('style');
      style.setAttribute('data-copy-url', 'true');
      style.textContent = `
        @keyframes slideInRight {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideInLeft {
          from {
            transform: translateX(-400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideInTop {
          from {
            transform: translate(-50%, -100px);
            opacity: 0;
          }
          to {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }
        @keyframes slideInBottom {
          from {
            transform: translate(-50%, 100px);
            opacity: 0;
          }
          to {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.documentElement.appendChild(notif);
    
    setTimeout(() => {
      notif.remove();
    }, CONFIG.notifDuration);
  } catch (e) {
    debug('Notification error: ' + e.message);
  }
}

// Check if the correct modifiers are pressed
function checkModifiers(requireCtrl, requireAlt, requireShift, event) {
  const ctrlPressed = event.ctrlKey || event.metaKey;
  const altPressed = event.altKey;
  const shiftPressed = event.shiftKey;
  
  if (requireCtrl !== ctrlPressed) return false;
  if (requireAlt !== altPressed) return false;
  if (requireShift !== shiftPressed) return false;
  
  return true;
}

// Handle keyboard shortcuts
document.addEventListener('keydown', function(event) {
  if (!currentHoveredLink) return;
  
  if (event.target.tagName === 'INPUT' || 
      event.target.tagName === 'TEXTAREA' || 
      event.target.contentEditable === 'true') {
    return;
  }
  
  const key = event.key.toLowerCase();
  debug('Key pressed: ' + key + ', Ctrl: ' + event.ctrlKey + ', Alt: ' + event.altKey + ', Shift: ' + event.shiftKey);
  
  if (key === CONFIG.copyUrlKey.toLowerCase() && 
      checkModifiers(CONFIG.copyUrlCtrl, CONFIG.copyUrlAlt, CONFIG.copyUrlShift, event)) {
    event.preventDefault();
    event.stopPropagation();
    
    const url = currentHoveredLink.href;
    debug('Copying URL: ' + url);
    
    navigator.clipboard.writeText(url).then(() => {
      debug('URL copied successfully');
      showNotification('✓ URL copied!');
    }).catch(err => {
      debug('Failed to copy: ' + err);
      showNotification('✗ Copy failed');
    });
  }
  
  else if (key === CONFIG.copyTextKey.toLowerCase() && 
           checkModifiers(CONFIG.copyTextCtrl, CONFIG.copyTextAlt, CONFIG.copyTextShift, event)) {
    event.preventDefault();
    event.stopPropagation();
    
    const text = currentHoveredLink.textContent.trim();
    debug('Copying text: ' + text);
    
    navigator.clipboard.writeText(text).then(() => {
      debug('Text copied successfully');
      showNotification('✓ Text copied!');
    }).catch(err => {
      debug('Failed to copy: ' + err);
      showNotification('✗ Copy failed');
    });
  }
}, true);

// Reload settings when storage changes
browser.storage.onChanged.addListener(function(changes, areaName) {
  if (areaName === 'local') {
    loadSettings();
    debug('Settings updated from storage');
  }
});

// Load settings when content script starts
loadSettings();

debug('Extension loaded and initialized');