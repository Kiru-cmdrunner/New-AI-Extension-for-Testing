/**
 * Phase 7.4-M1 — L2 pins: extractDomContext persists interaction affordance.
 *
 * Spec .drytis/specs/phase-7-4-m1-affordance-capture.md (baseline aca8082):
 *   - pointerCursor: computed style cursor === 'pointer' on the resolved target
 *   - clickHandler: the onclick ATTRIBUTE is present on the resolved target
 *
 * Computed-fact capture (jsdom resolves cursor through both inline styles and
 * <style> stylesheet rules — verified in the 2026-08-24 grounding probes).
 * No timing, no site tokens, no statistics (doctrine).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { extractDomContext } from '../../src/definitions/dom-context-extractor';

describe('7.4-M1 A-series — affordance extraction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.querySelectorAll('style').forEach((s) => s.remove());
  });

  it('A1: inline style cursor:pointer → pointerCursor true', () => {
    const el = document.createElement('div');
    el.style.cursor = 'pointer';
    document.body.appendChild(el);
    expect(extractDomContext(el).pointerCursor).toBe(true);
  });

  it('A2: stylesheet rule cursor:pointer → pointerCursor true', () => {
    const style = document.createElement('style');
    style.textContent = '.chip7m1 { cursor: pointer; }';
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.className = 'chip7m1';
    document.body.appendChild(el);
    expect(extractDomContext(el).pointerCursor).toBe(true);
  });

  it('A3: no cursor declaration → pointerCursor false (never undefined)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(extractDomContext(el).pointerCursor).toBe(false);
  });

  it('A4: explicit cursor:default → false', () => {
    const el = document.createElement('div');
    el.style.cursor = 'default';
    document.body.appendChild(el);
    expect(extractDomContext(el).pointerCursor).toBe(false);
  });

  it('A5: onclick attribute present → clickHandler true', () => {
    const el = document.createElement('div');
    el.setAttribute('onclick', 'void 0');
    document.body.appendChild(el);
    expect(extractDomContext(el).clickHandler).toBe(true);
  });

  it('A6: no onclick attribute → clickHandler false', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(extractDomContext(el).clickHandler).toBe(false);
  });

  it('A7: 2×2 independence matrix (pointer-only / onclick-only / both / neither)', () => {
    const style = document.createElement('style');
    style.textContent = '.p-only7m1 { cursor: pointer; }';
    document.head.appendChild(style);

    const pointerOnly = document.createElement('div');
    pointerOnly.className = 'p-only7m1';
    document.body.appendChild(pointerOnly);
    const ctxP = extractDomContext(pointerOnly);
    expect(ctxP.pointerCursor).toBe(true);
    expect(ctxP.clickHandler).toBe(false);

    const onclickOnly = document.createElement('div');
    onclickOnly.setAttribute('onclick', 'void 0');
    document.body.appendChild(onclickOnly);
    const ctxO = extractDomContext(onclickOnly);
    expect(ctxO.pointerCursor).toBe(false);
    expect(ctxO.clickHandler).toBe(true);

    const both = document.createElement('div');
    both.className = 'p-only7m1';
    both.setAttribute('onclick', 'void 0');
    document.body.appendChild(both);
    const ctxB = extractDomContext(both);
    expect(ctxB.pointerCursor).toBe(true);
    expect(ctxB.clickHandler).toBe(true);

    const neither = document.createElement('div');
    document.body.appendChild(neither);
    const ctxN = extractDomContext(neither);
    expect(ctxN.pointerCursor).toBe(false);
    expect(ctxN.clickHandler).toBe(false);
  });

  it('A8: fields are real booleans — JSON-serializable, never undefined from the extractor', () => {
    const el = document.createElement('div');
    el.style.cursor = 'pointer';
    document.body.appendChild(el);
    const ctx = extractDomContext(el);
    const round: unknown = JSON.parse(JSON.stringify(ctx));
    expect((round as Record<string, unknown>).pointerCursor).toBe(true);
    expect((round as Record<string, unknown>).clickHandler).toBe(false);
  });

  it('A9: extractor reads the element it is GIVEN (guards refactor drift)', () => {
    // Two siblings: one pointer-styled, one not. Context of the plain one must
    // NOT inherit the sibling's computed affordance.
    const style = document.createElement('style');
    style.textContent = '.a9p7m1 { cursor: pointer; }';
    document.head.appendChild(style);
    const styled = document.createElement('div');
    styled.className = 'a9p7m1';
    document.body.appendChild(styled);
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    expect(extractDomContext(styled).pointerCursor).toBe(true);
    expect(extractDomContext(plain).pointerCursor).toBe(false);
  });
});
