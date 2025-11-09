// Copy URL on Hover - Enhanced with Quick Tabs
// 
// KNOWN LIMITATIONS:
// 1. Focus Issue (#2): When you click inside a Quick Tab iframe, keyboard shortcuts 
//    won't work until you click back in the main page. This is a browser security 
//    limitation - iframes capture keyboard focus.
//    WORKAROUND: Click anywhere in the main page to restore keyboard shortcuts.
//
// 2. Nested Quick Tabs (#3): Cannot open Quick Tabs from inside other Quick Tabs
//    because cross-origin iframes block script injection for security.
//    WORKAROUND: Use the "Open in New Tab" button to open links in a real tab.
//
// 3. Zen Browser Theme (#10): Detecting Zen Browser workspace themes requires
//    access to Zen-specific browser APIs which are not available to content scripts.
//    Would need a separate WebExtension API or Zen Browser integration.
//
// BUG FIXES (v1.5.4):
// - Fixed: Opening Quick Tab via keyboard shortcut would create multiple tabs up to 
//   the limit due to BroadcastChannel infinite loop. Now Quick Tabs created from 
//   broadcasts are marked with fromBroadcast=true to prevent re-broadcasting.
// - Fixed: Quick Tabs now sync across ALL domains, not just same domain tabs.
// - Fixed: Quick Tab position and size changes now sync across all tabs.
// - Fixed: Closing a Quick Tab in one tab now closes it in all tabs.
// - Fixed: Quick Tabs can now be moved outside webpage boundaries.
// - Fixed: Quick Tabs reappearing after page reload even when closed. Storage is now
//   always updated when tabs are closed, regardless of broadcast state.
//
// BUG FIXES (v1.5.4.1):
// - Fixed: Quick Tab duplication bug when navigating between pages on the same domain
//   (e.g., switching between Wikipedia pages). Restored Quick Tabs now pass 
//   fromBroadcast=true to prevent re-broadcasting and creating duplicates.
// - Fixed: Quick Tabs now persist across different domains (e.g., Wikipedia to YouTube)
//   by switching from localStorage to browser.storage.local which is shared across all
//   origins.
// - Added: Duplicate detection when restoring Quick Tabs to prevent multiple instances
//   of the same URL from being created.
// - Fixed: Quick Tab position and size now persist when switching tabs. Move and resize
//   broadcast handlers now save to storage.
// - Added: Pin Quick Tab feature - pin a Quick Tab to a specific page URL. Pinned Quick
//   Tabs only appear on the page they're pinned to, while unpinned Quick Tabs appear
//   across all tabs/domains.

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
  quickTabPersistAcrossTabs: true,
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

// Constants
const GOOGLE_FAVICON_URL = 'https://www.google.com/s2/favicons?domain=';
const TOOLTIP_OFFSET_X = 10;
const TOOLTIP_OFFSET_Y = 10;
const TOOLTIP_DURATION_MS = 1500;
const TOOLTIP_FADE_OUT_MS = 200;

let CONFIG = { ...DEFAULT_CONFIG };
let currentHoveredLink = null;
let currentHoveredElement = null;
let quickTabWindows = [];
let minimizedQuickTabs = [];
let quickTabZIndex = 1000000;
let lastMouseX = 0;
let lastMouseY = 0;

// ==================== BROADCAST CHANNEL SETUP ====================
// Create a BroadcastChannel for real-time cross-tab Quick Tab sync
let quickTabChannel = null;

function initializeBroadcastChannel() {
  if (quickTabChannel) return; // Already initialized
  
  try {
    quickTabChannel = new BroadcastChannel('quick-tabs-sync');
    debug('BroadcastChannel initialized for Quick Tab sync');
    
    // Listen for Quick Tab creation messages from other tabs
    quickTabChannel.onmessage = handleBroadcastMessage;
    
  } catch (err) {
    console.error('Failed to create BroadcastChannel:', err);
    debug('BroadcastChannel not available - using localStorage fallback only');
  }
}

function handleBroadcastMessage(event) {
  const message = event.data;
  
  if (message.action === 'createQuickTab') {
    debug(`Received Quick Tab broadcast from another tab: ${message.url}`);
    
    // Filter based on pin status - only show unpinned Quick Tabs via broadcast
    // Pinned Quick Tabs are handled by storage restore based on current page URL
    if (message.pinnedToUrl) {
      const currentPageUrl = window.location.href;
      if (message.pinnedToUrl !== currentPageUrl) {
        debug(`Skipping pinned Quick Tab broadcast (pinned to ${message.pinnedToUrl}, current: ${currentPageUrl})`);
        return;
      }
    }
    
    // Create the Quick Tab window with the same properties
    // Pass true for fromBroadcast to prevent re-broadcasting
    createQuickTabWindow(
      message.url,
      message.width,
      message.height,
      message.left,
      message.top,
      true, // fromBroadcast = true
      message.pinnedToUrl
    );
  }
  else if (message.action === 'closeQuickTab') {
    debug(`Received close Quick Tab broadcast for URL: ${message.url}`);
    
    // Find and close the Quick Tab with matching URL
    const container = quickTabWindows.find(win => {
      const iframe = win.querySelector('iframe');
      return iframe && iframe.src === message.url;
    });
    
    if (container) {
      closeQuickTabWindow(container, false); // false = don't broadcast again
    }
  }
  else if (message.action === 'closeAllQuickTabs') {
    debug('Received close all Quick Tabs broadcast');
    closeAllQuickTabWindows(false); // false = don't broadcast again
  }
  else if (message.action === 'moveQuickTab') {
    debug(`Received move Quick Tab broadcast for URL: ${message.url}`);
    
    // Find and move the Quick Tab with matching URL
    const container = quickTabWindows.find(win => {
      const iframe = win.querySelector('iframe');
      return iframe && iframe.src === message.url;
    });
    
    if (container) {
      container.style.left = message.left + 'px';
      container.style.top = message.top + 'px';
      // Save to storage so position persists when switching tabs
      saveQuickTabsToStorage();
    }
  }
  else if (message.action === 'resizeQuickTab') {
    debug(`Received resize Quick Tab broadcast for URL: ${message.url}`);
    
    // Find and resize the Quick Tab with matching URL
    const container = quickTabWindows.find(win => {
      const iframe = win.querySelector('iframe');
      return iframe && iframe.src === message.url;
    });
    
    if (container) {
      container.style.width = message.width + 'px';
      container.style.height = message.height + 'px';
      // Save to storage so size persists when switching tabs
      saveQuickTabsToStorage();
    }
  }
  else if (message.action === 'clearMinimizedTabs') {
    minimizedQuickTabs = [];
    updateMinimizedTabsManager();
  }
}

function broadcastQuickTabCreation(url, width, height, left, top, pinnedToUrl = null) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;
  
  quickTabChannel.postMessage({
    action: 'createQuickTab',
    url: url,
    width: width || CONFIG.quickTabDefaultWidth,
    height: height || CONFIG.quickTabDefaultHeight,
    left: left,
    top: top,
    pinnedToUrl: pinnedToUrl,
    timestamp: Date.now()
  });
  
  debug(`Broadcasting Quick Tab creation to other tabs: ${url}`);
}

function broadcastQuickTabClose(url) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;
  
  quickTabChannel.postMessage({
    action: 'closeQuickTab',
    url: url,
    timestamp: Date.now()
  });
  
  debug(`Broadcasting Quick Tab close to other tabs: ${url}`);
}

function broadcastCloseAll() {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;
  
  quickTabChannel.postMessage({
    action: 'closeAllQuickTabs',
    timestamp: Date.now()
  });
}

function broadcastQuickTabMove(url, left, top) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;
  
  quickTabChannel.postMessage({
    action: 'moveQuickTab',
    url: url,
    left: left,
    top: top,
    timestamp: Date.now()
  });
  
  debug(`Broadcasting Quick Tab move to other tabs: ${url}`);
}

function broadcastQuickTabResize(url, width, height) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;
  
  quickTabChannel.postMessage({
    action: 'resizeQuickTab',
    url: url,
    width: width,
    height: height,
    timestamp: Date.now()
  });
  
  debug(`Broadcasting Quick Tab resize to other tabs: ${url}`);
}

function broadcastClearMinimized() {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;
  
  quickTabChannel.postMessage({
    action: 'clearMinimizedTabs',
    timestamp: Date.now()
  });
}

// ==================== END BROADCAST CHANNEL SETUP ====================

// ==================== BROWSER STORAGE PERSISTENCE ====================
// Using browser.storage.local instead of localStorage to support cross-domain persistence
// browser.storage.local is shared across all tabs regardless of origin

function saveQuickTabsToStorage() {
  if (!CONFIG.quickTabPersistAcrossTabs) return;
  
  try {
    const state = quickTabWindows.map(container => {
      const iframe = container.querySelector('iframe');
      const titleText = container.querySelector('.copy-url-quicktab-titlebar span');
      const rect = container.getBoundingClientRect();
      
      return {
        url: iframe?.src || '',
        title: titleText?.textContent || 'Quick Tab',
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        minimized: false,
        pinnedToUrl: container._pinnedToUrl || null
      };
    });
    
    // Also include minimized tabs
    const minimizedState = minimizedQuickTabs.map(tab => ({
      ...tab,
      minimized: true
    }));
    
    const allTabs = [...state, ...minimizedState];
    
    // Use browser.storage.local for cross-domain support
    browser.storage.local.set({ quickTabs_storage: allTabs }).then(() => {
      debug(`Saved ${allTabs.length} Quick Tabs to browser.storage.local`);
    }).catch(err => {
      console.error('Error saving Quick Tabs to browser.storage.local:', err);
    });
    
  } catch (err) {
    console.error('Error saving Quick Tabs:', err);
  }
}

function restoreQuickTabsFromStorage() {
  if (!CONFIG.quickTabPersistAcrossTabs) return;
  
  browser.storage.local.get('quickTabs_storage').then(result => {
    const tabs = result.quickTabs_storage;
    if (!tabs || !Array.isArray(tabs) || tabs.length === 0) return;
    
    debug(`Restoring ${tabs.length} Quick Tabs from browser.storage.local`);
    
    // Get current page URL for pin filtering
    const currentPageUrl = window.location.href;
    
    // Check if we already have Quick Tabs with the same URLs to prevent duplicates
    const existingUrls = new Set(quickTabWindows.map(win => {
      const iframe = win.querySelector('iframe');
      return iframe ? iframe.src : null;
    }).filter(url => url !== null));
    
    // Restore non-minimized tabs
    const normalTabs = tabs.filter(t => !t.minimized);
    normalTabs.forEach(tab => {
      // Skip if we already have a Quick Tab with this URL (prevents duplicates)
      if (existingUrls.has(tab.url)) {
        debug(`Skipping duplicate Quick Tab: ${tab.url}`);
        return;
      }
      
      // Filter based on pin status
      if (tab.pinnedToUrl) {
        // Only restore pinned Quick Tabs on the page they're pinned to
        if (tab.pinnedToUrl !== currentPageUrl) {
          debug(`Skipping pinned Quick Tab (pinned to ${tab.pinnedToUrl}, current: ${currentPageUrl})`);
          return;
        }
      }
      
      if (quickTabWindows.length >= CONFIG.quickTabMaxWindows) return;
      
      // Pass true for fromBroadcast to prevent re-broadcasting when restoring from storage
      // This fixes the duplication bug where restored tabs would broadcast and create duplicates
      createQuickTabWindow(tab.url, tab.width, tab.height, tab.left, tab.top, true, tab.pinnedToUrl);
    });
    
    // Restore minimized tabs (also check for duplicates and pin status)
    const existingMinimizedUrls = new Set(minimizedQuickTabs.map(t => t.url));
    const minimized = tabs.filter(t => {
      if (!t.minimized) return false;
      if (existingMinimizedUrls.has(t.url)) return false;
      
      // Filter based on pin status
      if (t.pinnedToUrl && t.pinnedToUrl !== currentPageUrl) {
        debug(`Skipping minimized pinned Quick Tab (pinned to ${t.pinnedToUrl}, current: ${currentPageUrl})`);
        return false;
      }
      
      return true;
    });
    
    if (minimized.length > 0) {
      minimizedQuickTabs.push(...minimized);
      updateMinimizedTabsManager();
    }
    
  }).catch(err => {
    console.error('Error restoring Quick Tabs from browser.storage.local:', err);
  });
}

