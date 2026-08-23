/**
 * 6F-M2b — sw-recovered identity seed (F4-D display honesty)
 *
 * Spec: .drytis/specs/phase-6f-m2b-sw-recovered-identity.md
 *
 * synthesizeMinimalEvidence must seed targetEvidence.identity from the
 * owning interaction's trigger (already a full ElementIdentity) instead of
 * hardcoding null — the sw-recovered-form-submit card then renders the real
 * element instead of "Unknown element". Honesty rules: shape-less triggers
 * keep null; before/after stay null; idempotence preserved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ComponentInteraction } from '../../../src/shared/component-types';
import type { ElementIdentity } from '../../../src/shared/types';

// ── Mock chrome.storage.local (same shape as evidence-attribution.test.ts) ──
const storageData = new Map<string, unknown>();
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return Object.fromEntries(storageData);
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (storageData.has(k)) out[k] = storageData.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storageData.set(k, v);
      }),
      remove: vi.fn((keys: string | string[] | null) => {
        if (keys === null) {
          storageData.clear();
        } else {
          for (const k of Array.isArray(keys) ? keys : [keys]) storageData.delete(k);
        }
        return Promise.resolve();
      }),
    },
  },
});

import { synthesizeMinimalEvidence } from '../../../src/background/evidence-attribution';

function makeIdentity(over: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Add to cart',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'INPUT',
    className: 'a-button-input',
    name: 'submit.add-to-cart',
    stableId: 'add-to-cart-button',
    testId: null,
    dataCy: null,
    dataQa: null,
    dataAutoId: null,
    cssSelector: '#add-to-cart-button',
    xPath: '//*[@id="add-to-cart-button"]',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: 'submit',
    elementId: '',
    ...over,
  } as ElementIdentity;
}

function makeClick(
  id = 'int-1',
  trigger: ElementIdentity | Record<string, unknown> = makeIdentity(),
  withEvidence = false,
): ComponentInteraction {
  return {
    interactionId: id,
    type: 'Click' as never,
    trigger: trigger as never,
    triggerEvent: { eventId: 'evt-click-1', eventType: 'click' } as never,
    memberEvents: [] as never,
    startTime: 1_000,
    endTime: 1_100,
    endState: 'completed' as never,
    metadata: {},
    behavioralEvidence: withEvidence
      ? ({ windowId: 'existing', window: { endReason: 'stabilized' } } as never)
      : undefined,
  } as unknown as ComponentInteraction;
}

describe('6F-M2b — synthesizeMinimalEvidence identity seed', () => {
  beforeEach(() => storageData.clear());

  it('AC-1: seeds identity from trigger — tag/stableId/ariaRole/accessibleName copied; before/after stay null', () => {
    const click = makeClick();
    const ev = synthesizeMinimalEvidence(click, 'evt-click-1');
    expect(ev.window.endReason).toBe('sw-recovered-form-submit');
    expect(ev.targetEvidence.identity).not.toBeNull();
    expect(ev.targetEvidence.identity!.tag).toBe('INPUT');
    expect(ev.targetEvidence.identity!.stableId).toBe('add-to-cart-button');
    expect(ev.targetEvidence.identity!.ariaRole).toBe('button');
    expect(ev.targetEvidence.identity!.accessibleName).toBe('Add to cart');
    expect(ev.targetEvidence.before).toBeNull();
    expect(ev.targetEvidence.after).toBeNull();
    expect(ev.targetEvidence.identityCapturedAt).toBe(0);
  });

  it('AC-2: full identity carries through (className, inputType, cssSelector, testId nulls)', () => {
    const click = makeClick('int-2', makeIdentity({ testId: 'atc-btn' }));
    const ev = synthesizeMinimalEvidence(click, 'evt-click-1');
    const id = ev.targetEvidence.identity!;
    expect(id.className).toBe('a-button-input');
    expect(id.inputType).toBe('submit');
    expect(id.cssSelector).toBe('#add-to-cart-button');
    expect(id.testId).toBe('atc-btn');
    expect(id.dataCy).toBeNull();
    expect(id.dataQa).toBeNull();
  });

  it('AC-3: shape-less trigger (no tag) keeps identity null — no invention', () => {
    const click = makeClick('int-3', { ariaRole: 'document' });
    const ev = synthesizeMinimalEvidence(click, 'evt-click-1');
    expect(ev.targetEvidence.identity).toBeNull();
  });

  it('AC-4: existing behavioralEvidence returned unchanged (idempotence)', () => {
    const click = makeClick('int-4', makeIdentity(), true);
    const ev = synthesizeMinimalEvidence(click, 'evt-click-1');
    expect((ev.window as { endReason: string }).endReason).toBe('stabilized');
    expect(ev.windowId).toBe('existing');
  });

  it('AC-1b: the seed is a CLONE — mutating it never mutates interaction.trigger', () => {
    const click = makeClick('int-5');
    const ev = synthesizeMinimalEvidence(click, 'evt-click-1');
    ev.targetEvidence.identity!.accessibleName = 'MUTATED';
    expect((click.trigger as unknown as ElementIdentity).accessibleName).toBe('Add to cart');
  });

  it('AC-5: empty-string elementId is copied as-is — the seed never trims/normalizes (no invented stableId)', () => {
    // Spec §3 "copy as-is": the synthesizer must NOT normalize '' → null or
    // promote anything else into stableId. Capture-side normalization
    // (identity-extractor el.id || null) is the single authority; a synthetic
    // producer that already normalized keeps null, and consumers falsy-guard
    // '' anyway. The pin: the seeded object carries the SAME elementId the
    // trigger carried — byte for byte, no invention, no trimming.
    const click = makeClick('int-6', makeIdentity({ elementId: '' }));
    const ev = synthesizeMinimalEvidence(click, 'evt-click-1');
    expect(ev.targetEvidence.identity!.elementId).toBe('');
    // And a trigger whose elementId IS null (already normalized) stays null:
    const click2 = makeClick('int-7', makeIdentity({ elementId: null as unknown as string }));
    const ev2 = synthesizeMinimalEvidence(click2, 'evt-click-1');
    expect(ev2.targetEvidence.identity!.elementId).toBeNull();
    // Neither shape invents a stableId from an empty id:
    expect(ev.targetEvidence.identity!.stableId).toBe('add-to-cart-button'); // from the trigger as-is
    expect(ev2.targetEvidence.identity!.stableId).toBe('add-to-cart-button');
  });
});
