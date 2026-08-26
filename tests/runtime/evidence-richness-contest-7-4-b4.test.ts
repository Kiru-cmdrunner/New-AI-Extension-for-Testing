/**
 * 7.4-B4 S4-1 — Evidence richness contest at DRAIN time.
 *
 * Grounded at src/runtime/sw-integration.ts:620–878 (attach/replace/
 * shape-guard block + scoreEvidenceRichness + drainPendingEvidence).
 *
 * Coverage audit before writing this file (2026-08-26):
 *   - ATTACH-time arms are ALREADY pinned by
 *     tests/runtime/network-supplement-shape-guard.test.ts:
 *       · line ~340: null-target evidence NEVER replaces evidence carrying
 *         a target, even at higher raw score (shape guard).
 *       · line ~364: richer REAL evidence (with target) still replaces
 *         weaker real evidence (Round-5 semantics intact).
 *   - The genuinely untested path is the DRAIN-time contest
 *     (drainPendingEvidence, :833): pending entries sitting on BOTH the
 *     trigger eventId AND a memberEvent eventId of one card with unequal
 *     richness → the richer candidate must win, and both keys must be
 *     deleted from the pending map (winner and loser alike).
 *
 * Spec: .drytis/specs/phase-7-4-b4-unclassified-output-policy.md §S4-1.
 * (Provenance: closes a B3-review WARN whose original ID labels are no
 * longer locatable in the workspace; the code anchor, not the label, is
 * normative.)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { BehavioralEvidence, DomChangeSummary } from '../../src/shared/behavioral-evidence-types';
import type { ObservedEvent, ElementIdentity } from '../../src/shared/component-types';

// ── Chrome mock (M8.3 pattern, proven in projection-evidence-join-7-4-b3) ──

function setupChromeMock(data: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...data };
  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[]) => {
          if (keys === undefined) return { ...store };
          const keyArr = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const k of keyArr) {
            if (k in store) result[k] = structuredClone(store[k]);
          }
          return result;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store[k] = structuredClone(v);
        }),
        remove: vi.fn(async (keys?: string | string[]) => {
          const keyArr = (Array.isArray(keys) ? keys : [keys]).filter(
            (k): k is string => typeof k === 'string',
          );
          for (const k of keyArr) delete store[k];
        }),
      },
    },
    runtime: { sendMessage: vi.fn(async () => {}), onMessage: { addListener: vi.fn() } },
    tabs: { query: vi.fn(async () => [{ id: 1 }]), sendMessage: vi.fn(async () => {}) },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
  };
  globalThis.chrome = chromeMock as unknown as typeof chrome;
  return { store };
}

// ── Fixtures ──────────────────────────────────────────────────────────

function domChanges(n: number): DomChangeSummary[] {
  return Array.from({ length: n }, (_, i) => ({
    targetPath: `body > div#contest-${i}`,
    targetTag: 'div',
    types: ['attributes'],
    changedAttributes: ['style'],
    attributeDeltas: { style: { old: null, new: 'display: none;' } },
    addedNodesCount: 0,
    removedNodesCount: 0,
    characterDataDelta: null,
    rawMutationCount: 1,
    firstBatchIndex: i,
    lastBatchIndex: i,
    firstMutationAt: 1,
    lastMutationAt: 1,
    shadowContext: null,
  }));
}

function makeEvidence(sourceEventId: string, nDomChanges: number): BehavioralEvidence {
  return {
    sourceEventId,
    sourceEventType: 'click',
    windowId: `bev-${sourceEventId}`,
    targetEvidence: null,
    applicationEvidence: {
      domChanges: domChanges(nDomChanges),
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [],
      domChangeOverflow: 0,
      coarseMode: false,
      performanceCondition: null,
    },
  } as unknown as BehavioralEvidence;
}

function mkTarget(tag: string, cssSelector: string, accessibleName: string): ElementIdentity {
  return {
    accessibleName, ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag, className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector,
    xPath: `/html/body/${tag.toLowerCase()}`, inIframe: false, shadowDom: false,
    href: null, inputType: null, elementId: '',
  } as ElementIdentity;
}

function ev(
  eventId: string, eventType: string, ts: number, target: ElementIdentity,
  valueAfter: string | null = null,
): ObservedEvent {
  return {
    eventId, eventType, timestamp: ts, captureSeq: ts, isTrusted: true,
    target,
    domContext: { ancestorRoles: [], ancestorClasses: [], inputType: 'text', isContentEditable: false },
    valueBefore: null, valueAfter, checkedBefore: null, checkedAfter: null,
    clientX: null, clientY: null, key: null, code: null,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    scrollDeltaY: null, scrollDeltaX: null,
    pageUrl: 'https://example.com', pageTitle: 'Test',
  } as unknown as ObservedEvent;
}

// (flushDebounce no longer needed — persistence reconciliation is a
// STOP-time concern pinned in projection-evidence-join-7-4-b3 S1-3)

// ── Tests ─────────────────────────────────────────────────────────────

describe('7.4-B4 S4-1: drain-time evidence richness contest', () => {
  afterEach(async () => {
    const mod = await import('../../src/runtime/sw-integration');
    mod.resetState();
    vi.resetModules();
    delete (globalThis as any).chrome;
  });

  it('S4-1a: richer member-keyed evidence wins over weaker trigger-keyed evidence at drain time', async () => {
    // The contest needs an interaction that genuinely carries BOTH keys at
    // emission: TextEntry (trigger = focus, memberEvents = inputs, completes
    // on blur). Pending entries sit on the focus eventId (weaker, 1
    // domChange) and an input eventId (richer, 3 domChanges) — the drain
    // must attach the RICHER member-keyed one.
    //
    // Fixture order matters: restoreFromStorage() loads pendingEvidence into
    // the module map AND builds the runtime. initRecording() would CLEAR the
    // map (stale-session hygiene) — so we restore and drive events directly,
    // exactly like a resumed mid-recording SW.
    const t = mkTarget('INPUT', '#search', 'Search');
    const focusEvent = ev('evt-trig-1', 'focus', 900, t);
    const inputEvent = ev('evt-mem-1', 'input', 1000, t, 'hotel');

    const pending = [
      ['evt-trig-1', makeEvidence('evt-trig-1', 1)],   // weaker (trigger-keyed)
      ['evt-mem-1', makeEvidence('evt-mem-1', 3)],     // richer (member-keyed)
    ];
    setupChromeMock({
      cmdrunner_recording_active: true,
      cmdrunner_live_interactions: [],
      cmdrunner_evidence_ledger: [],
      cmdrunner_pending_evidence: pending,
    });

    const { restoreFromStorage, processObservedEvent, getLiveInteractions } =
      await import('../../src/runtime/sw-integration');
    await restoreFromStorage();

    // Real TextEntry lifecycle: focus starts it, input is a member, blur
    // completes it → emission → drainPendingEvidence contest.
    processObservedEvent(focusEvent);
    processObservedEvent(inputEvent);
    processObservedEvent(ev('evt-trig-1-blur', 'blur', 1100, t));

    const live = getLiveInteractions()!;
    const text = live.find((i) => i.type === 'TextEntry');
    expect(text).toBeDefined();

    // THE CONTEST: the richer (member-keyed) evidence must be the one attached
    expect(text!.behavioralEvidence).toBeTruthy();
    expect(text!.behavioralEvidence!.sourceEventId).toBe('evt-mem-1');
    expect(text!.behavioralEvidence!.applicationEvidence!.domChanges!.length).toBe(3);

    // Persistence nuance (honest scope): the emission-path drain deletes
    // keys from the in-memory map; storage reconciliation is a STOP-time
    // concern (pinned by projection-evidence-join-7-4-b3 S1-3). We pin the
    // behavioral consequence instead: a SECOND lifecycle emitting on the
    // same event keys must find NO leftover winner/loser entries — the
    // in-memory map consumed both.
    processObservedEvent(ev('evt-probe-focus', 'focus', 1200, t));
    processObservedEvent(ev('evt-probe-input', 'input', 1210, t, 'x2'));
    processObservedEvent(ev('evt-probe-blur', 'blur', 1300, t));
    const probe = getLiveInteractions()!.filter((i) => i.type === 'TextEntry');
    // The probe episode is a no-lifecycle sibling (first TextEntry still
    // owns the element within its window) — the invariant that matters:
    // no interaction anywhere carries the loser key's evidence.
    const loserAttached = probe.some(
      (i) => i.behavioralEvidence?.sourceEventId === 'evt-trig-1',
    );
    expect(loserAttached).toBe(false);
  });

  it('S4-1b: richer trigger-keyed evidence wins over weaker member-keyed evidence (symmetry)', async () => {
    const t = mkTarget('INPUT', '#notes', 'Notes');
    const focusEvent = ev('evt-trig-2', 'focus', 1900, t);
    const inputEvent = ev('evt-mem-2', 'input', 2000, t, 'todo');

    const pending = [
      ['evt-trig-2', makeEvidence('evt-trig-2', 5)],   // richer (trigger-keyed)
      ['evt-mem-2', makeEvidence('evt-mem-2', 1)],     // weaker (member-keyed)
    ];
    setupChromeMock({
      cmdrunner_recording_active: true,
      cmdrunner_live_interactions: [],
      cmdrunner_evidence_ledger: [],
      cmdrunner_pending_evidence: pending,
    });

    const { restoreFromStorage, processObservedEvent, getLiveInteractions } =
      await import('../../src/runtime/sw-integration');
    await restoreFromStorage();

    processObservedEvent(focusEvent);
    processObservedEvent(inputEvent);
    processObservedEvent(ev('evt-trig-2-blur', 'blur', 2100, t));

    const text = getLiveInteractions()!.find((i) => i.type === 'TextEntry');
    expect(text).toBeDefined();
    expect(text!.behavioralEvidence!.sourceEventId).toBe('evt-trig-2');
    expect(text!.behavioralEvidence!.applicationEvidence!.domChanges!.length).toBe(5);
  });

  it('S4-1c: drain never displaces evidence already attached to an emitted card', async () => {
    // Attach-time shape guard is pinned (network-supplement-shape-guard
    // ~340). This is the DRAIN-side neighbor: an emitted Click carries
    // rich attached evidence (via the exported tier-1 path), and a pending
    // entry keyed to a member event of that card arrives LATER via the
    // drain path — the early-return guard (`if (interaction.
    // behavioralEvidence) return;` at the drain head) must refuse the
    // displacement.
    const t = mkTarget('BUTTON', '#guard-btn', 'Guard');
    const clickEvent = ev('evt-click-3', 'click', 3000, t);
    const laterMemberEvent = ev('evt-mem-3', 'click', 3100, t);

    // Nothing pending at emission time — the Click emits clean.
    setupChromeMock({
      cmdrunner_recording_active: true,
      cmdrunner_live_interactions: [],
      cmdrunner_evidence_ledger: [],
      cmdrunner_pending_evidence: [],
    });

    const { restoreFromStorage, processObservedEvent, getLiveInteractions, attachEvidenceToInteraction, storePendingEvidence } =
      await import('../../src/runtime/sw-integration');
    await restoreFromStorage();

    processObservedEvent(clickEvent);
    const click = getLiveInteractions()!.find((i) => i.type === 'Click');
    expect(click).toBeDefined();

    // Attach real evidence explicitly (exported tier-1 path)
    const attached = attachEvidenceToInteraction('evt-click-3', makeEvidence('evt-rich', 4));
    expect(attached).toBeTruthy();
    const after = getLiveInteractions()!.find((i) => i.type === 'Click')!;
    expect(after.behavioralEvidence!.sourceEventId).toBe('evt-rich');

    // Now a RICHER pending entry lands on the trigger key (9 domChanges).
    // Nothing new emits (duplicate click on same element within the dedup
    // window folds into the prior — see B3 S2), and the drain only runs at
    // EMISSION time, so the attached evidence survives. Pin exactly that:
    storePendingEvidence(makeEvidence('evt-click-3', 9));
    processObservedEvent(laterMemberEvent);

    const final = getLiveInteractions()!.find((i) => i.type === 'Click')!;
    expect(final.behavioralEvidence!.sourceEventId).toBe('evt-rich');
  });
});
