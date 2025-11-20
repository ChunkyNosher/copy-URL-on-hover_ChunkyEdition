/**
 * Gaming Platform URL Handlers Tests
 * Tests for gaming platform URL detection (Steam, Epic Games, etc.)
 */

import { gamingHandlers } from '../../../src/features/url-handlers/gaming.js';

const {
  steam: findSteamUrl,
  steamPowered: findSteamPoweredUrl,
  epicGames: findEpicGamesUrl,
  gOG: findGOGUrl,
  itchIo: findItchIoUrl,
  gameJolt: findGameJoltUrl
} = gamingHandlers;

describe('Gaming Platform URL Handlers', () => {
  describe('findSteamUrl', () => {
    test('should extract URL from data-ds-appid element', () => {
      const item = document.createElement('div');
      item.setAttribute('data-ds-appid', '730');

      const link = document.createElement('a');
      link.href = 'https://store.steampowered.com/app/730/CounterStrike_2/';
      item.appendChild(link);

      const element = document.createElement('span');
      item.appendChild(element);

      const result = findSteamUrl(element);

      expect(result).toBe('https://store.steampowered.com/app/730/CounterStrike_2/');
    });

    test('should extract URL from search_result_row', () => {
      const row = document.createElement('div');
      row.className = 'search_result_row';

      const link = document.createElement('a');
      link.href = 'https://store.steampowered.com/app/1091500/Cyberpunk_2077/';
      row.appendChild(link);

      const element = document.createElement('div');
      row.appendChild(element);

      const result = findSteamUrl(element);

      expect(result).toBe('https://store.steampowered.com/app/1091500/Cyberpunk_2077/');
    });

    test('should fallback to generic when no item found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findSteamUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in item', () => {
      const item = document.createElement('div');
      item.setAttribute('data-ds-appid', '123');

      const element = document.createElement('div');
      item.appendChild(element);

      const result = findSteamUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findSteamPoweredUrl', () => {
    test('should extract URL from data-ds-appid element', () => {
      const item = document.createElement('div');
      item.setAttribute('data-ds-appid', '570');

      const link = document.createElement('a');
      link.href = 'https://store.steampowered.com/app/570/Dota_2/';
      item.appendChild(link);

      const element = document.createElement('span');
      item.appendChild(element);

      const result = findSteamPoweredUrl(element);

      expect(result).toBe('https://store.steampowered.com/app/570/Dota_2/');
    });

    test('should extract URL from game_area', () => {
      const area = document.createElement('div');
      area.className = 'game_area';

      const link = document.createElement('a');
      link.href = 'https://store.steampowered.com/app/945360/Among_Us/';
      area.appendChild(link);

      const element = document.createElement('div');
      area.appendChild(element);

      const result = findSteamPoweredUrl(element);

      expect(result).toBe('https://store.steampowered.com/app/945360/Among_Us/');
    });

    test('should fallback to generic when no item found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findSteamPoweredUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findEpicGamesUrl', () => {
    test('should extract URL from Card component', () => {
      const card = document.createElement('div');
      card.setAttribute('data-component', 'Card');

      const link = document.createElement('a');
      link.href = 'https://www.epicgames.com/store/en-US/p/fortnite';
      card.appendChild(link);

      const element = document.createElement('span');
      card.appendChild(element);

      const result = findEpicGamesUrl(element);

      expect(result).toBe('https://www.epicgames.com/store/en-US/p/fortnite');
    });

    test('should extract product URL from Card', () => {
      const card = document.createElement('div');
      card.setAttribute('data-component', 'Card');

      const link = document.createElement('a');
      link.href = 'https://store.epicgames.com/en-US/p/rocket-league';
      card.appendChild(link);

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findEpicGamesUrl(element);

      expect(result).toBe('https://store.epicgames.com/en-US/p/rocket-league');
    });

    test('should fallback to generic when no game found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findEpicGamesUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in card', () => {
      const card = document.createElement('div');
      card.setAttribute('data-component', 'Card');

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findEpicGamesUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findGOGUrl', () => {
    test('should extract URL from product-row', () => {
      const row = document.createElement('div');
      row.className = 'product-row';

      const link = document.createElement('a');
      link.href = 'https://www.gog.com/en/game/the_witcher_3_wild_hunt';
      row.appendChild(link);

      const element = document.createElement('span');
      row.appendChild(element);

      const result = findGOGUrl(element);

      expect(result).toBe('https://www.gog.com/en/game/the_witcher_3_wild_hunt');
    });

    test('should extract URL from data-game-id element', () => {
      const product = document.createElement('div');
      product.setAttribute('data-game-id', '1234567');

      const link = document.createElement('a');
      link.href = 'https://www.gog.com/game/cyberpunk_2077';
      product.appendChild(link);

      const element = document.createElement('div');
      product.appendChild(element);

      const result = findGOGUrl(element);

      expect(result).toBe('https://www.gog.com/game/cyberpunk_2077');
    });

    test('should fallback to generic when no product found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findGOGUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in product', () => {
      const product = document.createElement('div');
      product.className = 'product-row';

      const element = document.createElement('div');
      product.appendChild(element);

      const result = findGOGUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findItchIoUrl', () => {
    test('should extract URL from game_cell with game_link', () => {
      const cell = document.createElement('div');
      cell.className = 'game_cell';

      const link = document.createElement('a');
      link.className = 'game_link';
      link.href = 'https://username.itch.io/my-game';
      cell.appendChild(link);

      const element = document.createElement('span');
      cell.appendChild(element);

      const result = findItchIoUrl(element);

      expect(result).toBe('https://username.itch.io/my-game');
    });

    test('should extract URL from title link', () => {
      const cell = document.createElement('div');
      cell.className = 'game_cell';

      const link = document.createElement('a');
      link.className = 'title';
      link.href = 'https://author.itch.io/awesome-game';
      cell.appendChild(link);

      const element = document.createElement('div');
      cell.appendChild(element);

      const result = findItchIoUrl(element);

      expect(result).toBe('https://author.itch.io/awesome-game');
    });

    test('should extract URL from data-game_id element', () => {
      const game = document.createElement('div');
      game.setAttribute('data-game_id', '12345');

      const link = document.createElement('a');
      link.className = 'game_link';
      link.href = 'https://dev.itch.io/cool-game';
      game.appendChild(link);

      const element = document.createElement('span');
      game.appendChild(element);

      const result = findItchIoUrl(element);

      expect(result).toBe('https://dev.itch.io/cool-game');
    });

    test('should fallback to generic when no game found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findItchIoUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findGameJoltUrl', () => {
    test('should extract URL from game-card', () => {
      const card = document.createElement('div');
      card.className = 'game-card';

      const link = document.createElement('a');
      link.href = 'https://gamejolt.com/games/my-awesome-game/123456';
      card.appendChild(link);

      const element = document.createElement('span');
      card.appendChild(element);

      const result = findGameJoltUrl(element);

      expect(result).toBe('https://gamejolt.com/games/my-awesome-game/123456');
    });

    test('should extract URL from data-game-id element', () => {
      const game = document.createElement('div');
      game.setAttribute('data-game-id', '789012');

      const link = document.createElement('a');
      link.href = 'https://gamejolt.com/games/super-game/789012';
      game.appendChild(link);

      const element = document.createElement('div');
      game.appendChild(element);

      const result = findGameJoltUrl(element);

      expect(result).toBe('https://gamejolt.com/games/super-game/789012');
    });

    test('should fallback to generic when no game found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findGameJoltUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in game card', () => {
      const card = document.createElement('div');
      card.className = 'game-card';

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findGameJoltUrl(element);

      expect(result).toBeNull();
    });
  });
});
