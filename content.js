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
// 3. Persistent Quick Tabs (#4): Quick Tabs cannot persist across different browser
//    tabs because each tab has its own isolated DOM and content script instance.
//    Browser security prevents cross-tab DOM manipulation.
//    WORKAROUND: Use the minimize feature to keep tabs accessible while browsing.
//
// 4. Zen Browser Theme (#10): Detecting Zen Browser workspace themes requires
//    access to Zen-specific browser APIs which are not available to content scripts.
//    Would need a separate WebExtension API or Zen Browser integration.

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

// Constants
const GOOGLE_FAVICON_URL = 'https://www.google.com/s2/favicons?domain=';

let CONFIG = { ...DEFAULT_CONFIG };
let currentHoveredLink = null;
let currentHoveredElement = null;
let quickTabWindows = [];
let minimizedQuickTabs = [];
let quickTabZIndex = 1000000;
let lastMouseX = 0;
let lastMouseY = 0;

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
function showNotification(message) {
  if (!CONFIG.showNotification) return;
  
  try {
    const notif = document.createElement('div');
    notif.textContent = message;
    
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

// Create Quick Tab window
function createQuickTabWindow(url) {
  if (isRestrictedPage()) {
    showNotification('✗ Quick Tab not available on this page');
    debug('Quick Tab blocked on restricted page');
    return;
  }
  
  if (quickTabWindows.length >= CONFIG.quickTabMaxWindows) {
    showNotification(`✗ Maximum ${CONFIG.quickTabMaxWindows} Quick Tabs allowed`);
    debug(`Maximum Quick Tab windows (${CONFIG.quickTabMaxWindows}) reached`);
    return;
  }
  
  debug(`Creating Quick Tab for URL: ${url}`);
  
  // Create container
  const container = document.createElement('div');
  container.className = 'copy-url-quicktab-window';
  container.style.cssText = `
    position: fixed;
    width: ${CONFIG.quickTabDefaultWidth}px;
    height: ${CONFIG.quickTabDefaultHeight}px;
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
  switch (CONFIG.quickTabPosition) {
    case 'follow-cursor':
      posX = lastMouseX + 10;
      posY = lastMouseY + 10;
      break;
    case 'center':
      posX = (window.innerWidth - CONFIG.quickTabDefaultWidth) / 2;
      posY = (window.innerHeight - CONFIG.quickTabDefaultHeight) / 2;
      break;
    case 'top-left':
      posX = 20;
      posY = 20;
      break;
    case 'top-right':
      posX = window.innerWidth - CONFIG.quickTabDefaultWidth - 20;
      posY = 20;
      break;
    case 'bottom-left':
      posX = 20;
      posY = window.innerHeight - CONFIG.quickTabDefaultHeight - 20;
      break;
    case 'bottom-right':
      posX = window.innerWidth - CONFIG.quickTabDefaultWidth - 20;
      posY = window.innerHeight - CONFIG.quickTabDefaultHeight - 20;
      break;
    case 'custom':
      posX = CONFIG.quickTabCustomX;
      posY = CONFIG.quickTabCustomY;
      break;
    default:
      posX = lastMouseX + 10;
      posY = lastMouseY + 10;
  }
  
  // Ensure window stays within viewport
  posX = Math.max(0, Math.min(posX, window.innerWidth - CONFIG.quickTabDefaultWidth));
  posY = Math.max(0, Math.min(posY, window.innerHeight - CONFIG.quickTabDefaultHeight));
  
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
    cursor: move;
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
      switchFocus: CONFIG.openNewTabSwitchFocus 
    });
    showNotification('✓ Opened in new tab');
    debug(`Quick Tab opened URL in new tab: ${iframe.src}`);
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
  
  // Add to tracking array
  quickTabWindows.push(container);
  
  // Make draggable
  makeDraggable(container, titleBar);
  
  // Make resizable
  makeResizable(container);
  
  // Bring to front on click
  container.addEventListener('mousedown', () => {
    container.style.zIndex = quickTabZIndex++;
  });
  
  showNotification('✓ Quick Tab opened');
  debug(`Quick Tab window created. Total windows: ${quickTabWindows.length}`);
}

// Close Quick Tab window
function closeQuickTabWindow(container) {
  const index = quickTabWindows.indexOf(container);
  if (index > -1) {
    quickTabWindows.splice(index, 1);
  }
  // Clean up resize listeners
  if (container._resizeCleanup) {
    container._resizeCleanup();
  }
  container.remove();
  debug(`Quick Tab window closed. Remaining windows: ${quickTabWindows.length}`);
}

// Close all Quick Tab windows
function closeAllQuickTabWindows() {
  const count = quickTabWindows.length;
  quickTabWindows.forEach(window => {
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
  if (container._resizeCleanup) {
    container._resizeCleanup();
  }
  container.remove();
  
  showNotification('✓ Quick Tab minimized');
  debug(`Quick Tab minimized. Total minimized: ${minimizedQuickTabs.length}`);
  
  // Update or create minimized tabs manager
  updateMinimizedTabsManager();
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
  let startX, startY, initialX, initialY;
  
  handle.addEventListener('mousedown', (e) => {
    // Don't drag if clicking on a button or img
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'IMG') {
      return;
    }
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = element.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    let newX = initialX + dx;
    let newY = initialY + dy;
    
    // Keep within viewport
    newX = Math.max(0, Math.min(newX, window.innerWidth - element.offsetWidth));
    newY = Math.max(0, Math.min(newY, window.innerHeight - element.offsetHeight));
    
    element.style.left = newX + 'px';
    element.style.top = newY + 'px';
  });
  
  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// Make element resizable
function makeResizable(element) {
  const minWidth = 300;
  const minHeight = 200;
  
  // Create resize handles
  const positions = ['se', 'sw', 'ne', 'nw', 'n', 's', 'e', 'w'];
  
  let currentHandle = null;
  let isResizing = false;
  let startX, startY, startWidth, startHeight, startLeft, startTop;
  
  const handleMouseMove = (e) => {
    if (!isResizing || !currentHandle) return;
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    let newWidth = startWidth;
    let newHeight = startHeight;
    let newLeft = startLeft;
    let newTop = startTop;
    
    const pos = currentHandle.dataset.position;
    
    if (pos.includes('e')) newWidth = Math.max(minWidth, startWidth + dx);
    if (pos.includes('w')) {
      newWidth = Math.max(minWidth, startWidth - dx);
      if (newWidth > minWidth) newLeft = startLeft + dx;
    }
    if (pos.includes('s')) newHeight = Math.max(minHeight, startHeight + dy);
    if (pos.includes('n')) {
      newHeight = Math.max(minHeight, startHeight - dy);
      if (newHeight > minHeight) newTop = startTop + dy;
    }
    
    element.style.width = newWidth + 'px';
    element.style.height = newHeight + 'px';
    element.style.left = newLeft + 'px';
    element.style.top = newTop + 'px';
    
    e.preventDefault();
    e.stopPropagation();
  };
  
  const handleMouseUp = (e) => {
    if (isResizing) {
      isResizing = false;
      currentHandle = null;
      e.preventDefault();
      e.stopPropagation();
    }
  };
  
  // Add global listeners once per element
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('mouseup', handleMouseUp, true);
  
  // Store cleanup function
  element._resizeCleanup = () => {
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseup', handleMouseUp, true);
  };
  
  positions.forEach(pos => {
    const handle = document.createElement('div');
    handle.className = `copy-url-resize-handle resize-${pos}`;
    handle.dataset.position = pos;
    
    // Style based on position
    let styles = 'position: absolute; background: transparent;';
    
    switch (pos) {
      case 'se':
        styles += 'right: 0; bottom: 0; width: 15px; height: 15px; cursor: nwse-resize;';
        break;
      case 'sw':
        styles += 'left: 0; bottom: 0; width: 15px; height: 15px; cursor: nesw-resize;';
        break;
      case 'ne':
        styles += 'right: 0; top: 40px; width: 15px; height: 15px; cursor: nesw-resize;';
        break;
      case 'nw':
        styles += 'left: 0; top: 40px; width: 15px; height: 15px; cursor: nwse-resize;';
        break;
      case 'n':
        styles += 'top: 40px; left: 15px; right: 15px; height: 5px; cursor: ns-resize;';
        break;
      case 's':
        styles += 'bottom: 0; left: 15px; right: 15px; height: 5px; cursor: ns-resize;';
        break;
      case 'e':
        styles += 'right: 0; top: 55px; bottom: 5px; width: 5px; cursor: ew-resize;';
        break;
      case 'w':
        styles += 'left: 0; top: 55px; bottom: 5px; width: 5px; cursor: ew-resize;';
        break;
    }
    
    handle.style.cssText = styles;
    
    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      currentHandle = handle;
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      startWidth = rect.width;
      startHeight = rect.height;
      startLeft = rect.left;
      startTop = rect.top;
      
      e.preventDefault();
      e.stopPropagation();
    });
    
    element.appendChild(handle);
  });
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
      showNotification('✓ URL copied!');
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
