// Copy URL on Hover - Lite Version
// 
// This is the lightweight version without Quick Tabs functionality.
// Focus is on core URL and text copying features.

// Browser API compatibility shim for Firefox/Chrome cross-compatibility
if (typeof browser === 'undefined') {
  var browser = chrome;
}

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
  darkMode: true
};

// Constants
const TOOLTIP_OFFSET_X = 10;
const TOOLTIP_OFFSET_Y = 10;
const TOOLTIP_FADE_OUT_MS = 200;

let CONFIG = { ...DEFAULT_CONFIG };
let currentHoveredLink = null;
let currentHoveredElement = null;
let lastMouseX = 0;
let lastMouseY = 0;

// ============================================================
// QUICK TABS INTEGRATION - Firefox Preferences Bridge
// ============================================================

// Track the currently hovered link for Quick Tabs integration
let currentQuickTabsLink = null;

// Update Quick Tabs by sending hover data to background script
// Background script will write to Firefox preferences (browser.storage.local)
function updateQuickTabs(url, title) {
  if (url && url.trim() !== '') {
    // Avoid duplicate updates
    if (currentQuickTabsLink === url) {
      return;
    }
    
    currentQuickTabsLink = url;
    
    // Send message to background script to update preferences
    browser.runtime.sendMessage({
      type: 'HOVER_DETECTED',
      action: 'SET_LINK',
      url: url,
      title: title || url,
      timestamp: Date.now()
    }).catch(e => {
      debug('Failed to send hover message to background: ' + e.message);
    });
    
    debug('Sent Quick Tabs hover message to background: ' + url);
  } else {
    // Clear the current link
    if (currentQuickTabsLink === null) {
      return;
    }
    
    currentQuickTabsLink = null;
    
    // Send message to background script to clear preferences
    browser.runtime.sendMessage({
      type: 'HOVER_DETECTED',
      action: 'CLEAR_LINK'
    }).catch(e => {
      debug('Failed to send clear message to background: ' + e.message);
    });
    
    debug('Sent Quick Tabs clear message to background');
  }
}

// ============================================================
// END QUICK TABS INTEGRATION
// ============================================================

// ---------------------------------------------------------------
// DOM SYNC LISTENER FOR UC.JS BRIDGE
// ---------------------------------------------------------------
// Listen for messages from background script to sync to DOM
// This allows uc.js scripts to read the hovered link data
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SYNC_TO_DOM') {
        // Write to document element attributes so uc.js can read them
        document.documentElement.setAttribute('data-quicktabs-hovered-url', message.url || '');
        document.documentElement.setAttribute('data-quicktabs-hovered-title', message.title || '');
        document.documentElement.setAttribute('data-quicktabs-hovered-state', message.state || 'idle');
        document.documentElement.setAttribute('data-quicktabs-timestamp', Date.now());
        
        console.log('[CopyURL-Content] DOM sync:', { url: message.url, state: message.state });
    }
});

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
    @keyframes tooltipScaleIn {
      0% { opacity: 0; transform: scale(0.8); }
      100% { opacity: 1; transform: scale(1); }
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

// Track mouse position for tooltip placement
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
      
      // Update Quick Tabs
      updateQuickTabs(url, getLinkText(element));
      
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
  
  // Clear Quick Tabs 
  updateQuickTabs(null, null);
}, true);

// Show notification
function showNotification(message, options = {}) {
  if (!CONFIG.showNotification) return;
  
  const showTooltip = options.tooltip || false;
  
  try {
    const notif = document.createElement('div');
    notif.textContent = message;
    
    // If tooltip is requested (for URL copy) and display mode is tooltip, show cursor-following popup
    // Otherwise, if showTooltip is true but mode is 'notification', fall through to regular notification below
    if (showTooltip && CONFIG.notifDisplayMode === 'tooltip') {
      // Ensure tooltip animation is initialized
      initTooltipAnimation();
      
      // Get animation name
      let animationName = '';
      if (CONFIG.tooltipAnimation === 'scale') {
        animationName = 'tooltipScaleIn';
      } else if (CONFIG.tooltipAnimation === 'fade') {
        animationName = 'tooltipFadeIn';
      }
      
      notif.style.cssText = `
        position: fixed;
        left: ${lastMouseX + TOOLTIP_OFFSET_X}px;
        top: ${lastMouseY + TOOLTIP_OFFSET_Y}px;
        background: ${CONFIG.tooltipColor};
        color: #fff;
        padding: 6px 12px;
        border-radius: 4px;
        border: 1px solid rgba(0,0,0,0.2);
        z-index: 999999;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        ${animationName ? `animation: ${animationName} 0.2s ease-out;` : ''}
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
      setTimeout(removeTooltip, CONFIG.tooltipDuration);
      
      return;
    }
    
    // Regular notification for corner display (used for text copy or when display mode is 'notification')
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

// Storage listener
browser.storage.onChanged.addListener(function(changes, areaName) {
  if (areaName === 'local') {
    loadSettings();
  }
});

// Initialize
loadSettings();

debug('Extension loaded - supports 100+ websites with site-specific optimized handlers');
