/**
 * NAV Pending Capture — Service-Worker Handler Unit Tests (AC4)
 *
 * From .drytis/specs/post-nav-evidence-capture.md. Verifies the SW side of the
 * NAV pull model: the bounded pendingNavCapture map, consume-on-pull
 * semantics, latest-wins on new commit, bounded eviction, and TTL expiry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock chrome.storage.local ─────────────────────────────────────────

const storageData = new Map<string, unknown>();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null || keys === undefined) return Object.fromEntries(storageData);
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (storageData.has(k)) out[k] = storageData.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storageData.set(k, v);
      }),
      remove: vi.fn((keys: string | string[] | null) => {
        if (keys === null || keys === undefined) {
          storageData.clear();
          return Promise.resolve();
        }
        for (const k of Array.isArray(keys) ? keys : [keys]) storageData.delete(k);
        return Promise.resolve();
      }),
    },
  },
});

import {
  recordPendingNavCapture,
  consumePendingNavCapture,
  peekPendingNavCapture,
  __clearPendingNavCaptureForTests,
} from '../../../src/background/post-nav-capture';
import { MAX_NAV_CAPTURE_ENTRIES, POST_NAV_CAPTURE_TTL_MS } from '../../../src/shared/post-nav-types';

describe('post-nav-capture store (SW side)', () => {
  beforeEach(() => {
    storageData.clear();
    __clearPendingNavCaptureForTests();
  });

  it('AC4a: returns the pending record for the sender tab; second pull in the same document is null', () => {
    recordPendingNavCapture(1, {
      navEventId: 'nav-1',
      fromUrl: 'https://a.example/',
      toUrl: 'https://b.example/',
      navType: 'form_submit',
      committedAt: Date.now(),
    });
    const first = consumePendingNavCapture(1);
    expect(first?.navEventId).toBe('nav-1');
    expect(first?.fromUrl).toBe('https://a.example/');
    const second = consumePendingNavCapture(1);
    expect(second).toBeNull();
  });

  it('AC4b: tab isolation — pulling for tab 2 does not consume tab 1 record', () => {
    recordPendingNavCapture(1, {
      navEventId: 'nav-1',
      fromUrl: 'a',
      toUrl: 'b',
      navType: 'link',
      committedAt: Date.now(),
    });
    expect(consumePendingNavCapture(2)).toBeNull();
    expect(consumePendingNavCapture(1)?.navEventId).toBe('nav-1');
  });

  it('AC4c: latest-wins — a new commit for the same tab replaces the record', () => {
    recordPendingNavCapture(1, { navEventId: 'nav-1', fromUrl: 'a', toUrl: 'b', navType: 'link', committedAt: Date.now() });
    recordPendingNavCapture(1, { navEventId: 'nav-2', fromUrl: 'b', toUrl: 'c', navType: 'reload', committedAt: Date.now() + 10 });
    const rec = consumePendingNavCapture(1);
    expect(rec?.navEventId).toBe('nav-2');
    expect(rec?.committedAt).toBeGreaterThan(0);
  });

  it('AC4d: bounded — more than MAX_NAV_CAPTURE_ENTRIES tabs shift-evicts the oldest', () => {
    expect(MAX_NAV_CAPTURE_ENTRIES).toBeGreaterThan(0);
    const now = Date.now();
    for (let tab = 1; tab <= MAX_NAV_CAPTURE_ENTRIES + 5; tab++) {
      recordPendingNavCapture(tab, { navEventId: `nav-${tab}`, fromUrl: 'a', toUrl: 'b', navType: 'link', committedAt: now + tab });
    }
    expect(consumePendingNavCapture(1)).toBeNull(); // evicted (oldest committedAt)
    expect(consumePendingNavCapture(MAX_NAV_CAPTURE_ENTRIES + 5)?.navEventId).toBe(`nav-${MAX_NAV_CAPTURE_ENTRIES + 5}`);
  });

  it('AC4e: peek does not consume', () => {
    recordPendingNavCapture(1, { navEventId: 'nav-1', fromUrl: 'a', toUrl: 'b', navType: 'link', committedAt: Date.now() });
    expect(peekPendingNavCapture(1)?.navEventId).toBe('nav-1');
    expect(consumePendingNavCapture(1)?.navEventId).toBe('nav-1');
  });

  it('AC4f: TTL — a record older than POST_NAV_CAPTURE_TTL_MS reads as absent (placeholder stands)', () => {
    recordPendingNavCapture(1, {
      navEventId: 'nav-1',
      fromUrl: 'a',
      toUrl: 'b',
      navType: 'link',
      committedAt: Date.now() - (POST_NAV_CAPTURE_TTL_MS + 5_000),
    });
    expect(peekPendingNavCapture(1)).toBeNull();
    expect(consumePendingNavCapture(1)).toBeNull();
  });

  it('AC4g: unknown tab returns null without throwing', () => {
    expect(consumePendingNavCapture(999)).toBeNull();
    expect(peekPendingNavCapture(998)).toBeNull();
  });
});
