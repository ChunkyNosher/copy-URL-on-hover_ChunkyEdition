import {
  FormatMigrator,
  V1_5_8_15_Format,
  V1_5_8_14_Format,
  LegacyFormat,
  EmptyFormat
} from '../../../src/storage/FormatMigrator.js';

describe('FormatMigrator', () => {
  let migrator;

  beforeEach(() => {
    migrator = new FormatMigrator();
  });

  describe('V1_5_8_15_Format (Current)', () => {
    test('should match current format with containers key', () => {
      const data = {
        containers: {
          'firefox-default': {
            tabs: [{ id: 'qt-1' }],
            lastUpdate: Date.now()
          }
        },
        saveId: '123-abc',
        timestamp: Date.now()
      };

      const format = new V1_5_8_15_Format();
      expect(format.matches(data)).toBe(true);
    });

    test('should not match when containers key is missing', () => {
      const data = {
        tabs: [{ id: 'qt-1' }],
        timestamp: Date.now()
      };

      const format = new V1_5_8_15_Format();
      expect(format.matches(data)).toBe(false);
    });

    test('should parse without modification', () => {
      const data = {
        containers: {
          'firefox-default': {
            tabs: [{ id: 'qt-1' }],
            lastUpdate: 123456
          },
          'firefox-container-1': {
            tabs: [{ id: 'qt-2' }],
            lastUpdate: 123457
          }
        }
      };

      const format = new V1_5_8_15_Format();
      const result = format.parse(data);

      expect(result).toEqual(data.containers);
      expect(result['firefox-default'].tabs).toHaveLength(1);
      expect(result['firefox-container-1'].tabs).toHaveLength(1);
    });

    test('should return empty object when containers is missing', () => {
      const data = {
        saveId: '123-abc'
      };

      const format = new V1_5_8_15_Format();
      const result = format.parse(data);

      expect(result).toEqual({});
    });

    test('should report correct version', () => {
      const format = new V1_5_8_15_Format();
      expect(format.getVersion()).toBe('v1.5.8.15+');
    });
  });

  describe('V1_5_8_14_Format (Unwrapped)', () => {
    test('should match unwrapped container format', () => {
      const data = {
        'firefox-default': {
          tabs: [{ id: 'qt-1' }],
          lastUpdate: Date.now()
        },
        'firefox-container-1': {
          tabs: [{ id: 'qt-2' }],
          lastUpdate: Date.now()
        },
        saveId: '123-abc',
        timestamp: Date.now()
      };

      const format = new V1_5_8_14_Format();
      expect(format.matches(data)).toBe(true);
    });

    test('should not match current format', () => {
      const data = {
        containers: {
          'firefox-default': {
            tabs: [],
            lastUpdate: Date.now()
          }
        }
      };

      const format = new V1_5_8_14_Format();
      expect(format.matches(data)).toBe(false);
    });

    test('should not match legacy format', () => {
      const data = {
        tabs: [{ id: 'qt-1' }],
        timestamp: Date.now()
      };

      const format = new V1_5_8_14_Format();
      expect(format.matches(data)).toBe(false);
    });

    test('should parse unwrapped containers', () => {
      const data = {
        'firefox-default': {
          tabs: [{ id: 'qt-1' }],
          lastUpdate: 123456
        },
        'firefox-container-1': {
          tabs: [{ id: 'qt-2' }],
          lastUpdate: 123457
        },
        saveId: '123-abc',
        timestamp: 999999
      };

      const format = new V1_5_8_14_Format();
      const result = format.parse(data);

      expect(result).toEqual({
        'firefox-default': {
          tabs: [{ id: 'qt-1' }],
          lastUpdate: 123456
        },
        'firefox-container-1': {
          tabs: [{ id: 'qt-2' }],
          lastUpdate: 123457
        }
      });

      // Should not include metadata
      expect(result.saveId).toBeUndefined();
      expect(result.timestamp).toBeUndefined();
    });

    test('should report correct version', () => {
      const format = new V1_5_8_14_Format();
      expect(format.getVersion()).toBe('v1.5.8.14');
    });
  });

  describe('LegacyFormat (Flat Tabs)', () => {
    test('should match legacy format with tabs array', () => {
      const data = {
        tabs: [
          { id: 'qt-1', url: 'https://example.com' },
          { id: 'qt-2', url: 'https://test.com' }
        ],
        timestamp: Date.now()
      };

      const format = new LegacyFormat();
      expect(format.matches(data)).toBe(true);
    });

    test('should not match current format', () => {
      const data = {
        containers: {
          'firefox-default': {
            tabs: [],
            lastUpdate: Date.now()
          }
        }
      };

      const format = new LegacyFormat();
      expect(format.matches(data)).toBe(false);
    });

    test('should migrate to container-aware format', () => {
      const timestamp = Date.now();
      const data = {
        tabs: [
          { id: 'qt-1', url: 'https://one.com' },
          { id: 'qt-2', url: 'https://two.com' }
        ],
        timestamp: timestamp
      };

      const format = new LegacyFormat();
      const result = format.parse(data);

      expect(result).toEqual({
        'firefox-default': {
          tabs: [
            { id: 'qt-1', url: 'https://one.com' },
            { id: 'qt-2', url: 'https://two.com' }
          ],
          lastUpdate: timestamp
        }
      });
    });

    test('should use current timestamp when timestamp missing', () => {
      const data = {
        tabs: [{ id: 'qt-1' }]
      };

      const format = new LegacyFormat();
      const result = format.parse(data);

      expect(result['firefox-default'].lastUpdate).toBeGreaterThan(Date.now() - 1000);
    });

    test('should report correct version', () => {
      const format = new LegacyFormat();
      expect(format.getVersion()).toBe('v1.5.8.13-legacy');
    });
  });

  describe('EmptyFormat (Fallback)', () => {
    test('should match any data', () => {
      const format = new EmptyFormat();
      expect(format.matches(null)).toBe(true);
      expect(format.matches(undefined)).toBe(true);
      expect(format.matches({})).toBe(true);
      expect(format.matches({ random: 'data' })).toBe(true);
    });

    test('should return empty containers', () => {
      const format = new EmptyFormat();
      expect(format.parse(null)).toEqual({});
      expect(format.parse(undefined)).toEqual({});
      expect(format.parse({})).toEqual({});
    });

    test('should report correct version', () => {
      const format = new EmptyFormat();
      expect(format.getVersion()).toBe('empty');
    });
  });

  describe('FormatMigrator.detect()', () => {
    test('should detect v1.5.8.15+ format', () => {
      const data = {
        containers: {
          'firefox-default': {
            tabs: [],
            lastUpdate: Date.now()
          }
        }
      };

      const format = migrator.detect(data);
      expect(format).toBeInstanceOf(V1_5_8_15_Format);
    });

    test('should detect v1.5.8.14 format', () => {
      const data = {
        'firefox-default': {
          tabs: [],
          lastUpdate: Date.now()
        },
        'firefox-container-1': {
          tabs: [],
          lastUpdate: Date.now()
        }
      };

      const format = migrator.detect(data);
      expect(format).toBeInstanceOf(V1_5_8_14_Format);
    });

    test('should detect legacy format', () => {
      const data = {
        tabs: [{ id: 'qt-1' }],
        timestamp: Date.now()
      };

      const format = migrator.detect(data);
      expect(format).toBeInstanceOf(LegacyFormat);
    });

    test('should fallback to EmptyFormat for unrecognized data', () => {
      const data = {
        randomKey: 'randomValue'
      };

      const format = migrator.detect(data);
      expect(format).toBeInstanceOf(EmptyFormat);
    });

    test('should fallback to EmptyFormat for null/undefined', () => {
      expect(migrator.detect(null)).toBeInstanceOf(EmptyFormat);
      expect(migrator.detect(undefined)).toBeInstanceOf(EmptyFormat);
    });
  });

  describe('FormatMigrator.parse()', () => {
    test('should parse current format', () => {
      const data = {
        containers: {
          'firefox-default': {
            tabs: [{ id: 'qt-1' }],
            lastUpdate: 123456
          }
        }
      };

      const result = migrator.parse(data);
      expect(result).toEqual(data.containers);
    });

    test('should parse and migrate v1.5.8.14 format', () => {
      const data = {
        'firefox-default': {
          tabs: [{ id: 'qt-1' }],
          lastUpdate: 123456
        }
      };

      const result = migrator.parse(data);
      expect(result['firefox-default'].tabs).toEqual([{ id: 'qt-1' }]);
    });

    test('should parse and migrate legacy format', () => {
      const data = {
        tabs: [{ id: 'qt-1' }],
        timestamp: 123456
      };

      const result = migrator.parse(data);
      expect(result['firefox-default'].tabs).toEqual([{ id: 'qt-1' }]);
      expect(result['firefox-default'].lastUpdate).toBe(123456);
    });

    test('should handle empty data', () => {
      const result = migrator.parse({});
      expect(result).toEqual({});
    });
  });

  describe('FormatMigrator.needsMigration()', () => {
    test('should return false for current format', () => {
      const data = {
        containers: {
          'firefox-default': {
            tabs: [],
            lastUpdate: Date.now()
          }
        }
      };

      expect(migrator.needsMigration(data)).toBe(false);
    });

    test('should return true for v1.5.8.14 format', () => {
      const data = {
        'firefox-default': {
          tabs: [],
          lastUpdate: Date.now()
        }
      };

      expect(migrator.needsMigration(data)).toBe(true);
    });

    test('should return true for legacy format', () => {
      const data = {
        tabs: [],
        timestamp: Date.now()
      };

      expect(migrator.needsMigration(data)).toBe(true);
    });

    test('should return true for empty/unrecognized data', () => {
      expect(migrator.needsMigration({})).toBe(true);
      expect(migrator.needsMigration(null)).toBe(true);
    });
  });

  describe('FormatMigrator.getSupportedVersions()', () => {
    test('should return all supported versions', () => {
      const versions = migrator.getSupportedVersions();
      expect(versions).toContain('v1.5.8.15+');
      expect(versions).toContain('v1.5.8.14');
      expect(versions).toContain('v1.5.8.13-legacy');
      expect(versions).toContain('empty');
      expect(versions).toHaveLength(4);
    });
  });

  describe('Integration Tests', () => {
    test('should migrate from legacy to current preserving all tabs', () => {
      const legacyData = {
        tabs: [
          {
            id: 'qt-1',
            url: 'https://example.com',
            position: { left: 100, top: 100 },
            size: { width: 400, height: 300 }
          },
          {
            id: 'qt-2',
            url: 'https://test.com',
            position: { left: 200, top: 200 },
            size: { width: 500, height: 400 }
          }
        ],
        timestamp: 999999
      };

      const result = migrator.parse(legacyData);

      expect(result['firefox-default'].tabs).toHaveLength(2);
      expect(result['firefox-default'].tabs[0].id).toBe('qt-1');
      expect(result['firefox-default'].tabs[1].id).toBe('qt-2');
      expect(result['firefox-default'].lastUpdate).toBe(999999);
    });

    test('should preserve multiple containers in v1.5.8.14 format', () => {
      const v14Data = {
        'firefox-default': {
          tabs: [{ id: 'qt-1' }],
          lastUpdate: 111111
        },
        'firefox-container-1': {
          tabs: [{ id: 'qt-2' }],
          lastUpdate: 222222
        },
        'firefox-container-2': {
          tabs: [{ id: 'qt-3' }],
          lastUpdate: 333333
        }
      };

      const result = migrator.parse(v14Data);

      expect(Object.keys(result)).toHaveLength(3);
      expect(result['firefox-default'].tabs[0].id).toBe('qt-1');
      expect(result['firefox-container-1'].tabs[0].id).toBe('qt-2');
      expect(result['firefox-container-2'].tabs[0].id).toBe('qt-3');
    });
  });
});
