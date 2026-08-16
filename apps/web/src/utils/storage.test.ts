import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keys, readJson, readString, remove, writeJson, writeString } from './storage';

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readJson', () => {
    it('returns the stored value', () => {
      localStorage.setItem('k', JSON.stringify({ a: 1 }));
      expect(readJson('k', null)).toEqual({ a: 1 });
    });

    it('returns the fallback when the key is absent', () => {
      expect(readJson('missing', ['default'])).toEqual(['default']);
    });

    it('returns the fallback rather than throwing on malformed JSON', () => {
      // The bug this guards: an unguarded JSON.parse on mount meant one bad
      // entry white-screened the whole app.
      localStorage.setItem('k', '{ this is not json');
      expect(readJson('k', 'fallback')).toBe('fallback');
    });

    it('drops a malformed entry so it cannot fail again next load', () => {
      localStorage.setItem('k', 'nonsense{');
      readJson('k', null);
      expect(localStorage.getItem('k')).toBeNull();
    });

    it('survives storage being unavailable entirely', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
      expect(readJson('k', 'fallback')).toBe('fallback');
    });
  });

  describe('writeJson', () => {
    it('stores the value and reports success', () => {
      expect(writeJson('k', { a: 1 })).toBe(true);
      expect(JSON.parse(localStorage.getItem('k') ?? 'null')).toEqual({ a: 1 });
    });

    it('reports failure instead of throwing when the quota is exceeded', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      // Callers surface this to the user rather than losing the write silently.
      expect(writeJson('k', { a: 1 })).toBe(false);
    });
  });

  describe('strings and keys', () => {
    it('round-trips a string', () => {
      writeString('theme', 'dark');
      expect(readString('theme')).toBe('dark');
    });

    it('returns null for an absent string', () => {
      expect(readString('nope')).toBeNull();
    });

    it('removes a key', () => {
      writeString('k', 'v');
      remove('k');
      expect(readString('k')).toBeNull();
    });

    it('lists the stored keys', () => {
      writeString('ragstone-conversation-1', 'a');
      writeString('ragstone-conversation-2', 'b');
      expect(keys().filter((k) => k.startsWith('ragstone-conversation-'))).toHaveLength(2);
    });

    it('returns an empty list when storage throws', () => {
      vi.spyOn(Object, 'keys').mockImplementation(() => {
        throw new Error('unavailable');
      });
      expect(keys()).toEqual([]);
    });
  });
});
