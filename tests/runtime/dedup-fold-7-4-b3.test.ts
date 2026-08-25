/**
 * 7.4-B3 S2 — Dedup fold, not resurrection.
 *
 * F1: a duplicate click within DEDUP_WINDOW_MS currently suppresses the
 * interaction and releaseClaims the ledger entry → the Projection Engine
 * resurrects it as an Unclassified card. The card lies (the click WAS
 * recognized) and the repeat information is lost.
 *
 * S2 folds the duplicate into the prior interaction instead:
 *   - ledger disposition → 'claimed' by the PRIOR interactionId
 *   - memberEvents appended (eventId-guarded)
 *   - metadata.repeatCount incremented on the prior
 *   - the gesture's press-half (pending mousedown twin) is claimed too,
 *     so projection mints no card for either half
 *   - onDedupFold hook persists for MV3 survival
 *
 * Post-restart degradation: lastInteractionByType snapshot-lacking →
 * suppress-and-release (current behavior) — pinned as the honest fallback.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
import type { ComponentDefinition, ComponentInteraction } from '../../src/shared/component-types';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { makeObservedEvent } from '../helpers/make-event';

// ── Fixture definitions ────────────────────────────────────────────────

function makeClickDef(): ComponentDefinition {
  return {
    type: 'Click',
    priority: 180,
    triggerEventTypes: new Set(['click', 'contextmenu']),
    detectTrigger(event) {
      const t = event.target.tag;
      if (t === 'BUTTON' || t === 'A' || t === 'INPUT' || t === 'SELECT') {
        return { type: 'Click' };
      }
      return null;
    },
    isInScope() {
      return false; // immediate completion
    },
    handleEvent() {
      return { endState: 'completed' as const };
    },
    shouldCancelOnOutside() {
      return false;
    },
    buildResult(ctx) {
      return {
        metadata: {
          targetName: ctx.trigger.accessibleName,
          targetTag: ctx.trigger.tag,
        },
      };
    },
  };
}

const btn = { tag: 'BUTTON', accessibleName: 'Save', cssSelector: '#save', elementId: 'save' };

// SW-parity helper: the service worker appends to the ledger BEFORE
// runtime.process — unit tests must do the same for disposition pins.
function processEvent(
  runtime: ReturnType<typeof createRuntime>,
  ledger: EvidenceLedger,
  event: ReturnType<typeof makeObservedEvent>,
): void {
  ledger.append(event);
  runtime.process(event);
}

function clickEvent(eventId: string, ts: number) {
  return makeObservedEvent({
    eventId,
    eventType: 'click',
    timestamp: ts,
    captureSeq: ts,
    target: btn as any,
  });
}

function mousedownEvent(eventId: string, ts: number) {
  return makeObservedEvent({
    eventId,
    eventType: 'mousedown',
    timestamp: ts,
    captureSeq: ts,
    target: btn as any,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('7.4-B3 S2: dedup fold, not resurrection', () => {
  it('S2-1: two clicks same element within window → ONE interaction, repeatCount 1', () => {
    const ledger = new EvidenceLedger();
    const emitted: ComponentInteraction[] = [];
    const runtime = createRuntime([makeClickDef()], {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
    });

    processEvent(runtime, ledger, clickEvent('evt-1-1', 1000));
    processEvent(runtime, ledger, mousedownEvent('evt-1-2', 2500));
    processEvent(runtime, ledger, clickEvent('evt-1-3', 2580));

    expect(emitted.length).toBe(1); // first click only
    expect(emitted[0].metadata.repeatCount).toBe(1); // fold recorded
    expect(emitted[0].memberEvents.map((e) => e.eventId)).toEqual(
      expect.arrayContaining(['evt-1-3']),
    );
  });

  it('S2-2: folded click ledger disposition claimed by prior interactionId', () => {
    const ledger = new EvidenceLedger();
    const emitted: ComponentInteraction[] = [];
    const runtime = createRuntime([makeClickDef()], {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
    });

    processEvent(runtime, ledger, clickEvent('evt-2-1', 1000));
    processEvent(runtime, ledger, clickEvent('evt-2-2', 2000)); // within 2s → dup

    const e2 = ledger.get('evt-2-2')!;
    expect(e2.disposition).toBe('claimed');
    expect(e2.claimedBy).toBe(emitted[0].interactionId);
    expect(e2.claimType).toBe('Click');
  });

  it('S2-2b: folded gesture mousedown twin also claimed by prior', () => {
    const ledger = new EvidenceLedger();
    const emitted: ComponentInteraction[] = [];
    const runtime = createRuntime([makeClickDef()], {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
    });

    processEvent(runtime, ledger, clickEvent('evt-3-1', 1000));
    processEvent(runtime, ledger, mousedownEvent('evt-3-2', 2500));
    processEvent(runtime, ledger, clickEvent('evt-3-3', 2580));

    const md = ledger.get('evt-3-2')!;
    expect(md.disposition).toBe('claimed');
    expect(md.claimedBy).toBe(emitted[0].interactionId);
  });

  it('S2-3: M5 self-consistency — every discrete ledger entry represented', () => {
    const ledger = new EvidenceLedger();
    const emitted: ComponentInteraction[] = [];
    const runtime = createRuntime([makeClickDef()], {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
    });

    processEvent(runtime, ledger, clickEvent('evt-4-1', 1000));
    processEvent(runtime, ledger, mousedownEvent('evt-4-2', 2500));
    processEvent(runtime, ledger, clickEvent('evt-4-3', 2580));

    const represented = new Set<string>();
    for (const i of emitted) {
      if (i.triggerEvent?.eventId) represented.add(i.triggerEvent.eventId);
      for (const ev of i.memberEvents ?? []) represented.add(ev.eventId);
    }
    for (const entry of ledger.getEntries()) {
      expect(represented.has(entry.eventId)).toBe(true);
    }
  });

  it('S2-4: onDedupFold hook called (MV3 persist pin)', () => {
    const ledger = new EvidenceLedger();
    const emitted: ComponentInteraction[] = [];
    const onDedupFold = vi.fn();
    const runtime = createRuntime([makeClickDef()], {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
      onDedupFold,
    });

    processEvent(runtime, ledger, clickEvent('evt-5-1', 1000));
    processEvent(runtime, ledger, clickEvent('evt-5-2', 2000));

    expect(onDedupFold).toHaveBeenCalledTimes(1);
    expect(onDedupFold.mock.calls[0][0].interactionId).toBe(emitted[0].interactionId);
  });

  it('S2-4b: onDedupFold receives the suppressed lifecycle ctx (binding-release pin)', () => {
    const ledger = new EvidenceLedger();
    const emitted: ComponentInteraction[] = [];
    const onDedupFold = vi.fn();
    const runtime = createRuntime([makeClickDef()], {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
      onDedupFold,
    });

    processEvent(runtime, ledger, clickEvent('evt-5b-1', 1000));
    processEvent(runtime, ledger, clickEvent('evt-5b-2', 2000));

    expect(onDedupFold).toHaveBeenCalledTimes(1);
    // arg 0 = prior interaction (already pinned by S2-4)
    expect(onDedupFold.mock.calls[0][0].interactionId).toBe(emitted[0].interactionId);
    // arg 1 = suppressed lifecycle ctx: the wiring contract the RCA fix
    // (stale-lifecycleBindings leak) depends on. The suppressed lifecycle's
    // FINALIZE_EVIDENCE releases its EvidenceCollector binding — without
    // this ctx the binding leaks and holds later windows open.
    const suppressedCtx = onDedupFold.mock.calls[0][1];
    expect(suppressedCtx).toBeDefined();
    expect(suppressedCtx.type).toBe('Click');
    expect(suppressedCtx.triggerEvent?.eventId ?? suppressedCtx.triggerEvent.eventId).toBe('evt-5b-2');
  });

  it('S2-7: synthetic ledger entry does NOT break twin recovery (RCA pin, reviewer Critical #1)', () => {
    // Regression shape from the b3-full-final census run: a synthetic S3
    // 'change' entry minted BEFORE the repeat-click gesture used to sort
    // AFTER every real entry of its page (its eventId broke
    // extractPageId), so the twin scan hit it first and broke — the
    // mousedown half-card resurrected as Unclassified. The synthetic id
    // must now parse to the same pageId and sort among real entries.
    const ledger = new EvidenceLedger();
    const emitted: ComponentInteraction[] = [];
    const runtime = createRuntime([makeClickDef()], {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
    });

    // Real gesture 1 (emits).
    processEvent(runtime, ledger, mousedownEvent('evt-8-1', 1000));
    processEvent(runtime, ledger, clickEvent('evt-8-2', 1080));

    // Synthetic S3 entry in the SAME page, appended mid-session (mints via
    // appendSynthetic directly — sw-integration is not under test here,
    // only the ledger-ordering interaction with foldIntoPrior).
    ledger.appendSynthetic({
      eventId: 'evt-8-1000000000',
      eventType: 'change' as never,
      timestamp: 1200,
      captureSeq: 1200,
      isTrusted: true,
      target: btn as never,
      domContext: { ancestorRoles: [], ancestorClasses: [] } as never,
      valueAfter: 'hotel',
    } as never);

    // Real gesture 2 (dedup-folds into gesture 1; its mousedown twin is
    // the entry that must be claimed, not resurrected).
    processEvent(runtime, ledger, mousedownEvent('evt-8-3', 2000));
    processEvent(runtime, ledger, clickEvent('evt-8-4', 2080));

    // Twin claimed by the fold: no pending mousedown remains, and the
    // synthetic entry is untouched (still pending — it is not part of any
    // gesture).
    const twin = ledger.get('evt-8-3')!;
    expect(twin.disposition).toBe('claimed');
    expect(twin.claimedBy).toBe(emitted[0].interactionId);
    expect(ledger.get('evt-8-1000000000')!.disposition).toBe('pending');
    // Fold members carry the twin.
    const memberIds = (emitted[0].memberEvents ?? []).map((e) => e.eventId);
    expect(memberIds).toContain('evt-8-3');
    expect((emitted[0].metadata as { repeatCount?: number }).repeatCount).toBe(1);
  });

  it('S2-5: post-restart degradation — no prior interaction available → suppress-and-release (honest Unclassified)', () => {
    const ledger = new EvidenceLedger();
    const emitted: ComponentInteraction[] = [];
    // Simulate post-restart: runtime restored WITHOUT liveInteractionByType
    // (snapshot serializes dedup metadata only). The dedup record still
    // matches, but the fold target is gone → the old behavior is the honest
    // fallback: suppress + releaseClaims.
    const runtime = createRuntime([makeClickDef()], {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
    });

    // First click emits normally
    processEvent(runtime, ledger, clickEvent('evt-6-1', 1000));
    expect(emitted.length).toBe(1);

    // Simulate restart: drop the fold index (as restore() would)
    (runtime as any).lastInteractionByType?.clear?.();

    processEvent(runtime, ledger, clickEvent('evt-6-2', 2000));
    const e2 = ledger.get('evt-6-2')!;
    // Degradation: no live prior → old releaseClaims path
    expect(e2.disposition).toBe('unclaimed');
    expect(emitted.length).toBe(1);
  });

  it('S2-6: abandoned/interrupted releaseClaims paths untouched (R4)', () => {
    // A definition that cancels on outside events → abandoned → released.
    const ledger = new EvidenceLedger();
    const emitted: ComponentInteraction[] = [];

    const dropdownDef: ComponentDefinition = {
      type: 'Dropdown',
      priority: 20,
      triggerEventTypes: new Set(['click']),
      detectTrigger(event) {
        if (event.target.tag === 'DIV' && event.domContext?.ancestorRoles?.length) {
          return { type: 'Dropdown' };
        }
        return null;
      },
      isInScope(event, ctx) {
        // Mirror real Dropdown: trigger element itself or semantic child.
        return (event.target as any).cssSelector === (ctx.trigger as any).cssSelector || event.target.ariaRole === 'option';
      },
      handleEvent() {
        return null; // stay active
      },
      shouldCancelOnOutside() {
        return true;
      },
      buildResult(ctx) {
        return { metadata: { targetName: ctx.trigger.accessibleName } };
      },
    };

    const runtime = createRuntime([dropdownDef, makeClickDef()], {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
    });

    // Open dropdown lifecycle
    processEvent(
      runtime,
      ledger,
      makeObservedEvent({
        eventId: 'evt-7-1',
        eventType: 'click',
        timestamp: 1000,
        captureSeq: 1000,
        target: { tag: 'DIV', accessibleName: 'trigger', cssSelector: '#dd' } as any,
        domContext: {
          ancestorRoles: ['combobox'],
          ancestorClasses: [],
        } as any,
      }),
    );

    // Click outside → shouldCancelOnOutside → abandoned → releaseClaims
    processEvent(runtime, ledger, clickEvent('evt-7-2', 3000));

    const trigger = ledger.get('evt-7-1')!;
    // The abandoned path emits with endState 'abandoned' (production filter
    // drops it downstream); the ledger releaseClaims is the R4-protected
    // invariant: unclaimed → honest Unclassified at projection.
    expect(trigger.disposition).toBe('unclaimed');
    const abandoned = emitted.filter((i) => i.type === 'Dropdown');
    expect(abandoned.length).toBe(1);
    expect(abandoned[0].endState).toBe('abandoned');
  });
});
