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

// Find the tweet URL from an element
function findTweetUrl(element) {
  // If element is already an <a> tag, return its href
  if (element.tagName === 'A' && element.href) {
    return element.href;
  }
  
  // Find closest article (Twitter tweet container)
  const article = element.closest('article');
  if (!article) {
    debug('No article found');
    return null;
  }
  
  // Look for links with href containing /status/ - this is the actual tweet URL
  const statusLink = article.querySelector('a[href*="/status/"]');
  if (statusLink && statusLink.href) {
    debug('Found status link: ' + statusLink.href);
    return statusLink.href;
  }
  
  // Fallback: Look for any link inside article that's not a profile link
  const allLinks = article.querySelectorAll('a[href]');
  for (let link of allLinks) {
    const url = link.href;
    // Skip profile links (they have /username or look like profile URLs)
    // and focus on status links
    if (url.includes('/status/')) {
      debug('Found status link (fallback): ' + url);
      return url;
    }
  }
  
  // If no status link found, try getting any link that's not a profile
  for (let link of allLinks) {
    const url = link.href;
    // Avoid common navigation links
    if (!url.includes('/explore') && 
        !url.includes('/home') && 
        !url.includes('/messages') && 
        !url.includes('/notifications')) {
      if (url.includes('twitter.com') || url.includes('x.com')) {
        debug('Found alternative link: ' + url);
        return url;
      }
    }
  }
  
  debug('No suitable link found in article');
  return null;
}

// Get tweet text (the actual tweet content)
function getTweetText(element) {
  const article = element.closest('article');
  if (!article) {
    return element.textContent.trim().substring(0, 100);
  }
  
  // Find the main tweet text content
  // Twitter uses role="region" or specific divs for tweet content
  const tweetContent = article.querySelector('[data-testid="tweet"] div[lang], [role="article"] div[lang]');
  if (tweetContent) {
    return tweetContent.textContent.trim().substring(0, 100);
  }
  
  // Fallback to getting text content excluding header
  const header = article.querySelector('div[data-testid="User-Name"]');
  if (header) {
    // Get all text and remove header text
    let allText = article.textContent.trim();
    let headerText = header.textContent.trim();
    let remaining = allText.replace(headerText, '').trim();
    return remaining.substring(0, 100);
  }
  
  return element.textContent.trim().substring(0, 100);
}

// Enhanced hover detection for Twitter
document.addEventListener('mouseover', function(event) {
  let target = event.target;
  let element = null;
  
  // Direct link
  if (target.tagName === 'A' && target.href && target.href.includes('/status/')) {
    element = target;
  } else {
    // Check if hovering over anything in a tweet article
    const article = target.closest('article');
    if (article) {
      element = article;
      debug('Article found on hover');
    }
  }
  
  if (element) {
    const url = findTweetUrl(element);
    if (url) {
      currentHoveredLink = element;
      currentHoveredElement = element;
      debug('Element hovered with URL: ' + url);
    } else {
      debug('Element hovered but no URL found');
    }
  }
}, true);

// Track mouseout
document.addEventListener('mouseout', function(event) {
  currentHoveredLink = null;
  currentHoveredElement = null;
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
  if (!currentHoveredLink && !currentHoveredElement) {
    debug('No element hovered on key press');
    return;
  }
  
  if (event.target.tagName === 'INPUT' || 
      event.target.tagName === 'TEXTAREA' || 
      event.target.contentEditable === 'true') {
    return;
  }
  
  const key = event.key.toLowerCase();
  const element = currentHoveredLink || currentHoveredElement;
  const url = findTweetUrl(element);
  
  debug('Key pressed: ' + key);
  debug('URL found: ' + url);
  
  if (key === CONFIG.copyUrlKey.toLowerCase() && 
      checkModifiers(CONFIG.copyUrlCtrl, CONFIG.copyUrlAlt, CONFIG.copyUrlShift, event)) {
    event.preventDefault();
    event.stopPropagation();
    
    if (!url) {
      debug('No URL found for copy');
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
    
    const text = getTweetText(element);
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
