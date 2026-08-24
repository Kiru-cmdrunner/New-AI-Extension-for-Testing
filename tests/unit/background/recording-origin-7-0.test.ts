/**
 * Phase 7.0-KR — App Identity Gate (unit pins).
 *
 * Spec: .drytis/specs/phase-7-0-kr-app-identity.md §6 tests 1–5.
 * Pins the pure origin-resolution helpers BEFORE the service-worker wiring:
 *   - normalizeWebOrigin: origin-only strings for http(s), null otherwise
 *   - resolveRecordingOrigin: start-stamp precedence + onCommitted fallback
 *     + honest null when nothing web-origin-shaped is resolvable.
 * Doctrine: no timing rules, no invention — extraction only.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeWebOrigin,
  resolveRecordingOrigin,
} from '../../../src/understanding/persistence/recording-origin';

describe('normalizeWebOrigin (7.0-KR AC-1)', () => {
  it('test 1 — strips path and query, returns origin only', () => {
    expect(normalizeWebOrigin('https://app.test/checkout?x=1')).toBe('https://app.test');
  });

  it('test 2 — keeps non-default port', () => {
    expect(normalizeWebOrigin('https://app.test:8443/x')).toBe('https://app.test:8443');
  });

  it('test 3 — extension panel URL is NOT a web origin', () => {
    expect(
      normalizeWebOrigin('chrome-extension://gndjidfncanlhlonpcabokbdhnikglpn/src/sidepanel/index.html'),
    ).toBeNull();
  });

  it('test 4 — blank / about: / garbage are null', () => {
    expect(normalizeWebOrigin('about:blank')).toBeNull();
    expect(normalizeWebOrigin('')).toBeNull();
    expect(normalizeWebOrigin('not a url')).toBeNull();
  });

  it('http is a valid web origin (loopback fixtures)', () => {
    expect(normalizeWebOrigin('http://127.0.0.1:8190/m9-form-submit-validation.html')).toBe(
      'http://127.0.0.1:8190',
    );
  });

  it('file: and devtools: schemes are null (http/https only, doctrine-honest)', () => {
    expect(normalizeWebOrigin('file:///workspace/index.html')).toBeNull();
    expect(normalizeWebOrigin('devtools://devtools/bundled/inspector.html')).toBeNull();
  });
});

describe('resolveRecordingOrigin (7.0-KR AC-2)', () => {
  const APP = 'https://shop.example/products?sort=1';
  const PANEL = 'chrome-extension://abc123/src/sidepanel/index.html';
  const COMMITTED = 'http://127.0.0.1:8190/cart.html';

  it('test 5a — valid startUrl WINS over a committed URL (start-tab semantics)', () => {
    expect(
      resolveRecordingOrigin({ startUrl: APP, lastCommittedWebUrl: COMMITTED }),
    ).toBe('https://shop.example');
  });

  it('test 5b — extension startUrl falls back to the recording-scope committed URL', () => {
    expect(
      resolveRecordingOrigin({ startUrl: PANEL, lastCommittedWebUrl: COMMITTED }),
    ).toBe('http://127.0.0.1:8190');
  });

  it('test 5c — path-differing startUrl still normalizes to one origin (fragmentation pin, unit level)', () => {
    expect(resolveRecordingOrigin({ startUrl: 'https://a.test/x', lastCommittedWebUrl: null })).toBe(
      'https://a.test',
    );
    expect(resolveRecordingOrigin({ startUrl: 'https://a.test/y', lastCommittedWebUrl: null })).toBe(
      'https://a.test',
    );
  });

  it('test 5d — nothing resolvable → honest null (never a synthesized app row)', () => {
    expect(resolveRecordingOrigin({ startUrl: PANEL, lastCommittedWebUrl: null })).toBeNull();
    expect(resolveRecordingOrigin({ startUrl: '', lastCommittedWebUrl: 'about:blank' })).toBeNull();
  });

  it('test 5e — non-web committed URL never leaks in as fallback', () => {
    expect(
      resolveRecordingOrigin({ startUrl: PANEL, lastCommittedWebUrl: 'chrome-extension://abc/x' }),
    ).toBeNull();
  });
});
