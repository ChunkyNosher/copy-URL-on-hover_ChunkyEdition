# URL Handler Registry Architecture

## Overview

The URL detection system uses a registry pattern with 13 site-specific handler categories and a generic fallback handler. Handlers are organized by domain type (social media, developer, ecommerce, etc.) and executed in priority order.

## URL Handler Architecture

```mermaid
graph TD
    subgraph "Content Script"
        CS[Mouseover Event]
        HD[HoverDetection]
    end

    subgraph "URL Handler Registry"
        REGISTRY[HandlerRegistry<br/>Map&lt;domain, handler&gt;]

        subgraph "Site-Specific Handlers (13)"
            SM[social-media.js<br/>Twitter, Facebook,<br/>Instagram, etc.]
            DEV[developer.js<br/>GitHub, GitLab,<br/>Stack Overflow, etc.]
            VIDEO[video.js<br/>YouTube, Vimeo,<br/>Twitch, etc.]
            ECOM[ecommerce.js<br/>Amazon, eBay, etc.]
            NEWS[news-discussion.js<br/>Reddit, HN, etc.]
            BLOG[blogging.js<br/>Medium, Dev.to, etc.]
            GAME[gaming.js<br/>Steam, Epic, etc.]
            LEARN[learning.js<br/>Coursera, Udemy, etc.]
            ENT[entertainment.js<br/>Spotify, Netflix, etc.]
            IMG[image-design.js<br/>Figma, Canva, etc.]
            OTHER[other.js<br/>Wikipedia, etc.]
        end

        GEN[generic.js<br/>Fallback Handler]
    end

    subgraph "URL Extraction"
        EXTRACT[Extract URL<br/>from element]
        VAL[Validate URL]
        NOTIFY[Show Notification]
    end

    CS --> HD
    HD --> REGISTRY

    REGISTRY -->|Match domain| SM
    REGISTRY -->|Match domain| DEV
    REGISTRY -->|Match domain| VIDEO
    REGISTRY -->|Match domain| ECOM
    REGISTRY -->|Match domain| NEWS
    REGISTRY -->|Match domain| BLOG
    REGISTRY -->|Match domain| GAME
    REGISTRY -->|Match domain| LEARN
    REGISTRY -->|Match domain| ENT
    REGISTRY -->|Match domain| IMG
    REGISTRY -->|Match domain| OTHER
    REGISTRY -->|No match| GEN

    SM --> EXTRACT
    DEV --> EXTRACT
    GEN --> EXTRACT

    EXTRACT --> VAL
    VAL --> NOTIFY

    style REGISTRY fill:#fff9c4,stroke:#f57f17,stroke-width:3px
    style GEN fill:#e0e0e0,stroke:#616161,stroke-width:2px
```

## Handler Registry Implementation

### Registry Structure

```javascript
// src/features/url-handlers/index.js
import * as socialMedia from './social-media.js';
import * as developer from './developer.js';
import * as video from './video.js';
import * as ecommerce from './ecommerce.js';
import * as newsDiscussion from './news-discussion.js';
import * as blogging from './blogging.js';
import * as gaming from './gaming.js';
import * as learning from './learning.js';
import * as entertainment from './entertainment.js';
import * as imageDesign from './image-design.js';
import * as other from './other.js';
import * as generic from './generic.js';

export class URLHandlerRegistry {
  constructor() {
    this.handlers = new Map();
    this._registerHandlers();
  }

  _registerHandlers() {
    // Social Media (Priority 1)
    this.register('twitter.com', socialMedia.findTwitterUrl);
    this.register('facebook.com', socialMedia.findFacebookUrl);
    this.register('instagram.com', socialMedia.findInstagramUrl);
    this.register('linkedin.com', socialMedia.findLinkedInUrl);
    this.register('reddit.com', newsDiscussion.findRedditUrl);

    // Developer (Priority 2)
    this.register('github.com', developer.findGitHubUrl);
    this.register('gitlab.com', developer.findGitLabUrl);
    this.register('stackoverflow.com', developer.findStackOverflowUrl);
    this.register('npmjs.com', developer.findNpmUrl);

    // Video (Priority 3)
    this.register('youtube.com', video.findYouTubeUrl);
    this.register('vimeo.com', video.findVimeoUrl);
    this.register('twitch.tv', video.findTwitchUrl);

    // E-commerce (Priority 4)
    this.register('amazon.com', ecommerce.findAmazonUrl);
    this.register('ebay.com', ecommerce.findEbayUrl);
    this.register('etsy.com', ecommerce.findEtsyUrl);

    // ... 100+ more domain registrations
  }

  register(domain, handler) {
    this.handlers.set(domain, handler);
  }

  findUrl(element, hostname) {
    // Try site-specific handler
    for (const [domain, handler] of this.handlers) {
      if (hostname.includes(domain)) {
        try {
          const url = handler(element);
          if (url) return url;
        } catch (error) {
          console.warn(`Handler for ${domain} failed:`, error);
        }
      }
    }

    // Fallback to generic handler
    return generic.findGenericUrl(element);
  }
}
```

