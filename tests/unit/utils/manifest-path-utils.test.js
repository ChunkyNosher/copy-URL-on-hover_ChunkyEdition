import { normalizeManifestPaths } from '../../../scripts/manifest-path-utils.js';

describe('normalizeManifestPaths', () => {
  test('removes dist prefixes from manifest script paths', () => {
    const manifest = {
      background: {
        scripts: ['dist/browser-polyfill.min.js', 'dist/background.js']
      },
      content_scripts: [{ js: ['dist/browser-polyfill.min.js', 'dist/content.js'] }]
    };

    const normalized = JSON.parse(normalizeManifestPaths(JSON.stringify(manifest)));

    expect(normalized.background.scripts).toEqual(['browser-polyfill.min.js', 'background.js']);
    expect(normalized.content_scripts[0].js).toEqual(['browser-polyfill.min.js', 'content.js']);
  });

  test('leaves already normalized paths unchanged', () => {
    const manifest = {
      background: {
        scripts: ['browser-polyfill.min.js', 'background.js']
      },
      content_scripts: [{ js: ['browser-polyfill.min.js', 'content.js'] }]
    };

    const normalized = JSON.parse(normalizeManifestPaths(JSON.stringify(manifest)));

    expect(normalized.background.scripts).toEqual(['browser-polyfill.min.js', 'background.js']);
    expect(normalized.content_scripts[0].js).toEqual(['browser-polyfill.min.js', 'content.js']);
  });
});
