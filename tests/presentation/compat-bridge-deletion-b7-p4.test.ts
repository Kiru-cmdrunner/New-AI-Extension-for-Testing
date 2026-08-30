/**
 * B7-P4 T4 — COMPAT BRIDGE DELETION (red-first).
 *
 * Spec §5.4 item 3 (P4): "Panel reads switch from `metadata.meaningful`
 * to `consequenceClasses`; the compat bridge is deleted."
 *
 * What must be TRUE after P4:
 *   1. filterProductionInteractions NO LONGER MUTATES hover metadata —
 *      no writes of consequenceClasses, no writes of meaningful. The
 *      filter keeps admission semantics (deriveConsequenceClasses read)
 *      and is side-effect-free (a pure filter again).
 *   2. The ledger's anchor gate derives admission from the recorded
 *      evidence (deriveConsequenceClasses) instead of reading the
 *      stored metadata.consequenceClasses array.
 *   3. The panel renderer derives admission per render from the
 *      interaction's own evidence instead of metadata.meaningful.
 *   4. Legacy stored rows (with metadata.consequenceClasses from the
 *      P2/P3 era) still anchor/render admitted — backward compatible.
 */
import { describe, expect, it } from 'vitest';
import {
  filterProductionInteractions,
  deriveConsequenceClasses,
} from '../../src/presentation/output-adapter';
import { isAnchorEligibleInteraction } from '../../src/runtime/evidence-ledger';

// ── Fixture builders ─────────────────────────────────────────────────────

function admittedHover(interactionId: string, metadata: Record<string, unknown> = {}) {
  return {
    interactionId,
    type: 'Hover',
    endState: 'completed',
    triggerEvent: { eventId: `e-${interactionId}`, eventType: 'mouseenter' },
    memberEvents: [],
    metadata: { ...metadata },
    behavioralEvidence: {
      sourceEventId: `e-${interactionId}`,
      windowId: `w-${interactionId}`,
      applicationEvidence: {
        newSurfaces: [
          {
            path: 'div#m',
            tagName: 'DIV',
            ariaRole: 'menu',
            accessibleName: 'M',
            shadowContext: null,
            descendantCount: 1,
            relativeTime: 10,
            batchIndex: 1,
            kind: 'added' as const,
            emergence: 'revealed' as const,
          },
        ],
      },
    },
  } as never;
}

function gestureOnlyHover(interactionId: string) {
  return {
    interactionId,
    type: 'Hover',
    endState: 'completed',
    triggerEvent: { eventId: 'e-gesture', eventType: 'mouseenter' },
    memberEvents: [],
    metadata: {},
    behavioralEvidence: {
      sourceEventId: 'e-gesture',
      windowId: 'w-gesture',
      applicationEvidence: {},
    },
  } as never;
}

describe('B7-P4 T4: compat-bridge deletion', () => {
  it('filterProductionInteractions no longer mutates hover metadata (no bridge writes)', () => {
    // HEC v1 re-baseline: admission requires the recorded capture-time
    // verdict (§9/D2) — give the fixture an evidenced qualification; the
    // assertion under test (no metadata mutation) is unchanged.
    const hover = admittedHover('int-1', { meaningful: true }); // legacy stored judgment
    (
      (hover as { behavioralEvidence: { hoverQualification?: unknown } }).behavioralEvidence
    ).hoverQualification = {
      verdict: 'evidenced', evidenceClass: 'reveal',
      evidenceReason: 'reveal: aria-expanded false→true on joined element',
      anchorFacts: {}, factSummary: {},
    };
    const out = filterProductionInteractions([hover]);
    expect(out.length).toBe(1);
    expect((out[0] as { metadata: Record<string, unknown> }).metadata).toEqual({
      meaningful: true,
    });
  });

  it('ledger anchor gate reads evidence directly (no metadata.consequenceClasses dependency)', () => {
    // A hover with evidence but NO stored metadata.consequenceClasses
    // must still anchor — the gate derives from evidence, not metadata.
    const hover = admittedHover('int-2');
    expect(isAnchorEligibleInteraction(hover as never)).toBe(true);
    // Gesture-only never anchors (V4).
    expect(isAnchorEligibleInteraction(gestureOnlyHover('int-3') as never)).toBe(false);
  });

  it('legacy stored consequenceClasses rows still anchor (backward compatible)', () => {
    const hover = admittedHover('int-4', { consequenceClasses: ['reveal'] });
    expect(isAnchorEligibleInteraction(hover as never)).toBe(true);
  });

  it('deriveConsequenceClasses remains exported and pure (single derivation source)', () => {
    const hover = admittedHover('int-5');
    const classes = deriveConsequenceClasses(hover as never);
    expect(classes).toEqual(expect.arrayContaining(['reveal']));
  });
});