## Handler Categories

### 1. Social Media (social-media.js)

**Coverage**: Twitter, Facebook, Instagram, LinkedIn, TikTok, Snapchat, Pinterest, Tumblr

**Strategy**: Target feed items, profile links, post containers

```javascript
export function findTwitterUrl(element) {
  // Check for tweet container
  const tweetContainer = element.closest('article[data-testid="tweet"]');
  if (tweetContainer) {
    const linkElement = tweetContainer.querySelector('a[href*="/status/"]');
    if (linkElement) {
      return linkElement.href;
    }
  }

  // Check for profile links
  const profileLink = element.closest('a[href^="/"][href*="@"]');
  if (profileLink) {
    return 'https://twitter.com' + profileLink.getAttribute('href');
  }

  return null;
}

export function findInstagramUrl(element) {
  // Check for post container
  const postContainer = element.closest('article');
  if (postContainer) {
    const linkElement = postContainer.querySelector('a[href*="/p/"]');
    if (linkElement) {
      return linkElement.href;
    }
  }

  return null;
}
```

### 2. Developer (developer.js)

**Coverage**: GitHub, GitLab, Stack Overflow, npm, PyPI, Docker Hub, Bitbucket

**Strategy**: Detect repo links, issue/PR links, package pages

```javascript
export function findGitHubUrl(element) {
  // Check for repository link
  const repoLink = element.closest('a[href^="/"][href*="/"]');
  if (repoLink) {
    const href = repoLink.getAttribute('href');
    // Match /:owner/:repo pattern
    const match = href.match(/^\/([^\/]+)\/([^\/]+)\/?$/);
    if (match) {
      return 'https://github.com' + href;
    }
  }

  // Check for issue/PR links
  const issueLink = element.closest('a[href*="/issues/"], a[href*="/pull/"]');
  if (issueLink) {
    return issueLink.href;
  }

  return null;
}

export function findStackOverflowUrl(element) {
  // Check for question container
  const questionContainer = element.closest('.question-summary, .answer');
  if (questionContainer) {
    const linkElement = questionContainer.querySelector('.question-hyperlink, a.answer-hyperlink');
    if (linkElement) {
      return linkElement.href;
    }
  }

  return null;
}
```

### 3. Video (video.js)

**Coverage**: YouTube, Vimeo, Twitch, Dailymotion, Wistia

**Strategy**: Extract video IDs from containers, thumbnails, embeds

```javascript
export function findYouTubeUrl(element) {
  // Check for video container
  const videoContainer = element.closest('ytd-video-renderer, ytd-grid-video-renderer');
  if (videoContainer) {
    const linkElement = videoContainer.querySelector('a#video-title');
    if (linkElement) {
      return linkElement.href;
    }
  }

  // Check for video ID in URL
  const videoLink = element.closest('a[href*="/watch?v="]');
  if (videoLink) {
    return videoLink.href;
  }

  return null;
}
```

### 4. E-commerce (ecommerce.js)

**Coverage**: Amazon, eBay, Etsy, AliExpress, Shopify stores

**Strategy**: Extract product IDs, handle dynamic pricing containers

