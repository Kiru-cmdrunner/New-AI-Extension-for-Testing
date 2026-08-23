/**
 * 6F-M2b — consumer + renderer pins for the sw-recovered identity seed
 *
 * Spec: .drytis/specs/phase-6f-m2b-sw-recovered-identity.md (§2 sweep table,
 * AC-6, AC-7)
 *
 * The seed makes targetEvidence.identity non-null on sw-recovered thin
 * evidence. These pins prove the two behavioral consumers react correctly:
 *   - renderer: renders the real element (the fix's purpose), never
 *     "Unknown element" when identity is seeded;
 *   - TargetStateSignalExtractor: still returns [] (before/after null guard)
 *   - extractInteractionContract: state fields unchanged (domContext path)
 */
import { describe, it, expect } from 'vitest';
import type { ComponentInteraction } from '../../../src/shared/component-types';
import type { ElementIdentity } from '../../../src/shared/types';
import { TargetStateSignalExtractor } from '../../../src/understanding/signal-extractors/target-state-signals';
import { extractInteractionContract } from '../../../src/understanding/enrichment/interaction-contract';
import { synthesizeMinimalEvidence } from '../../../src/background/evidence-attribution';
import { renderIdentity } from '../../../src/sidepanel/evidence-renderer';

const TRIGGER: ElementIdentity = {
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
} as ElementIdentity;

function makeClick(): ComponentInteraction {
  return {
    interactionId: 'int-1',
    type: 'Click' as never,
    trigger: TRIGGER as never,
    triggerEvent: { eventId: 'evt-1', eventType: 'click' } as never,
    memberEvents: [] as never,
    startTime: 1_000,
    endTime: 1_100,
    endState: 'completed' as never,
    metadata: {},
  } as unknown as ComponentInteraction;
}

describe('6F-M2b — consumer pins for the identity seed', () => {
  it('AC-6: renderer shows the real element for a seeded sw-recovered card', () => {
    const ev = synthesizeMinimalEvidence(makeClick(), 'evt-1');
    const el = renderIdentity(ev.targetEvidence.identity);
    const text = el.textContent ?? '';
    expect(text).toContain('INPUT');
    expect(text).toContain('#add-to-cart-button');
    expect(text).toContain('Add to cart');
    expect(text).not.toContain('Unknown element');
  });

  it('AC-6b: null identity still renders "Unknown element" (honesty unchanged)', () => {
    const el = renderIdentity(null);
    expect(el.textContent).toContain('Unknown element');
  });

  it('AC-7a: TargetStateSignalExtractor returns [] on seeded thin evidence (before/after null guard)', () => {
    const click = makeClick();
    click.behavioralEvidence = synthesizeMinimalEvidence(click, 'evt-1');
    expect(new TargetStateSignalExtractor().extract(click)).toEqual([]);
  });

  it('AC-7b: extractInteractionContract unchanged — domContext fallback path', () => {
    const click = makeClick();
    click.triggerEvent = {
      eventId: 'evt-1',
      eventType: 'click',
      domContext: { disabled: true, ariaExpanded: false },
    } as never;
    click.behavioralEvidence = synthesizeMinimalEvidence(click, 'evt-1');
    const contract = extractInteractionContract(click);
    // D9 fallback: disabled from domContext even though targetEvidence exists
    // (its after snapshot is null — the seed does not invent state).
    expect(contract.disabled).toBe(true);
    expect(contract.expanded).toBe(false);
  });
});
