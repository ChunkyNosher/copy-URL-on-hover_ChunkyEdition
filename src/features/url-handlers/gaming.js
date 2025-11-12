/**
 * Gaming URL Handlers
 * URL detection for gaming platforms
 */

import { debug } from '../../utils/debug.js';
import { findGenericUrl } from './generic.js';

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

export const gamingHandlers = {
  steam: findSteamUrl,
  steamPowered: findSteamPoweredUrl,
  epicGames: findEpicGamesUrl,
  gOG: findGOGUrl,
  itchIo: findItchIoUrl,
  gameJolt: findGameJoltUrl,
};
