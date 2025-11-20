/**
 * Video Platform URL Handlers Tests
 * Tests for video platform URL detection (YouTube, Vimeo, etc.)
 */

import { videoHandlers } from '../../../src/features/url-handlers/video.js';

const {
  youTube: findYouTubeUrl,
  vimeo: findVimeoUrl,
  dailyMotion: findDailyMotionUrl,
  twitch: findTwitchUrl,
  rumble: findRumbleUrl,
  odysee: findOdyseeUrl,
  bitchute: findBitchuteUrl
} = videoHandlers;

describe('Video Platform URL Handlers', () => {
  describe('findYouTubeUrl', () => {
    test('should extract URL from ytd-rich-grid-media', () => {
      const gridMedia = document.createElement('ytd-rich-grid-media');

      const thumbnailLink = document.createElement('a');
      thumbnailLink.id = 'thumbnail';
      thumbnailLink.href = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
      gridMedia.appendChild(thumbnailLink);

      const result = findYouTubeUrl(gridMedia);

      expect(result).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ');
    });

    test('should extract URL from ytd-video-renderer', () => {
      const renderer = document.createElement('ytd-video-renderer');

      const watchLink = document.createElement('a');
      watchLink.href = 'https://youtube.com/watch?v=abc123XYZ';
      renderer.appendChild(watchLink);

      const result = findYouTubeUrl(renderer);

      expect(result).toBe('https://youtube.com/watch?v=abc123XYZ');
    });

    test('should prioritize thumbnail link over general watch link', () => {
      const card = document.createElement('ytd-thumbnail');

      const watchLink = document.createElement('a');
      watchLink.href = 'https://youtube.com/watch?v=general';
      card.appendChild(watchLink);

      const thumbnailLink = document.createElement('a');
      thumbnailLink.id = 'thumbnail';
      thumbnailLink.href = 'https://youtube.com/watch?v=thumbnail';
      card.appendChild(thumbnailLink);

      const result = findYouTubeUrl(card);

      expect(result).toBe('https://youtube.com/watch?v=thumbnail');
    });

    test('should handle direct link element with /watch as videoCard', () => {
      // The link element itself can be the videoCard when it matches a[href*="/watch"]
      const link = document.createElement('a');
      link.href = 'https://youtube.com/watch?v=test456';

      // Add a child link with watch?v= for querySelector to find
      const innerLink = document.createElement('a');
      innerLink.href = 'https://youtube.com/watch?v=test456';
      link.appendChild(innerLink);

      const result = findYouTubeUrl(link);

      expect(result).toBe('https://youtube.com/watch?v=test456');
    });

    test('should fallback to generic handler when no video card', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findYouTubeUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no watch link found', () => {
      const renderer = document.createElement('ytd-video-renderer');

      const link = document.createElement('a');
      link.href = 'https://youtube.com/channel/UC123';
      renderer.appendChild(link);

      const result = findYouTubeUrl(renderer);

      expect(result).toBeNull();
    });
  });

  describe('findVimeoUrl', () => {
    test('should extract URL from data-clip-id container', () => {
      const video = document.createElement('div');
      video.setAttribute('data-clip-id', '123456789');

      const link = document.createElement('a');
      link.href = 'https://vimeo.com/123456789';
      video.appendChild(link);

      const result = findVimeoUrl(video);

      expect(result).toBe('https://vimeo.com/123456789');
    });

    test('should extract URL from .clip_grid_item', () => {
      const item = document.createElement('div');
      item.className = 'clip_grid_item';

      const link = document.createElement('a');
      link.href = 'https://vimeo.com/video/987654321';
      item.appendChild(link);

      const result = findVimeoUrl(item);

      expect(result).toBe('https://vimeo.com/video/987654321');
    });

    test('should match vimeo.com/ URL pattern', () => {
      const video = document.createElement('div');
      video.setAttribute('data-clip-id', 'test');

      const link = document.createElement('a');
      link.href = 'https://vimeo.com/channels/staffpicks/12345';
      video.appendChild(link);

      const result = findVimeoUrl(video);

      expect(result).toBe('https://vimeo.com/channels/staffpicks/12345');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findVimeoUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no vimeo.com link', () => {
      const video = document.createElement('div');
      video.className = 'clip_grid_item';

      const link = document.createElement('a');
      link.href = 'https://example.com/video';
      video.appendChild(link);

      const result = findVimeoUrl(video);

      expect(result).toBeNull();
    });
  });

  describe('findDailyMotionUrl', () => {
    test('should extract URL from data-video container', () => {
      const video = document.createElement('div');
      video.setAttribute('data-video', 'x123abc');

      const link = document.createElement('a');
      link.href = 'https://dailymotion.com/video/x123abc';
      video.appendChild(link);

      const result = findDailyMotionUrl(video);

      expect(result).toBe('https://dailymotion.com/video/x123abc');
    });

    test('should extract URL from .sd_video_item', () => {
      const item = document.createElement('div');
      item.className = 'sd_video_item';

      const link = document.createElement('a');
      link.href = 'https://dailymotion.com/video/x789xyz';
      item.appendChild(link);

      const result = findDailyMotionUrl(item);

      expect(result).toBe('https://dailymotion.com/video/x789xyz');
    });

    test('should require /video/ in URL', () => {
      const video = document.createElement('div');
      video.className = 'sd_video_item';

      const link = document.createElement('a');
      link.href = 'https://dailymotion.com/user/123';
      video.appendChild(link);

      const result = findDailyMotionUrl(video);

      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findDailyMotionUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findTwitchUrl', () => {
    test('should extract video URL from data-a-target="video-card"', () => {
      const card = document.createElement('div');
      card.setAttribute('data-a-target', 'video-card');

      const link = document.createElement('a');
      link.href = 'https://twitch.tv/videos/123456789';
      card.appendChild(link);

      const result = findTwitchUrl(card);

      expect(result).toBe('https://twitch.tv/videos/123456789');
    });

    test('should extract clip URL from .video-card', () => {
      const card = document.createElement('div');
      card.className = 'video-card';

      const link = document.createElement('a');
      link.href = 'https://twitch.tv/username/clip/ClipName123';
      card.appendChild(link);

      const result = findTwitchUrl(card);

      expect(result).toBe('https://twitch.tv/username/clip/ClipName123');
    });

    test('should match /videos/ or /clip/ in URL', () => {
      const card = document.createElement('div');
      card.className = 'video-card';

      const link1 = document.createElement('a');
      link1.href = 'https://twitch.tv/directory';
      card.appendChild(link1);

      const link2 = document.createElement('a');
      link2.href = 'https://twitch.tv/clip/TestClip';
      card.appendChild(link2);

      const result = findTwitchUrl(card);

      expect(result).toBe('https://twitch.tv/clip/TestClip');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findTwitchUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching link', () => {
      const card = document.createElement('div');
      card.setAttribute('data-a-target', 'video-card');

      const link = document.createElement('a');
      link.href = 'https://twitch.tv/directory';
      card.appendChild(link);

      const result = findTwitchUrl(card);

      expect(result).toBeNull();
    });
  });

  describe('findRumbleUrl', () => {
    test('should extract URL from .video-item', () => {
      const item = document.createElement('div');
      item.className = 'video-item';

      const link = document.createElement('a');
      link.href = 'https://rumble.com/video-title.html';
      item.appendChild(link);

      const result = findRumbleUrl(item);

      expect(result).toBe('https://rumble.com/video-title.html');
    });

    test('should extract URL from data-video container', () => {
      const video = document.createElement('div');
      video.setAttribute('data-video', 'rumble-123');

      const link = document.createElement('a');
      link.href = 'https://rumble.com/another-video.html';
      video.appendChild(link);

      const result = findRumbleUrl(video);

      expect(result).toBe('https://rumble.com/another-video.html');
    });

    test('should require .html extension', () => {
      const item = document.createElement('div');
      item.className = 'video-item';

      const link = document.createElement('a');
      link.href = 'https://rumble.com/c/channel';
      item.appendChild(link);

      const result = findRumbleUrl(item);

      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findRumbleUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findOdyseeUrl', () => {
    test('should extract URL from .claim-preview', () => {
      const preview = document.createElement('div');
      preview.className = 'claim-preview';

      const link = document.createElement('a');
      link.href = 'https://odysee.com/@channel:1/video-title:2';
      preview.appendChild(link);

      const result = findOdyseeUrl(preview);

      expect(result).toBe('https://odysee.com/@channel:1/video-title:2');
    });

    test('should extract URL from data-id container', () => {
      const video = document.createElement('div');
      video.setAttribute('data-id', 'odysee-123');

      const link = document.createElement('a');
      link.href = 'https://odysee.com/@creator:a/content:b';
      video.appendChild(link);

      const result = findOdyseeUrl(video);

      expect(result).toBe('https://odysee.com/@creator:a/content:b');
    });

    test('should require /@ in URL', () => {
      const preview = document.createElement('div');
      preview.className = 'claim-preview';

      const link = document.createElement('a');
      link.href = 'https://odysee.com/explore';
      preview.appendChild(link);

      const result = findOdyseeUrl(preview);

      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findOdyseeUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findBitchuteUrl', () => {
    test('should extract URL from .video-card', () => {
      const card = document.createElement('div');
      card.className = 'video-card';

      const link = document.createElement('a');
      link.href = 'https://bitchute.com/video/abc123/';
      card.appendChild(link);

      const result = findBitchuteUrl(card);

      expect(result).toBe('https://bitchute.com/video/abc123/');
    });

    test('should extract URL from .channel-videos-container', () => {
      const container = document.createElement('div');
      container.className = 'channel-videos-container';

      const link = document.createElement('a');
      link.href = 'https://bitchute.com/video/xyz789/';
      container.appendChild(link);

      const result = findBitchuteUrl(container);

      expect(result).toBe('https://bitchute.com/video/xyz789/');
    });

    test('should require /video/ in URL', () => {
      const card = document.createElement('div');
      card.className = 'video-card';

      const link = document.createElement('a');
      link.href = 'https://bitchute.com/channel/test';
      card.appendChild(link);

      const result = findBitchuteUrl(card);

      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findBitchuteUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });
});
