/**
 * B7-P4 T5 — PANEL: hover evidence badges + gesture-only grouping (red-first).
 *
 * Spec §5.4 item 1: "Hover rows render evidence-derived badges (per-class
 * chips); gesture-only hovers grouped via the existing toggle-row pattern
 * (grouping never destruction — D4); unattributedConsequences surfaced
 * (V1 honest floor); dedup folds become presentation-only for gesture-only
 * hovers and are disabled for admitted ones (F-5's data loss scoped away)."
 *
 * HEC v1 re-baseline (2026-08-30): admission and chips now read the
 * RECORDED capture-time verdict/class (metadata.hoverQualification or the
 * evidence envelope) — the fixture below carries one. Legacy no-record
 * rows render the derived display classes (display only).
 */
import { describe, expect, it } from 'vitest';
import { renderProductionInteractions } from '../../src/sidepanel/interaction-renderer';
import type { ComponentInteraction } from '../../src/shared/component-types';

function makeHover(
  interactionId: string,
  opts: { evidence?: object; endState?: string; qualified?: boolean } = {},
): ComponentInteraction {
  return {
    interactionId,
    type: 'Hover',
    endState: opts.endState ?? 'completed',
    triggerEvent: {
      eventId: `e-${interactionId}`,
      eventType: 'mouseenter',
    },
    memberEvents: [],
    metadata: opts.qualified === false ? {} : {
      hoverQualification: {
        verdict: opts.evidence ? 'evidenced' : 'gesture-only',
        evidenceClass: opts.evidence ? 'reveal' : null,
        evidenceReason: opts.evidence
          ? 'reveal: surface emerged joined to anchor'
          : 'gesture-only: no target-local consequence in enter window',
        anchorFacts: {},
        factSummary: {},
      },
    },
    behavioralEvidence: {
      sourceEventId: `e-${interactionId}`,
      windowId: `w-${interactionId}`,
      ...(opts.evidence ? { applicationEvidence: opts.evidence } : {}),
    },
  } as unknown as ComponentInteraction;
}

const REVEAL_EVIDENCE = {
  newSurfaces: [
    {
      path: 'div#menu',
      tagName: 'DIV',
      ariaRole: 'menu',
      accessibleName: 'Main menu',
      shadowContext: null,
      descendantCount: 3,
      relativeTime: 10,
      batchIndex: 1,
      kind: 'added',
      emergence: 'revealed',
    },
  ],
};

describe('B7-P4 T5: hover panel badges + gesture-only grouping', () => {
  it('admitted hover row renders a per-class evidence chip for each derived class', () => {
    const container = document.createElement('div');
    const hover = makeHover('int-1', { evidence: REVEAL_EVIDENCE });
    renderProductionInteractions(container, [hover]);
    const chipTexts = [...container.querySelectorAll('.interaction-chip')].map(
      (c) => c.textContent ?? '',
    );
    expect(chipTexts.some((t) => t.includes('reveal'))).toBe(true);
  });

  it('gesture-only hover (no evidence classes) is grouped behind the toggle row, NOT rendered by default', () => {
    const container = document.createElement('div');
    const admitted = makeHover('int-1', { evidence: REVEAL_EVIDENCE });
    const gestureOnly = makeHover('int-2', {});
    renderProductionInteractions(container, [admitted, gestureOnly]);
    const ids = [...container.querySelectorAll('.timeline-event__id')].map(
      (n) => n.textContent ?? '',
    );
    expect(ids).toContain('int-1');
    expect(ids).not.toContain('int-2');
  });

  it('showHidden renders gesture-only hover with a suppression chip (grouping never destruction)', () => {
    const container = document.createElement('div');
    const admitted = makeHover('int-1', { evidence: REVEAL_EVIDENCE });
    const gestureOnly = makeHover('int-2', {});
    renderProductionInteractions(container, [admitted, gestureOnly], {
      showHidden: true,
    });
    const ids = [...container.querySelectorAll('.timeline-event__id')].map(
      (n) => n.textContent ?? '',
    );
    expect(ids).toContain('int-1');
    expect(ids).toContain('int-2');
    const suppressed = [
      ...container.querySelectorAll('.interaction-chip--suppressed'),
    ].map((c) => c.textContent ?? '');
    expect(suppressed.some((t) => t.includes('not meaningful'))).toBe(true);
  });
});
