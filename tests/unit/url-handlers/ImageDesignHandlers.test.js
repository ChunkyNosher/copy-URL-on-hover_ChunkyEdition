/**
 * Image Design Platform URL Handlers Tests
 * Tests for image/design platform URL detection (Pinterest, Dribbble, etc.)
 */

import { image_designHandlers } from '../../../src/features/url-handlers/image-design.js';

const {
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
  giphy: findGiphyUrl
} = image_designHandlers;

describe('Image Design Platform URL Handlers', () => {
  describe('findPinterestUrl', () => {
    test('should extract URL from pin with data-test-id', () => {
      const pin = document.createElement('div');
      pin.setAttribute('data-test-id', 'pin');

      const link = document.createElement('a');
      link.href = 'https://www.pinterest.com/pin/1234567890/';
      pin.appendChild(link);

      const element = document.createElement('span');
      pin.appendChild(element);

      const result = findPinterestUrl(element);

      expect(result).toBe('https://www.pinterest.com/pin/1234567890/');
    });

    test('should extract URL from button role element', () => {
      const button = document.createElement('div');
      button.setAttribute('role', 'button');

      const link = document.createElement('a');
      link.href = 'https://www.pinterest.com/pin/9876543210/';
      button.appendChild(link);

      const element = document.createElement('div');
      button.appendChild(element);

      const result = findPinterestUrl(element);

      expect(result).toBe('https://www.pinterest.com/pin/9876543210/');
    });

    test('should fallback to generic when no pin found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findPinterestUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in pin', () => {
      const pin = document.createElement('div');
      pin.setAttribute('data-test-id', 'pin');

      const element = document.createElement('div');
      pin.appendChild(element);

      const result = findPinterestUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findTumblrUrl', () => {
    test('should extract URL from post with data-id', () => {
      const post = document.createElement('div');
      post.setAttribute('data-id', '123456789');

      const link = document.createElement('a');
      link.href = 'https://username.tumblr.com/post/123456789/post-title';
      post.appendChild(link);

      const element = document.createElement('span');
      post.appendChild(element);

      const result = findTumblrUrl(element);

      expect(result).toBe('https://username.tumblr.com/post/123456789/post-title');
    });

    test('should extract URL from article element', () => {
      const article = document.createElement('article');

      const link = document.createElement('a');
      link.href = 'https://blog.tumblr.com/post/987654321/another-post';
      article.appendChild(link);

      const element = document.createElement('div');
      article.appendChild(element);

      const result = findTumblrUrl(element);

      expect(result).toBe('https://blog.tumblr.com/post/987654321/another-post');
    });

    test('should fallback to generic when no post found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findTumblrUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /post/ link in container', () => {
      const post = document.createElement('div');
      post.setAttribute('data-id', '123');

      const link = document.createElement('a');
      link.href = 'https://tumblr.com/dashboard';
      post.appendChild(link);

      const element = document.createElement('div');
      post.appendChild(element);

      const result = findTumblrUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findDribbbleUrl', () => {
    test('should extract URL from data-thumbnail-target', () => {
      const shot = document.createElement('div');
      shot.setAttribute('data-thumbnail-target', 'shot');

      const link = document.createElement('a');
      link.href = 'https://dribbble.com/shots/12345678-design-title';
      shot.appendChild(link);

      const element = document.createElement('span');
      shot.appendChild(element);

      const result = findDribbbleUrl(element);

      expect(result).toBe('https://dribbble.com/shots/12345678-design-title');
    });

    test('should extract URL from shot-thumbnail class', () => {
      const shot = document.createElement('div');
      shot.className = 'shot-thumbnail';

      const link = document.createElement('a');
      link.href = 'https://dribbble.com/shots/87654321-awesome-design';
      shot.appendChild(link);

      const element = document.createElement('div');
      shot.appendChild(element);

      const result = findDribbbleUrl(element);

      expect(result).toBe('https://dribbble.com/shots/87654321-awesome-design');
    });

    test('should fallback to generic when no shot found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findDribbbleUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /shots/ link in container', () => {
      const shot = document.createElement('div');
      shot.className = 'shot-thumbnail';

      const link = document.createElement('a');
      link.href = 'https://dribbble.com/designers';
      shot.appendChild(link);

      const element = document.createElement('div');
      shot.appendChild(element);

      const result = findDribbbleUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findBehanceUrl', () => {
    test('should extract URL from data-project-id', () => {
      const project = document.createElement('div');
      project.setAttribute('data-project-id', '123456');

      const link = document.createElement('a');
      link.href = 'https://www.behance.net/gallery/123456/project-title';
      project.appendChild(link);

      const element = document.createElement('span');
      project.appendChild(element);

      const result = findBehanceUrl(element);

      expect(result).toBe('https://www.behance.net/gallery/123456/project-title');
    });

    test('should extract URL from Project class', () => {
      const project = document.createElement('div');
      project.className = 'Project';

      const link = document.createElement('a');
      link.href = 'https://www.behance.net/gallery/987654/design-project';
      project.appendChild(link);

      const element = document.createElement('div');
      project.appendChild(element);

      const result = findBehanceUrl(element);

      expect(result).toBe('https://www.behance.net/gallery/987654/design-project');
    });

    test('should fallback to generic when no project found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findBehanceUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /gallery/ link in container', () => {
      const project = document.createElement('div');
      project.className = 'Project';

      const link = document.createElement('a');
      link.href = 'https://www.behance.net/search';
      project.appendChild(link);

      const element = document.createElement('div');
      project.appendChild(element);

      const result = findBehanceUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findDeviantartUrl', () => {
    test('should extract URL from data-deviationid', () => {
      const deviation = document.createElement('div');
      deviation.setAttribute('data-deviationid', 'ABC123');

      const link = document.createElement('a');
      link.setAttribute('data-hook', 'deviation_link');
      link.href = 'https://www.deviantart.com/artist/art/artwork-title-123456';
      deviation.appendChild(link);

      const element = document.createElement('span');
      deviation.appendChild(element);

      const result = findDeviantartUrl(element);

      expect(result).toBe('https://www.deviantart.com/artist/art/artwork-title-123456');
    });

    test('should extract URL from class name', () => {
      const deviation = document.createElement('div');
      deviation.className = '_2vUXu';

      const link = document.createElement('a');
      link.setAttribute('data-hook', 'deviation_link');
      link.href = 'https://www.deviantart.com/user/art/another-artwork-789012';
      deviation.appendChild(link);

      const element = document.createElement('div');
      deviation.appendChild(element);

      const result = findDeviantartUrl(element);

      expect(result).toBe('https://www.deviantart.com/user/art/another-artwork-789012');
    });

    test('should fallback to generic when no deviation found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findDeviantartUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no deviation_link in container', () => {
      const deviation = document.createElement('div');
      deviation.setAttribute('data-deviationid', '123');

      const link = document.createElement('a');
      link.href = 'https://www.deviantart.com/';
      deviation.appendChild(link);

      const element = document.createElement('div');
      deviation.appendChild(element);

      const result = findDeviantartUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findFlickrUrl', () => {
    test('should extract URL from photo-list-photo-view', () => {
      const photo = document.createElement('div');
      photo.className = 'photo-list-photo-view';

      const link = document.createElement('a');
      link.href = 'https://www.flickr.com/photos/username/12345678901/';
      photo.appendChild(link);

      const element = document.createElement('span');
      photo.appendChild(element);

      const result = findFlickrUrl(element);

      expect(result).toBe('https://www.flickr.com/photos/username/12345678901/');
    });

    test('should extract URL from data-photo-id', () => {
      const photo = document.createElement('div');
      photo.setAttribute('data-photo-id', '98765432109');

      const link = document.createElement('a');
      link.href = 'https://www.flickr.com/photos/user/98765432109/';
      photo.appendChild(link);

      const element = document.createElement('div');
      photo.appendChild(element);

      const result = findFlickrUrl(element);

      expect(result).toBe('https://www.flickr.com/photos/user/98765432109/');
    });

    test('should fallback to generic when no photo found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findFlickrUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /photos/ link in container', () => {
      const photo = document.createElement('div');
      photo.setAttribute('data-photo-id', '123');

      const link = document.createElement('a');
      link.href = 'https://www.flickr.com/explore';
      photo.appendChild(link);

      const element = document.createElement('div');
      photo.appendChild(element);

      const result = findFlickrUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('find500pxUrl', () => {
    test('should extract URL from photo-item', () => {
      const photo = document.createElement('div');
      photo.setAttribute('data-test', 'photo-item');

      const link = document.createElement('a');
      link.href = 'https://500px.com/photo/123456789/photo-title';
      photo.appendChild(link);

      const element = document.createElement('span');
      photo.appendChild(element);

      const result = find500pxUrl(element);

      expect(result).toBe('https://500px.com/photo/123456789/photo-title');
    });

    test('should fallback to generic when no photo found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = find500pxUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /photo/ link in container', () => {
      const photo = document.createElement('div');
      photo.setAttribute('data-test', 'photo-item');

      const link = document.createElement('a');
      link.href = 'https://500px.com/popular';
      photo.appendChild(link);

      const element = document.createElement('div');
      photo.appendChild(element);

      const result = find500pxUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findUnsplashUrl', () => {
    test('should extract URL from figure element', () => {
      const figure = document.createElement('figure');

      const link = document.createElement('a');
      link.href = 'https://unsplash.com/photos/abc123XYZ';
      figure.appendChild(link);

      const element = document.createElement('div');
      figure.appendChild(element);

      const result = findUnsplashUrl(element);

      expect(result).toBe('https://unsplash.com/photos/abc123XYZ');
    });

    test('should extract URL from data-test attribute', () => {
      const photo = document.createElement('div');
      photo.setAttribute('data-test', 'photo-grid-single-column-figure');

      const link = document.createElement('a');
      link.href = 'https://unsplash.com/photos/xyz789ABC';
      photo.appendChild(link);

      const element = document.createElement('span');
      photo.appendChild(element);

      const result = findUnsplashUrl(element);

      expect(result).toBe('https://unsplash.com/photos/xyz789ABC');
    });

    test('should fallback to generic when no photo found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findUnsplashUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /photos/ link in container', () => {
      const photo = document.createElement('figure');

      const link = document.createElement('a');
      link.href = 'https://unsplash.com/collections';
      photo.appendChild(link);

      const element = document.createElement('div');
      photo.appendChild(element);

      const result = findUnsplashUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findPexelsUrl', () => {
    test('should extract URL from data-photo-modal-medium', () => {
      const photo = document.createElement('div');
      photo.setAttribute('data-photo-modal-medium', 'true');

      const link = document.createElement('a');
      link.href = 'https://www.pexels.com/photo/123456/';
      photo.appendChild(link);

      const element = document.createElement('span');
      photo.appendChild(element);

      const result = findPexelsUrl(element);

      expect(result).toBe('https://www.pexels.com/photo/123456/');
    });

    test('should extract URL from article element', () => {
      const article = document.createElement('article');

      const link = document.createElement('a');
      link.href = 'https://www.pexels.com/photo/789012/';
      article.appendChild(link);

      const element = document.createElement('div');
      article.appendChild(element);

      const result = findPexelsUrl(element);

      expect(result).toBe('https://www.pexels.com/photo/789012/');
    });

    test('should fallback to generic when no photo found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findPexelsUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /photo/ link in container', () => {
      const photo = document.createElement('article');

      const link = document.createElement('a');
      link.href = 'https://www.pexels.com/videos';
      photo.appendChild(link);

      const element = document.createElement('div');
      photo.appendChild(element);

      const result = findPexelsUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findPixabayUrl', () => {
    test('should extract photo URL from data-id', () => {
      const photo = document.createElement('div');
      photo.setAttribute('data-id', '123456');

      const link = document.createElement('a');
      link.href = 'https://pixabay.com/photos/nature-landscape-123456/';
      photo.appendChild(link);

      const element = document.createElement('span');
      photo.appendChild(element);

      const result = findPixabayUrl(element);

      expect(result).toBe('https://pixabay.com/photos/nature-landscape-123456/');
    });

    test('should extract illustration URL', () => {
      const item = document.createElement('div');
      item.className = 'item';

      const link = document.createElement('a');
      link.href = 'https://pixabay.com/illustrations/art-design-789012/';
      item.appendChild(link);

      const element = document.createElement('div');
      item.appendChild(element);

      const result = findPixabayUrl(element);

      expect(result).toBe('https://pixabay.com/illustrations/art-design-789012/');
    });

    test('should fallback to generic when no photo found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findPixabayUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /photos/ or /illustrations/ link', () => {
      const photo = document.createElement('div');
      photo.className = 'item';

      const link = document.createElement('a');
      link.href = 'https://pixabay.com/videos';
      photo.appendChild(link);

      const element = document.createElement('div');
      photo.appendChild(element);

      const result = findPixabayUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findArtstationUrl', () => {
    test('should extract URL from project class', () => {
      const project = document.createElement('div');
      project.className = 'project';

      const link = document.createElement('a');
      link.href = 'https://www.artstation.com/artwork/abc123';
      project.appendChild(link);

      const element = document.createElement('span');
      project.appendChild(element);

      const result = findArtstationUrl(element);

      expect(result).toBe('https://www.artstation.com/artwork/abc123');
    });

    test('should extract URL from data-project-id', () => {
      const project = document.createElement('div');
      project.setAttribute('data-project-id', '789012');

      const link = document.createElement('a');
      link.href = 'https://www.artstation.com/artwork/xyz789';
      project.appendChild(link);

      const element = document.createElement('div');
      project.appendChild(element);

      const result = findArtstationUrl(element);

      expect(result).toBe('https://www.artstation.com/artwork/xyz789');
    });

    test('should fallback to generic when no project found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findArtstationUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /artwork/ link in container', () => {
      const project = document.createElement('div');
      project.className = 'project';

      const link = document.createElement('a');
      link.href = 'https://www.artstation.com/marketplace';
      project.appendChild(link);

      const element = document.createElement('div');
      project.appendChild(element);

      const result = findArtstationUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findImgurUrl', () => {
    test('should extract URL from post id', () => {
      const post = document.createElement('div');
      post.id = 'post-abc123';

      const link = document.createElement('a');
      link.href = 'https://imgur.com/gallery/abc123';
      post.appendChild(link);

      const element = document.createElement('span');
      post.appendChild(element);

      const result = findImgurUrl(element);

      expect(result).toBe('https://imgur.com/gallery/abc123');
    });

    test('should extract URL from Post class', () => {
      const post = document.createElement('div');
      post.className = 'Post';

      const link = document.createElement('a');
      link.href = 'https://imgur.com/gallery/xyz789';
      post.appendChild(link);

      const element = document.createElement('div');
      post.appendChild(element);

      const result = findImgurUrl(element);

      expect(result).toBe('https://imgur.com/gallery/xyz789');
    });

    test('should fallback to generic when no post found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findImgurUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /gallery/ link in container', () => {
      const post = document.createElement('div');
      post.className = 'Post';

      const link = document.createElement('a');
      link.href = 'https://imgur.com/hot';
      post.appendChild(link);

      const element = document.createElement('div');
      post.appendChild(element);

      const result = findImgurUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findGiphyUrl', () => {
    test('should extract URL from data-giphy-id', () => {
      const gif = document.createElement('div');
      gif.setAttribute('data-giphy-id', 'abc123xyz');

      const link = document.createElement('a');
      link.href = 'https://giphy.com/gifs/funny-cat-abc123xyz';
      gif.appendChild(link);

      const element = document.createElement('span');
      gif.appendChild(element);

      const result = findGiphyUrl(element);

      expect(result).toBe('https://giphy.com/gifs/funny-cat-abc123xyz');
    });

    test('should extract URL from gif class', () => {
      const gif = document.createElement('div');
      gif.className = 'gif';

      const link = document.createElement('a');
      link.href = 'https://giphy.com/gifs/awesome-animation-xyz789abc';
      gif.appendChild(link);

      const element = document.createElement('div');
      gif.appendChild(element);

      const result = findGiphyUrl(element);

      expect(result).toBe('https://giphy.com/gifs/awesome-animation-xyz789abc');
    });

    test('should fallback to generic when no gif found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findGiphyUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /gifs/ link in container', () => {
      const gif = document.createElement('div');
      gif.setAttribute('data-giphy-id', 'abc123');

      const link = document.createElement('a');
      link.href = 'https://giphy.com/search';
      gif.appendChild(link);

      const element = document.createElement('div');
      gif.appendChild(element);

      const result = findGiphyUrl(element);

      expect(result).toBeNull();
    });
  });
});
