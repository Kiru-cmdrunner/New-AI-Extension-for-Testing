/**
 * 7.4-B2 S1 — dom-context-extractor pins: ariaAutoComplete + listId.
 *
 * Spec .drytis/specs/phase-7-4-b2-combobox-typeable.md §S1 (baseline d525911):
 *   - ariaAutoComplete: raw `aria-autocomplete` attribute value, null when absent
 *   - listId: raw `list` attribute on <input>, null when absent or non-input
 *
 * Same jsdom pattern as 7.4-M1 affordance pins (dom-context-affordance-7-4-m1).
 * No behavior change — zero consumers in S1.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { extractDomContext } from '../../src/definitions/dom-context-extractor';

describe('7.4-B2 S1 — ariaAutoComplete + listId extraction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('S1-1a: aria-autocomplete="list" → ariaAutoComplete = "list"', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.setAttribute('aria-autocomplete', 'list');
    document.body.appendChild(el);
    expect(extractDomContext(el).ariaAutoComplete).toBe('list');
  });

  it('S1-1b: aria-autocomplete="both" → "both"', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.setAttribute('aria-autocomplete', 'both');
    document.body.appendChild(el);
    expect(extractDomContext(el).ariaAutoComplete).toBe('both');
  });

  it('S1-1c: aria-autocomplete="inline" → "inline"', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.setAttribute('aria-autocomplete', 'inline');
    document.body.appendChild(el);
    expect(extractDomContext(el).ariaAutoComplete).toBe('inline');
  });

  it('S1-1d: attribute absent → null (never undefined)', () => {
    const el = document.createElement('input');
    el.type = 'text';
    document.body.appendChild(el);
    expect(extractDomContext(el).ariaAutoComplete).toBe(null);
  });

  it('S1-1e: ariaAutoComplete is a real string — JSON-serializable, never undefined', () => {
    const el = document.createElement('input');
    el.setAttribute('aria-autocomplete', 'list');
    document.body.appendChild(el);
    const ctx = extractDomContext(el);
    const round: unknown = JSON.parse(JSON.stringify(ctx));
    expect((round as Record<string, unknown>).ariaAutoComplete).toBe('list');
  });

  it('S1-2a: <input list="cities"> → listId = "cities"', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.setAttribute('list', 'cities');
    document.body.appendChild(el);
    expect(extractDomContext(el).listId).toBe('cities');
  });

  it('S1-2b: list attribute absent → null', () => {
    const el = document.createElement('input');
    el.type = 'text';
    document.body.appendChild(el);
    expect(extractDomContext(el).listId).toBe(null);
  });

  it('S1-2c: non-INPUT element (div) → listId null (list is INPUT-only)', () => {
    const el = document.createElement('div');
    el.setAttribute('list', 'whatever');
    document.body.appendChild(el);
    expect(extractDomContext(el).listId).toBe(null);
  });

  it('S1-2d: listId is a real string — JSON-serializable, never undefined', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.setAttribute('list', 'countries');
    document.body.appendChild(el);
    const ctx = extractDomContext(el);
    const round: unknown = JSON.parse(JSON.stringify(ctx));
    expect((round as Record<string, unknown>).listId).toBe('countries');
  });
});
