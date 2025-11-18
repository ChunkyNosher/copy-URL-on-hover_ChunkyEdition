import { StorageAdapter } from '../../../src/storage/StorageAdapter.js';

describe('StorageAdapter Base Class', () => {
  let adapter;

  beforeEach(() => {
    adapter = new StorageAdapter();
  });

  describe('Abstract Methods', () => {
    test('should throw error when save is not implemented', async () => {
      await expect(adapter.save('firefox-default', [])).rejects.toThrow(
        'StorageAdapter.save() must be implemented by subclass'
      );
    });

    test('should throw error when load is not implemented', async () => {
      await expect(adapter.load('firefox-default')).rejects.toThrow(
        'StorageAdapter.load() must be implemented by subclass'
      );
    });

    test('should throw error when loadAll is not implemented', async () => {
      await expect(adapter.loadAll()).rejects.toThrow(
        'StorageAdapter.loadAll() must be implemented by subclass'
      );
    });

    test('should throw error when delete is not implemented', async () => {
      await expect(adapter.delete('firefox-default', 'qt-123')).rejects.toThrow(
        'StorageAdapter.delete() must be implemented by subclass'
      );
    });

    test('should throw error when deleteContainer is not implemented', async () => {
      await expect(adapter.deleteContainer('firefox-default')).rejects.toThrow(
        'StorageAdapter.deleteContainer() must be implemented by subclass'
      );
    });

    test('should throw error when clear is not implemented', async () => {
      await expect(adapter.clear()).rejects.toThrow(
        'StorageAdapter.clear() must be implemented by subclass'
      );
    });
  });

  describe('Inheritance', () => {
    test('should be extendable by subclasses', () => {
      class TestAdapter extends StorageAdapter {
        async save() {
          return 'save-id-123';
        }
      }

      const testAdapter = new TestAdapter();
      expect(testAdapter).toBeInstanceOf(StorageAdapter);
    });

    test('subclass can override methods', async () => {
      class TestAdapter extends StorageAdapter {
        async save(containerId, tabs) {
          return `saved-${containerId}-${tabs.length}`;
        }
      }

      const testAdapter = new TestAdapter();
      const result = await testAdapter.save('firefox-default', [1, 2, 3]);
      expect(result).toBe('saved-firefox-default-3');
    });
  });
});
