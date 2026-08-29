/**
 * Capture-Time Click Qualification v1.2 — Step 1 (inert) — TDD-2
 *
 * Per-fact CAPTURE tests: real jsdom DOM, stubbed hit-test probe
 * (jsdom lacks elementFromPoint — the probe is an injectable seam,
 * spec §11). Verifies captureClickQualification() reads each §3.1/§3.2
 * fact correctly at the dispatch instant, and that EventTap attaches
 * the vector additively for click/contextmenu only.
 *
 * jsdom limitations honored explicitly:
 *  - getBoundingClientRect() returns all zeros → zeroSizeLifted is true
 *    for ANY lifted element in jsdom (stubbed per-test when it matters).
 *  - elementFromPoint does not exist → default probe reports
 *    checked:false / miss:null (honest absence, never fabricated).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  captureClickQualification,
  type HitTestProbe,
} from '../../src/tap/click-qualification';
import { createEventTap, TEST_HOOK } from '../../src/tap/event-tap';

/**
 * Click MouseEvent factory: creates the event, DISPATCHES it on the element
 * (so event.target/composedPath are real), and returns it. The capture
 * function is then called on the already-dispatched event — same shape the
 * EventTap sees mid-dispatch.
 */
function clickOn(el: Element, over: Partial<MouseEventInit> = {}): MouseEvent {
  const ev = new MouseEvent('click', {
    bubbles: true,
    composed: true,
    clientX: 10,
    clientY: 10,
    ...over,
  });
  el.dispatchEvent(ev);
  return ev;
}

/** The elementFromPoint stand-in: returns whatever we decide is topmost. */
const probeReturning =
  (el: Element | null): HitTestProbe =>
  () =>
    el;

