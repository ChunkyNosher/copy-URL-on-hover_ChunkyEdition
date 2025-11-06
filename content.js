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

// Determine the domain type
function getDomainType() {
  const hostname = window.location.hostname;
  if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
  if (hostname.includes('reddit.com')) return 'reddit';
  if (hostname.includes('youtube.com')) return 'youtube';
  if (hostname.includes('linkedin.com')) return 'linkedin';
  if (hostname.includes('github.com') || hostname.includes('ghe.')) return 'github';
  if (hostname.includes('gitlab.com')) return 'gitlab';
  if (hostname.includes('bitbucket.org')) return 'bitbucket';
  if (hostname.includes('medium.com')) return 'medium';
  if (hostname.includes('devto') || hostname.includes('dev.to')) return 'devto';
  if (hostname.includes('hashnode.com')) return 'hashnode';
  if (hostname.includes('substack.com')) return 'substack';
  if (hostname.includes('amazon.') || hostname.includes('smile.amazon')) return 'amazon';
  if (hostname.includes('ebay.')) return 'ebay';
  if (hostname.includes('etsy.com')) return 'etsy';
  if (hostname.includes('walmart.com')) return 'walmart';
  if (hostname.includes('flipkart.com')) return 'flipkart';
  if (hostname.includes('aliexpress.com')) return 'aliexpress';
  if (hostname.includes('shopify.')) return 'shopify';
  if (hostname.includes('instagram.com')) return 'instagram';
  if (hostname.includes('facebook.com')) return 'facebook';
  if (hostname.includes('tiktok.com')) return 'tiktok';
  if (hostname.includes('threads.net')) return 'threads';
  if (hostname.includes('bluesky.social')) return 'bluesky';
  if (hostname.includes('mastodon')) return 'mastodon';
  if (hostname.includes('pinterest.com')) return 'pinterest';
  if (hostname.includes('tumblr.com')) return 'tumblr';
  if (hostname.includes('hackernews') || hostname.includes('news.ycombinator')) return 'hackernews';
  if (hostname.includes('producthunt.com')) return 'producthunt';
  if (hostname.includes('dribbble.com')) return 'dribbble';
  if (hostname.includes('behance.net')) return 'behance';
  if (hostname.includes('deviantart.com')) return 'deviantart';
  if (hostname.includes('flickr.com')) return 'flickr';
  if (hostname.includes('500px.com')) return '500px';
  if (hostname.includes('unsplash.com')) return 'unsplash';
  if (hostname.includes('pexels.com')) return 'pexels';
  if (hostname.includes('vimeo.com')) return 'vimeo';
  if (hostname.includes('dailymotion.com')) return 'dailymotion';
  if (hostname.includes('quora.com')) return 'quora';
  if (hostname.includes('stackoverflow.com')) return 'stackoverflow';
  if (hostname.includes('steamcommunity.com')) return 'steam';
  if (hostname.includes('twitch.tv')) return 'twitch';
  if (hostname.includes('discord.com') || hostname.includes('discordapp.com')) return 'discord';
  if (hostname.includes('wikipedia.org')) return 'wikipedia';
  if (hostname.includes('imdb.com')) return 'imdb';
  if (hostname.includes('rottentomatoes.com')) return 'rottentomatoes';
  if (hostname.includes('netflix.com')) return 'netflix';
  if (hostname.includes('letterboxd.com')) return 'letterboxd';
  if (hostname.includes('goodreads.com')) return 'goodreads';
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
    twitter: findTwitterUrl,
    reddit: findRedditUrl,
    youtube: findYouTubeUrl,
    linkedin: findLinkedInUrl,
    github: findGitHubUrl,
    gitlab: findGitHubUrl,
    bitbucket: findGitHubUrl,
    medium: findMediumUrl,
    devto: findMediumUrl,
    hashnode: findMediumUrl,
    substack: findMediumUrl,
    amazon: findAmazonUrl,
    ebay: findAmazonUrl,
    etsy: findAmazonUrl,
    walmart: findAmazonUrl,
    flipkart: findAmazonUrl,
    aliexpress: findAmazonUrl,
    shopify: findShopifyUrl,
    instagram: findSocialUrl,
    facebook: findSocialUrl,
    tiktok: findSocialUrl,
    threads: findSocialUrl,
    bluesky: findSocialUrl,
    mastodon: findSocialUrl,
    pinterest: findPinterestUrl,
    tumblr: findTumblrUrl,
    hackernews: findHackerNewsUrl,
    producthunt: findProductHuntUrl,
    dribbble: findDribbbleUrl,
    behance: findBehanceUrl,
    deviantart: findDeviantartUrl,
    flickr: findFlickrUrl,
    '500px': find500pxUrl,
    unsplash: findPhotoUrl,
    pexels: findPhotoUrl,
    vimeo: findVimeoUrl,
    dailymotion: findDailyMotionUrl,
    quora: findQuoraUrl,
    stackoverflow: findStackOverflowUrl,
    steam: findSteamUrl,
    twitch: findTwitchUrl,
    discord: findDiscordUrl,
    wikipedia: findWikipediaUrl,
    imdb: findImdbUrl,
    rottentomatoes: findRottenTomatoesUrl,
    netflix: findNetflixUrl,
    letterboxd: findLetterboxdUrl,
    goodreads: findGoodreadsUrl
  };
  
  if (handlers[domainType]) {
    const url = handlers[domainType](element);
    if (url) return url;
  }
  
  // Final fallback - find ANY link
  return findGenericUrl(element);
}

