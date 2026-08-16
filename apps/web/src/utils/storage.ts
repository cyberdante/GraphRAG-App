/**
 * localStorage that cannot take the app down.
 *
 * Reads used to call JSON.parse directly on mount, so a single malformed entry
 * white-screened the whole app. Every read now falls back, and a bad entry is
 * dropped rather than left to fail again on the next load.
 */

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`Discarding unreadable storage entry "${key}"`, error);
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage is unavailable entirely (private mode, disabled). Nothing to do.
    }
    return fallback;
  }
}

/** Returns false when the write failed, usually because the quota is full. */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Could not save "${key}"`, error);
    return false;
  }
}

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Could not save "${key}"`, error);
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing sensible to do if storage is unavailable.
  }
}

export function keys(): string[] {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}