describe('captureClickQualification — per-fact capture (§3)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── disabledNative (R-2 tag restriction) ──────────────────────────

  it('disabled native <button> ⇒ disabledNative=true, disabledAttrNonNative=false', () => {
    document.body.innerHTML = '<button id="b" disabled>Go</button>';
    const btn = document.getElementById('b')!;
    const q = captureClickQualification(clickOn(btn), btn, probeReturning(btn))!;
    expect(q.facts.disabledNative).toBe(true);
    expect(q.facts.disabledAttrNonNative).toBe(false);
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual(['disabled-native']);
  });

  it('R-2: <div disabled> (framework pattern) ⇒ disabledAttrNonNative=true, disabledNative=false', () => {
    document.body.innerHTML = '<div id="d" disabled role="button">Go</div>';
    const div = document.getElementById('d')!;
    const q = captureClickQualification(clickOn(div), div, probeReturning(div))!;
    expect(q.facts.disabledNative).toBe(false);
    expect(q.facts.disabledAttrNonNative).toBe(true);
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual(['disabled-attr-non-native']);
  });

  // ── fieldsetDisabled (R-3 restriction + legend exemption) ─────────

  it('form control inside fieldset[disabled] ⇒ fieldsetDisabled=true', () => {
    document.body.innerHTML =
      '<fieldset disabled><input id="i" type="text"></fieldset>';
    const inp = document.getElementById('i')!;
    const q = captureClickQualification(clickOn(inp), inp, probeReturning(inp))!;
    expect(q.facts.fieldsetDisabled).toBe(true);
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual(['fieldset-disabled']);
  });

  it('R-3: plain <div> inside fieldset[disabled] ⇒ fieldsetDisabled=false, QUALIFIED', () => {
    document.body.innerHTML =
      '<fieldset disabled><div id="d">label text</div></fieldset>';
    const div = document.getElementById('d')!;
    const q = captureClickQualification(clickOn(div), div, probeReturning(div))!;
    expect(q.facts.fieldsetDisabled).toBe(false);
    expect(q.verdict).toBe('qualified');
  });

  it('R-3: form control inside the FIRST LEGEND of a disabled fieldset ⇒ exempt, qualified', () => {
    document.body.innerHTML =
      '<fieldset disabled><legend><input id="i" type="text"></legend><input id="other"></fieldset>';
    const inp = document.getElementById('i')!;
    const q = captureClickQualification(clickOn(inp), inp, probeReturning(inp))!;
    expect(q.facts.fieldsetDisabled).toBe(false);
    expect(q.verdict).toBe('qualified');
    // and the control outside the legend still fires
    const other = document.getElementById('other')!;
    const q2 = captureClickQualification(clickOn(other), other, probeReturning(other))!;
    expect(q2.facts.fieldsetDisabled).toBe(true);
  });

  // ── ariaDisabled / inertSubtree ───────────────────────────────────

  it('aria-disabled="true" ⇒ ariaDisabled=true, provably-invalid (app-declared tier)', () => {
    document.body.innerHTML = '<div id="d" role="button" aria-disabled="true">Save</div>';
    const div = document.getElementById('d')!;
    const q = captureClickQualification(clickOn(div), div, probeReturning(div))!;
    expect(q.facts.ariaDisabled).toBe(true);
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual(['aria-disabled']);
  });

  it('ancestor [inert] ⇒ inertSubtree=true (closest incl. self)', () => {
    document.body.innerHTML = '<div inert><button id="b">Go</button></div>';
    const btn = document.getElementById('b')!;
    const q = captureClickQualification(clickOn(btn), btn, probeReturning(btn))!;
    expect(q.facts.inertSubtree).toBe(true);
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual(['inert-subtree']);
  });

  it('inert on SELF also fires inertSubtree', () => {
    document.body.innerHTML = '<button id="b" inert>Go</button>';
    const btn = document.getElementById('b')!;
    const q = captureClickQualification(clickOn(btn), btn, probeReturning(btn))!;
    expect(q.facts.inertSubtree).toBe(true);
  });

  // ── pointerEventsNone (R-4: resolved-target computed fact) ────────

  it('computed pointer-events:none on the resolved target is RECORDED, never a standalone cause (R-4)', () => {
    document.body.innerHTML = '<div id="d" role="button" style="pointer-events: none">Go</div>';
    const div = document.getElementById('d')!;
    const q = captureClickQualification(clickOn(div), div, probeReturning(div))!;
    expect(q.facts.pointerEventsNone).toBe(true);
    expect(q.verdict).toBe('qualified');
    expect(q.causes).toEqual([]);
  });

  // ── hitTest (injectable probe) ────────────────────────────────────

  it('probe returns an overlay ∉ composed path ⇒ miss=true ⇒ hit-test-miss cause', () => {
    document.body.innerHTML =
      '<button id="b">Go</button><div id="overlay" style="position:fixed;inset:0"></div>';
    const btn = document.getElementById('b')!;
    const overlay = document.getElementById('overlay')!;
    const q = captureClickQualification(clickOn(btn), btn, probeReturning(overlay))!;
    expect(q.facts.hitTest).toEqual({ checked: true, miss: true });
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual(['hit-test-miss']);
  });

  it('probe returns the raw element itself ⇒ miss=false, qualified', () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    const btn = document.getElementById('b')!;
    const q = captureClickQualification(clickOn(btn), btn, probeReturning(btn))!;
    expect(q.facts.hitTest).toEqual({ checked: true, miss: false });
    expect(q.verdict).toBe('qualified');
  });

  it('probe returns an ANCESTOR of raw (in composed path) ⇒ miss=false', () => {
    document.body.innerHTML = '<button id="b"><span id="s">Go</span></button>';
    const span = document.getElementById('s')!;
    const btn = document.getElementById('b')!;
    // raw = span (deepest hit); elementFromPoint can return an ancestor
    // when descendants are pointer-events:none — membership in the raw
    // composed path is the spec's non-miss rule.
    const q = captureClickQualification(clickOn(span), span, probeReturning(btn))!;
    expect(q.facts.hitTest.miss).toBe(false);
  });

  it('probe returns the shadow HOST of raw (shadow-host walk) ⇒ miss=false', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button id="inner">Inner</button>';
    const inner = shadow.getElementById('inner')!;
    const q = captureClickQualification(
      clickOn(inner),
      inner,
      probeReturning(host),
    )!;
    expect(q.facts.hitTest.miss).toBe(false);
  });

  it('NO probe available (jsdom/legacy) ⇒ checked=false, miss=null — honest absence, never fabricated', () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    const btn = document.getElementById('b')!;
    const q = captureClickQualification(clickOn(btn), btn, undefined)!;
    expect(q.facts.hitTest).toEqual({ checked: false, miss: null });
    expect(q.verdict).toBe('qualified');
  });

  it('probe returns null (point off-viewport) ⇒ miss=null (inconclusive), never a miss', () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    const btn = document.getElementById('b')!;
    const q = captureClickQualification(clickOn(btn), btn, probeReturning(null))!;
    expect(q.facts.hitTest).toEqual({ checked: true, miss: null });
    expect(q.verdict).toBe('qualified');
  });

  // ── hit-target structure (§3.2) ───────────────────────────────────

  it('BODY raw hit ⇒ kind=canvas, rawTag=BODY, qualified+insufficient (B3 S4 preserved)', () => {
    const q = captureClickQualification(
      clickOn(document.body),
      document.body,
      probeReturning(document.body),
    )!;
    expect(q.facts.hitTarget.kind).toBe('canvas');
    expect(q.facts.hitTarget.rawTag).toBe('BODY');
    expect(q.facts.hitTarget.lifted).toBe(false);
    expect(q.facts.hitTarget.liftStrategy).toBe('raw');
    expect(q.verdict).toBe('qualified');
    expect(q.insufficient).toBe(true);
  });

  it('HTML raw hit ⇒ canvas', () => {
    document.documentElement.innerHTML = '<body></body>';
    const q = captureClickQualification(
      clickOn(document.documentElement),
      document.documentElement,
      probeReturning(document.documentElement),
    )!;
    expect(q.facts.hitTarget.kind).toBe('canvas');
    expect(q.facts.hitTarget.rawTag).toBe('HTML');
  });

  it('lift audit: plain span inside button ⇒ lifted=true, rawTag=SPAN, strategy=path, rawInteractiveShaped=false, insufficient', () => {
    document.body.innerHTML = '<button id="b"><span id="s">Go</span></button>';
    const span = document.getElementById('s')!;
    const btn = document.getElementById('b')!;
    // resolved = button via composedPath scan (strategy 1 → 'path')
    const q = captureClickQualification(
      clickOn(span),
      btn,
      probeReturning(span),
    )!;
    expect(q.facts.hitTarget).toEqual({
      kind: 'element',
      rawTag: 'SPAN',
      lifted: true,
      liftStrategy: 'path',
      rawInteractiveShaped: false,
    });
    expect(q.verdict).toBe('qualified');
    expect(q.insufficient).toBe(true);
  });

  it('no lift ⇒ strategy=raw, rawInteractiveShaped=true on a semantic element', () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    const btn = document.getElementById('b')!;
    const q = captureClickQualification(clickOn(btn), btn, probeReturning(btn))!;
    expect(q.facts.hitTarget.lifted).toBe(false);
    expect(q.facts.hitTarget.liftStrategy).toBe('raw');
    expect(q.facts.hitTarget.rawInteractiveShaped).toBe(true);
    expect(q.insufficient).toBe(false);
  });

  it('raw element with tabindex=0 is rawInteractiveShaped (shared predicate)', () => {
    document.body.innerHTML = '<div id="d" tabindex="0">Go</div>';
    const div = document.getElementById('d')!;
    const q = captureClickQualification(clickOn(div), div, probeReturning(div))!;
    expect(q.facts.hitTarget.rawInteractiveShaped).toBe(true);
  });

  // ── zeroSizeLifted (R-5; jsdom zero-rect reality) ─────────────────

  it('lifted resolved target with EMPTY rect ⇒ zeroSizeLifted recorded; WITHOUT miss it stays qualified+insufficient', () => {
    document.body.innerHTML = '<div id="wrap"><span id="s" role="button">Go</span></div>';
    const span = document.getElementById('s')!;
    const wrap = document.getElementById('wrap')!;
    // jsdom rects are all zero → zeroSizeLifted fires with no miss proof
    const q = captureClickQualification(
      clickOn(span),
      wrap,
      probeReturning(span),
    )!;
    expect(q.facts.zeroSizeLifted).toBe(true);
    expect(q.verdict).toBe('qualified');
    expect(q.insufficient).toBe(true);
  });

  it('lifted resolved target with NON-empty rect ⇒ zeroSizeLifted=false', () => {
    document.body.innerHTML = '<div id="wrap"><span id="s">Go</span></div>';
    const span = document.getElementById('s')!;
    const wrap = document.getElementById('wrap')!;
    (wrap as HTMLElement).getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40 }) as DOMRect;
    const q = captureClickQualification(
      clickOn(span),
      wrap,
      probeReturning(span),
    )!;
    expect(q.facts.zeroSizeLifted).toBe(false);
  });

  // ── Scope + immutability ──────────────────────────────────────────

  it('returns null for keydown (click-family only: click/contextmenu)', () => {
    document.body.innerHTML = '<input id="i" type="text">';
    const inp = document.getElementById('i')!;
    const kd = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    inp.dispatchEvent(kd);
    expect(captureClickQualification(kd, inp, probeReturning(inp))).toBeNull();
  });

  it('computes for contextmenu (same physical family)', () => {
    document.body.innerHTML = '<button id="b" disabled>Go</button>';
    const btn = document.getElementById('b')!;
    const ctx = new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 });
    btn.dispatchEvent(ctx);
    const q = captureClickQualification(ctx, btn, probeReturning(btn))!;
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual(['disabled-native']);
  });

  it('facts frozen at capture (deep-frozen vector)', () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    const btn = document.getElementById('b')!;
    const q = captureClickQualification(clickOn(btn), btn, probeReturning(btn))!;
    expect(Object.isFrozen(q)).toBe(true);
    expect(Object.isFrozen(q.facts)).toBe(true);
    expect(Object.isFrozen(q.facts.hitTest)).toBe(true);
    expect(Object.isFrozen(q.facts.hitTarget)).toBe(true);
  });
});