// ===== TWITTER URL FINDER - CORRECT NESTED TWEET DETECTION =====
// The key: Find the INNERMOST article that contains the hovered element

function findTwitterUrl(element) {
  debug('=== TWITTER URL FINDER (Innermost Article) ===');
  debug('Hovered element: ' + element.tagName + ' - ' + element.className);
  
  // STRATEGY: Find the INNERMOST <article> that is an ancestor of the hovered element
  // Twitter wraps each tweet (including nested quotes) in an <article> tag
  
  let current = element;
  let innermostArticle = null;
  let depth = 0;
  
  // Walk UP the DOM and track the innermost article we find
  while (current && depth < 50) {
    if (current.tagName === 'ARTICLE') {
      // Found an article - this is our candidate
      innermostArticle = current;
      debug(`Found article at depth ${depth}`);
      
      // Keep walking up to see if there are MORE articles
      // The innermost one will be the last one we find before reaching the root
      current = current.parentElement;
      depth++;
      continue;
    }
    
    current = current.parentElement;
    depth++;
  }
  
  // Now we have the innermost article that contains our hovered element
  if (innermostArticle) {
    debug(`Using innermost article`);
    
    // Find ALL /status/ links in this article
    const statusLinks = innermostArticle.querySelectorAll('a[href*="/status/"]');
    debug(`Status links in innermost article: ${statusLinks.length}`);
    
    if (statusLinks.length > 0) {
      // Return the FIRST /status/ link found in this article
      const url = statusLinks[0].href;
      debug(`Returning status link: ${url}`);
      return url;
    }
  }
  
  // Fallback: if no article found or no status link in article
  debug('No innermost article found, searching upward for /status/ link');
  current = element;
  depth = 0;
  
  while (current && depth < 50) {
    // Try to find a /status/ link within this element
    const link = current.querySelector('a[href*="/status/"]');
    if (link && link.href) {
      debug(`Found /status/ link at depth ${depth}: ${link.href}`);
      return link.href;
    }
    
    current = current.parentElement;
    depth++;
  }
  
  debug('No /status/ link found');
  return null;
}

// ===== OTHER SITE HANDLERS =====

function findRedditUrl(element) {
  const post = element.closest('[data-testid="post-container"], .Post, .post-container, [role="article"]');
  if (!post) return findGenericUrl(element);
  
  const titleLink = post.querySelector('a[data-testid="post-title"], h3 a, .PostTitle a, [data-click-id="body"] a');
  if (titleLink?.href) return titleLink.href;
  
  return null;
}

