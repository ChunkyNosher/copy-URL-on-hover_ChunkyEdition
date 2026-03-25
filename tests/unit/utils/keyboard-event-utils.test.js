import { getDeepEventTarget, isInputField } from '../../../src/utils/keyboard-event-utils.js';

describe('keyboard-event-utils', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('getDeepEventTarget()', () => {
    test('returns the composed path target for shadow DOM keyboard events', () => {
      const host = document.createElement('div');
      const shadowRoot = host.attachShadow({ mode: 'open' });
      const input = document.createElement('input');

      shadowRoot.appendChild(input);
      document.body.appendChild(host);

      const event = {
        target: host,
        composedPath: () => [input, shadowRoot, host, document.body, document, window]
      };

      expect(getDeepEventTarget(event)).toBe(input);
    });

    test('falls back to event.target when composedPath is unavailable', () => {
      const input = document.createElement('input');
      const event = { target: input };

      expect(getDeepEventTarget(event)).toBe(input);
    });
  });

  describe('isInputField()', () => {
    test('returns true for native form inputs', () => {
      expect(isInputField(document.createElement('input'))).toBe(true);
      expect(isInputField(document.createElement('textarea'))).toBe(true);
    });

    test('returns true for descendants of contenteditable containers', () => {
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      const child = document.createElement('span');
      editable.appendChild(child);

      expect(isInputField(child)).toBe(true);
    });

    test('returns true for role-based search widgets', () => {
      const searchbox = document.createElement('div');
      searchbox.setAttribute('role', 'searchbox');

      const combobox = document.createElement('div');
      combobox.setAttribute('role', 'combobox');

      expect(isInputField(searchbox)).toBe(true);
      expect(isInputField(combobox)).toBe(true);
    });

    test('returns false for non-editable elements', () => {
      expect(isInputField(document.createElement('button'))).toBe(false);
    });
  });
});
