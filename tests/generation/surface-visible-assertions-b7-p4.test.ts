/**
 * B7-P4 T3 — OWNERSHIP-SAFE surface-visible IR assertions (red-first).
 *
 * Spec §5.4 item 2 + the 2026-08-29 grounding-audit amendment:
 *   - `surface-visible` joins DERIVABLE_KINDS with locator honesty.
 *   - The P1 Hover containment gate in deriveStepAssertions is REMOVED.
 *   - A Hover mints surface-visible ONLY from facts in its OWNED set
 *     (the shared adversarial ownership pass); facts owned by a click
 *     window produce NO hover assertion.
 *   - INV-GEN-4 composes: owned ∧ locator-derivable both required.
 *   - MAX_ASSERTIONS_PER_STEP=3 respected.
 *   - Channel A Variants 1 + 2 must yield NO hover surface-visible
 *     assertion (spec acceptance, explicit).
 */
import { describe, expect, it } from 'vitest';
import { deriveStepAssertions } from '../../src/generation/assertion-derivation';
import type { ComponentInteraction } from '../../src/shared/component-types';

// ── Test-artifact builders ───────────────────────────────────────────────

interface FactSpec {
  path: string;
  batchIndex: number;
  kind?: 'reveal' | 'insertion';
}

function evt(
  eventType: string,
  eventId: string,
  timestamp: number,
  tabId = 1,
): ComponentInteraction['triggerEvent'] {
  return {
    eventType,
    eventId,
    timestamp,
    captureOrigin: { tabId },
  } as ComponentInteraction['triggerEvent'];
}

function hoverInteraction(
  interactionId: string,
  timestamp: number,
  durationMs: number,
  openedBatch: number,
  facts: FactSpec[],
): ComponentInteraction {
  const domChanges = facts.map((f) => ({
    targetPath: f.path,
    firstBatchIndex: f.batchIndex,
    addedNodesCount: f.kind === 'insertion' ? 1 : 0,
    changedAttributes: [] as string[],
    attributeDeltas:
      f.kind === 'insertion'
        ? undefined
        : { 'aria-expanded': { old: 'false', new: 'true' } },
  }));
  return {
    interactionId,
    type: 'Hover',
    endState: 'completed',
    triggerEvent: evt('mouseenter', `enter-${interactionId}`, timestamp),
    memberEvents: [],
    metadata: {},
    behavioralEvidence: {
      sourceEventId: `enter-${interactionId}`,
      sourceEventType: 'mouseenter',
      windowId: `w-${interactionId}`,
      window: {
        openedAt: timestamp,
        openedBatch,
        closedAt: timestamp + durationMs,
        durationMs,
        endReason: 'left',
        stabilityTrace: [],
      },
      applicationEvidence: {
        domChanges,
      },
    } as unknown as ComponentInteraction['behavioralEvidence'],
  } as unknown as ComponentInteraction;
}

