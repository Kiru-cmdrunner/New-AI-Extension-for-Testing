/**
 * B7-P1 TRANSITIONAL CONTAINMENT — evidence attachment must not leak into
 * IR assertions or understanding signals before P2/P4 land the admission
 * rule and surface-visible derivation.
 *
 * Spec §5.1 ("P1 is invisible by construction" containment note):
 * meaningful hovers ALREADY pass today's production filter and carry
 * near-empty synthetic evidence. P1 attaches RICH window evidence to hover
 * interactions. If derivation seams read that evidence, derived IR
 * assertions and understanding signals/outcomes would change TODAY —
 * violating the byte-identical requirement. Two transitional gates:
 *
 *   Gate IR:   deriveStepAssertions skips interactions of type 'Hover'
 *              (removed in P4 when surface-visible becomes a deliberate
 *              derivation with locator honesty).
 *   Gate UND:  SignalExtractionCoordinator.extractFromInteraction returns
 *              the empty SignalSet for Hover (removed in P2/P4 — the
 *              admission rule + producer role replace it).
 *
 * Both gates are scoped to Hover ONLY — every other type's derivation is
 * byte-identical with or without the gate.
 */

import { describe, it, expect } from 'vitest';
import { deriveStepAssertions } from '../../src/generation/assertion-derivation';
import { SignalExtractionCoordinator } from '../../src/understanding/signal-extractors/signal-extractor';
import type { ComponentInteraction } from '../../src/shared/component-types';

function richEvidenceInteraction(type: ComponentInteraction['type']): ComponentInteraction {
  return {
    interactionId: 'i-1',
    type,
    triggerEvent: {
      eventId: 'evt-1', eventType: 'click', timestamp: Date.now(), captureSeq: 1,
      isTrusted: true,
      target: {
        accessibleName: 'x', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
        placeholder: null, tag: 'BUTTON', className: null, name: null, stableId: 'b1',
        testId: null, dataCy: null, dataQa: null, cssSelector: '', xPath: '', elementId: '',
        rect: null, textContent: null, shadowContext: null,
      },
      domContext: {
        inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false,
        disabled: false, readOnly: false, required: false, ancestorRoles: [],
        ancestorClasses: [], tabIndex: 0,
      },
      valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
      clientX: 1, clientY: 1, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollDeltaX: null, pageUrl: 'http://t/', pageTitle: 'T',
    } as any,
    memberEvents: [],
    startTime: Date.now(),
    endTime: Date.now(),
    endState: 'completed',
    metadata: {},
    // RICH post-P1 evidence: a resulting-state snapshot whose items WOULD
    // be derivable if the gate were absent.
    behavioralEvidence: {
      sourceEventId: 'evt-1',
      windowId: 'w-1',
      applicationEvidence: {
        resultingState: {
          url: 'http://t/',
          viewId: 'v-1',
          items: [
            { kind: 'entity', matchedSelector: '[data-testid]', text: 'Product A',
              numericValue: null, entityId: null, entityType: null,
              domPath: 'div>ul#list>li#p-a', attributes: { 'data-testid': 'p-a' },
              visible: true, uniqueInSnapshot: true },
            { kind: 'counter', matchedSelector: '[data-testid]', text: '4 items',
              numericValue: 4, entityId: null, entityType: null,
              domPath: 'div>span#c', attributes: { 'data-testid': 'count' },
              visible: true, uniqueInSnapshot: true },
          ],
        },
        notifications: [],
        domChanges: [],
        networkConsequences: [],
        surfaces: [
          { path: 'div>ul', tagName: 'ul', ariaRole: 'menu', accessibleName: 'Products menu',
            shadowContext: null, descendantCount: 3, relativeTime: 10, batchIndex: 0,
            kind: 'added', emergence: 'revealed' },
        ],
      },
    } as any,
  } as unknown as ComponentInteraction;
}

describe('B7-P1 containment gates (transitional)', () => {
  it('Gate IR (P4 FLIPPED): a Hover with rich CONTAINED evidence derives nothing — containment is not ownership', () => {
    // B7-P4 removed the blanket Hover skip. The derivation is now
    // OWNERSHIP-scoped: a hover derives ONLY from facts the shared
    // adversarial ownership pass assigns it. This fixture has NO
    // window.openedBatch and no owned facts — only a contained
    // resulting-state snapshot — so the P4 derivation is honestly SILENT.
    // The Channel A guarantee (contained ≠ caused) is preserved by the
    // ownership pass, not by a blanket skip.
    const hover = richEvidenceInteraction('Hover');
    const map = deriveStepAssertions([hover]);
    expect(map.size).toBe(0);
    expect(map.has('evt-1')).toBe(false);
  });

  it('Gate IR (control): a non-Hover type with the SAME rich evidence still derives assertions', () => {
    const click = richEvidenceInteraction('Click');
    const map = deriveStepAssertions([click]);
    // The snapshot has derivable kinds (entity, counter) — the control MUST
    // produce assertions; if it does not, the fixture stopped exercising the
    // seam and the Hover test above proves nothing.
    expect(map.size).toBe(1);
    expect(map.get('evt-1')!.length).toBeGreaterThan(0);
  });

  it('Gate UND: SignalExtractionCoordinator returns an empty SignalSet for Hover', () => {
    const coordinator = new SignalExtractionCoordinator();
    const hover = richEvidenceInteraction('Hover');
    const result = coordinator.extractFromInteraction(hover);
    expect(result.viewChanges).toHaveLength(0);
    expect(result.apiOperations).toHaveLength(0);
    expect(result.notifications).toHaveLength(0);
    expect(result.counterChanges).toHaveLength(0);
    expect(result.listChanges).toHaveLength(0);
    expect(result.pageContent).toBeNull();
  });
});