function clearQuickTabsFromStorage() {
  browser.storage.local.remove('quickTabs_storage').then(() => {
    debug('Cleared Quick Tabs from browser.storage.local');
  }).catch(err => {
    console.error('Error clearing browser.storage.local:', err);
  });
}

// Listen for storage changes from other tabs/windows
// browser.storage.onChanged works across all origins
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.quickTabs_storage) {
    debug('Storage change detected from another tab/window');
    // Note: We rely on BroadcastChannel for real-time same-origin sync
    // Storage event handles cross-origin sync
    
    // Only restore if the change came from another context
    // and we don't already have these Quick Tabs
    if (changes.quickTabs_storage.newValue) {
      const newTabs = changes.quickTabs_storage.newValue;
      if (Array.isArray(newTabs)) {
        // Get current URLs to avoid duplicates
        const existingUrls = new Set(quickTabWindows.map(win => {
          const iframe = win.querySelector('iframe');
          return iframe ? iframe.src : null;
        }).filter(url => url !== null));
        
        // Get current page URL for pin filtering
        const currentPageUrl = window.location.href;
        
        // Only create Quick Tabs that don't already exist
        newTabs.filter(t => {
          if (t.minimized) return false;
          if (existingUrls.has(t.url)) return false;
          
          // Filter based on pin status
          if (t.pinnedToUrl && t.pinnedToUrl !== currentPageUrl) {
            debug(`Skipping pinned Quick Tab from storage event (pinned to ${t.pinnedToUrl}, current: ${currentPageUrl})`);
            return false;
          }
          
          return true;
        }).forEach(tab => {
          if (quickTabWindows.length >= CONFIG.quickTabMaxWindows) return;
          createQuickTabWindow(tab.url, tab.width, tab.height, tab.left, tab.top, true, tab.pinnedToUrl);
        });
      }
    }
  }
});

// ==================== END BROWSER STORAGE PERSISTENCE ====================

