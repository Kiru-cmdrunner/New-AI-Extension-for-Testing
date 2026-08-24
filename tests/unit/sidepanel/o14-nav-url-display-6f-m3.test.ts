/**
 * 6F-M3 Wave 1 — O14 navigation URL display truncation
 *
 * Spec: .drytis/specs/phase-6f-m3-w1-display-honesty.md §4 (AC1–AC6)
 *
 * Panel labels only: when a Navigation has no title, the fallback label
 * shows origin+path (query/hash dropped) instead of the raw full URL.
 * The machine record (metadata.pageUrl, IR, KR) keeps the full URL.
 */
import { describe, it, expect } from 'vitest';
import { displayUrl, isUrlDerivedTitle } from '../../../src/enrichment/quote-safe';
import { toIRAction } from '../../../src/presentation/output-adapter';

describe('6F-M3 O14 — isUrlDerivedTitle truth table (E2E run-4/6 finding)', () => {
  it('title === url → true (Chrome pseudo-title, exact form)', () => {
    expect(
      isUrlDerivedTitle('http://x/flights?a=1', 'http://x/flights?a=1'),
    ).toBe(true);
  });
  it('title === url without scheme → true (Chrome omits scheme: host/path?q)', () => {
    expect(
      isUrlDerivedTitle(
        '127.0.0.1:8191/flights?origin=MAA&utm_source=test',
        'http://127.0.0.1:8191/flights?origin=MAA&utm_source=test',
      ),
    ).toBe(true);
  });
  it('real title ≠ url → false (title-first preserved)', () => {
    expect(
      isUrlDerivedTitle('Flight Search', 'http://x/flights?a=1'),
    ).toBe(false);
  });
  it('empty title → false (handled by the empty-title branch)', () => {
    expect(isUrlDerivedTitle('', 'http://x/flights')).toBe(false);
  });
  it('empty url → false', () => {
    expect(isUrlDerivedTitle('x', '')).toBe(false);
  });
});

describe('6F-M3 O14 — displayUrl truth table (AC5)', () => {
  it('drops the query string, keeps origin+path', () => {
    expect(displayUrl('https://www.adanione.com/search?origin=MAA&dest=DEL&utm=x')).toBe(
      'https://www.adanione.com/search',
    );
  });

  it('drops the hash, keeps origin+path', () => {
    expect(displayUrl('https://example.com/flights#results')).toBe(
      'https://example.com/flights',
    );
  });

  it('truncates a >60 char path with an ellipsis', () => {
    const raw = `https://example.com/${'a'.repeat(80)}`;
    const out = displayUrl(raw, 60);
    expect(out.length).toBeLessThanOrEqual(61); // 60 + ellipsis char
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('https://example.com/')).toBe(true);
  });

  it('short URLs pass through unchanged', () => {
    expect(displayUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('empty string → empty string', () => {
    expect(displayUrl('')).toBe('');
  });

  it('non-URL / unparseable string → raw unchanged (honesty, no throw)', () => {
    expect(displayUrl('not a url at all')).toBe('not a url at all');
  });

  it('opaque-origin URL (about:) → raw unchanged (origin serializes "null")', () => {
    expect(displayUrl('about:blank-not-a-host')).toBe('about:blank-not-a-host');
  });

  it('custom maxLen honored', () => {
    expect(displayUrl('https://example.com/some/path', 20)).toBe('https://example.com/…');
  });
});

describe('6F-M3 O14 — fallback label sites (AC1–AC4)', () => {
  // The behavioral label pins live in
  // tests/unit/sidepanel/o14-nav-label-sites-6f-m3.test.ts (rendered card
  // text, both display fallbacks share displayUrl). This file keeps the
  // helper truth table and the IR machine-record guarantee.

  it('AC6: IR keeps the FULL raw pageUrl (machine record untouched)', () => {
    const raw = 'https://www.adanione.com/search?origin=MAA&dest=DEL';
    const interaction = {
      interactionId: 'int-nav-1',
      type: 'Navigation',
      trigger: { tag: 'HTML', ariaRole: 'document' },
      triggerEvent: { eventId: 'evt-n1', eventType: 'navigation' },
      memberEvents: [],
      startTime: 1,
      endTime: 2,
      endState: 'completed',
      metadata: { pageUrl: raw, pageTitle: '' },
    } as never;
    const ir = toIRAction(interaction);
    expect(ir).not.toBeNull();
    const urlish = JSON.stringify(ir ?? {});
    expect(urlish).toContain(raw);
  });
});
