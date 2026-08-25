/**
 * 7.4-B1 Expander — IR bridge pins (spec phase-7-4-b1-expander.md AC-4/5).
 * Replay-correctness: Expander → IRAction.CLICK (TOGGLE is checkbox-specific).
 */
import { describe, it, expect } from 'vitest';
import type { ComponentInteraction } from '../../src/shared/component-types';
import { build } from '../../src/generation/ir-bridge';

// INTERACTION_TO_IR_ACTION is Record<InteractionType, IRAction> — a missing
// Expander row is a COMPILE ERROR; importing build exercises the real gate.

function expanderInteraction(): ComponentInteraction {
  return {
    id: 'int-1', type: 'Expander', startTime: 1, endTime: 2,
    trigger: {
      tag: 'BUTTON', ariaRole: null, className: null,
      accessibleName: 'More filters', ariaLabel: null, placeholder: null,
      cssSelector: '#more-filters', autoId: null, dataAutoId: null,
    },
    triggerEvent: {
      eventId: 'evt-1', eventType: 'click', timestamp: 1, captureSeq: 1,
      clientX: 5, clientY: 5, pageUrl: 'https://x.test/', pageTitle: 'X',
      domContext: { inputType: null, ariaExpanded: false, ariaHasPopup: null,
        isContentEditable: false, disabled: false, readOnly: false, required: false,
        ancestorRoles: [], ancestorClasses: [], tabIndex: null },
    },
    endReason: 'explicit', endState: 'completed',
    metadata: { targetName: 'More filters', expandedAtTrigger: false },
  } as unknown as ComponentInteraction;
}

describe('7.4-B1 Expander IR mapping', () => {
  const planFor = () => build({
    interactions: [expanderInteraction()],
    recordingContext: { startUrl: 'https://x.test/', title: 'X' },
  } as never);
  const stepFor = () => planFor().steps.find((s) => {
    const t = s.target as { resolvedLocators?: { value: string }[] } | undefined;
    return (t?.resolvedLocators ?? []).some((l) => l.value === '#more-filters');
  });

  it('B1-13: Expander interaction → IR action click', () => {
    expect(stepFor()).toBeTruthy();
    expect(stepFor()?.action).toBe('click');
  });

  it('B1-14: description reads "Expand or collapse …"', () => {
    expect(stepFor()?.description).toMatch(/expand or collapse the more filters/i);
  });

  it('B1-15: step input stays null (replay parity with hand-written click)', () => {
    expect(stepFor()?.input).toBeNull();
  });

  it('B1-16: Expander steps are PRODUCTION steps (not filtered as noise)', () => {
    // NOISE_TYPES is module-private; the observable contract is that the
    // Expander step appears in the plan at all — noise types are skipped
    // entirely (build's NOISE_TYPES.has gate, ir-bridge.ts:573).
    expect(planFor().steps.length).toBeGreaterThan(0);
    expect(stepFor()).toBeTruthy();
  });
});
