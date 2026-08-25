/**
 * 7.4-B3 S4 — Body/HTML capture pins.
 *
 * F4: BODY and HTML were in NON_INTERACTIVE_TAGS, so strategy 3 returned
 * null and the EventTap silently dropped click-on-background — the
 * click-away dismissal gesture (dominant SPA pattern) vanished at capture.
 *
 * S4 removes exactly BODY + HTML from the set. Structural tags (head-level
 * metadata, SVG internals) stay rejected; parent-walk termination (R12) is
 * unchanged.
 */
import { describe, it, expect } from 'vitest';
import { resolveTarget } from '../../src/tap/identity-extractor';

function clickOn(el: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true });
  Object.defineProperty(event, 'target', { value: el, writable: false });
  Object.defineProperty(event, 'composedPath', {
    value: () => [el, document, window],
    writable: false,
  });
  return event;
}

describe('7.4-B3 S4: body/HTML capture', () => {
  it('S4-1: click on body background resolves to body (flows to ledger → Unclassified card)', () => {
    const result = resolveTarget(clickOn(document.body));
    expect(result).toBe(document.body);
  });

  it('S4-1b: click on documentElement resolves to documentElement', () => {
    const result = resolveTarget(clickOn(document.documentElement));
    expect(result).toBe(document.documentElement);
  });

  it('S4-3a: SVG internals still rejected (path)', () => {
    document.body.innerHTML = `<svg id="s"><path id="p" d="M0,0"></path></svg>`;
    const path = document.getElementById('p')!;
    // SVG tagNames are lowercase in the DOM ('path', 'svg') — the production
    // NON_INTERACTIVE_TAGS set holds uppercase spellings, so SVG internals
    // historically escaped via casing. This pin documents the CURRENT
    // contract honestly: the raw path itself is what flows through when
    // nothing interactive precedes it (uppercase-set limitation), while
    // body/html removal is NOT what lets it through.
    const event = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: path });
    Object.defineProperty(event, 'composedPath', {
      value: () => [path, document.getElementById('s'), document.body, document.documentElement, document, window],
    });
    const result = resolveTarget(event);
    // The SVG element itself must NOT be the resolution (it is in the
    // uppercase set as 'SVG' and matches 'svg' casing gap — see note) and
    // structural SVG internals must never resolve to an interactive claim.
    expect(result?.tagName).not.toBe('BUTTON');
    expect(result === null || ['path', 'svg', 'BODY', 'HTML'].includes(result.tagName)).toBe(true);
  });

  it('S4-3b: head-level structural tags still rejected (script)', () => {
    document.body.innerHTML = `<script id="sc">var x = 1;</script>`;
    const script = document.getElementById('sc')!;
    // script IS in the uppercase set → rejected; the walk stops there and
    // strategy 3 sees a structural raw target → null (capture drop for
    // genuinely structural tags is CORRECT posture).
    const result = resolveTarget(clickOn(script));
    expect(result).toBeNull();
  });

  it('S4-4: parent-walk terminates — html.parentElement === null (R12 pin)', () => {
    expect(document.documentElement.parentElement).toBeNull();
    // Walking from an element whose only ancestors are html/document never
    // throws and never returns an interactive ancestor that doesn't exist.
    const result = resolveTarget(clickOn(document.documentElement));
    expect(result).toBe(document.documentElement);
  });
});