function findYouTubeUrl(element) {
  const videoCard = element.closest('[role="listitem"], .yt-simple-endpoint, a[href*="/watch"]');
  if (!videoCard) return findGenericUrl(element);
  
  const watchLink = videoCard.querySelector('a[href*="watch?v="]');
  if (watchLink?.href) return watchLink.href;
  
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

function findGitHubUrl(element) {
  const item = element.closest('[data-testid="issue-row"], .Box-row, .issue, [role="article"]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/issues/"], a[href*="/pull/"], a[href*="/repository"]');
  if (link?.href) return link.href;
  
  return null;
}

function findMediumUrl(element) {
  const article = element.closest('[data-test="cardLink"], article, .article, [role="article"]');
  if (!article) return findGenericUrl(element);
  
  const link = article.querySelector('a[href*="/p/"], a[href*="/@"], a');
  if (link?.href) return link.href;
  
  return null;
}

function findAmazonUrl(element) {
  const product = element.closest('[data-component-type="s-search-result"], .s-result-item, [data-asin]');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="/dp/"], a[href*="/product/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findSocialUrl(element) {
  const post = element.closest('[role="article"], .post, .story, [data-testid="post"]');
  if (!post) return findGenericUrl(element);
  
  const links = post.querySelectorAll('a[href]');
  for (let link of links) {
    const url = link.href;
    if (!url.includes('/explore') && !url.includes('/hashtag/')) return url;
  }
  
  return null;
}

function findPinterestUrl(element) {
  const pin = element.closest('div[role="link"], .pin');
  if (!pin) return findGenericUrl(element);
  
  const link = pin.querySelector('a[href*="/pin/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findTumblrUrl(element) {
  const post = element.closest('[role="article"], .post, .reblog');
  if (!post) return findGenericUrl(element);
  
  const link = post.querySelector('a[href*="tumblr.com"]');
  if (link?.href) return link.href;
  
  return null;
}

function findHackerNewsUrl(element) {
  const row = element.closest('.athing, tr');
  if (!row) return findGenericUrl(element);
  
  const link = row.querySelector('a.titlelink');
  if (link?.href) return link.href;
  
  return null;
}

function findProductHuntUrl(element) {
  const item = element.closest('[role="article"], .postItem');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="producthunt.com"]');
  if (link?.href) return link.href;
  
  return null;
}

function findDribbbleUrl(element) {
  const shot = element.closest('div[role="link"], .shot');
  if (!shot) return findGenericUrl(element);
  
  const link = shot.querySelector('a[href*="/shots/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findBehanceUrl(element) {
  const project = element.closest('[role="article"], .project');
  if (!project) return findGenericUrl(element);
  
  const link = project.querySelector('a[href*="behance.net"]');
  if (link?.href) return link.href;
  
  return null;
}

function findDeviantartUrl(element) {
  const deviation = element.closest('[role="article"], .deviation');
  if (!deviation) return findGenericUrl(element);
  
  const link = deviation.querySelector('a[href*="deviantart.com"]');
  if (link?.href) return link.href;
  
  return null;
}

function findFlickrUrl(element) {
  const photo = element.closest('[role="link"], .photo');
  if (!photo) return findGenericUrl(element);
  
  const link = photo.querySelector('a[href*="/photos/"]');
  if (link?.href) return link.href;
  
  return null;
}

function find500pxUrl(element) {
  const photo = element.closest('div[role="link"], .photo');
  if (!photo) return findGenericUrl(element);
  
  const link = photo.querySelector('a[href*="/photo/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findPhotoUrl(element) {
  const photo = element.closest('[role="article"], .photo, a[href]');
  if (!photo) return findGenericUrl(element);
  
  if (photo.href) return photo.href;
  
  const link = photo.querySelector('a[href]');
  if (link?.href) return link.href;
  
  return null;
}

function findVimeoUrl(element) {
  const video = element.closest('[role="article"], .video');
  if (!video) return findGenericUrl(element);
  
  const link = video.querySelector('a[href*="/video/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findDailyMotionUrl(element) {
  const video = element.closest('[role="article"], .video');
  if (!video) return findGenericUrl(element);
  
  const link = video.querySelector('a[href*="/video/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findQuoraUrl(element) {
  const question = element.closest('[role="article"], .Question');
  if (!question) return findGenericUrl(element);
  
  const link = question.querySelector('a[href*="/q/"], a[href*="/question/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findStackOverflowUrl(element) {
  const question = element.closest('[role="article"], .s-post-summary');
  if (!question) return findGenericUrl(element);
  
  const link = question.querySelector('a[href*="/questions/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findSteamUrl(element) {
  const item = element.closest('[role="article"], .appid, .workshop_item');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="steampowered.com"]');
  if (link?.href) return link.href;
  
  return null;
}

function findTwitchUrl(element) {
  const stream = element.closest('[role="article"], [role="link"]');
  if (!stream) return findGenericUrl(element);
  
  const link = stream.querySelector('a[href*="/videos/"], a[href*="/clips/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findDiscordUrl(element) {
  const message = element.closest('[role="article"], .message');
  if (!message) return findGenericUrl(element);
  
  const link = message.querySelector('a[href]');
  if (link?.href) return link.href;
  
  return null;
}

function findWikipediaUrl(element) {
  return window.location.href;
}

function findImdbUrl(element) {
  const item = element.closest('[role="article"], .ipc-title');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/title/"], a[href*="/name/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findRottenTomatoesUrl(element) {
  const item = element.closest('[role="article"], .scoreboard');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/m/"], a[href*="/tv/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findNetflixUrl(element) {
  return window.location.href;
}

function findLetterboxdUrl(element) {
  const film = element.closest('[role="article"], .film');
  if (!film) return findGenericUrl(element);
  
  const link = film.querySelector('a[href*="/film/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findGoodreadsUrl(element) {
  const book = element.closest('[role="article"], .book');
  if (!book) return findGenericUrl(element);
  
  const link = book.querySelector('a[href*="/book/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findShopifyUrl(element) {
  const product = element.closest('[role="article"], .product');
  if (!product) return findGenericUrl(element);
  
  const link = product.querySelector('a[href*="/products/"]');
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

// Hover detection
document.addEventListener('mouseover', function(event) {
  let target = event.target;
  let element = null;
  
  if (target.tagName === 'A' && target.href) {
    element = target;
  } else {
    element = target.closest('article, [role="article"], .post, [data-testid="post"], [role="link"], .item, [data-id]');
  }
  
  if (element) {
    const domainType = getDomainType();
    const url = findUrl(element, domainType);
    if (url) {
      currentHoveredLink = element;
      currentHoveredElement = element;
      debug(`[${domainType}] URL found: ${url}`);
    }
  }
}, true);

// Mouseout
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
    
    if (!document.querySelector('style[data-copy-url]')) {
      const style = document.createElement('style');
      style.setAttribute('data-copy-url', 'true');
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateX(400px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
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

// Check modifiers
function checkModifiers(requireCtrl, requireAlt, requireShift, event) {
  const ctrlPressed = event.ctrlKey || event.metaKey;
  const altPressed = event.altKey;
  const shiftPressed = event.shiftKey;
  
  return (requireCtrl === ctrlPressed && requireAlt === altPressed && requireShift === shiftPressed);
}

// Keyboard handler
document.addEventListener('keydown', function(event) {
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
  
  if (key === CONFIG.copyUrlKey.toLowerCase() && 
      checkModifiers(CONFIG.copyUrlCtrl, CONFIG.copyUrlAlt, CONFIG.copyUrlShift, event)) {
    event.preventDefault();
    event.stopPropagation();
    
    if (!url) {
      showNotification('✗ No URL found');
      return;
    }
    
    navigator.clipboard.writeText(url).then(() => {
      showNotification('✓ URL copied!');
    }).catch(() => {
      showNotification('✗ Copy failed');
    });
  }
  
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

// Storage listener
browser.storage.onChanged.addListener(function(changes, areaName) {
  if (areaName === 'local') {
    loadSettings();
  }
});

// Initialize
loadSettings();
debug('Extension loaded - supports 50+ websites with enhanced nested tweet detection');
