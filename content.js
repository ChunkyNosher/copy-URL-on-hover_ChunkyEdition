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
  debugMode: false,
  darkMode: true
};

let CONFIG = { ...DEFAULT_CONFIG };
let currentHoveredLink = null;
let currentHoveredElement = null;

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

// Find the actual link URL from an element
function findLinkUrl(element) {
  // Direct href attribute
  if (element.href) {
    return element.href;
  }
  
  // Check parent elements for href
  let parent = element.parentElement;
  for (let i = 0; i < 10; i++) {
    if (!parent) break;
    if (parent.href) {
      return parent.href;
    }
    parent = parent.parentElement;
  }
  
  // Twitter/X specific: Look for links inside the element
  const link = element.querySelector('a[href]');
  if (link && link.href) {
    return link.href;
  }
  
  // Twitter/X: Check for article's associated link
  const article = element.closest('article');
  if (article) {
    const articleLink = article.querySelector('a[href*="twitter.com"], a[href*="x.com"]');
    if (articleLink && articleLink.href) {
      return articleLink.href;
    }
  }
  
  return null;
}

// Get link text
function getLinkText(element) {
  // Check if it's a direct link
  if (element.tagName === 'A') {
    return element.textContent.trim();
  }
  
  // Look for link inside
  const link = element.querySelector('a[href]');
  if (link) {
    return link.textContent.trim();
  }
  
  // Get general text content
  return element.textContent.trim().substring(0, 100);
}

// Enhanced hover detection for Twitter
document.addEventListener('mouseover', function(event) {
  let target = event.target;
  let element = null;
  
  // Direct link
  if (target.tagName === 'A' && target.href) {
    element = target;
  } else {
    // Check if it's a Twitter tweet container
    const article = target.closest('article');
    if (article) {
      element = article;
    } else {
      // Check for regular link parent
      element = target.closest('a[href]');
    }
  }
  
  if (element) {
    const url = findLinkUrl(element);
    if (url) {
      currentHoveredLink = element;
      currentHoveredElement = element;
      debug('Element hovered with URL: ' + url);
    }
  }
}, true);

// Track mouseout
document.addEventListener('mouseout', function(event) {
  currentHoveredLink = null;
  currentHoveredElement = null;
  debug('Element unhovered');
}, true);

// Show notification
function showNotification(message) {
  if (!CONFIG.showNotification) return;
  
  try {
    const notif = document.createElement('div');
    notif.textContent = message;
    notif.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: ${CONFIG.notifColor};
      color: #fff;
      padding: 12px 20px;
      border-radius: 6px;
      z-index: 999999;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      animation: slideIn 0.3s ease-out;
    `;
    
    // Add animation style
    if (!document.querySelector('style[data-copy-url]')) {
      const style = document.createElement('style');
      style.setAttribute('data-copy-url', 'true');
      style.textContent = `
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
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
  if (!currentHoveredLink && !currentHoveredElement) return;
  
  if (event.target.tagName === 'INPUT' || 
      event.target.tagName === 'TEXTAREA' || 
      event.target.contentEditable === 'true') {
    return;
  }
  
  const key = event.key.toLowerCase();
  const element = currentHoveredLink || currentHoveredElement;
  const url = findLinkUrl(element);
  
  debug('Key pressed: ' + key + ', Ctrl: ' + event.ctrlKey + ', Alt: ' + event.altKey + ', Shift: ' + event.shiftKey);
  debug('Element found, URL: ' + url);
  
  if (key === CONFIG.copyUrlKey.toLowerCase() && 
      checkModifiers(CONFIG.copyUrlCtrl, CONFIG.copyUrlAlt, CONFIG.copyUrlShift, event)) {
    event.preventDefault();
    event.stopPropagation();
    
    if (!url) {
      debug('No URL found on element');
      showNotification('✗ No URL found');
      return;
    }
    
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
    
    const text = getLinkText(element);
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
