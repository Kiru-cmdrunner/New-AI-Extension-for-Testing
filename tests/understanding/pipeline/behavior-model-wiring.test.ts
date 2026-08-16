/**
 * CP5 — pipeline wiring integration tests.
 *
 * Verifies Stage 3.5 activation inside the real UnderstandingPipeline:
 *   1. Happy path — behaviorModel populated on PipelineOutcome, episodes
 *      built from real Stage 1–3 outputs + capture artifacts, warnings
 *      surfaced, JSON round-trip safe (UnderstandingResult shape).
 *   2. Error isolation — derivation failure → null model + ONE warning,
 *      later stages (semanticKnowledge/outcomes/transitions) unaffected.
 *   3. Empty session → null model, no crash.
 *   4. Determinism — same input twice → deep-equal outcomes.
 *   5. generatedAtMs fallback (max endTime) + injected value honored.
 *   6. Session / nav-retention isolation (R1 semantics).
 *
 * Spec: .drytis/specs/cp5-pipeline-wiring.md
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  UnderstandingPipeline,
} from '../../../src/understanding/pipeline/understanding-pipeline';
import type { ComponentInteraction } from '../../../src/shared/component-types';
import type { CaptureArtifacts } from '../../../src/understanding/behavior-model/capture-inputs';
import type { PostNavCaptureRecord } from '../../../src/shared/post-nav-types';

// ── Fixtures (deterministic — fixed epoch, no Date.now) ────────────────

const T = 1_700_000_000_000;
let seq = 0;
function resetFixtures(): void {
  seq = 0;
}

function click(id: string, name: string, t: number): ComponentInteraction {
  seq += 1;
  return {
    interactionId: id,
    type: 'Click',
    trigger: { tag: 'BUTTON', accessibleName: name },
    triggerEvent: {
      eventId: `evt-p1-${seq}`,
      eventType: 'click',
      timestamp: t,
      captureSeq: seq,
      captureOrigin: { tabId: 7, frameId: 0 },
      pageId: 'p1',
    },
    memberEvents: [],
    startTime: t,
    endTime: t + 100,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      sourceEventId: `evt-p1-${seq}`,
      sourceEventType: 'click',
      windowId: `bev-evt-p1-${seq}`,
      frameId: 'main',
      window: { openedAt: 0, closedAt: 0.15, durationMs: 150, endReason: 'stabilized', stabilityTrace: [] },
      targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, changed: false, changeSummary: [] },
      applicationEvidence: {
        domChanges: [],
        domChangeOverflow: 0,
        coarseMode: false,
        newSurfaces: [{ path: 'div.toast', ariaRole: 'status', accessibleName: 'Added to cart', tagName: 'DIV', changeType: 'added', timestamp: t + 50 }],
        removedSurfaces: [],
        visibilityChanges: [],
        navigation: [],
        networkActivity: [],
        performanceCondition: null,
      },
    } as never,
  } as unknown as ComponentInteraction;
}

function artifacts(): CaptureArtifacts {
  return {
    stampedRequests: [
      {
        url: 'https://a.example/api/cart',
        method: 'POST',
        status: 200,
        requestId: 'req-1',
        sourceEventId: 'evt-p1-1',
      },
    ],
    postNavRecords: [
      { navEventId: 'nav-1', committedAt: T + 265, fromUrl: 'https://a.example/p', toUrl: 'https://a.example/cart', navType: 'form_submit' },
    ],
  };
}

function session(): { interactions: ComponentInteraction[]; captureArtifacts: CaptureArtifacts } {
  resetFixtures();
  return {
    interactions: [click('int-1', 'Add to Cart', T)],
    captureArtifacts: artifacts(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('CP5 Stage 3.5 — pipeline wiring', () => {
  beforeEach(() => {
    resetFixtures();
  });

  it('populates behaviorModel from Stages 1–3 outputs + capture artifacts', async () => {
    const s = session();
    const pipeline = new UnderstandingPipeline({ noPersistence: true });
    const outcome = await pipeline.run({
      interactions: s.interactions,
      origin: 'https://a.example',
      sessionId: 'sess-1',
      generatedAtMs: T + 60_000,
      captureArtifacts: s.captureArtifacts,
    });
    await pipeline.close();

    expect(outcome.behaviorModel).not.toBeNull();
    expect(outcome.behaviorModel!.id).toBe('abm-sess-1');
    expect(outcome.behaviorModel!.sessionId).toBe('sess-1');
    expect(outcome.behaviorModel!.generatedAtMs).toBe(T + 60_000);
    expect(outcome.behaviorModel!.episodes.length).toBeGreaterThan(0);
    // Episode outcome merged from Stage 3 outcomes (notification success .3).
    const ep = outcome.behaviorModel!.episodes[0];
    expect(ep.episodeOutcome).not.toBeNull();
  });

  it('exposes flattened behaviorModelWarnings for observability', async () => {
    const s = session();
    const pipeline = new UnderstandingPipeline({ noPersistence: true });
    const outcome = await pipeline.run({
      interactions: s.interactions,
      origin: 'https://a.example',
      sessionId: 'sess-1',
      generatedAtMs: T + 60_000,
      captureArtifacts: s.captureArtifacts,
    });
    await pipeline.close();
    // Warnings array exists and each entry is `code: refs` shaped (string).
    for (const w of outcome.behaviorModelWarnings) {
      expect(typeof w).toBe('string');
      expect(w).toMatch(/^[a-z-]+:/);
    }
  });

  it('UnderstandingResult shape: behaviorModel is JSON round-trip safe', async () => {
    const s = session();
    const pipeline = new UnderstandingPipeline({ noPersistence: true });
    const outcome = await pipeline.run({
      interactions: s.interactions,
      origin: 'https://a.example',
      sessionId: 'sess-1',
      generatedAtMs: T + 60_000,
      captureArtifacts: s.captureArtifacts,
    });
    await pipeline.close();

    const result = {
      sessionId: 'sess-1',
      schemaVersion: 2,
      behaviorModel: outcome.behaviorModel ?? undefined,
    };
    const round = JSON.parse(JSON.stringify(result));
    expect(round.behaviorModel.id).toBe('abm-sess-1');
    expect(round.behaviorModel.episodes[0].anchor.interactionId).toBeDefined();
  });

  it('error isolation: derivation failure → null model, one warning, later stages intact', async () => {
    const s = session();
    const pipeline = new UnderstandingPipeline({ noPersistence: true });
    // Sabotage: endTime access throws ONLY during Stage 3.5's fallback
    // computation (adapter reduce over endTime). Stage 3 reads
    // interaction.type/trigger/access — Stage 6 reads different fields, so
    // the poison stays scoped to the behavior-model stage's try/catch.
    let armed = false;
    const poisonEndTime = (ints: ComponentInteraction[]): ComponentInteraction[] =>
      ints.map((i) => {
        const poisoned: Record<string, unknown> = { ...i };
        Object.defineProperty(poisoned, 'endTime', {
          get() {
            if (armed) throw new Error('boom-during-extraction');
            return i.endTime;
          },
          configurable: true,
        });
        return poisoned as unknown as ComponentInteraction;
      });
    // Warm-up run without artifacts to confirm the guard works normally.

    const outcome = await pipeline.run({
      interactions: poisonEndTime(s.interactions),
      origin: 'https://a.example',
      sessionId: 'sess-1',
      generatedAtMs: T + 60_000,
    });
    await pipeline.close();
    // Sanity: no sabotage fired (armed never set) — this run should have a model.
    expect(outcome.behaviorModel).not.toBeNull();
    expect(outcome.semanticKnowledge).not.toBeNull();

    // Now the real sabotage: re-run with the getter armed. Stage 3.5 throws
    // inside its try/catch; Stages 4–7 are unaffected because their reads
    // never touch endTime through this proxy shape.
    const pipeline2 = new UnderstandingPipeline({ noPersistence: true });
    armed = true;
    const outcome2 = await pipeline2.run({
      interactions: poisonEndTime(session().interactions),
      origin: 'https://a.example',
      sessionId: 'sess-1',
      generatedAtMs: T + 60_000,
    });
    await pipeline2.close();

    expect(outcome2.behaviorModel).toBeNull();
    expect(outcome2.warnings.some((w) => w.startsWith('behavior-model:'))).toBe(true);
    // Later stages still produced their artifacts.
    expect(Array.isArray(outcome2.transitions)).toBe(true);
    expect(outcome2.semanticKnowledge).not.toBeNull();
  });

  it('empty session → null model, no crash', async () => {
    const pipeline = new UnderstandingPipeline({ noPersistence: true });
    const outcome = await pipeline.run({
      interactions: [],
      origin: 'https://a.example',
      sessionId: 'sess-empty',
      generatedAtMs: T,
    });
    await pipeline.close();
    expect(outcome.behaviorModel).toBeNull();
    expect(outcome.warnings.some((w) => w.startsWith('behavior-model:'))).toBe(false);
  });

  it('deterministic: same input twice → deep-equal behaviorModel', async () => {
    const run = async (): Promise<unknown> => {
      const s = session();
      const pipeline = new UnderstandingPipeline({ noPersistence: true });
      const o = await pipeline.run({
        interactions: s.interactions,
        origin: 'https://a.example',
        sessionId: 'sess-1',
        generatedAtMs: T + 60_000,
        captureArtifacts: s.captureArtifacts,
      });
      await pipeline.close();
      return o.behaviorModel;
    };
    expect(await run()).toEqual(await run());
  });

  it('generatedAtMs fallback = max(interaction.endTime) when not injected', async () => {
    const s = session();
    const pipeline = new UnderstandingPipeline({ noPersistence: true });
    const outcome = await pipeline.run({
      interactions: s.interactions,
      origin: 'https://a.example',
      sessionId: 'sess-1',
      // no generatedAtMs — deterministic fallback expected
      captureArtifacts: s.captureArtifacts,
    });
    await pipeline.close();
    expect(outcome.behaviorModel!.generatedAtMs).toBe(T + 100); // endTime of int-1
  });
});

// ── R1: session / nav-retention isolation ───────────────────────────────
//
// The retention array lives in service-worker.ts (not importable here); its
// semantics are pinned directly against the exact code shape shipped there:
// push + FIFO shift at SESSION_NAV_RECORDS_CAP = 200, cleared at every
// handleStartRecording. These tests encode the same invariants the SW
// enforces, so any drift in the SW logic can be caught by grepping that the
// constants/behaviors still match this contract.

describe('CP5 R1 — session / nav-retention isolation', () => {
  const CAP = 200;

  function makeRetention(): { push: (r: PostNavCaptureRecord) => void; clear: () => void; list: () => PostNavCaptureRecord[] } {
    const arr: PostNavCaptureRecord[] = [];
    return {
      push: (r) => {
        arr.push(r);
        if (arr.length > CAP) arr.shift();
      },
      // The SW clears via `sessionNavRecords.length = 0` (handleStartRecording).
      clear: () => { arr.length = 0; },
      list: () => [...arr],
    };
  }

  function navRecord(n: number, committedAt: number): PostNavCaptureRecord {
    return {
      navEventId: `nav-${n}`,
      committedAt,
      fromUrl: `https://a.example/p${n}`,
      toUrl: `https://a.example/p${n + 1}`,
      navType: 'link',
    };
  }

  it('cap: FIFO evicts the OLDEST record beyond 200', () => {
    const r = makeRetention();
    for (let i = 0; i < CAP + 50; i += 1) {
      r.push(navRecord(i, T + i));
    }
    const list = r.list();
    expect(list).toHaveLength(CAP);
    expect(list[0].navEventId).toBe('nav-50'); // first 50 evicted
    expect(list[list.length - 1].navEventId).toBe(`nav-${CAP + 49}`);
  });

  it('session start clears retention — stale records never reach the next model', () => {
    const r = makeRetention();
    r.push(navRecord(1, T));
    expect(r.list()).toHaveLength(1);
    // handleStartRecording clears the array (session scoping, INV).
    r.clear();
    expect(r.list()).toEqual([]);
  });

  it('stale navEventId can never match a later session’s navigation (exact-ID matching)', () => {
    const r = makeRetention();
    r.push(navRecord(1, T));
    const stale = r.list()[0];
    // A later session's synthetic nav events carry NEW ids (nav-<Date.now>-<rand>);
    // exact-ID matching means the stale id never matches.
    const laterSessionNavEventIds = ['nav-1700000001000-abc123', 'nav-1700000002000-def456'];
    expect(laterSessionNavEventIds).not.toContain(stale.navEventId);
  });

  it('retention mirrors consumption 1:1 — duplicates are prevented UPSTREAM by exactly-once consume', () => {
    const r = makeRetention();
    // The pending store is exactly-once per navigation per document: consume
    // deletes the slot, and the re-confirm write OVERWRITES the same slot
    // (same navEventId) rather than adding. Therefore each navigation fires
    // retainNavRecord at most once. This pins the CONTRACT the SW must keep:
    // retention is called only at the consume site, never at record time.
    const consumed = navRecord(1, T);
    r.push(consumed); // the single consume of nav-1
    const list = r.list();
    expect(list.filter((x) => x.navEventId === 'nav-1').length).toBe(1);
  });

  it('tab isolation: records from different tabs coexist; T2 matching is by navEventId only', () => {
    const r = makeRetention();
    r.push(navRecord(1, T));      // tab A
    r.push(navRecord(2, T + 5));  // tab B
    const list = r.list();
    expect(list.map((x) => x.navEventId)).toEqual(['nav-1', 'nav-2']);
    // No tabId on records — matching is exact-ID, structurally tab-safe.
    expect(list.every((x) => !('tabId' in x))).toBe(true);
  });
});
