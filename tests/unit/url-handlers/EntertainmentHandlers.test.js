/**
 * Entertainment Platform URL Handlers Tests
 * Tests for entertainment platform URL detection
 */

import { entertainmentHandlers } from '../../../src/features/url-handlers/entertainment.js';

const {
  wikipedia: findWikipediaUrl,
  imdb: findImdbUrl,
  rottenTomatoes: findRottenTomatoesUrl,
  netflix: findNetflixUrl,
  spotify: findSpotifyUrl,
  soundcloud: findSoundcloudUrl,
  letterboxd: findLetterboxdUrl,
  goodreads: findGoodreadsUrl,
  myAnimeList: findMyAnimeListUrl,
  aniList: findAniListUrl,
  kitsu: findKitsuUrl,
  lastFm: findLastFmUrl,
  bandcamp: findBandcampUrl
} = entertainmentHandlers;

describe('Entertainment Platform URL Handlers', () => {
  describe('findWikipediaUrl', () => {
    test('should use generic handler for direct links', () => {
      const link = document.createElement('a');
      link.href = 'https://en.wikipedia.org/wiki/JavaScript';

      const result = findWikipediaUrl(link);

      expect(result).toBe('https://en.wikipedia.org/wiki/JavaScript');
    });

    test('should fallback to generic handler for any element', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://en.wikipedia.org/wiki/Test';
      div.appendChild(link);

      const result = findWikipediaUrl(link);

      expect(result).toBe('https://en.wikipedia.org/wiki/Test');
    });
  });

  describe('findImdbUrl', () => {
    test('should extract /title/ URL from .lister-item', () => {
      const item = document.createElement('div');
      item.className = 'lister-item';

      const link = document.createElement('a');
      link.href = 'https://imdb.com/title/tt0111161/';
      item.appendChild(link);

      const result = findImdbUrl(item);

      expect(result).toBe('https://imdb.com/title/tt0111161/');
    });

    test('should extract /name/ URL from data-testid="title"', () => {
      const item = document.createElement('div');
      item.setAttribute('data-testid', 'title');

      const link = document.createElement('a');
      link.href = 'https://imdb.com/name/nm0000209/';
      item.appendChild(link);

      const result = findImdbUrl(item);

      expect(result).toBe('https://imdb.com/name/nm0000209/');
    });

    test('should return first matching link (/title/ or /name/)', () => {
      const item = document.createElement('div');
      item.className = 'lister-item';

      const titleLink = document.createElement('a');
      titleLink.href = 'https://imdb.com/title/tt456';
      item.appendChild(titleLink);

      const nameLink = document.createElement('a');
      nameLink.href = 'https://imdb.com/name/nm123';
      item.appendChild(nameLink);

      const result = findImdbUrl(item);

      // querySelector returns first match - /title/ comes first in selector
      expect(result).toBe('https://imdb.com/title/tt456');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findImdbUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching link', () => {
      const item = document.createElement('div');
      item.className = 'lister-item';

      const link = document.createElement('a');
      link.href = 'https://imdb.com/search';
      item.appendChild(link);

      const result = findImdbUrl(item);

      expect(result).toBeNull();
    });
  });

  describe('findRottenTomatoesUrl', () => {
    test('should extract /m/ URL from data-qa="discovery-media-list-item"', () => {
      const item = document.createElement('div');
      item.setAttribute('data-qa', 'discovery-media-list-item');

      const link = document.createElement('a');
      link.href = 'https://rottentomatoes.com/m/the_shawshank_redemption';
      item.appendChild(link);

      const result = findRottenTomatoesUrl(item);

      expect(result).toBe('https://rottentomatoes.com/m/the_shawshank_redemption');
    });

    test('should extract /tv/ URL', () => {
      const item = document.createElement('div');
      item.setAttribute('data-qa', 'discovery-media-list-item');

      const link = document.createElement('a');
      link.href = 'https://rottentomatoes.com/tv/breaking_bad';
      item.appendChild(link);

      const result = findRottenTomatoesUrl(item);

      expect(result).toBe('https://rottentomatoes.com/tv/breaking_bad');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findRottenTomatoesUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /m/ or /tv/ link', () => {
      const item = document.createElement('div');
      item.setAttribute('data-qa', 'discovery-media-list-item');

      const link = document.createElement('a');
      link.href = 'https://rottentomatoes.com/browse';
      item.appendChild(link);

      const result = findRottenTomatoesUrl(item);

      expect(result).toBeNull();
    });
  });

  describe('findNetflixUrl', () => {
    test('should return current page URL', () => {
      const originalLocation = window.location.href;

      const div = document.createElement('div');
      const result = findNetflixUrl(div);

      expect(result).toBe(originalLocation);
    });

    test('should work with any element', () => {
      const link = document.createElement('a');
      const result = findNetflixUrl(link);

      expect(result).toBe(window.location.href);
    });
  });

  describe('findSpotifyUrl', () => {
    test('should extract /track/ URL from data-testid="tracklist-row"', () => {
      const row = document.createElement('div');
      row.setAttribute('data-testid', 'tracklist-row');

      const link = document.createElement('a');
      link.href = 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp';
      row.appendChild(link);

      const result = findSpotifyUrl(row);

      expect(result).toBe('https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp');
    });

    test('should extract /album/ URL from .track', () => {
      const track = document.createElement('div');
      track.className = 'track';

      const link = document.createElement('a');
      link.href = 'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3';
      track.appendChild(link);

      const result = findSpotifyUrl(track);

      expect(result).toBe('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3');
    });

    test('should return first matching link (/track/ or /album/)', () => {
      const row = document.createElement('div');
      row.className = 'track';

      const trackLink = document.createElement('a');
      trackLink.href = 'https://open.spotify.com/track/456';
      row.appendChild(trackLink);

      const albumLink = document.createElement('a');
      albumLink.href = 'https://open.spotify.com/album/123';
      row.appendChild(albumLink);

      const result = findSpotifyUrl(row);

      // querySelector returns first match - /track/ comes first in selector
      expect(result).toBe('https://open.spotify.com/track/456');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findSpotifyUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /track/ or /album/ link', () => {
      const row = document.createElement('div');
      row.setAttribute('data-testid', 'tracklist-row');

      const link = document.createElement('a');
      link.href = 'https://open.spotify.com/playlist/abc';
      row.appendChild(link);

      const result = findSpotifyUrl(row);

      expect(result).toBeNull();
    });
  });

  describe('findSoundcloudUrl', () => {
    test('should extract URL from .searchItem', () => {
      const item = document.createElement('div');
      item.className = 'searchItem';

      const link = document.createElement('a');
      link.href = 'https://soundcloud.com/artist/track-name';
      item.appendChild(link);

      const result = findSoundcloudUrl(item);

      expect(result).toBe('https://soundcloud.com/artist/track-name');
    });

    test('should extract URL from .soundList__item', () => {
      const item = document.createElement('div');
      item.className = 'soundList__item';

      const link = document.createElement('a');
      link.href = 'https://soundcloud.com/user/song';
      item.appendChild(link);

      const result = findSoundcloudUrl(item);

      expect(result).toBe('https://soundcloud.com/user/song');
    });

    test('should require soundcloud.com in URL', () => {
      const item = document.createElement('div');
      item.className = 'searchItem';

      const link1 = document.createElement('a');
      link1.href = 'https://example.com/track';
      item.appendChild(link1);

      const link2 = document.createElement('a');
      link2.href = 'https://soundcloud.com/artist/track';
      item.appendChild(link2);

      const result = findSoundcloudUrl(item);

      expect(result).toBe('https://soundcloud.com/artist/track');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findSoundcloudUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no soundcloud.com link', () => {
      const item = document.createElement('div');
      item.className = 'searchItem';

      const link = document.createElement('a');
      link.href = 'https://example.com/music';
      item.appendChild(link);

      const result = findSoundcloudUrl(item);

      expect(result).toBeNull();
    });
  });

  describe('findLetterboxdUrl', () => {
    test('should extract /film/ URL from .film-poster', () => {
      const film = document.createElement('div');
      film.className = 'film-poster';

      const link = document.createElement('a');
      link.href = 'https://letterboxd.com/film/the-shawshank-redemption/';
      film.appendChild(link);

      const result = findLetterboxdUrl(film);

      expect(result).toBe('https://letterboxd.com/film/the-shawshank-redemption/');
    });

    test('should extract URL from data-film-id', () => {
      const film = document.createElement('div');
      film.setAttribute('data-film-id', '12345');

      const link = document.createElement('a');
      link.href = 'https://letterboxd.com/film/pulp-fiction/';
      film.appendChild(link);

      const result = findLetterboxdUrl(film);

      expect(result).toBe('https://letterboxd.com/film/pulp-fiction/');
    });

    test('should require /film/ in URL', () => {
      const film = document.createElement('div');
      film.className = 'film-poster';

      const link = document.createElement('a');
      link.href = 'https://letterboxd.com/user/films/';
      film.appendChild(link);

      const result = findLetterboxdUrl(film);

      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findLetterboxdUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findGoodreadsUrl', () => {
    test('should extract /book/show/ URL from .bookBox', () => {
      const book = document.createElement('div');
      book.className = 'bookBox';

      const link = document.createElement('a');
      link.href = 'https://goodreads.com/book/show/123-book-title';
      book.appendChild(link);

      const result = findGoodreadsUrl(book);

      expect(result).toBe('https://goodreads.com/book/show/123-book-title');
    });

    test('should extract URL from data-book-id', () => {
      const book = document.createElement('div');
      book.setAttribute('data-book-id', '456');

      const link = document.createElement('a');
      link.href = 'https://goodreads.com/book/show/456-another-book';
      book.appendChild(link);

      const result = findGoodreadsUrl(book);

      expect(result).toBe('https://goodreads.com/book/show/456-another-book');
    });

    test('should require /book/show/ in URL', () => {
      const book = document.createElement('div');
      book.className = 'bookBox';

      const link = document.createElement('a');
      link.href = 'https://goodreads.com/author/show/123';
      book.appendChild(link);

      const result = findGoodreadsUrl(book);

      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findGoodreadsUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findMyAnimeListUrl', () => {
    test('should extract /anime/ URL from .anime_ranking_h3', () => {
      const anime = document.createElement('div');
      anime.className = 'anime_ranking_h3';

      const link = document.createElement('a');
      link.href = 'https://myanimelist.net/anime/5114/Fullmetal_Alchemist_Brotherhood';
      anime.appendChild(link);

      const result = findMyAnimeListUrl(anime);

      expect(result).toBe('https://myanimelist.net/anime/5114/Fullmetal_Alchemist_Brotherhood');
    });

    test('should extract URL from data-id', () => {
      const anime = document.createElement('div');
      anime.setAttribute('data-id', '123');

      const link = document.createElement('a');
      link.href = 'https://myanimelist.net/anime/123/Death_Note';
      anime.appendChild(link);

      const result = findMyAnimeListUrl(anime);

      expect(result).toBe('https://myanimelist.net/anime/123/Death_Note');
    });

    test('should require /anime/ in URL', () => {
      const anime = document.createElement('div');
      anime.className = 'anime_ranking_h3';

      const link = document.createElement('a');
      link.href = 'https://myanimelist.net/manga/456';
      anime.appendChild(link);

      const result = findMyAnimeListUrl(anime);

      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findMyAnimeListUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findAniListUrl', () => {
    test('should extract /anime/ URL from .media-card', () => {
      const media = document.createElement('div');
      media.className = 'media-card';

      const link = document.createElement('a');
      link.href = 'https://anilist.co/anime/20958/Shingeki-no-Kyojin';
      media.appendChild(link);

      const result = findAniListUrl(media);

      expect(result).toBe('https://anilist.co/anime/20958/Shingeki-no-Kyojin');
    });

    test('should extract /manga/ URL from data-media-id', () => {
      const media = document.createElement('div');
      media.setAttribute('data-media-id', '789');

      const link = document.createElement('a');
      link.href = 'https://anilist.co/manga/30011/Naruto';
      media.appendChild(link);

      const result = findAniListUrl(media);

      expect(result).toBe('https://anilist.co/manga/30011/Naruto');
    });

    test('should return first matching link (/anime/ or /manga/)', () => {
      const media = document.createElement('div');
      media.className = 'media-card';

      const animeLink = document.createElement('a');
      animeLink.href = 'https://anilist.co/anime/456';
      media.appendChild(animeLink);

      const mangaLink = document.createElement('a');
      mangaLink.href = 'https://anilist.co/manga/123';
      media.appendChild(mangaLink);

      const result = findAniListUrl(media);

      // querySelector returns first match - /anime/ comes first in selector
      expect(result).toBe('https://anilist.co/anime/456');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findAniListUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /anime/ or /manga/ link', () => {
      const media = document.createElement('div');
      media.className = 'media-card';

      const link = document.createElement('a');
      link.href = 'https://anilist.co/user/profile';
      media.appendChild(link);

      const result = findAniListUrl(media);

      expect(result).toBeNull();
    });
  });

  describe('findKitsuUrl', () => {
    test('should extract /anime/ URL from .media-card', () => {
      const media = document.createElement('div');
      media.className = 'media-card';

      const link = document.createElement('a');
      link.href = 'https://kitsu.io/anime/attack-on-titan';
      media.appendChild(link);

      const result = findKitsuUrl(media);

      expect(result).toBe('https://kitsu.io/anime/attack-on-titan');
    });

    test('should extract /manga/ URL from .media-card', () => {
      const media = document.createElement('div');
      media.className = 'media-card';

      const link = document.createElement('a');
      link.href = 'https://kitsu.io/manga/one-piece';
      media.appendChild(link);

      const result = findKitsuUrl(media);

      expect(result).toBe('https://kitsu.io/manga/one-piece');
    });

    test('should return first matching link (/anime/ or /manga/)', () => {
      const media = document.createElement('div');
      media.className = 'media-card';

      const animeLink = document.createElement('a');
      animeLink.href = 'https://kitsu.io/anime/test';
      media.appendChild(animeLink);

      const mangaLink = document.createElement('a');
      mangaLink.href = 'https://kitsu.io/manga/test';
      media.appendChild(mangaLink);

      const result = findKitsuUrl(media);

      // querySelector returns first match - /anime/ comes first in selector
      expect(result).toBe('https://kitsu.io/anime/test');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findKitsuUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching link', () => {
      const media = document.createElement('div');
      media.className = 'media-card';

      const link = document.createElement('a');
      link.href = 'https://kitsu.io/users/profile';
      media.appendChild(link);

      const result = findKitsuUrl(media);

      expect(result).toBeNull();
    });
  });

  describe('findLastFmUrl', () => {
    test('should extract /music/ URL from .chartlist-row', () => {
      const item = document.createElement('div');
      item.className = 'chartlist-row';

      const link = document.createElement('a');
      link.href = 'https://last.fm/music/Radiohead';
      item.appendChild(link);

      const result = findLastFmUrl(item);

      expect(result).toBe('https://last.fm/music/Radiohead');
    });

    test('should extract URL from data-track-id', () => {
      const item = document.createElement('div');
      item.setAttribute('data-track-id', '12345');

      const link = document.createElement('a');
      link.href = 'https://last.fm/music/The+Beatles/_/Hey+Jude';
      item.appendChild(link);

      const result = findLastFmUrl(item);

      expect(result).toBe('https://last.fm/music/The+Beatles/_/Hey+Jude');
    });

    test('should require /music/ in URL', () => {
      const item = document.createElement('div');
      item.className = 'chartlist-row';

      const link = document.createElement('a');
      link.href = 'https://last.fm/user/profile';
      item.appendChild(link);

      const result = findLastFmUrl(item);

      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findLastFmUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findBandcampUrl', () => {
    test('should extract /track/ URL from .item-details', () => {
      const item = document.createElement('div');
      item.className = 'item-details';

      const link = document.createElement('a');
      link.href = 'https://artist.bandcamp.com/track/song-name';
      item.appendChild(link);

      const result = findBandcampUrl(item);

      expect(result).toBe('https://artist.bandcamp.com/track/song-name');
    });

    test('should extract /album/ URL from data-item-id', () => {
      const item = document.createElement('div');
      item.setAttribute('data-item-id', '789');

      const link = document.createElement('a');
      link.href = 'https://artist.bandcamp.com/album/album-name';
      item.appendChild(link);

      const result = findBandcampUrl(item);

      expect(result).toBe('https://artist.bandcamp.com/album/album-name');
    });

    test('should return first matching link (/track/ or /album/)', () => {
      const item = document.createElement('div');
      item.className = 'item-details';

      const trackLink = document.createElement('a');
      trackLink.href = 'https://artist.bandcamp.com/track/test';
      item.appendChild(trackLink);

      const albumLink = document.createElement('a');
      albumLink.href = 'https://artist.bandcamp.com/album/test';
      item.appendChild(albumLink);

      const result = findBandcampUrl(item);

      // querySelector returns first match - /track/ comes first in selector
      expect(result).toBe('https://artist.bandcamp.com/track/test');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findBandcampUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /track/ or /album/ link', () => {
      const item = document.createElement('div');
      item.className = 'item-details';

      const link = document.createElement('a');
      link.href = 'https://bandcamp.com/discover';
      item.appendChild(link);

      const result = findBandcampUrl(item);

      expect(result).toBeNull();
    });
  });
});
