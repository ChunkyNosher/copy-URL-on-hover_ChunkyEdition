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

// Common clickable elements that might contain URL data attributes
const CLICKABLE_ELEMENTS = ['DIV', 'SPAN', 'BUTTON'];

// Extract URL from element's data attributes
function extractUrlFromDataAttributes(element) {
  const dataAttributes = [
    'href',
    'data-href',
    'data-url',
    'data-link',
    'data-target-url'
  ];
  
  for (const attr of dataAttributes) {
    const value = element.getAttribute(attr);
    if (value && value.trim()) {
      const url = value.trim();
      // Security: Validate URL to prevent XSS attacks
      // Extract protocol if present
      const protocolMatch = url.match(/^([a-z][a-z0-9+.-]*):\/\//i);
      if (protocolMatch) {
        const protocol = protocolMatch[1].toLowerCase();
        // Only allow http and https protocols
        if (protocol === 'http' || protocol === 'https') {
          return url;
        }
        debug('Rejected potentially dangerous URL scheme: ' + url);
      } else if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../') || url.startsWith('#')) {
        // Allow relative URLs: absolute paths, relative paths, and anchors
        return url;
      } else if (/^[a-z0-9_.\/-]+$/i.test(url)) {
        // Allow simple alphanumeric paths with forward slashes, dots, underscores, and hyphens
        return url;
      } else {
        debug('Rejected potentially dangerous URL: ' + url);
      }
    }
  }
  
  return null;
}

// Detect and extract link information from an element
function detectLinkElement(element) {
  if (!element) return null;
  
  // Method 1: Direct <a> tag with href
  if (element.tagName === 'A' && element.href) {
    debug('Detected traditional <a> tag with href');
    return { element: element, url: element.href };
  }
  
  // Method 2: Closest parent <a> tag with href
  const closestAnchor = element.closest('a');
  if (closestAnchor && closestAnchor.href) {
    debug('Detected parent <a> tag with href');
    return { element: closestAnchor, url: closestAnchor.href };
  }
  
  // Method 3: Element with role="link" and URL in data attributes
  if (element.getAttribute('role') === 'link') {
    const url = extractUrlFromDataAttributes(element);
    if (url) {
      debug('Detected element with role="link" and data URL: ' + url);
      return { element: element, url: url };
    }
  }
  
  // Method 4: Closest parent with role="link" and URL in data attributes
  const closestRoleLink = element.closest('[role="link"]');
  if (closestRoleLink) {
    const url = extractUrlFromDataAttributes(closestRoleLink);
    if (url) {
      debug('Detected parent with role="link" and data URL: ' + url);
      return { element: closestRoleLink, url: url };
    }
  }
  
  // Method 5: Common clickable elements with URL-like data attributes
  if (CLICKABLE_ELEMENTS.includes(element.tagName)) {
    const url = extractUrlFromDataAttributes(element);
    if (url) {
      debug('Detected clickable element (' + element.tagName + ') with data URL: ' + url);
      return { element: element, url: url };
    }
  }
  
  // Method 6: Check parent clickable elements
  for (const tagName of CLICKABLE_ELEMENTS) {
    const closestClickable = element.closest(tagName.toLowerCase());
    if (closestClickable) {
      const url = extractUrlFromDataAttributes(closestClickable);
      if (url) {
        debug('Detected parent clickable element (' + tagName + ') with data URL: ' + url);
        return { element: closestClickable, url: url };
      }
    }
  }
  
  return null;
}

// Track mouseover on links
document.addEventListener('mouseover', function(event) {
  const linkInfo = detectLinkElement(event.target);
  
  if (linkInfo && linkInfo.element) {
    const textContent = linkInfo.element.textContent || '';
    currentHoveredLink = { href: linkInfo.url, textContent: textContent };
    currentHoveredElement = linkInfo.element;
    debug('Link hovered: ' + linkInfo.url);
  } else {
    // Clear state if no link is detected
    currentHoveredLink = null;
    currentHoveredElement = null;
  }
}, true);

// Track mouseout
document.addEventListener('mouseout', function(event) {
  // Check if we're leaving the currently tracked element
  // relatedTarget is where the mouse is moving to
  if (currentHoveredElement && event.target === currentHoveredElement) {
    // Only clear if we're moving outside the element (not to a child)
    // relatedTarget can be null when mouse leaves the browser window
    if (!event.relatedTarget || !currentHoveredElement.contains(event.relatedTarget)) {
      currentHoveredLink = null;
      currentHoveredElement = null;
      debug('Link unhovered');
    }
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