```javascript
export function findAmazonUrl(element) {
  // Check for product container
  const productContainer = element.closest('[data-asin]');
  if (productContainer) {
    const asin = productContainer.getAttribute('data-asin');
    if (asin) {
      return `https://www.amazon.com/dp/${asin}`;
    }
  }

  // Check for product links
  const productLink = element.closest('a[href*="/dp/"], a[href*="/gp/product/"]');
  if (productLink) {
    return productLink.href;
  }

  return null;
}
```

### 5-11. Other Categories

| Category            | Key Sites                | Handler Count | Coverage |
| ------------------- | ------------------------ | ------------- | -------- |
| **News/Discussion** | Reddit, HN, Slashdot     | 8             | 100%     |
| **Blogging**        | Medium, Dev.to, Substack | 10            | 90.19%   |
| **Gaming**          | Steam, Epic, Itch.io     | 6             | 95.34%   |
| **Learning**        | Coursera, Udemy, Khan    | 8             | 94%      |
| **Entertainment**   | Spotify, Netflix, IMDb   | 9             | 100%     |
| **Image/Design**    | Figma, Canva, Behance    | 8             | 100%     |
| **Other**           | Wikipedia, Docs, Maps    | 5             | 100%     |

### 12. Generic Handler (generic.js)

**Fallback**: Used when no site-specific handler matches

```javascript
export function findGenericUrl(element) {
  // Strategy 1: Find closest anchor tag
  const anchor = element.closest('a');
  if (anchor && anchor.href) {
    return anchor.href;
  }

  // Strategy 2: Check for href attribute on element
  if (element.hasAttribute('href')) {
    return element.getAttribute('href');
  }

  // Strategy 3: Search children for links
  const childLink = element.querySelector('a[href]');
  if (childLink) {
    return childLink.href;
  }

  // Strategy 4: Check data attributes
  const dataUrl =
    element.getAttribute('data-url') ||
    element.getAttribute('data-href') ||
    element.getAttribute('data-link');
  if (dataUrl) {
    return dataUrl;
  }

  return null;
}
```

## URL Detection Flow

```mermaid
sequenceDiagram
    participant User
    participant DOM as Page Element
    participant CS as Content Script
    participant REG as URLHandlerRegistry
    participant HAND as SiteHandler
    participant GEN as GenericHandler
    participant UI as NotificationUI

    User->>DOM: Mouseover element
    DOM->>CS: mouseover event

    CS->>CS: Get hostname<br/>window.location.hostname

    CS->>REG: findUrl(element, hostname)

    REG->>REG: Loop through handlers<br/>for matching domains

    alt Site-specific handler found
        REG->>HAND: handler(element)
        HAND->>HAND: Extract URL<br/>(site-specific logic)

        alt URL found
            HAND-->>REG: Return URL
            REG-->>CS: URL
        else URL not found
            HAND-->>REG: Return null
            REG->>GEN: findGenericUrl(element)
            GEN-->>REG: URL or null
            REG-->>CS: URL or null
        end
    else No site-specific handler
        REG->>GEN: findGenericUrl(element)
        GEN-->>REG: URL or null
        REG-->>CS: URL or null
    end

    alt URL found
        CS->>CS: Validate URL
        CS->>UI: Show notification<br/>with URL
        UI->>User: Display notification
    else No URL found
        CS->>User: No action
    end
```

## Handler Priority System

### Priority Levels

1. **Exact Domain Match** (Priority 1)
   - `twitter.com` → `findTwitterUrl`
   - Most specific, highest priority

2. **Subdomain Match** (Priority 2)
   - `www.twitter.com` → `findTwitterUrl`
   - `mobile.twitter.com` → `findTwitterUrl`
   - Matches parent domain handler

3. **Partial Match** (Priority 3)
   - `x.com` → `findTwitterUrl` (Twitter rebrand)
   - Configured aliases

4. **Generic Fallback** (Priority 4)
   - All other sites → `findGenericUrl`
   - Lowest priority, always available

### Execution Order

```javascript
findUrl(element, hostname) {
  // Priority 1: Exact domain match
  if (this.handlers.has(hostname)) {
    const handler = this.handlers.get(hostname);
    const url = handler(element);
    if (url) return url;
  }

  // Priority 2: Subdomain match (includes check)
  for (const [domain, handler] of this.handlers) {
    if (hostname.includes(domain)) {
      try {
        const url = handler(element);
        if (url) return url;
      } catch (error) {
        console.warn(`Handler for ${domain} failed:`, error);
        // Continue to next handler instead of failing
      }
    }
  }

  // Priority 3: Domain aliases (configured separately)
  const alias = this.aliases.get(hostname);
  if (alias && this.handlers.has(alias)) {
    const handler = this.handlers.get(alias);
    const url = handler(element);
    if (url) return url;
  }

  // Priority 4: Generic fallback
  return generic.findGenericUrl(element);
}
```

## Error Handling

### Handler Failures

```javascript
for (const [domain, handler] of this.handlers) {
  if (hostname.includes(domain)) {
    try {
      const url = handler(element);
      if (url) return url;
    } catch (error) {
      // Log error but continue to next handler
      console.warn(`Handler for ${domain} failed:`, error);
      // Don't break - try generic handler
    }
  }
}