// Initialize tooltip animation keyframes once
function initTooltipAnimation() {
  if (document.querySelector('style[data-copy-url-tooltip]')) return;
  
  const style = document.createElement('style');
  style.setAttribute('data-copy-url-tooltip', 'true');
  style.textContent = `
    @keyframes tooltipFadeIn {
      from { opacity: 0; transform: translateY(-5px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

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

// Determine the domain type
function getDomainType() {
  const hostname = window.location.hostname;
  // Social Media
  if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
  if (hostname.includes('reddit.com')) return 'reddit';
  if (hostname.includes('linkedin.com')) return 'linkedin';
  if (hostname.includes('instagram.com')) return 'instagram';
  if (hostname.includes('facebook.com')) return 'facebook';
  if (hostname.includes('tiktok.com')) return 'tiktok';
  if (hostname.includes('threads.net')) return 'threads';
  if (hostname.includes('bluesky.social')) return 'bluesky';
  if (hostname.includes('mastodon')) return 'mastodon';
  if (hostname.includes('snapchat.com')) return 'snapchat';
  if (hostname.includes('whatsapp.com')) return 'whatsapp';
  if (hostname.includes('telegram.org')) return 'telegram';
  
  // Video Platforms
  if (hostname.includes('youtube.com')) return 'youtube';
  if (hostname.includes('vimeo.com')) return 'vimeo';
  if (hostname.includes('dailymotion.com')) return 'dailymotion';
  if (hostname.includes('twitch.tv')) return 'twitch';
  if (hostname.includes('rumble.com')) return 'rumble';
  if (hostname.includes('odysee.com')) return 'odysee';
  if (hostname.includes('bitchute.com')) return 'bitchute';
  
  // Developer Platforms
  if (hostname.includes('github.com') || hostname.includes('ghe.')) return 'github';
  if (hostname.includes('gitlab.com')) return 'gitlab';
  if (hostname.includes('bitbucket.org')) return 'bitbucket';
  if (hostname.includes('stackoverflow.com')) return 'stackoverflow';
  if (hostname.includes('stackexchange.com')) return 'stackexchange';
  if (hostname.includes('serverfault.com')) return 'serverfault';
  if (hostname.includes('superuser.com')) return 'superuser';
  if (hostname.includes('codepen.io')) return 'codepen';
  if (hostname.includes('jsfiddle.net')) return 'jsfiddle';
  if (hostname.includes('replit.com')) return 'replit';
  if (hostname.includes('glitch.com')) return 'glitch';
  if (hostname.includes('codesandbox.io')) return 'codesandbox';
  
  // Blogging Platforms
  if (hostname.includes('medium.com')) return 'medium';
  if (hostname.includes('devto') || hostname.includes('dev.to')) return 'devto';
  if (hostname.includes('hashnode.com')) return 'hashnode';
  if (hostname.includes('substack.com')) return 'substack';
  if (hostname.includes('wordpress.com')) return 'wordpress';
  if (hostname.includes('blogger.com') || hostname.includes('blogspot.com')) return 'blogger';
  if (hostname.includes('ghost.io') || hostname.includes('ghost.org')) return 'ghost';
  if (hostname.includes('notion.site') || hostname.includes('notion.so')) return 'notion';
  
  // E-commerce
  if (hostname.includes('amazon.') || hostname.includes('smile.amazon')) return 'amazon';
  if (hostname.includes('ebay.')) return 'ebay';
  if (hostname.includes('etsy.com')) return 'etsy';
  if (hostname.includes('walmart.com')) return 'walmart';
  if (hostname.includes('flipkart.com')) return 'flipkart';
  if (hostname.includes('aliexpress.com')) return 'aliexpress';
  if (hostname.includes('alibaba.com')) return 'alibaba';
  if (hostname.includes('shopify.')) return 'shopify';
  if (hostname.includes('target.com')) return 'target';
  if (hostname.includes('bestbuy.com')) return 'bestbuy';
  if (hostname.includes('newegg.com')) return 'newegg';
  if (hostname.includes('wish.com')) return 'wish';
  
  // Image & Design Platforms
  if (hostname.includes('pinterest.com')) return 'pinterest';
  if (hostname.includes('tumblr.com')) return 'tumblr';
  if (hostname.includes('dribbble.com')) return 'dribbble';
  if (hostname.includes('behance.net')) return 'behance';
  if (hostname.includes('deviantart.com')) return 'deviantart';
  if (hostname.includes('flickr.com')) return 'flickr';
  if (hostname.includes('500px.com')) return '500px';
  if (hostname.includes('unsplash.com')) return 'unsplash';
  if (hostname.includes('pexels.com')) return 'pexels';
  if (hostname.includes('pixabay.com')) return 'pixabay';
  if (hostname.includes('artstation.com')) return 'artstation';
  if (hostname.includes('imgur.com')) return 'imgur';
  if (hostname.includes('giphy.com')) return 'giphy';
  
  // News & Discussion
  if (hostname.includes('hackernews') || hostname.includes('news.ycombinator')) return 'hackernews';
  if (hostname.includes('producthunt.com')) return 'producthunt';
  if (hostname.includes('quora.com')) return 'quora';
  if (hostname.includes('discord.com') || hostname.includes('discordapp.com')) return 'discord';
  if (hostname.includes('slack.com')) return 'slack';
  if (hostname.includes('lobste.rs')) return 'lobsters';
  if (hostname.includes('news.google.com')) return 'googlenews';
  if (hostname.includes('feedly.com')) return 'feedly';
  
  // Entertainment & Media
  if (hostname.includes('wikipedia.org')) return 'wikipedia';
  if (hostname.includes('imdb.com')) return 'imdb';
  if (hostname.includes('rottentomatoes.com')) return 'rottentomatoes';
  if (hostname.includes('netflix.com')) return 'netflix';
  if (hostname.includes('letterboxd.com')) return 'letterboxd';
  if (hostname.includes('goodreads.com')) return 'goodreads';
  if (hostname.includes('myanimelist.net')) return 'myanimelist';
  if (hostname.includes('anilist.co')) return 'anilist';
  if (hostname.includes('kitsu.io')) return 'kitsu';
  if (hostname.includes('last.fm')) return 'lastfm';
  if (hostname.includes('spotify.com')) return 'spotify';
  if (hostname.includes('soundcloud.com')) return 'soundcloud';
  if (hostname.includes('bandcamp.com')) return 'bandcamp';
  
  // Gaming
  if (hostname.includes('steamcommunity.com')) return 'steam';
  if (hostname.includes('steampowered.com')) return 'steampowered';
  if (hostname.includes('epicgames.com')) return 'epicgames';
  if (hostname.includes('gog.com')) return 'gog';
  if (hostname.includes('itch.io')) return 'itchio';
  if (hostname.includes('gamejolt.com')) return 'gamejolt';
  
  // Professional & Learning
  if (hostname.includes('coursera.org')) return 'coursera';
  if (hostname.includes('udemy.com')) return 'udemy';
  if (hostname.includes('edx.org')) return 'edx';
  if (hostname.includes('khanacademy.org')) return 'khanacademy';
  if (hostname.includes('skillshare.com')) return 'skillshare';
  if (hostname.includes('pluralsight.com')) return 'pluralsight';
  if (hostname.includes('udacity.com')) return 'udacity';
  
  // Other
  if (hostname.includes('archive.org')) return 'archiveorg';
  if (hostname.includes('patreon.com')) return 'patreon';
  if (hostname.includes('ko-fi.com')) return 'kofi';
  if (hostname.includes('buymeacoffee.com')) return 'buymeacoffee';
  if (hostname.includes('gumroad.com')) return 'gumroad';
  
  return 'generic';
}

// Generic URL finder - most robust
function findUrl(element, domainType) {
  // Try direct link first
  if (element.tagName === 'A' && element.href) {
    return element.href;
  }
  
  // Check parents for href (up to 20 levels)
  let parent = element.parentElement;
  for (let i = 0; i < 20; i++) {
    if (!parent) break;
    if (parent.href) return parent.href;
    parent = parent.parentElement;
  }
  
  // Site-specific handlers
  const handlers = {
    // Social Media
    twitter: findTwitterUrl,
    reddit: findRedditUrl,
    linkedin: findLinkedInUrl,
    instagram: findInstagramUrl,
    facebook: findFacebookUrl,
    tiktok: findTikTokUrl,
    threads: findThreadsUrl,
    bluesky: findBlueskyUrl,
    mastodon: findMastodonUrl,
    snapchat: findSnapchatUrl,
    whatsapp: findWhatsappUrl,
    telegram: findTelegramUrl,
    
    // Video Platforms
    youtube: findYouTubeUrl,
    vimeo: findVimeoUrl,
    dailymotion: findDailyMotionUrl,
    twitch: findTwitchUrl,
    rumble: findRumbleUrl,
    odysee: findOdyseeUrl,
    bitchute: findBitchuteUrl,
    
    // Developer Platforms
    github: findGitHubUrl,
    gitlab: findGitLabUrl,
    bitbucket: findBitbucketUrl,
    stackoverflow: findStackOverflowUrl,
    stackexchange: findStackExchangeUrl,
    serverfault: findServerFaultUrl,
    superuser: findSuperUserUrl,
    codepen: findCodepenUrl,
    jsfiddle: findJSFiddleUrl,
    replit: findReplitUrl,
    glitch: findGlitchUrl,
    codesandbox: findCodesandboxUrl,
    
    // Blogging Platforms
    medium: findMediumUrl,
    devto: findDevToUrl,
    hashnode: findHashnodeUrl,
    substack: findSubstackUrl,
    wordpress: findWordpressUrl,
    blogger: findBloggerUrl,
    ghost: findGhostUrl,
    notion: findNotionUrl,
    
    // E-commerce
    amazon: findAmazonUrl,
    ebay: findEbayUrl,
    etsy: findEtsyUrl,
    walmart: findWalmartUrl,
    flipkart: findFlipkartUrl,
    aliexpress: findAliexpressUrl,
    alibaba: findAlibabaUrl,
    shopify: findShopifyUrl,
    target: findTargetUrl,
    bestbuy: findBestBuyUrl,
    newegg: findNeweggUrl,
    wish: findWishUrl,
    
    // Image & Design Platforms
    pinterest: findPinterestUrl,
    tumblr: findTumblrUrl,
    dribbble: findDribbbleUrl,
    behance: findBehanceUrl,
    deviantart: findDeviantartUrl,
    flickr: findFlickrUrl,
    '500px': find500pxUrl,
    unsplash: findUnsplashUrl,
    pexels: findPexelsUrl,
    pixabay: findPixabayUrl,
    artstation: findArtstationUrl,
    imgur: findImgurUrl,
    giphy: findGiphyUrl,
    
    // News & Discussion
    hackernews: findHackerNewsUrl,
    producthunt: findProductHuntUrl,
    quora: findQuoraUrl,
    discord: findDiscordUrl,
    slack: findSlackUrl,
    lobsters: findLobstersUrl,
    googlenews: findGoogleNewsUrl,
    feedly: findFeedlyUrl,
    
    // Entertainment & Media
    wikipedia: findWikipediaUrl,
    imdb: findImdbUrl,
    rottentomatoes: findRottenTomatoesUrl,
    netflix: findNetflixUrl,
    letterboxd: findLetterboxdUrl,
    goodreads: findGoodreadsUrl,
    myanimelist: findMyAnimeListUrl,
    anilist: findAniListUrl,
    kitsu: findKitsuUrl,
    lastfm: findLastFmUrl,
    spotify: findSpotifyUrl,
    soundcloud: findSoundcloudUrl,
    bandcamp: findBandcampUrl,
    
    // Gaming
    steam: findSteamUrl,
    steampowered: findSteamPoweredUrl,
    epicgames: findEpicGamesUrl,
    gog: findGOGUrl,
    itchio: findItchIoUrl,
    gamejolt: findGameJoltUrl,
    
    // Professional & Learning
    coursera: findCourseraUrl,
    udemy: findUdemyUrl,
    edx: findEdXUrl,
    khanacademy: findKhanAcademyUrl,
    skillshare: findSkillshareUrl,
    pluralsight: findPluralsightUrl,
    udacity: findUdacityUrl,
    
    // Other
    archiveorg: findArchiveOrgUrl,
    patreon: findPatreonUrl,
    kofi: findKoFiUrl,
    buymeacoffee: findBuyMeACoffeeUrl,
    gumroad: findGumroadUrl
  };
  
  if (handlers[domainType]) {
    const url = handlers[domainType](element);
    if (url) return url;
  }
  
  // Final fallback - find ANY link
  return findGenericUrl(element);
}

// ===== SOCIAL MEDIA HANDLERS =====

function findTwitterUrl(element) {
  debug('=== TWITTER URL FINDER ===');
  debug('Hovered element: ' + element.tagName + ' - ' + element.className);
  
  if (element && element.href) {
    debug(`URL found directly from hovered element: ${element.href}`);
    return element.href;
  }
  
  debug('No Twitter URL found on the provided element.');
  return null;
}

function findRedditUrl(element) {
  const post = element.closest('[data-testid="post-container"], .Post, .post-container, [role="article"]');
  if (!post) return findGenericUrl(element);
  
  const titleLink = post.querySelector('a[data-testid="post-title"], h3 a, .PostTitle a, [data-click-id="body"] a');
  if (titleLink?.href) return titleLink.href;
  
  return null;
}

function findLinkedInUrl(element) {
  const post = element.closest('[data-id], .feed-shared-update-v2, [data-test="activity-item"]');
  if (!post) return findGenericUrl(element);
  
  const links = post.querySelectorAll('a[href]');
  for (let link of links) {
    const url = link.href;
    if (url.includes('/feed/') || url.includes('/posts/')) return url;
  }
  
  return null;
}

function findInstagramUrl(element) {
  const post = element.closest('[role="article"], article');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('a[href*="/p/"], a[href*="/reel/"], time a');
  if (link?.href) return link.href;
  
  return null;
}

function findFacebookUrl(element) {
  const post = element.closest('[role="article"], [data-testid="post"]');
  if (!post) return findGenericUrl(element);
  
  const links = post.querySelectorAll('a[href*="/posts/"], a[href*="/photos/"], a[href*="/videos/"]');
  if (links.length > 0) return links[0].href;
  
  return null;
}

function findTikTokUrl(element) {
  const video = element.closest('[data-e2e="user-post-item"], .video-feed-item');
  if (!video) return findGenericUrl(element);
  
  const link = video.querySelector('a[href*="/@"]');
  if (link?.href) return link.href;
  
  return null;
}

function findThreadsUrl(element) {
  const post = element.closest('[role="article"]');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('a[href*="/t/"], time a');
  if (link?.href) return link.href;
  
  return null;
}

function findBlueskyUrl(element) {
  const post = element.closest('[data-testid="postThreadItem"], [role="article"]');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('a[href*="/post/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findMastodonUrl(element) {
  const post = element.closest('.status, [data-id]');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('a.status__relative-time, a.detailed-status__datetime');
  if (link?.href) return link.href;
  
  return null;
}

function findSnapchatUrl(element) {
  const story = element.closest('[role="article"], .Story');
  if (!story) return findGenericUrl(element);
  
  const link = story.querySelector('a[href*="/add/"], a[href*="/spotlight/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findWhatsappUrl(element) {
  // WhatsApp Web doesn't use traditional links - it's a single-page app
  // The current chat/conversation URL is the most relevant URL to copy
  return window.location.href;
}

function findTelegramUrl(element) {
  const message = element.closest('.message, [data-mid]');
  if (!message) return findGenericUrl(element);
  
  const link = message.querySelector('a[href*="t.me"]');
  if (link?.href) return link.href;
  
  return null;
}

// ===== VIDEO PLATFORM HANDLERS =====

function findYouTubeUrl(element) {
  const videoCard = element.closest('ytd-rich-grid-media, ytd-thumbnail, ytd-video-renderer, ytd-grid-video-renderer, a[href*="/watch"]');
  if (!videoCard) return findGenericUrl(element);
  
  const thumbnailLink = videoCard.querySelector('a#thumbnail[href*="watch?v="]');
  if (thumbnailLink?.href) return thumbnailLink.href;
  
  const watchLink = videoCard.querySelector('a[href*="watch?v="]');
  if (watchLink?.href) return watchLink.href;
  
  return null;
}

function findVimeoUrl(element) {
  const video = element.closest('[data-clip-id], .clip_grid_item');
  if (!video) return findGenericUrl(element);
  
  const link = video.querySelector('a[href*="/video/"], a[href*="vimeo.com/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findDailyMotionUrl(element) {
  const video = element.closest('[data-video], .sd_video_item');
  if (!video) return findGenericUrl(element);
  
  const link = video.querySelector('a[href*="/video/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findTwitchUrl(element) {
  const stream = element.closest('[data-a-target="video-card"], .video-card');
  if (!stream) return findGenericUrl(element);
  
  const link = stream.querySelector('a[href*="/videos/"], a[href*="/clip/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findRumbleUrl(element) {
  const video = element.closest('.video-item, [data-video]');
  if (!video) return findGenericUrl(element);
  
  const link = video.querySelector('a[href*=".html"]');
  if (link?.href) return link.href;
  
  return null;
}

function findOdyseeUrl(element) {
  const video = element.closest('.claim-preview, [data-id]');
  if (!video) return findGenericUrl(element);
  
  const link = video.querySelector('a[href*="/@"]');
  if (link?.href) return link.href;
  
  return null;
}

function findBitchuteUrl(element) {
  const video = element.closest('.video-card, .channel-videos-container');
  if (!video) return findGenericUrl(element);
  
  const link = video.querySelector('a[href*="/video/"]');
  if (link?.href) return link.href;
  
  return null;
}

// ===== DEVELOPER PLATFORM HANDLERS =====

function findGitHubUrl(element) {
  const item = element.closest('[data-testid="issue-row"], .Box-row, .issue, [role="article"]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/issues/"], a[href*="/pull/"], a[href*="/discussions/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findGitLabUrl(element) {
  const item = element.closest('.issue, .merge-request, [data-qa-selector]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/issues/"], a[href*="/merge_requests/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findBitbucketUrl(element) {
  const item = element.closest('[data-testid="issue-row"], .iterable-item');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/issues/"], a[href*="/pull-requests/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findStackOverflowUrl(element) {
  const question = element.closest('.s-post-summary, [data-post-id]');
  if (!question) return findGenericUrl(element);
  
  const link = question.querySelector('a.s-link[href*="/questions/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findStackExchangeUrl(element) {
  const question = element.closest('.s-post-summary, .question-summary');
  if (!question) return findGenericUrl(element);
  
  const link = question.querySelector('a[href*="/questions/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findServerFaultUrl(element) {
  // Server Fault uses the same Stack Exchange structure
  return findStackExchangeUrl(element);
}

function findSuperUserUrl(element) {
  // Super User uses the same Stack Exchange structure
  return findStackExchangeUrl(element);
}

function findCodepenUrl(element) {
  const pen = element.closest('[data-slug], .single-pen');
  if (!pen) return findGenericUrl(element);
  
  const link = pen.querySelector('a[href*="/pen/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findJSFiddleUrl(element) {
  const fiddle = element.closest('.fiddle, [data-id]');
  if (!fiddle) return findGenericUrl(element);
  
  const link = fiddle.querySelector('a[href*="jsfiddle.net"]');
  if (link?.href) return link.href;
  
  return null;
}

function findReplitUrl(element) {
  const repl = element.closest('[data-repl-id], .repl-item');
  if (!repl) return findGenericUrl(element);
  
  const link = repl.querySelector('a[href*="/@"]');
  if (link?.href) return link.href;
  
  return null;
}

function findGlitchUrl(element) {
  const project = element.closest('.project, [data-project-id]');
  if (!project) return findGenericUrl(element);
  
  const link = project.querySelector('a[href*="glitch.com/~"]');
  if (link?.href) return link.href;
  
  return null;
}

function findCodesandboxUrl(element) {
  const sandbox = element.closest('[data-id], .sandbox-item');
  if (!sandbox) return findGenericUrl(element);
  
  const link = sandbox.querySelector('a[href*="/s/"]');
  if (link?.href) return link.href;
  
  return null;
}

// ===== BLOGGING PLATFORM HANDLERS =====

function findMediumUrl(element) {
  const article = element.closest('[data-post-id], article');
  if (!article) return findGenericUrl(element);
  
  const link = article.querySelector('a[data-action="open-post"], h2 a, h3 a');
  if (link?.href) return link.href;
  
  return null;
}

function findDevToUrl(element) {
  const article = element.closest('.crayons-story, [data-article-id]');
  if (!article) return findGenericUrl(element);
  
  const link = article.querySelector('a[id*="article-link"], h2 a, h3 a');
  if (link?.href) return link.href;
  
  return null;
}

function findHashnodeUrl(element) {
  const article = element.closest('[data-post-id], .post-card');
  if (!article) return findGenericUrl(element);
  
  const link = article.querySelector('a[href*="/post/"], h1 a, h2 a');
  if (link?.href) return link.href;
  
  return null;
}

function findSubstackUrl(element) {
  const article = element.closest('.post, [data-testid="post-preview"]');
  if (!article) return findGenericUrl(element);
  
  const link = article.querySelector('a[href*="/p/"], h2 a, h3 a');
  if (link?.href) return link.href;
  
  return null;
}

function findWordpressUrl(element) {
  const post = element.closest('.post, .hentry, article');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('a.entry-title-link, h2 a, .entry-title a');
  if (link?.href) return link.href;
  
  return null;
}

function findBloggerUrl(element) {
  const post = element.closest('.post, .post-outer');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('h3.post-title a, a.post-title');
  if (link?.href) return link.href;
  
  return null;
}

function findGhostUrl(element) {
  const article = element.closest('.post-card, article');
  if (!article) return findGenericUrl(element);
  
  const link = article.querySelector('.post-card-title a, h2 a');
  if (link?.href) return link.href;
  
  return null;
}

function findNotionUrl(element) {
  // Notion typically uses current page URL
  return window.location.href;
}

// ===== E-COMMERCE HANDLERS =====

function findAmazonUrl(element) {
  const product = element.closest('[data-component-type="s-search-result"], .s-result-item, [data-asin]');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a.a-link-normal[href*="/dp/"], h2 a');
  if (link?.href) return link.href;
  
  return null;
}

function findEbayUrl(element) {
  const item = element.closest('.s-item, [data-view="mi"]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a.s-item__link, .vip a');
  if (link?.href) return link.href;
  
  return null;
}

function findEtsyUrl(element) {
  const listing = element.closest('[data-listing-id], .listing-link');
  if (!listing) return findGenericUrl(element);
  
  const link = listing.querySelector('a[href*="/listing/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findWalmartUrl(element) {
  const product = element.closest('[data-item-id], .search-result-gridview-item');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="/ip/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findFlipkartUrl(element) {
  const product = element.closest('[data-id], ._2kHMtA');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="/p/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findAliexpressUrl(element) {
  const product = element.closest('[data-product-id], .product-item');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="/item/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findAlibabaUrl(element) {
  const product = element.closest('[data-content], .organic-list-offer');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="/product-detail/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findShopifyUrl(element) {
  const product = element.closest('.product-item, .grid-item, [data-product-id]');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="/products/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findTargetUrl(element) {
  const product = element.closest('[data-test="product-grid-item"]');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="/p/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findBestBuyUrl(element) {
  const product = element.closest('.sku-item, [data-sku-id]');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="/site/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findNeweggUrl(element) {
  const item = element.closest('.item-cell, [data-item]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a.item-title');
  if (link?.href) return link.href;
  
  return null;
}

function findWishUrl(element) {
  const product = element.closest('[data-productid], .ProductCard');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="/product/"]');
  if (link?.href) return link.href;
  
  return null;
}

// ===== IMAGE & DESIGN PLATFORM HANDLERS =====

function findPinterestUrl(element) {
  const pin = element.closest('[data-test-id="pin"], [role="button"]');
  if (!pin) return findGenericUrl(element);
  
  const link = pin.querySelector('a[href*="/pin/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findTumblrUrl(element) {
  const post = element.closest('[data-id], article');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('a[href*="/post/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findDribbbleUrl(element) {
  const shot = element.closest('[data-thumbnail-target], .shot-thumbnail');
  if (!shot) return findGenericUrl(element);
  
  const link = shot.querySelector('a[href*="/shots/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findBehanceUrl(element) {
  const project = element.closest('[data-project-id], .Project');
  if (!project) return findGenericUrl(element);
  
  const link = project.querySelector('a[href*="/gallery/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findDeviantartUrl(element) {
  const deviation = element.closest('[data-deviationid], ._2vUXu');
  if (!deviation) return findGenericUrl(element);
  
  const link = deviation.querySelector('a[data-hook="deviation_link"]');
  if (link?.href) return link.href;
  
  return null;
}

function findFlickrUrl(element) {
  const photo = element.closest('.photo-list-photo-view, [data-photo-id]');
  if (!photo) return findGenericUrl(element);
  
  const link = photo.querySelector('a[href*="/photos/"]');
  if (link?.href) return link.href;
  
  return null;
}

function find500pxUrl(element) {
  const photo = element.closest('[data-test="photo-item"]');
  if (!photo) return findGenericUrl(element);
  
  const link = photo.querySelector('a[href*="/photo/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findUnsplashUrl(element) {
  const photo = element.closest('figure, [data-test="photo-grid-single-column-figure"]');
  if (!photo) return findGenericUrl(element);
  
  const link = photo.querySelector('a[href*="/photos/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findPexelsUrl(element) {
  const photo = element.closest('[data-photo-modal-medium], article');
  if (!photo) return findGenericUrl(element);
  
  const link = photo.querySelector('a[href*="/photo/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findPixabayUrl(element) {
  const photo = element.closest('[data-id], .item');
  if (!photo) return findGenericUrl(element);
  
  const link = photo.querySelector('a[href*="/photos/"], a[href*="/illustrations/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findArtstationUrl(element) {
  const project = element.closest('.project, [data-project-id]');
  if (!project) return findGenericUrl(element);
  
  const link = project.querySelector('a[href*="/artwork/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findImgurUrl(element) {
  const post = element.closest('[id^="post-"], .Post');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('a[href*="/gallery/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findGiphyUrl(element) {
  const gif = element.closest('[data-giphy-id], .gif');
  if (!gif) return findGenericUrl(element);
  
  const link = gif.querySelector('a[href*="/gifs/"]');
  if (link?.href) return link.href;
  
  return null;
}

// ===== NEWS & DISCUSSION HANDLERS =====

function findHackerNewsUrl(element) {
  const row = element.closest('.athing');
  if (!row) return findGenericUrl(element);
  
  const link = row.querySelector('a.titlelink, .storylink');
  if (link?.href) return link.href;
  
  return null;
}

function findProductHuntUrl(element) {
  const item = element.closest('[data-test="post-item"]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/posts/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findQuoraUrl(element) {
  const question = element.closest('[data-scroll-id], .q-box');
  if (!question) return findGenericUrl(element);
  
  const link = question.querySelector('a[href*="/q/"], a[href*="/question/"], a.question_link');
  if (link?.href) return link.href;
  
  return null;
}

function findDiscordUrl(element) {
  const message = element.closest('[id^="chat-messages-"], .message');
  if (!message) return findGenericUrl(element);
  
  const link = message.querySelector('a[href]');
  if (link?.href) return link.href;
  
  return null;
}

function findSlackUrl(element) {
  const message = element.closest('[data-qa="message_container"]');
  if (!message) return findGenericUrl(element);
  
  const link = message.querySelector('a[href*="/archives/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findLobstersUrl(element) {
  const story = element.closest('.story');
  if (!story) return findGenericUrl(element);
  
  const link = story.querySelector('a.u-url');
  if (link?.href) return link.href;
  
  return null;
}

function findGoogleNewsUrl(element) {
  const article = element.closest('article, [data-n-tid]');
  if (!article) return findGenericUrl(element);
  
  const link = article.querySelector('a[href*="./articles/"], h3 a, h4 a');
  if (link?.href) return link.href;
  
  return null;
}

function findFeedlyUrl(element) {
  const entry = element.closest('[data-entry-id], .entry');
  if (!entry) return findGenericUrl(element);
  
  const link = entry.querySelector('a.entry__title');
  if (link?.href) return link.href;
  
  return null;
}

// ===== ENTERTAINMENT & MEDIA HANDLERS =====

function findWikipediaUrl(element) {
  // Wikipedia typically refers to the current article
  return window.location.href;
}

function findImdbUrl(element) {
  const item = element.closest('.lister-item, [data-testid="title"]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/title/"], a[href*="/name/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findRottenTomatoesUrl(element) {
  const item = element.closest('[data-qa="discovery-media-list-item"]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/m/"], a[href*="/tv/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findNetflixUrl(element) {
  // Netflix uses current page URL
  return window.location.href;
}

function findLetterboxdUrl(element) {
  const film = element.closest('.film-poster, [data-film-id]');
  if (!film) return findGenericUrl(element);
  
  const link = film.querySelector('a[href*="/film/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findGoodreadsUrl(element) {
  const book = element.closest('.bookBox, [data-book-id]');
  if (!book) return findGenericUrl(element);
  
  const link = book.querySelector('a[href*="/book/show/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findMyAnimeListUrl(element) {
  const anime = element.closest('.anime_ranking_h3, [data-id]');
  if (!anime) return findGenericUrl(element);
  
  const link = anime.querySelector('a[href*="/anime/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findAniListUrl(element) {
  const media = element.closest('.media-card, [data-media-id]');
  if (!media) return findGenericUrl(element);
  
  const link = media.querySelector('a[href*="/anime/"], a[href*="/manga/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findKitsuUrl(element) {
  const media = element.closest('.media-card');
  if (!media) return findGenericUrl(element);
  
  const link = media.querySelector('a[href*="/anime/"], a[href*="/manga/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findLastFmUrl(element) {
  const item = element.closest('.chartlist-row, [data-track-id]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/music/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findSpotifyUrl(element) {
  const item = element.closest('[data-testid="tracklist-row"], .track');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/track/"], a[href*="/album/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findSoundcloudUrl(element) {
  const track = element.closest('.searchItem, .soundList__item');
  if (!track) return findGenericUrl(element);
  
  const link = track.querySelector('a[href*="soundcloud.com/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findBandcampUrl(element) {
  const item = element.closest('.item-details, [data-item-id]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/track/"], a[href*="/album/"]');
  if (link?.href) return link.href;
  
  return null;
}

// ===== GAMING HANDLERS =====

function findSteamUrl(element) {
  const item = element.closest('[data-ds-appid], .search_result_row');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/app/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findSteamPoweredUrl(element) {
  const item = element.closest('[data-ds-appid], .game_area');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/app/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findEpicGamesUrl(element) {
  const game = element.closest('[data-component="Card"]');
  if (!game) return findGenericUrl(element);
  
  const link = game.querySelector('a[href*="/p/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findGOGUrl(element) {
  const product = element.closest('.product-row, [data-game-id]');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="/game/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findItchIoUrl(element) {
  const game = element.closest('.game_cell, [data-game_id]');
  if (!game) return findGenericUrl(element);
  
  const link = game.querySelector('a.game_link, a.title');
  if (link?.href) return link.href;
  
  return null;
}

function findGameJoltUrl(element) {
  const game = element.closest('.game-card, [data-game-id]');
  if (!game) return findGenericUrl(element);
  
  const link = game.querySelector('a[href*="/games/"]');
  if (link?.href) return link.href;
  
  return null;
}

// ===== PROFESSIONAL & LEARNING HANDLERS =====

function findCourseraUrl(element) {
  const course = element.closest('[data-e2e="CourseCard"], .CourseCard');
  if (!course) return findGenericUrl(element);
  
  const link = course.querySelector('a[href*="/learn/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findUdemyUrl(element) {
  const course = element.closest('[data-purpose="course-card"]');
  if (!course) return findGenericUrl(element);
  
  const link = course.querySelector('a[href*="/course/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findEdXUrl(element) {
  const course = element.closest('.course-card, [data-course-id]');
  if (!course) return findGenericUrl(element);
  
  const link = course.querySelector('a[href*="/course/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findKhanAcademyUrl(element) {
  const item = element.closest('[data-test-id], .link-item');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/math/"], a[href*="/science/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findSkillshareUrl(element) {
  const classCard = element.closest('[data-class-id], .class-card');
  if (!classCard) return findGenericUrl(element);
  
  const link = classCard.querySelector('a[href*="/classes/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findPluralsightUrl(element) {
  const course = element.closest('[data-course-id], .course-card');
  if (!course) return findGenericUrl(element);
  
  const link = course.querySelector('a[href*="/courses/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findUdacityUrl(element) {
  const course = element.closest('[data-testid="catalog-card"]');
  if (!course) return findGenericUrl(element);
  
  const link = course.querySelector('a[href*="/course/"]');
  if (link?.href) return link.href;
  
  return null;
}

// ===== OTHER HANDLERS =====

function findArchiveOrgUrl(element) {
  const item = element.closest('.item-ia, [data-id]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/details/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findPatreonUrl(element) {
  const post = element.closest('[data-tag="post-card"]');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('a[href*="/posts/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findKoFiUrl(element) {
  const post = element.closest('.feed-item, [data-post-id]');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('a[href*="/post/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findBuyMeACoffeeUrl(element) {
  const post = element.closest('.feed-card');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('a[href*="/p/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findGumroadUrl(element) {
  const product = element.closest('[data-permalink], .product-card');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="gumroad.com/"]');
  if (link?.href) return link.href;
  
  return null;
}

// ===== GENERIC FALLBACK =====

function findGenericUrl(element) {
  // Look for direct href on clicked element
  if (element.href) return element.href;
  
  // Look for closest link
  const link = element.closest('a[href]');
  if (link?.href) return link.href;
  
  // Search within element
  const innerLink = element.querySelector('a[href]');
  if (innerLink?.href) return innerLink.href;
  
  // Search siblings
  const siblings = element.parentElement?.querySelectorAll('a[href]');
  if (siblings?.length) return siblings[0].href;
  
  return null;
}

// Get link text
function getLinkText(element) {
  if (element.tagName === 'A') {
    return element.textContent.trim();
  }
  
  const link = element.querySelector('a[href]');
  if (link) {
    return link.textContent.trim();
  }
  
  return element.textContent.trim().substring(0, 100);
}

// Track mouse position for Quick Tab placement
document.addEventListener('mousemove', function(event) {
  lastMouseX = event.clientX;
  lastMouseY = event.clientY;
}, true);

// Hover detection
document.addEventListener('mouseover', function(event) {
  let target = event.target;
  let element = null;
  const domainType = getDomainType();

  // Special, more precise handling for Twitter
  if (domainType === 'twitter') {
    // IMPORTANT: Find the CLOSEST article to the hovered element (innermost)
    // This will be the correct tweet if hovering over a nested quote
    const tweetArticle = target.closest('article');
    
    if (tweetArticle) {
      debug(`Found article at: ${tweetArticle.className}`);
      
      // Count how many status links are in this article
      const allStatusLinks = tweetArticle.querySelectorAll('a[href*="/status/"]');
      debug(`Status links in this article: ${allStatusLinks.length}`);
      
      // Print each status link for debugging
      allStatusLinks.forEach((link, index) => {
        debug(`  Link ${index}: ${link.href}`);
      });
      
      // CRITICAL: We need the FIRST status link that is a DIRECT child or close relative
      // For the correct tweet (not nested ones), find the main tweet's status link
      let mainStatusLink = null;
      
      // Try to find the status link that's closest in the DOM tree
      // Usually it's a direct child of the article or one level deep
      for (let link of allStatusLinks) {
        // Check if this is the main tweet's link by seeing if it's in a header section
        const timeElement = link.querySelector('time');
        if (timeElement) {
          debug(`Found status link with time element: ${link.href}`);
          mainStatusLink = link;
          break;
        }
      }
      
      // If no link with time found, use the first one
      if (!mainStatusLink && allStatusLinks.length > 0) {
        mainStatusLink = allStatusLinks[0];
        debug(`Using first status link: ${mainStatusLink.href}`);
      }
      
      if (mainStatusLink) {
        element = mainStatusLink;
        debug(`Selected element href: ${element.href}`);
      }
    }
  }

  // Use the old logic for other websites if the new Twitter logic doesn't find anything
  if (!element) {
    if (target.tagName === 'A' && target.href) {
      element = target;
    } else {
      element = target.closest('article, [role="article"], .post, [data-testid="post"], [role="link"], .item, [data-id]');
    }
    
    // Fallback: if no container found, use the target itself
    // This allows site-specific handlers to traverse the DOM with their own logic
    if (!element) {
      element = target;
      debug(`[${domainType}] No specific container found, using target element: ${target.tagName}`);
    }
  }
  
  if (element) {
    debug(`[${domainType}] Element detected, attempting URL detection...`);
    const url = findUrl(element, domainType);
    if (url) {
      currentHoveredLink = element;
      currentHoveredElement = element;
      debug(`[${domainType}] URL found: ${url}`);
    } else {
      debug(`[${domainType}] No URL found for element`);
    }
  }
}, true);

// Mouseout
document.addEventListener('mouseout', function(event) {
  currentHoveredLink = null;
  currentHoveredElement = null;
}, true);

// Show notification
function showNotification(message, options = {}) {
  if (!CONFIG.showNotification) return;
  
  const showTooltip = options.tooltip || false;
  
  try {
    const notif = document.createElement('div');
    notif.textContent = message;
    
    // If tooltip is requested (for URL copy), show it near the cursor
    if (showTooltip) {
      // Ensure tooltip animation is initialized
      initTooltipAnimation();
      
      notif.style.cssText = `
        position: fixed;
        left: ${lastMouseX + TOOLTIP_OFFSET_X}px;
        top: ${lastMouseY + TOOLTIP_OFFSET_Y}px;
        background: ${CONFIG.notifColor};
        color: #fff;
        padding: 6px 12px;
        border-radius: 4px;
        border: 1px solid ${CONFIG.notifBorderColor || '#000000'};
        z-index: 999999;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        animation: tooltipFadeIn 0.2s ease-out;
        pointer-events: none;
        white-space: nowrap;
      `;
      
      document.documentElement.appendChild(notif);
      
      // Schedule tooltip removal with fade out
      const removeTooltip = () => {
        notif.style.opacity = '0';
        notif.style.transition = `opacity ${TOOLTIP_FADE_OUT_MS}ms`;
        setTimeout(() => notif.remove(), TOOLTIP_FADE_OUT_MS);
      };
      setTimeout(removeTooltip, TOOLTIP_DURATION_MS);
      
      return;
    }
    
    // Regular notification (existing code)
    // Get position styles based on notifPosition setting
    let positionStyles = '';
    let isCenter = false;
    switch (CONFIG.notifPosition) {
      case 'top-left':
        positionStyles = 'top: 20px; left: 20px;';
        break;
      case 'top-center':
        positionStyles = 'top: 20px; left: 50%;';
        isCenter = true;
        break;
      case 'top-right':
        positionStyles = 'top: 20px; right: 20px;';
        break;
      case 'bottom-left':
        positionStyles = 'bottom: 20px; left: 20px;';
        break;
      case 'bottom-center':
        positionStyles = 'bottom: 20px; left: 50%;';
        isCenter = true;
        break;
      case 'bottom-right':
      default:
        positionStyles = 'bottom: 20px; right: 20px;';
        break;
    }
    
    // Get size styles based on notifSize setting
    let fontSize = '14px';
    let padding = '12px 20px';
    switch (CONFIG.notifSize) {
      case 'small':
        fontSize = '12px';
        padding = '8px 14px';
        break;
      case 'medium':
        fontSize = '14px';
        padding = '12px 20px';
        break;
      case 'large':
        fontSize = '16px';
        padding = '16px 26px';
        break;
    }
    
    // Get animation name
    let animationName = '';
    const animation = CONFIG.notifAnimation || 'slide';
    switch (animation) {
      case 'slide':
        animationName = 'notifSlideIn';
        break;
      case 'pop':
        animationName = 'notifPopIn';
        break;
      case 'none':
        animationName = 'notifFadeIn';
        break;
      default:
        animationName = 'notifSlideIn';
    }
    
    // Border styles
    const borderWidth = CONFIG.notifBorderWidth || 1;
    const borderColor = CONFIG.notifBorderColor || '#000000';
    
    notif.style.cssText = `
      position: fixed;
      ${positionStyles}
      ${isCenter ? 'transform: translateX(-50%);' : ''}
      background: ${CONFIG.notifColor};
      color: #fff;
      padding: ${padding};
      border-radius: 6px;
      border: ${borderWidth}px solid ${borderColor};
      z-index: 999999;
      font-size: ${fontSize};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      animation: ${animationName} 0.3s ease-out;
    `;
    
    // Create animation styles based on position and animation type
    if (!document.querySelector('style[data-copy-url-notif]')) {
      const style = document.createElement('style');
      style.setAttribute('data-copy-url-notif', 'true');
      
      const position = CONFIG.notifPosition || 'bottom-right';
      
      let slideKeyframes = '';
      if (position.includes('center')) {
        if (position.includes('top')) {
          slideKeyframes = `
            @keyframes notifSlideIn {
              from { opacity: 0; margin-top: -50px; }
              to { opacity: 1; margin-top: 0; }
            }
          `;
        } else {
          slideKeyframes = `
            @keyframes notifSlideIn {
              from { opacity: 0; margin-bottom: -50px; }
              to { opacity: 1; margin-bottom: 0; }
            }
          `;
        }
      } else if (position.includes('right')) {
        slideKeyframes = `
          @keyframes notifSlideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `;
      } else if (position.includes('left')) {
        slideKeyframes = `
          @keyframes notifSlideIn {
            from { transform: translateX(-400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `;
      }
      
      const popKeyframes = `
        @keyframes notifPopIn {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); opacity: 1; }
        }
      `;
      
      const fadeKeyframes = `
        @keyframes notifFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `;
      
      style.textContent = slideKeyframes + popKeyframes + fadeKeyframes;
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

// Check modifiers
function checkModifiers(requireCtrl, requireAlt, requireShift, event) {
  const ctrlPressed = event.ctrlKey || event.metaKey;
  const altPressed = event.altKey;
  const shiftPressed = event.shiftKey;
  
  return (requireCtrl === ctrlPressed && requireAlt === altPressed && requireShift === shiftPressed);
}

// Check if on a restricted page
function isRestrictedPage() {
  const url = window.location.href;
  return url.startsWith('about:') || 
         url.startsWith('chrome:') || 
         url.startsWith('moz-extension:') ||
         url.startsWith('chrome-extension:');
}

// Try to inject content script functionality into same-origin iframe
function tryInjectIntoIframe(iframe) {
  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      debug('Cannot access iframe document - likely cross-origin');
      return;
    }
    
    // Check if we can access the iframe (same-origin check)
    const iframeUrl = iframe.contentWindow.location.href;
    debug(`Attempting to inject into iframe: ${iframeUrl}`);
    
    // Create a script element with our content script's functionality
    // We'll create a minimal version that enables Quick Tabs within the iframe
    const script = iframeDoc.createElement('script');
    script.textContent = `
      // Minimal Quick Tab support for iframes
      (function() {
        if (window.__quickTabEnabled) return; // Already injected
        window.__quickTabEnabled = true;
        
        // Send message to parent to create Quick Tab
        function createQuickTabInParent(url) {
          // Get the parent origin for secure message passing
          const parentOrigin = (window.location.ancestorOrigins && window.location.ancestorOrigins[0]) 
            || window.location.origin;
          window.parent.postMessage({
            type: 'CREATE_QUICK_TAB',
            url: url
          }, parentOrigin);
        }
        
        // Add event listener for link hover
        document.addEventListener('keydown', function(event) {
          if (event.key === 'q' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
            // For keyboard events, we need to find the currently hovered element
            let link = null;
            
            // Try to find hovered link using :hover pseudo-class
            const hovered = document.querySelectorAll(':hover');
            for (let el of hovered) {
              if (el.tagName === 'A' && el.href) {
                link = el;
                break;
              }
            }
            
            if (link && link.href) {
              event.preventDefault();
              createQuickTabInParent(link.href);
            }
          }
        }, true);
        
        console.log('[CopyURLHover] Nested Quick Tab support enabled in iframe');
      })();
    `;
    
    iframeDoc.head.appendChild(script);
    debug('Successfully injected Quick Tab support into same-origin iframe');
  } catch (err) {
    // Expected for cross-origin iframes
    debug('Could not inject into iframe (expected for cross-origin): ' + err.message);
  }
}

// Create Quick Tab window
function createQuickTabWindow(url, width, height, left, top, fromBroadcast = false, pinnedToUrl = null) {
  if (isRestrictedPage()) {
    showNotification('✗ Quick Tab not available on this page');
    debug('Quick Tab blocked on restricted page');
    return;
  }
  
  // Check max windows limit
  if (quickTabWindows.length >= CONFIG.quickTabMaxWindows) {
    showNotification(`✗ Maximum ${CONFIG.quickTabMaxWindows} Quick Tabs allowed`);
    debug(`Maximum Quick Tab windows (${CONFIG.quickTabMaxWindows}) reached`);
    return;
  }
  
  debug(`Creating Quick Tab for URL: ${url}`);
  
  // Use provided dimensions or defaults
  const windowWidth = width || CONFIG.quickTabDefaultWidth;
  const windowHeight = height || CONFIG.quickTabDefaultHeight;
  
  // Create container
  const container = document.createElement('div');
  container.className = 'copy-url-quicktab-window';
  container.style.cssText = `
    position: fixed;
    width: ${windowWidth}px;
    height: ${windowHeight}px;
    background: ${CONFIG.darkMode ? '#2d2d2d' : '#ffffff'};
    border: 2px solid ${CONFIG.darkMode ? '#555' : '#ddd'};
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: ${quickTabZIndex++};
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 300px;
    min-height: 200px;
  `;
  
  // Position the window
  let posX, posY;
  
  // If position is provided (from restore), use it
  if (left !== undefined && top !== undefined) {
    posX = left;
    posY = top;
  } else {
    // Otherwise calculate based on settings
    switch (CONFIG.quickTabPosition) {
      case 'follow-cursor':
        posX = lastMouseX + 10;
        posY = lastMouseY + 10;
        break;
      case 'center':
        posX = (window.innerWidth - windowWidth) / 2;
        posY = (window.innerHeight - windowHeight) / 2;
        break;
      case 'top-left':
        posX = 20;
        posY = 20;
        break;
      case 'top-right':
        posX = window.innerWidth - windowWidth - 20;
        posY = 20;
        break;
      case 'bottom-left':
        posX = 20;
        posY = window.innerHeight - windowHeight - 20;
        break;
      case 'bottom-right':
        posX = window.innerWidth - windowWidth - 20;
        posY = window.innerHeight - windowHeight - 20;
        break;
      case 'custom':
        posX = CONFIG.quickTabCustomX;
        posY = CONFIG.quickTabCustomY;
        break;
      default:
        posX = lastMouseX + 10;
        posY = lastMouseY + 10;
    }
  }
  
  // Ensure window stays within viewport
  posX = Math.max(0, Math.min(posX, window.innerWidth - windowWidth));
  posY = Math.max(0, Math.min(posY, window.innerHeight - windowHeight));
  
  container.style.left = posX + 'px';
  container.style.top = posY + 'px';
  
  // Create iframe first (needed for button handlers)
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.style.cssText = `
    flex: 1;
    border: none;
    width: 100%;
    background: white;
  `;
  
  // Create title bar
  const titleBar = document.createElement('div');
  titleBar.className = 'copy-url-quicktab-titlebar';
  titleBar.style.cssText = `
    height: 40px;
    background: ${CONFIG.darkMode ? '#1e1e1e' : '#f5f5f5'};
    border-bottom: 1px solid ${CONFIG.darkMode ? '#555' : '#ddd'};
    display: flex;
    align-items: center;
    padding: 0 10px;
    user-select: none;
    gap: 5px;
    cursor: move;
  `;
  
  // Navigation buttons container
  const navContainer = document.createElement('div');
  navContainer.style.cssText = `
    display: flex;
    gap: 4px;
    align-items: center;
  `;
  
  // Helper function to create navigation button
  const createNavButton = (symbol, title) => {
    const btn = document.createElement('button');
    btn.textContent = symbol;
    btn.title = title;
    btn.style.cssText = `
      width: 24px;
      height: 24px;
      background: transparent;
      color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    `;
    btn.onmouseover = () => btn.style.background = CONFIG.darkMode ? '#444' : '#e0e0e0';
    btn.onmouseout = () => btn.style.background = 'transparent';
    return btn;
  };
  
  // Back button
  const backBtn = createNavButton('←', 'Back');
  backBtn.onclick = (e) => {
    e.stopPropagation();
    if (iframe.contentWindow) {
      try {
        iframe.contentWindow.history.back();
      } catch (err) {
        debug('Cannot navigate back - cross-origin restriction');
      }
    }
  };
  
  // Forward button
  const forwardBtn = createNavButton('→', 'Forward');
  forwardBtn.onclick = (e) => {
    e.stopPropagation();
    if (iframe.contentWindow) {
      try {
        iframe.contentWindow.history.forward();
      } catch (err) {
        debug('Cannot navigate forward - cross-origin restriction');
      }
    }
  };
  
  // Reload button
  const reloadBtn = createNavButton('↻', 'Reload');
  reloadBtn.onclick = (e) => {
    e.stopPropagation();
    iframe.src = iframe.src;
  };
  
  navContainer.appendChild(backBtn);
  navContainer.appendChild(forwardBtn);
  navContainer.appendChild(reloadBtn);
  
  // Favicon
  const favicon = document.createElement('img');
  favicon.style.cssText = `
    width: 16px;
    height: 16px;
    margin-left: 5px;
  `;
  // Extract domain for favicon
  try {
    const urlObj = new URL(url);
    favicon.src = `${GOOGLE_FAVICON_URL}${urlObj.hostname}&sz=32`;
    favicon.onerror = () => {
      favicon.style.display = 'none';
    };
  } catch (e) {
    favicon.style.display = 'none';
  }
  
  // Title text
  const titleText = document.createElement('span');
  titleText.textContent = 'Loading...';
  titleText.style.cssText = `
    flex: 1;
    font-size: 12px;
    font-weight: 500;
    color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0 5px;
  `;
  
  // Minimize button
  const minimizeBtn = document.createElement('button');
  minimizeBtn.textContent = '−';
  minimizeBtn.title = 'Minimize';
  minimizeBtn.style.cssText = `
    width: 24px;
    height: 24px;
    background: transparent;
    color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  `;
  minimizeBtn.onmouseover = () => minimizeBtn.style.background = CONFIG.darkMode ? '#444' : '#e0e0e0';
  minimizeBtn.onmouseout = () => minimizeBtn.style.background = 'transparent';
  minimizeBtn.onclick = (e) => {
    e.stopPropagation();
    minimizeQuickTab(container, iframe.src, titleText.textContent);
  };
  
  // Open in new tab button
  const openBtn = document.createElement('button');
  openBtn.textContent = '🔗';
  openBtn.title = 'Open in New Tab';
  openBtn.style.cssText = `
    width: 24px;
    height: 24px;
    background: transparent;
    color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  `;
  openBtn.onmouseover = () => openBtn.style.background = CONFIG.darkMode ? '#444' : '#e0e0e0';
  openBtn.onmouseout = () => openBtn.style.background = 'transparent';
  openBtn.onclick = (e) => {
    e.stopPropagation();
    browser.runtime.sendMessage({ 
      action: 'openTab', 
      url: iframe.src,
      switchFocus: true  // Always switch focus when opening from Quick Tab
    });
    showNotification('✓ Opened in new tab');
    debug(`Quick Tab opened URL in new tab: ${iframe.src}`);
    
    // Close Quick Tab if setting is enabled
    if (CONFIG.quickTabCloseOnOpen) {
      closeQuickTabWindow(container);
    }
  };
  
  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  closeBtn.style.cssText = `
    width: 24px;
    height: 24px;
    background: transparent;
    color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  `;
  closeBtn.onmouseover = () => closeBtn.style.background = CONFIG.darkMode ? '#ff5555' : '#ffcccc';
  closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeQuickTabWindow(container);
  };
  
  titleBar.appendChild(navContainer);
  titleBar.appendChild(favicon);
  titleBar.appendChild(titleText);
  
  // Pin button (before minimize button)
  const pinBtn = document.createElement('button');
  pinBtn.textContent = pinnedToUrl ? '📌' : '📍';
  pinBtn.title = pinnedToUrl ? `Pinned to: ${pinnedToUrl}` : 'Pin to current page';
  pinBtn.style.cssText = `
    width: 24px;
    height: 24px;
    background: ${pinnedToUrl ? (CONFIG.darkMode ? '#444' : '#e0e0e0') : 'transparent'};
    color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  `;
  pinBtn.onmouseover = () => pinBtn.style.background = CONFIG.darkMode ? '#444' : '#e0e0e0';
  pinBtn.onmouseout = () => pinBtn.style.background = pinnedToUrl ? (CONFIG.darkMode ? '#444' : '#e0e0e0') : 'transparent';
  pinBtn.onclick = (e) => {
    e.stopPropagation();
    
    // Toggle pin state
    if (container._pinnedToUrl) {
      // Unpin
      container._pinnedToUrl = null;
      pinBtn.textContent = '📍';
      pinBtn.title = 'Pin to current page';
      pinBtn.style.background = 'transparent';
      showNotification('✓ Quick Tab unpinned');
      debug(`Quick Tab unpinned: ${iframe.src}`);
    } else {
      // Pin to current page URL
      const currentPageUrl = window.location.href;
      container._pinnedToUrl = currentPageUrl;
      pinBtn.textContent = '📌';
      pinBtn.title = `Pinned to: ${currentPageUrl}`;
      pinBtn.style.background = CONFIG.darkMode ? '#444' : '#e0e0e0';
      showNotification('✓ Quick Tab pinned to this page');
      debug(`Quick Tab pinned to: ${currentPageUrl}`);
    }
    
    // Save updated state
    if (CONFIG.quickTabPersistAcrossTabs) {
      saveQuickTabsToStorage();
    }
  };
  
  titleBar.appendChild(pinBtn);
  titleBar.appendChild(minimizeBtn);
  titleBar.appendChild(openBtn);
  titleBar.appendChild(closeBtn);
  
  container.appendChild(titleBar);
  container.appendChild(iframe);
  
  // Try to update title when iframe loads
  iframe.addEventListener('load', () => {
    try {
      // This will fail for cross-origin iframes, but that's okay
      const iframeTitle = iframe.contentDocument?.title;
      if (iframeTitle) {
        titleText.textContent = iframeTitle;
        titleText.title = iframeTitle;
      } else {
        // Fallback to URL
        try {
          const urlObj = new URL(iframe.src);
          titleText.textContent = urlObj.hostname;
          titleText.title = iframe.src;
        } catch (e) {
          titleText.textContent = 'Quick Tab';
        }
      }
      
      // Try to inject content script into same-origin iframe for nested Quick Tabs
      tryInjectIntoIframe(iframe);
    } catch (e) {
      // Cross-origin - use URL instead
      try {
        const urlObj = new URL(iframe.src);
        titleText.textContent = urlObj.hostname;
        titleText.title = iframe.src;
      } catch (err) {
        titleText.textContent = 'Quick Tab';
      }
    }
  });
  
  // Add to DOM
  document.documentElement.appendChild(container);
  
  // Store the pinned URL on the container
  container._pinnedToUrl = pinnedToUrl;
  
  // Add to tracking array
  quickTabWindows.push(container);
  
  // Make draggable
  makeDraggable(container, titleBar);
  
  // Make resizable if enabled
  if (CONFIG.quickTabEnableResize) {
    makeResizable(container);
  }
  
  // Bring to front on click
  container.addEventListener('mousedown', () => {
    container.style.zIndex = quickTabZIndex++;
  });
  
  showNotification('✓ Quick Tab opened');
  debug(`Quick Tab window created. Total windows: ${quickTabWindows.length}`);
  
  // Broadcast to other tabs using BroadcastChannel for real-time sync
  // Only broadcast if this wasn't created from a broadcast (prevent infinite loop)
  if (!fromBroadcast && CONFIG.quickTabPersistAcrossTabs) {
    broadcastQuickTabCreation(url, windowWidth, windowHeight, posX, posY, pinnedToUrl);
    saveQuickTabsToStorage();
  }
}

// Close Quick Tab window
function closeQuickTabWindow(container, broadcast = true) {
  const index = quickTabWindows.indexOf(container);
  if (index > -1) {
    quickTabWindows.splice(index, 1);
  }
  
  // Get URL before removing the container
  const iframe = container.querySelector('iframe');
  const url = iframe ? iframe.src : null;
  
  // Clean up drag listeners
  if (container._dragCleanup) {
    container._dragCleanup();
  }
  // Clean up resize listeners
  if (container._resizeCleanup) {
    container._resizeCleanup();
  }
  container.remove();
  debug(`Quick Tab window closed. Remaining windows: ${quickTabWindows.length}`);
  
  // Always save updated state to storage after closing
  if (CONFIG.quickTabPersistAcrossTabs) {
    saveQuickTabsToStorage();
  }
  
  // Broadcast close to other tabs if enabled
  if (broadcast && url && CONFIG.quickTabPersistAcrossTabs) {
    broadcastQuickTabClose(url);
  }
}

// Close all Quick Tab windows
function closeAllQuickTabWindows(broadcast = true) {
  const count = quickTabWindows.length;
  quickTabWindows.forEach(window => {
    if (window._dragCleanup) {
      window._dragCleanup();
    }
    if (window._resizeCleanup) {
      window._resizeCleanup();
    }
    window.remove();
  });
  quickTabWindows = [];
  if (count > 0) {
    showNotification(`✓ Closed ${count} Quick Tab${count > 1 ? 's' : ''}`);
    debug(`All Quick Tab windows closed (${count} total)`);
  }
  
  // Always clear storage when all tabs are closed
  if (CONFIG.quickTabPersistAcrossTabs) {
    clearQuickTabsFromStorage();
  }
  
  // Broadcast to other tabs if enabled
  if (broadcast && CONFIG.quickTabPersistAcrossTabs) {
    broadcastCloseAll();
  }
}

// Minimize Quick Tab
function minimizeQuickTab(container, url, title) {
  const index = quickTabWindows.indexOf(container);
  if (index > -1) {
    quickTabWindows.splice(index, 1);
  }
  
  // Store minimized tab info
  minimizedQuickTabs.push({
    url: url,
    title: title || 'Quick Tab',
    timestamp: Date.now()
  });
  
  // Clean up and hide
  container.remove();
  
  showNotification('✓ Quick Tab minimized');
  debug(`Quick Tab minimized. Total minimized: ${minimizedQuickTabs.length}`);
  
  // Update or create minimized tabs manager
  updateMinimizedTabsManager();
  
  // Save to storage if persistence is enabled
  if (CONFIG.quickTabPersistAcrossTabs) {
    saveQuickTabsToStorage();
  }
}

// Restore minimized Quick Tab
function restoreQuickTab(index) {
  if (index < 0 || index >= minimizedQuickTabs.length) return;
  
  const tab = minimizedQuickTabs[index];
  minimizedQuickTabs.splice(index, 1);
  
  createQuickTabWindow(tab.url);
  updateMinimizedTabsManager();
  
  debug(`Quick Tab restored from minimized. Remaining minimized: ${minimizedQuickTabs.length}`);
}

// Delete minimized Quick Tab
function deleteMinimizedQuickTab(index) {
  if (index < 0 || index >= minimizedQuickTabs.length) return;
  
  minimizedQuickTabs.splice(index, 1);
  showNotification('✓ Minimized Quick Tab deleted');
  updateMinimizedTabsManager();
  
  debug(`Minimized Quick Tab deleted. Remaining minimized: ${minimizedQuickTabs.length}`);
}

// Update or create the minimized tabs manager window
function updateMinimizedTabsManager() {
  let manager = document.querySelector('.copy-url-minimized-manager');
  
  if (minimizedQuickTabs.length === 0) {
    // Remove manager if no tabs
    if (manager) {
      manager.remove();
    }
    return;
  }
  
  if (!manager) {
    // Create new manager
    manager = document.createElement('div');
    manager.className = 'copy-url-minimized-manager';
    manager.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 280px;
      max-height: 400px;
      background: ${CONFIG.darkMode ? '#2d2d2d' : '#ffffff'};
      border: 2px solid ${CONFIG.darkMode ? '#555' : '#ddd'};
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: ${quickTabZIndex + 1000};
      overflow: hidden;
      display: flex;
      flex-direction: column;
    `;
    
    // Manager header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 10px;
      background: ${CONFIG.darkMode ? '#1e1e1e' : '#f5f5f5'};
      border-bottom: 1px solid ${CONFIG.darkMode ? '#555' : '#ddd'};
      font-weight: 600;
      font-size: 13px;
      color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    header.textContent = 'Minimized Quick Tabs';
    
    // Close manager button
    const closeManagerBtn = document.createElement('button');
    closeManagerBtn.textContent = '✕';
    closeManagerBtn.style.cssText = `
      width: 20px;
      height: 20px;
      background: transparent;
      color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      padding: 0;
    `;
    closeManagerBtn.onclick = () => {
      manager.remove();
    };
    header.appendChild(closeManagerBtn);
    
    manager.appendChild(header);
    
    // List container
    const listContainer = document.createElement('div');
    listContainer.className = 'minimized-list';
    listContainer.style.cssText = `
      overflow-y: auto;
      max-height: 340px;
      padding: 5px;
    `;
    manager.appendChild(listContainer);
    
    document.documentElement.appendChild(manager);
    
    // Make draggable
    makeDraggable(manager, header);
  }
  
  // Update list
  const listContainer = manager.querySelector('.minimized-list');
  listContainer.innerHTML = '';
  
  minimizedQuickTabs.forEach((tab, index) => {
    const item = document.createElement('div');
    item.style.cssText = `
      padding: 8px;
      margin: 3px;
      background: ${CONFIG.darkMode ? '#3a3a3a' : '#f9f9f9'};
      border: 1px solid ${CONFIG.darkMode ? '#555' : '#ddd'};
      border-radius: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: background 0.2s;
    `;
    item.onmouseover = () => item.style.background = CONFIG.darkMode ? '#444' : '#f0f0f0';
    item.onmouseout = () => item.style.background = CONFIG.darkMode ? '#3a3a3a' : '#f9f9f9';
    
    // Favicon
    const favicon = document.createElement('img');
    favicon.style.cssText = 'width: 16px; height: 16px; flex-shrink: 0;';
    try {
      const urlObj = new URL(tab.url);
      favicon.src = `${GOOGLE_FAVICON_URL}${urlObj.hostname}&sz=32`;
      favicon.onerror = () => { favicon.style.display = 'none'; };
    } catch (e) {
      favicon.style.display = 'none';
    }
    
    // Title
    const title = document.createElement('span');
    title.textContent = tab.title;
    title.style.cssText = `
      flex: 1;
      font-size: 12px;
      color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    
    // Restore button
    const restoreBtn = document.createElement('button');
    restoreBtn.textContent = '↑';
    restoreBtn.title = 'Restore';
    restoreBtn.style.cssText = `
      width: 24px;
      height: 24px;
      background: #4CAF50;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      flex-shrink: 0;
    `;
    restoreBtn.onclick = (e) => {
      e.stopPropagation();
      restoreQuickTab(index);
    };
    
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Delete';
    deleteBtn.style.cssText = `
      width: 24px;
      height: 24px;
      background: #f44336;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      flex-shrink: 0;
    `;
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteMinimizedQuickTab(index);
    };
    
    item.appendChild(favicon);
    item.appendChild(title);
    item.appendChild(restoreBtn);
    item.appendChild(deleteBtn);
    
    // Click on item to restore
    item.onclick = () => restoreQuickTab(index);
    
    listContainer.appendChild(item);
  });
}

// Make element draggable
function makeDraggable(element, handle) {
  let isDragging = false;
  let offsetX = 0, offsetY = 0; // Store click offset within the element
  let updateIntervalId = null;
  let pendingX = null;
  let pendingY = null;
  let lastUpdateTime = 0;
  let dragOverlay = null; // Expanded hit area overlay
  
  // Get update rate from config (default 360 Hz = ~2.78ms interval)
  // This allows position updates to keep up with high refresh rate monitors
  const getUpdateInterval = () => {
    const updatesPerSecond = CONFIG.quickTabUpdateRate || 360;
    return 1000 / updatesPerSecond; // Convert Hz to milliseconds
  };
  
  const updatePosition = () => {
    if (pendingX !== null && pendingY !== null) {
      element.style.left = pendingX + 'px';
      element.style.top = pendingY + 'px';
      lastUpdateTime = performance.now();
      pendingX = null;
      pendingY = null;
    }
  };
  
  const createDragOverlay = () => {
    // Create an invisible overlay that extends beyond the Quick Tab bounds
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 999999999;
      cursor: move;
      pointer-events: auto;
    `;
    document.documentElement.appendChild(overlay);
    return overlay;
  };
  
  const removeDragOverlay = () => {
    if (dragOverlay) {
      dragOverlay.remove();
      dragOverlay = null;
    }
  };
  
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    // Additional safety check: ensure mouse button is still pressed
    if (e.buttons === 0) {
      // Mouse button was released but we missed the mouseup event
      handleMouseUp();
      return;
    }
    
    // Calculate new position based on current mouse position minus the offset
    // This keeps the element at the same relative position to the cursor
    let newX = e.clientX - offsetX;
    let newY = e.clientY - offsetY;
    
    // Allow Quick Tabs to move outside viewport boundaries
    // No constraints applied - can be moved anywhere including outside screen
    
    // Store the new position
    pendingX = newX;
    pendingY = newY;
    
    // Immediate update strategy to prevent "slip out" on high refresh rate monitors
    // Check if enough time has passed since last update
    const now = performance.now();
    const timeSinceLastUpdate = now - lastUpdateTime;
    const minInterval = getUpdateInterval();
    
    if (timeSinceLastUpdate >= minInterval) {
      // Update immediately if interval has passed
      updatePosition();
    }
    
    e.preventDefault();
  };
  
  const handleMouseUp = (e) => {
    // Always reset dragging state, even if called multiple times
    isDragging = false;
    
    // Remove the expanded overlay
    removeDragOverlay();
    
    // Clear any update interval
    if (updateIntervalId) {
      clearInterval(updateIntervalId);
      updateIntervalId = null;
    }
    
    // Apply any pending position immediately
    if (pendingX !== null && pendingY !== null) {
      element.style.left = pendingX + 'px';
      element.style.top = pendingY + 'px';
      
      // Broadcast move to other tabs
      const iframe = element.querySelector('iframe');
      if (iframe && CONFIG.quickTabPersistAcrossTabs) {
        broadcastQuickTabMove(iframe.src, pendingX, pendingY);
        saveQuickTabsToStorage();
      }
      
      pendingX = null;
      pendingY = null;
    }
  };
  
  const handleMouseDown = (e) => {
    // Don't drag if clicking on a button or img
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'IMG') {
      return;
    }
    
    // Only start dragging on left mouse button
    if (e.button !== 0) {
      return;
    }
    
    isDragging = true;
    
    // Create the expanded drag overlay
    dragOverlay = createDragOverlay();
    
    // Calculate the offset between the mouse position and the element's top-left corner
    const rect = element.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    
    lastUpdateTime = performance.now();
    
    e.preventDefault();
  };
  
  // Also handle mouseleave to ensure we stop dragging if mouse leaves the document
  const handleMouseLeave = (e) => {
    if (isDragging && e.buttons === 0) {
      handleMouseUp(e);
    }
  };
  
  handle.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mousemove', handleMouseMove, { passive: false });
  document.addEventListener('mouseup', handleMouseUp, true);
  document.addEventListener('mouseleave', handleMouseLeave, true);
  // Also listen on window to catch mouseup events that occur outside the browser window
  window.addEventListener('mouseup', handleMouseUp, true);
  window.addEventListener('blur', handleMouseUp, true);
  
  // Store cleanup function
  element._dragCleanup = () => {
    removeDragOverlay();
    handle.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp, true);
    document.removeEventListener('mouseleave', handleMouseLeave, true);
    window.removeEventListener('mouseup', handleMouseUp, true);
    window.removeEventListener('blur', handleMouseUp, true);
    if (updateIntervalId) {
      clearInterval(updateIntervalId);
    }
  };
}