function clickInteraction(
  interactionId: string,
  timestamp: number,
  openedBatch: number,
): ComponentInteraction {
  return {
    interactionId,
    type: 'Click',
    endState: 'completed',
    triggerEvent: evt('click', `click-${interactionId}`, timestamp),
    memberEvents: [],
    metadata: {},
    behavioralEvidence: {
      sourceEventId: `click-${interactionId}`,
      sourceEventType: 'click',
      window: {
        openedAt: timestamp,
        openedBatch,
        closedAt: timestamp + 500,
        durationMs: 500,
        endReason: 'idle',
        stabilityTrace: [],
      },
      applicationEvidence: { domChanges: [] },
    } as unknown as ComponentInteraction['behavioralEvidence'],
  } as unknown as ComponentInteraction;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('B7-P4 T3: ownership-safe surface-visible assertions', () => {
  it('CANONICAL: owned reveal fact → one surface-visible presence assertion', () => {
    const hover = hoverInteraction('h1', 1000, 600, 5, [
      { path: 'html > body > nav#mainnav > div#menu', batchIndex: 6 },
    ]);
    const map = deriveStepAssertions([hover]);
    const eventId = hover.triggerEvent!.eventId!;
    expect(map.has(eventId)).toBe(true);
    const assertions = map.get(eventId)!;
    expect(assertions.length).toBe(1);
    expect(assertions[0].type).toBe('presence');
    expect(assertions[0].comparison).toBe('isTrue');
    expect(assertions[0].targetCss).toBe('#menu');
    expect(assertions[0].derivedFrom).toBe('surface-visible');
    expect(assertions[0].severity).toBe('soft');
    expect(assertions[0].targetName).toBeTruthy();
  });

  it('OWNERSHIP (V1): click inside the hover span → hover owns NOTHING → no assertion', () => {
    // Channel A Variant 1: hover opens at t=1000 (openedBatch 5), the
    // revealer click lands at t=1300 inside the span (its own window
    // openedBatch 6), and the reveal fact is recorded at batch 7 — inside
    // the hover's window span but caused by the click.
    const hover = hoverInteraction('h-hover', 1000, 900, 5, [
      { path: 'html > body > div#panel', batchIndex: 7 },
    ]);
    const click = clickInteraction('c-reveal', 1300, 6);
    const map = deriveStepAssertions([hover, click]);
    const hoverEventId = hover.triggerEvent!.eventId!;
    expect(map.has(hoverEventId)).toBe(false);
  });

  it('OWNERSHIP (V2): staggered insertions into a click-revealed panel → no hover assertion', () => {
    // Channel A Variant 2: click opens the panel at t=1000 (batch 6). The
    // click's own window closes long before. A later hover (t=2600,
    // openedBatch 9) re-reports the panel's insertions at batch 10 — facts
    // living under a path the CLICK's window already owned (container
    // precedence).
    const click = clickInteraction('c-reveal', 1000, 6);
    // Give the click's window the panel insertion footprint so rule (c)
    // sees the precedent: panel path owned by the click's window.
    (click.behavioralEvidence as { applicationEvidence?: { domChanges?: unknown[] } }).applicationEvidence = {
      domChanges: [
        {
          targetPath: 'html > body > div#cpanel',
          firstBatchIndex: 7,
          addedNodesCount: 4,
          changedAttributes: [],
        },
      ],
    };
    const hover = hoverInteraction('h-late', 2600, 3200, 9, [
      { path: 'html > body > div#cpanel', batchIndex: 10, kind: 'insertion' },
    ]);
    const map = deriveStepAssertions([click, hover]);
    const hoverEventId = hover.triggerEvent!.eventId!;
    expect(map.has(hoverEventId)).toBe(false);
  });

  it('LOCATOR HONESTY: owned fact with no id-bearing path → no assertion', () => {
    const hover = hoverInteraction('h-nolocator', 1000, 600, 5, [
      { path: 'html > body > div > span', batchIndex: 6 },
    ]);
    const map = deriveStepAssertions([hover]);
    expect(map.has(hover.triggerEvent!.eventId!)).toBe(false);
  });

  it('LEGACY: window without openedBatch (pre-P4 row) → no assertion', () => {
    const hover = hoverInteraction('h-legacy', 1000, 600, 5, [
      { path: 'html > body > div#panel', batchIndex: 6 },
    ]);
    // Strip the openedBatch — legacy row.
    const w = (hover.behavioralEvidence as unknown as { window: Record<string, unknown> }).window;
    delete w.openedBatch;
    const map = deriveStepAssertions([hover]);
    expect(map.has(hover.triggerEvent!.eventId!)).toBe(false);
  });

  it('CAP: at most 3 surface-visible assertions per hover step', () => {
    const hover = hoverInteraction('h-cap', 1000, 600, 5, [
      { path: 'html > body > div#a1', batchIndex: 6 },
      { path: 'html > body > div#a2', batchIndex: 6 },
      { path: 'html > body > div#a3', batchIndex: 6 },
      { path: 'html > body > div#a4', batchIndex: 6 },
      { path: 'html > body > div#a5', batchIndex: 6 },
    ]);
    const map = deriveStepAssertions([hover]);
    const assertions = map.get(hover.triggerEvent!.eventId!)!;
    expect(assertions.length).toBe(3);
    expect(assertions.every((a) => a.derivedFrom === 'surface-visible')).toBe(true);
  });

  it('NON-HOVER UNCHANGED: a Click with resultingState derives as before (no hover gate side effect)', () => {
    // The gate removal must not change non-hover derivation. A click with
    // a resulting-state snapshot (the pre-existing path) still derives.
    const click = clickInteraction('c-snap', 1000, 5);
    (click.behavioralEvidence as {
      applicationEvidence?: { resultingState?: unknown };
    }).applicationEvidence = {
      resultingState: {
        url: 'https://shop.example.com/cart',
        viewId: null,
        items: [
          {
            kind: 'status-badge',
            matchedSelector: '#badge',
            text: 'Saved',
            numericValue: null,
            entityId: null,
            entityType: null,
            domPath: 'DIV#badge',
            attributes: {},
            visible: true,
          },
        ],
        itemsOverflow: 0,
        scannedAt: 1234.5,
        scanDurationMs: 8,
      },
    };
    const map = deriveStepAssertions([click]);
    const assertions = map.get(click.triggerEvent!.eventId!)!;
    expect(assertions.length).toBe(1);
    expect(assertions[0].derivedFrom).toBe('status-badge');
  });

  it('OTHER HOVER EVIDENCE: hover with resultingState snapshot but NO owned facts derives NOTHING', () => {
    // The amendment scopes hover derivation to owned facts only: a hover
    // with no owned facts mints nothing — even when a legacy snapshot
    // rides its evidence. Honest silence beats unverified derivation
    // (the P1 rationale — hover evidence never promised snapshot kinds).
    const hover = hoverInteraction('h-snaponly', 1000, 600, 5, []);
    (hover.behavioralEvidence as {
      applicationEvidence?: { resultingState?: unknown };
    }).applicationEvidence = {
      resultingState: {
        url: 'https://shop.example.com/cart',
        viewId: null,
        items: [
          {
            kind: 'status-badge',
            matchedSelector: '#badge',
            text: 'Saved',
            numericValue: null,
            entityId: null,
            entityType: null,
            domPath: 'DIV#badge',
            attributes: {},
            visible: true,
          },
        ],
        itemsOverflow: 0,
        scannedAt: 1234.5,
        scanDurationMs: 8,
      },
    };
    const map = deriveStepAssertions([hover]);
    expect(map.has(hover.triggerEvent!.eventId!)).toBe(false);
  });
});
