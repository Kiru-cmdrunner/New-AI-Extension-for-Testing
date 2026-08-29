/**
 * Phase 7.3 W-B — L3 pin: Click definition claims QA-instrumented targets.
 *
 * Spec .drytis/specs/phase-7-3-wb-auto-id-generic.md AC3 (baseline 98aa71b):
 *   - a plain DIV bearing `auto-id` (bare spelling) is claimed as a Click;
 *   - a plain DIV bearing `data-auto-id` (6B spelling) is claimed as a Click;
 *   - a plain DIV with NO QA instrumentation remains rejected (honest
 *     Unclassified preserved — W-B claims only what the app instruments);
 *   - the S6/LP1 open-selection-surface gate is untouched;
 *   - higher-priority shape still wins (claim gate is in the universal
 *     fallback only — this pin asserts the fallback's own detectTrigger).
 *
 * Attribute-presence fact: no timing rules, no site tokens (doctrine).
 */

import { describe, it, expect } from 'vitest';
import { clickDefinition } from '../../src/definitions/click';
import type { ObservedEvent } from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

function baseIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: 'result-item anim',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div.result-item',
    xPath: '//div',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: 'elem-0001',
    ...overrides,
  } as ElementIdentity;
}

function eventOf(target: ElementIdentity, domContextOverrides = {}): ObservedEvent {
  return {
    type: 'click',
    target,
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      disabled: false,
      readOnly: false,
      required: false,
      ancestorRoles: [],
      ancestorClasses: [],
      tabIndex: -1,
      ...domContextOverrides,
    },
    clientX: 10,
    clientY: 10,
  } as unknown as ObservedEvent;
}

describe('7.3 W-B AC3 — Click claim gate for QA auto-id targets', () => {
  it('claims a plain DIV bearing bare auto-id', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity({ autoId: 'select_flight_card' })),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('claims a plain DIV bearing data-auto-id (6B spelling)', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity({ dataAutoId: 'select_flight_card' })),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('claims when both spellings present (data-auto-id precedence noted)', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity({ autoId: 'bare', dataAutoId: 'prefixed' })),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('claims a plain DIV with NO QA instrumentation (v1.2 flip — qualification is capture-time)', () => {
    // Click Qualification v1.2 §8.5: appearance/instrumentation is no longer
    // evidence of click validity. A qualified trusted click on a plain DIV
    // is a Click. Invalid clicks are gated at capture
    // (tests/runtime/click-qualification-step2-wiring.test.ts S2-1/S2-2).
    const trigger = clickDefinition.detectTrigger(eventOf(baseIdentity()));
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('empty-string auto-id → still claims Click (v1.2 — auto-id no longer gates)', () => {
    // The ''-normalization guard is obsolete as a claim rule; kept as a
    // stability check that degenerate identity fields don't crash the
    // unconditional claim.
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity({ autoId: '' } as Partial<ElementIdentity>)),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('interactive tag still claims via isInteractiveElement (untouched path)', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity({ tag: 'BUTTON' })),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('S6/LP1 open-selection-surface gate remains functional', () => {
    // No auto-id anywhere; ancestor listbox + option role ancestry claims.
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity(), {
        ancestorRoles: ['listbox'],
        ancestorClasses: ['react-datepicker__month'],
      }),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });
});
