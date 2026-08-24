/**
 * Phase 7.3 W-B — L1/L2 pins: identity vocabulary + resolveTarget ancestor lift.
 *
 * Spec .drytis/specs/phase-7-3-wb-auto-id-generic.md (baseline 98aa71b):
 *   AC1 extractIdentity captures the bare `auto-id` attribute into the new
 *      optional `autoId` field; absent → null; `auto-id=""` → null (honest
 *      absence, mirrors the 6B dataAutoId rule); both spellings present →
 *      both fields populated independently, no conflation.
 *   AC2 resolveTarget lifts a click on a plain descendant to the ancestor
 *      bearing `auto-id` or `data-auto-id`; genuinely interactive leaves
 *      (button / a[href] / [role=button]) still win leaf-first; plain
 *      descendants of UN-instrumented ancestors keep Strategy-3 behavior
 *      (raw leaf returned).
 *
 * Generic convention under test — `auto-id` is an industry QA instrumentation
 * attribute, not a site token (doctrine: tests/doctrine/genericity-pin.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { extractIdentity, resolveTarget } from '../../src/tap/identity-extractor';

function mount(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  const found = host.firstElementChild!;
  document.body.appendChild(host);
  return found;
}

function fakeEvent(target: Element): Event {
  return { target, composedPath: () => [target] } as unknown as Event;
}

// ── AC1: extractIdentity autoId ──────────────────────────────────────────

describe('7.3 W-B AC1 — extractIdentity captures bare auto-id', () => {
  it('captures auto-id when present', () => {
    const target = mount('<div auto-id="select-flight-card">IndiGo 6E-231</div>');
    const identity = extractIdentity(target);
    expect(identity.autoId).toBe('select-flight-card');
  });

  it('null when the attribute is absent', () => {
    const target = mount('<div class="card">Plain</div>');
    const identity = extractIdentity(target);
    expect(identity.autoId).toBeNull();
  });

  it('empty-string attribute is normalized to null (honest absence)', () => {
    const target = mount('<div auto-id="">Empty</div>');
    const identity = extractIdentity(target);
    expect(identity.autoId).toBeNull();
  });

  it('both spellings present → both fields set independently, no conflation', () => {
    const target = mount(
      '<div auto-id="bare-value" data-auto-id="prefixed-value">Dual</div>',
    );
    const identity = extractIdentity(target);
    expect(identity.autoId).toBe('bare-value');
    expect(identity.dataAutoId).toBe('prefixed-value');
  });

  it('data-auto-id alone leaves autoId null (6B field unchanged)', () => {
    const target = mount('<div data-auto-id="prefixed-only">Prefixed</div>');
    const identity = extractIdentity(target);
    expect(identity.autoId).toBeNull();
    expect(identity.dataAutoId).toBe('prefixed-only');
  });

  it('identity remains JSON-serializable with the new field', () => {
    const target = mount('<div auto-id="json-pin">X</div>');
    const identity = extractIdentity(target);
    expect(() => JSON.stringify(identity)).not.toThrow();
    expect(JSON.parse(JSON.stringify(identity)).autoId).toBe('json-pin');
  });
});

// ── AC2: resolveTarget ancestor lift ─────────────────────────────────────

describe('7.3 W-B AC2 — resolveTarget lifts to instrumented ancestors', () => {
  it('lifts a plain span inside div[auto-id] to the card', () => {
    const card = mount(
      '<div auto-id="select-flight-card"><span class="price">7,000</span></div>',
    );
    const span = card.querySelector('span')!;
    const resolved = resolveTarget(fakeEvent(span));
    expect(resolved).toBe(card);
  });

  it('lifts a plain span inside div[data-auto-id] to the card', () => {
    const card = mount(
      '<div data-auto-id="select-flight-card"><span class="price">7,000</span></div>',
    );
    const span = card.querySelector('span')!;
    const resolved = resolveTarget(fakeEvent(span));
    expect(resolved).toBe(card);
  });

  it('inner <button> wins leaf-first over the instrumented ancestor', () => {
    const card = mount(
      '<div auto-id="select-flight-card"><button type="button">Book Now</button></div>',
    );
    const btn = card.querySelector('button')!;
    const resolved = resolveTarget(fakeEvent(btn));
    expect(resolved).toBe(btn);
  });

  it('inner a[href] wins leaf-first over the instrumented ancestor', () => {
    const card = mount(
      '<div auto-id="card"><a href="cart.html">Cart</a></div>',
    );
    const link = card.querySelector('a')!;
    const resolved = resolveTarget(fakeEvent(link));
    expect(resolved).toBe(link);
  });

  it('inner [role=button] wins leaf-first over the instrumented ancestor', () => {
    const card = mount(
      '<div auto-id="card"><div role="button" tabindex="0">Select</div></div>',
    );
    const roleBtn = card.querySelector('[role="button"]')!;
    const resolved = resolveTarget(fakeEvent(roleBtn));
    expect(resolved).toBe(roleBtn);
  });

  it('nearest instrumented ancestor wins over a farther one', () => {
    const outer = mount(
      '<div auto-id="outer-card"><div auto-id="inner-card"><span>text</span></div></div>',
    );
    const inner = outer.querySelector('[auto-id="inner-card"]')!;
    const span = outer.querySelector('span')!;
    const resolved = resolveTarget(fakeEvent(span));
    expect(resolved).toBe(inner);
  });

  it('plain descendant of UN-instrumented ancestors keeps Strategy-3 (raw leaf)', () => {
    const host = mount('<div class="card-box"><span class="price">7,000</span></div>');
    const span = host.querySelector('span')!;
    const resolved = resolveTarget(fakeEvent(span));
    expect(resolved).toBe(span);
  });
});
