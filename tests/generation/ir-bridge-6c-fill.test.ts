/**
 * Phase 6C — IR bridge: fill uses TYPED intent; committed state lives in the
 * step's own assertions
 *
 * Spec: .drytis/specs/phase-6a6c-assertion-derivation-fill-semantics.md §3
 *
 * Pins:
 *  - P5 (IR half): IRStep.input === typedValue when typed ≠ committed;
 *    input falls back to textValue when typedValue is absent (legacy
 *    recordings/autofill) — existing pins keep passing with identical
 *    fixtures.
 *  - generateDescription TextEntry reads typedValue ?? textValue.
 *  - The committed value surfaces ONLY via the step's assertions (derived by
 *    the P2 branch), never as the fill input.
 *
 * TDD: written before implementation. Red until extractInputValue and
 * generateDescription read typedValue ?? textValue. No product code here.
 */

import { describe, it, expect } from 'vitest';
import { build } from '../../src/generation/ir-bridge';
import type { ComponentInteraction } from '../../src/shared/component-types';

// ── Factories ─────────────────────────────────────────────

function textEntryInteraction(
  eventId: string,
  metadata: Record<string, unknown>,
): ComponentInteraction {
  return {
    interactionId: `int-${eventId}`,
    type: 'TextEntry',
    trigger: {
      tag: 'INPUT',
      stableId: 'origin',
      accessibleName: 'Origin',
      cssSelector: '#origin',
      elementId: '',
      ariaLabel: null,
      ariaRole: 'textbox',
      placeholder: null,
      className: null,
      name: 'origin',
      testId: null,
      dataCy: null,
      dataQa: null,
      href: null,
      inputType: 'text',
      ariaLabelledBy: null,
      xPath: '/html/body/input',
      inIframe: false,
      shadowDom: false,
    } as never,
    triggerEvent: { eventId } as never,
    memberEvents: [],
    startTime: 1,
    endTime: 2,
    endState: 'completed',
    metadata,
  } as unknown as ComponentInteraction;
}

function buildIR(interactions: ComponentInteraction[], enrichment?: object) {
  return build({
    interactions,
    recordingContext: { startUrl: 'https://example.test/flights', title: null },
    testCaseName: 'Flight search',
    enrichment: enrichment as never,
  });
}

// ── P5: fill input = typed intent ─────────────────────────

describe('ir-bridge — FILL input uses typed intent (P5)', () => {
  it('int-28: typed "Sat, 22 Aug" / committed "Sat, 05 Sep" → fill input is the TYPED value', () => {
    const ir = buildIR([
      textEntryInteraction('ev-fill', {
        targetName: 'Origin',
        typedValue: 'Sat, 22 Aug',
        textValue: 'Sat, 05 Sep',
        userTyped: true,
      }),
    ]);
    expect(ir.steps).toHaveLength(1);
    expect(ir.steps[0].action).toBe('fill');
    expect(ir.steps[0].input).toBe('Sat, 22 Aug');
  });

  it('description reads typed intent: Fill "Sat, 22 Aug" in the Origin', () => {
    const ir = buildIR([
      textEntryInteraction('ev-fill', {
        targetName: 'Origin',
        typedValue: 'Sat, 22 Aug',
        textValue: 'Sat, 05 Sep',
        userTyped: true,
      }),
    ]);
    expect(ir.steps[0].description).toBe('Fill "Sat, 22 Aug" in the Origin');
  });

  it('plainEnglish mirrors the description (capitalized)', () => {
    const ir = buildIR([
      textEntryInteraction('ev-fill', {
        targetName: 'Origin',
        typedValue: 'Sat, 22 Aug',
        textValue: 'Sat, 05 Sep',
        userTyped: true,
      }),
    ]);
    expect(ir.steps[0].plainEnglish).toBe('Fill "Sat, 22 Aug" in the Origin');
  });

  it('fallback: typedValue absent → input = textValue (legacy fixtures keep passing)', () => {
    const ir = buildIR([
      textEntryInteraction('ev-fill-legacy', {
        targetName: 'Origin',
        textValue: 'admin',
        userTyped: true,
      }),
    ]);
    expect(ir.steps[0].input).toBe('admin');
    expect(ir.steps[0].description).toBe('Fill "admin" in the Origin');
  });

  it('fallback: typedValue empty string → input = textValue', () => {
    const ir = buildIR([
      textEntryInteraction('ev-fill-empty', {
        targetName: 'Origin',
        typedValue: '',
        textValue: 'admin',
        userTyped: true,
      }),
    ]);
    expect(ir.steps[0].input).toBe('admin');
  });

  it('committed value reaches the step ONLY via assertions, never as fill input', () => {
    const enrichment = {
      stepAssertions: new Map([
        [
          'ev-fill',
          [
            {
              type: 'equality',
              comparison: 'equals',
              severity: 'soft',
              expectedValue: 'Sat, 05 Sep',
              property: 'value',
              targetCss: '#origin',
              targetName: 'Origin',
              derivedFrom: 'text-entry-committed',
            },
          ],
        ],
      ]),
    };
    const ir = buildIR(
      [
        textEntryInteraction('ev-fill', {
          targetName: 'Origin',
          typedValue: 'Sat, 22 Aug',
          textValue: 'Sat, 05 Sep',
          userTyped: true,
        }),
      ],
      enrichment,
    );
    expect(ir.steps[0].input).toBe('Sat, 22 Aug');
    expect(ir.steps[0].assertions).toHaveLength(1);
    expect(ir.steps[0].assertions[0].expectedValue).toBe('Sat, 05 Sep');
    expect(ir.steps[0].assertions[0].property).toBe('value');
  });
});