// Make Quick Tab window resizable
function makeResizable(element) {
  const minWidth = 300;
  const minHeight = 200;
  const handleSize = 10;
  
  // Create resize handles
  const handles = {
    'se': { cursor: 'se-resize', bottom: 0, right: 0 },
    'sw': { cursor: 'sw-resize', bottom: 0, left: 0 },
    'ne': { cursor: 'ne-resize', top: 0, right: 0 },
    'nw': { cursor: 'nw-resize', top: 0, left: 0 },
    'e': { cursor: 'e-resize', top: handleSize, right: 0, bottom: handleSize },
    'w': { cursor: 'w-resize', top: handleSize, left: 0, bottom: handleSize },
    's': { cursor: 's-resize', bottom: 0, left: handleSize, right: handleSize },
    'n': { cursor: 'n-resize', top: 0, left: handleSize, right: handleSize }
  };
  
  const resizeHandleElements = [];
  
  Object.entries(handles).forEach(([direction, style]) => {
    const handle = document.createElement('div');
    handle.className = 'copy-url-resize-handle';
    handle.style.cssText = `
      position: absolute;
      ${style.top !== undefined ? `top: ${style.top}px;` : ''}
      ${style.bottom !== undefined ? `bottom: ${style.bottom}px;` : ''}
      ${style.left !== undefined ? `left: ${style.left}px;` : ''}
      ${style.right !== undefined ? `right: ${style.right}px;` : ''}
      ${direction.includes('e') || direction.includes('w') ? `width: ${handleSize}px;` : ''}
      ${direction.includes('n') || direction.includes('s') ? `height: ${handleSize}px;` : ''}
      ${direction.length === 2 ? `width: ${handleSize}px; height: ${handleSize}px;` : ''}
      cursor: ${style.cursor};
      z-index: 10;
    `;
    
    let isResizing = false;
    let startX, startY, startWidth, startHeight, startLeft, startTop;
    let animationFrameId = null;
    let pendingResize = null;
    let resizeOverlay = null;
    
    const createResizeOverlay = () => {
      // Create an invisible overlay that extends beyond the Quick Tab bounds
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 999999999;
        cursor: ${style.cursor};
        pointer-events: auto;
      `;
      document.documentElement.appendChild(overlay);
      return overlay;
    };
    
    const removeResizeOverlay = () => {
      if (resizeOverlay) {
        resizeOverlay.remove();
        resizeOverlay = null;
      }
    };
    
    const handleMouseDown = (e) => {
      if (e.button !== 0) return;
      
      isResizing = true;
      
      // Create the expanded resize overlay
      resizeOverlay = createResizeOverlay();
      
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      startWidth = rect.width;
      startHeight = rect.height;
      startLeft = rect.left;
      startTop = rect.top;
      
      e.preventDefault();
      e.stopPropagation();
    };
    
    const applyResize = () => {
      if (pendingResize) {
        element.style.width = pendingResize.width + 'px';
        element.style.height = pendingResize.height + 'px';
        element.style.left = pendingResize.left + 'px';
        element.style.top = pendingResize.top + 'px';
        pendingResize = null;
        animationFrameId = null;
      }
    };
    
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      
      // Safety check for lost mouseup
      if (e.buttons === 0) {
        handleMouseUp();
        return;
      }
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      let newWidth = startWidth;
      let newHeight = startHeight;
      let newLeft = startLeft;
      let newTop = startTop;
      
      // Adjust based on direction
      if (direction.includes('e')) {
        newWidth = Math.max(minWidth, startWidth + dx);
      }
      if (direction.includes('w')) {
        const maxDx = startWidth - minWidth;
        const constrainedDx = Math.min(dx, maxDx);
        newWidth = startWidth - constrainedDx;
        newLeft = startLeft + constrainedDx;
      }
      if (direction.includes('s')) {
        newHeight = Math.max(minHeight, startHeight + dy);
      }
      if (direction.includes('n')) {
        const maxDy = startHeight - minHeight;
        const constrainedDy = Math.min(dy, maxDy);
        newHeight = startHeight - constrainedDy;
        newTop = startTop + constrainedDy;
      }
      
      // Allow Quick Tabs to be resized beyond viewport boundaries
      // No viewport constraints applied
      
      // Store pending resize
      pendingResize = { width: newWidth, height: newHeight, left: newLeft, top: newTop };
      
      // Schedule update using requestAnimationFrame for smooth resizing
      if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(applyResize);
      }
      
      e.preventDefault();
    };
    
    const handleMouseUp = () => {
      isResizing = false;
      
      // Remove the expanded overlay
      removeResizeOverlay();
      
      // Apply any pending resize immediately
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (pendingResize) {
        element.style.width = pendingResize.width + 'px';
        element.style.height = pendingResize.height + 'px';
        element.style.left = pendingResize.left + 'px';
        element.style.top = pendingResize.top + 'px';
        
        // Broadcast resize to other tabs
        const iframe = element.querySelector('iframe');
        if (iframe && CONFIG.quickTabPersistAcrossTabs) {
          broadcastQuickTabResize(iframe.src, pendingResize.width, pendingResize.height);
          // Also broadcast the position change if it was adjusted
          broadcastQuickTabMove(iframe.src, pendingResize.left, pendingResize.top);
          saveQuickTabsToStorage();
        }
        
        pendingResize = null;
      }
    };
    
    handle.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    window.addEventListener('blur', handleMouseUp, true);
    
    element.appendChild(handle);
    resizeHandleElements.push({ handle, handleMouseDown, handleMouseMove, handleMouseUp, removeResizeOverlay });
  });
  
  // Store cleanup function
  element._resizeCleanup = () => {
    resizeHandleElements.forEach(({ handle, handleMouseDown, handleMouseMove, handleMouseUp, removeResizeOverlay }) => {
      removeResizeOverlay();
      handle.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('blur', handleMouseUp, true);
      handle.remove();
    });
  };
}

// Check modifiers
// Keyboard handler
document.addEventListener('keydown', function(event) {
  // Handle Quick Tab close on Escape
  if (event.key === CONFIG.quickTabCloseKey && quickTabWindows.length > 0) {
    event.preventDefault();
    event.stopPropagation();
    closeAllQuickTabWindows();
    return;
  }
  
  if (!currentHoveredLink && !currentHoveredElement) return;
  
  if (event.target.tagName === 'INPUT' || 
      event.target.tagName === 'TEXTAREA' || 
      event.target.contentEditable === 'true') {
    return;
  }
  
  const key = event.key.toLowerCase();
  const element = currentHoveredLink || currentHoveredElement;
  const domainType = getDomainType();
  const url = findUrl(element, domainType);
  
  // Open Link in New Tab
  if (key === CONFIG.openNewTabKey.toLowerCase() && 
      checkModifiers(CONFIG.openNewTabCtrl, CONFIG.openNewTabAlt, CONFIG.openNewTabShift, event)) {
    event.preventDefault();
    event.stopPropagation();
    
    if (!url) {
      showNotification('✗ No URL found');
      return;
    }
    
    debug(`Opening URL in new tab: ${url}`);
    browser.runtime.sendMessage({ 
      action: 'openTab', 
      url: url,
      switchFocus: CONFIG.openNewTabSwitchFocus 
    });
    showNotification('✓ Opened in new tab');
  }
  
  // Quick Tab on Hover
  else if (key === CONFIG.quickTabKey.toLowerCase() && 
           checkModifiers(CONFIG.quickTabCtrl, CONFIG.quickTabAlt, CONFIG.quickTabShift, event)) {
    event.preventDefault();
    event.stopPropagation();
    
    if (!url) {
      showNotification('✗ No URL found');
      return;
    }
    
    createQuickTabWindow(url);
  }
  
  // Copy URL
  else if (key === CONFIG.copyUrlKey.toLowerCase() && 
      checkModifiers(CONFIG.copyUrlCtrl, CONFIG.copyUrlAlt, CONFIG.copyUrlShift, event)) {
    event.preventDefault();
    event.stopPropagation();
    
    if (!url) {
      showNotification('✗ No URL found');
      return;
    }
    
    navigator.clipboard.writeText(url).then(() => {
      showNotification('✓ URL copied!', { tooltip: true });
    }).catch(() => {
      showNotification('✗ Copy failed');
    });
  }
  
  // Copy Text
  else if (key === CONFIG.copyTextKey.toLowerCase() && 
           checkModifiers(CONFIG.copyTextCtrl, CONFIG.copyTextAlt, CONFIG.copyTextShift, event)) {
    event.preventDefault();
    event.stopPropagation();
    
    const text = getLinkText(element);
    
    navigator.clipboard.writeText(text).then(() => {
      showNotification('✓ Text copied!');
    }).catch(() => {
      showNotification('✗ Copy failed');
    });
  }
}, true);

// Message listener for nested Quick Tabs from iframes
window.addEventListener('message', function(event) {
  // Validate origin - only accept from same origin or about:blank iframes
  const currentOrigin = window.location.origin;
  if (event.origin !== currentOrigin && event.origin !== 'null') {
    debug(`Rejected message from unauthorized origin: ${event.origin}`);
    return;
  }
  
  // Only accept messages from same origin or our iframes
  if (event.data && event.data.type === 'CREATE_QUICK_TAB') {
    const url = event.data.url;
    if (url) {
      debug(`Received Quick Tab request from iframe: ${url}`);
      createQuickTabWindow(url);
    }
  }
});

// Storage listener
browser.storage.onChanged.addListener(function(changes, areaName) {
  if (areaName === 'local') {
    loadSettings();
  }
});

// Runtime message listener for background script messages
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'tabActivated') {
    debug('Tab activated, checking for stored Quick Tabs');
    restoreQuickTabsFromStorage();
    sendResponse({ received: true });
  }
  return true; // Keep channel open for async response
});

// Initialize
loadSettings();

// Initialize BroadcastChannel for cross-tab sync
initializeBroadcastChannel();

// Restore Quick Tabs from localStorage on page load
// Only restore if no Quick Tabs currently exist and persistence is enabled
if (quickTabWindows.length === 0 && minimizedQuickTabs.length === 0) {
  setTimeout(() => {
    restoreQuickTabsFromStorage();
  }, 100); // Small delay to ensure page is ready
}

debug('Extension loaded - supports 100+ websites with site-specific optimized handlers');
