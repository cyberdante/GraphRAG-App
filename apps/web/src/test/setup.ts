import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom implements no layout, so it omits scrollIntoView entirely. Components
// that keep a conversation pinned to the newest message call it on every
// render, which would fail every test that mounts one.
Element.prototype.scrollIntoView = vi.fn();
