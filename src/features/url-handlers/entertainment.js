/**
 * Entertainment URL Handlers
 * URL detection for entertainment platforms
 */

import { debug } from '../../utils/debug.js';
import { findGenericUrl } from './generic.js';

function findWikipediaUrl(element) {
  // Only return URL if hovering over an actual link element
  // Don't default to current page URL
  return findGenericUrl(element);
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

export const entertainmentHandlers = {
  wikipedia: findWikipediaUrl,
  imdb: findImdbUrl,
  rottenTomatoes: findRottenTomatoesUrl,
  netflix: findNetflixUrl,
  letterboxd: findLetterboxdUrl,
  goodreads: findGoodreadsUrl,
  myAnimeList: findMyAnimeListUrl,
  aniList: findAniListUrl,
  kitsu: findKitsuUrl,
  lastFm: findLastFmUrl,
  spotify: findSpotifyUrl,
  soundcloud: findSoundcloudUrl,
  bandcamp: findBandcampUrl
};