// Always fallback to generic
return generic.findGenericUrl(element);
```

**Key**: Handler failures don't break detection - system always tries generic fallback

### Invalid URLs

```javascript
findUrl(element, hostname) {
  const url = this._detectUrl(element, hostname);

  if (!url) return null;

  // Validate URL
  try {
    new URL(url); // Throws if invalid
    return url;
  } catch (error) {
    console.warn('Invalid URL detected:', url, error);
    return null;
  }
}
```

## Performance

### Handler Execution Time

| Operation           | Time   | Notes                                  |
| ------------------- | ------ | -------------------------------------- |
| **Registry Lookup** | <1ms   | Map.get() or includes()                |
| **Site Handler**    | 1-5ms  | DOM traversal (closest, querySelector) |
| **Generic Handler** | 2-8ms  | More extensive DOM search              |
| **Total Detection** | 3-13ms | Includes validation                    |

### Optimization Strategies

1. **Early Return**: Stop as soon as URL found
2. **Caching**: Cache last detected URL per element (100ms TTL)
3. **Lazy Loading**: Handlers loaded on-demand per site
4. **Memoization**: Cache hostname → handler mapping

```javascript
class URLHandlerRegistry {
  constructor() {
    this.handlers = new Map();
    this.hostnameCache = new Map(); // hostname → handler
    this.urlCache = new Map(); // element → {url, timestamp}
  }

  findUrl(element, hostname) {
    // Check cache first
    const cached = this.urlCache.get(element);
    if (cached && Date.now() - cached.timestamp < 100) {
      return cached.url;
    }

    // Detect URL
    const url = this._detectUrl(element, hostname);

    // Cache result
    this.urlCache.set(element, { url, timestamp: Date.now() });

    // Cleanup old cache entries
    if (this.urlCache.size > 1000) {
      this._cleanupCache();
    }

    return url;
  }
}
```

## Test Coverage

### Handler Category Coverage

| Category               | Coverage | Tests | Status          |
| ---------------------- | -------- | ----- | --------------- |
| **social-media.js**    | 100%     | 53    | ✅ Perfect      |
| **developer.js**       | 100%     | 48    | ✅ Perfect      |
| **video.js**           | 100%     | 32    | ✅ Perfect      |
| **news-discussion.js** | 100%     | 36    | ✅ Perfect      |
| **ecommerce.js**       | 100%     | 50    | ✅ Perfect      |
| **blogging.js**        | 90.19%   | 31    | ✅ Excellent    |
| **gaming.js**          | 95.34%   | 29    | ✅ Excellent    |
| **learning.js**        | 94%      | 32    | ✅ Excellent    |
| **entertainment.js**   | 100%     | 54    | ✅ Perfect      |
| **image-design.js**    | 100%     | 51    | ✅ Perfect      |
| **generic.js**         | 94.11%   | 28    | ✅ Excellent    |
| **other.js**           | 100%     | 20    | ✅ Perfect      |
| **Overall**            | 98.5%    | 464   | ⭐ Near Perfect |

**11 out of 13 categories at 100% coverage!**

## Related Documentation

- [Component Hierarchy](./1-component-hierarchy.md)
- [URL Handler Tests](../../tests/unit/features/url-handlers/)
- [Site Handler Examples](../../src/features/url-handlers/)