describe('EventTap — additive attachment (Step 1 inert)', () => {
  let tapHandle: ReturnType<typeof createEventTap> | null = null;
  let captured: any[] = [];

  beforeEach(() => {
    captured = [];
    document.body.innerHTML = '';
    TEST_HOOK.forceTrusted = true;
  });

  afterEach(() => {
    TEST_HOOK.forceTrusted = false;
    tapHandle?.stop();
    tapHandle = null;
  });

  it('attaches domContext.clickQualification on trusted clicks', () => {
    document.body.innerHTML = '<button id="b" disabled>Go</button>';
    const btn = document.getElementById('b')!;
    tapHandle = createEventTap({ onEvent: (e) => captured.push(e) });
    clickOn(btn); // dispatches internally
    expect(captured.length).toBe(1);
    const q = captured[0].domContext.clickQualification;
    expect(q).toBeTruthy();
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual(['disabled-native']);
  });

  it('attaches on contextmenu, NOT on keydown/mousedown', () => {
    document.body.innerHTML = '<input id="i" type="text">';
    const inp = document.getElementById('i')!;
    tapHandle = createEventTap({ onEvent: (e) => captured.push(e) });
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    inp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    inp.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const kd = captured.find((e) => e.eventType === 'keydown');
    const md = captured.find((e) => e.eventType === 'mousedown');
    const cm = captured.find((e) => e.eventType === 'contextmenu');
    expect(kd.domContext.clickQualification).toBeUndefined();
    expect(md.domContext.clickQualification).toBeUndefined();
    expect(cm.domContext.clickQualification?.verdict).toBe('qualified');
  });

  it('every other DomContext field is unchanged (additive-only)', () => {
    document.body.innerHTML = '<button id="b" aria-label="Save">S</button>';
    const btn = document.getElementById('b')!;
    tapHandle = createEventTap({ onEvent: (e) => captured.push(e) });
    clickOn(btn); // dispatches internally
    const dc = captured[0].domContext;
    expect(dc.disabled).toBe(false);
    expect(dc.tabIndex).toBe(0);
    expect(dc.pointerCursor).toBe(false);
    expect(Array.isArray(dc.ancestorRoles)).toBe(true);
    expect(Object.keys(dc).length).toBeGreaterThanOrEqual(12);
  });
});
