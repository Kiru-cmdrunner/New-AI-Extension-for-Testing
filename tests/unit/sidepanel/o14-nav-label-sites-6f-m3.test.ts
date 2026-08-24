/**
 * 6F-M3 Wave 1 — O14 navigation URL display truncation (label sites)
 *
 * Spec: .drytis/specs/phase-6f-m3-w1-display-honesty.md §4 (AC1–AC4)
 *
 * Pins the two display label sites: the meaning-resolver Navigation
 * fallback and the interaction-renderer fallbackActionDescription
 * Navigation case (via the rendered card text), plus title-first priority.
 */
import { describe, it, expect } from 'vitest';
import type { ComponentInteraction } from '../../../src/shared/component-types';
import type { ComponentDetectionResult } from '../../../src/enrichment/component-types';
import { renderProductionInteractions } from '../../../src/sidepanel/interaction-renderer';
import { displayUrl } from '../../../src/enrichment/quote-safe';
import { resolveMeaning } from '../../../src/enrichment/meaning-resolver';

const GENERIC_DETECTION = { componentType: null, componentData: {} } as unknown as ComponentDetectionResult;

function nav(pageUrl: string, pageTitle: string): ComponentInteraction {
  return {
    interactionId: 'int-nav-1',
    type: 'Navigation' as never,
    trigger: { tag: 'HTML', ariaRole: 'document' } as never,
    triggerEvent: { eventId: 'evt-n1', eventType: 'navigation' } as never,
    memberEvents: [] as never,
    startTime: 1,
    endTime: 2,
    endState: 'completed' as never,
    metadata: { pageUrl, pageTitle },
  } as unknown as ComponentInteraction;
}

describe('6F-M3 O14 — rendered Navigation labels (fallback sites)', () => {
  it('AC1: no title → label shows origin+path only (query/hash absent) in the card', () => {
    const c = document.createElement('div');
    renderProductionInteractions(c, [
      nav('https://www.adanione.com/search?origin=MAA&dest=DEL&utm=x', ''),
    ]);
    const text = c.textContent ?? '';
    expect(text).toContain('https://www.adanione.com/search');
    expect(text).not.toContain('origin=MAA');
    expect(text).not.toContain('utm=x');
    expect(text).not.toContain('dest=DEL');
  });

  it('AC1b: meaning-resolver fallback site also uses the display form (query URL)', () => {
    const raw = 'https://www.adanione.com/search?origin=MAA&dest=DEL&utm=x';
    const meaning = resolveMeaning(nav(raw, ''), GENERIC_DETECTION);
    expect(meaning).toBe(`Navigate to ${displayUrl(raw)}`);
    expect(meaning).toContain('https://www.adanione.com/search');
    expect(meaning).not.toContain('origin=MAA');
    expect(meaning).not.toContain('utm=x');
  });

  it('AC2: long path → truncated at 60 chars with ellipsis', () => {
    const long = `https://example.com/${'b'.repeat(90)}`;
    const c = document.createElement('div');
    renderProductionInteractions(c, [nav(long, '')]);
    const text = c.textContent ?? '';
    expect(text).toContain(displayUrl(long, 60));
    expect(text).not.toContain(long);
  });

  it('AC3: unparseable pageUrl → rendered unchanged (no throw)', () => {
    const raw = 'not a url at all';
    const c = document.createElement('div');
    renderProductionInteractions(c, [nav(raw, '')]);
    expect(c.textContent ?? '').toContain(raw);
  });

  it('AC4: title present → title-first rendering unchanged (D10 behavior)', () => {
    const c = document.createElement('div');
    renderProductionInteractions(c, [
      nav('https://www.adanione.com/search?x=1', 'Flight Search'),
    ]);
    const text = c.textContent ?? '';
    expect(text).toContain('Flight Search');
    expect(text).not.toContain('https://www.adanione.com/search');
  });

  it('AC4b (E2E run-4): Chrome URL-synthesized pseudo-title → display form, not the quoted URL', () => {
    // Chrome tabs.get returns the full query URL as title for untitled pages
    // (scheme present in storage pageTitle, scheme-stripped variant seen in
    // real runs) — both forms must fall back to the display form.
    const raw = 'http://127.0.0.1:8191/flights?origin=MAA&dest=DEL&utm_source=test';
    const c = document.createElement('div');
    renderProductionInteractions(c, [nav(raw, raw)]);
    let text = c.textContent ?? '';
    expect(text).toContain('http://127.0.0.1:8191/flights');
    expect(text).not.toContain('origin=MAA');
    expect(text).not.toContain('utm_source');
    // meaning-resolver site pinned identically
    const meaning = resolveMeaning(nav(raw, raw), GENERIC_DETECTION);
    expect(meaning).toBe(`Navigate to ${displayUrl(raw)}`);
    // scheme-stripped pseudo-title (the exact string observed in run-5/6)
    const stripped = '127.0.0.1:8191/flights?origin=MAA&dest=DEL&utm_source=test';
    const c2 = document.createElement('div');
    renderProductionInteractions(c2, [nav(raw, stripped)]);
    text = c2.textContent ?? '';
    expect(text).toContain('http://127.0.0.1:8191/flights');
    expect(text).not.toContain('origin=MAA');
    expect(text).not.toContain('utm_source');
    expect(resolveMeaning(nav(raw, stripped), GENERIC_DETECTION)).toBe(
      `Navigate to ${displayUrl(raw)}`,
    );
  });
});
