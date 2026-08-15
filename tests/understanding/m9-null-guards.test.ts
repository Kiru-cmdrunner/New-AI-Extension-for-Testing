/**
 * M9 Null Guards — regression tests
 *
 * Two runtime failures observed in real-Chrome Amazon Add-to-cart
 * verification (int-17), root-caused in the audit:
 *
 * NG-1 `signal-extraction: Cannot read properties of null (reading 'before')`
 *   TargetStateSignalExtractor dereferenced evidence.targetEvidence before
 *   null-checking it. G3 late-network re-collect supplements legitimately
 *   carry targetEvidence: null (evidence-collector.ts:1212) and can become an
 *   interaction's FINAL evidence. The throw escaped the coordinator (no
 *   per-extractor isolation) and nulled the WHOLE Stage-1 batch — every other
 *   interaction lost its api-operation signals → no state, no outcomes,
 *   no entities.
 *
 * NG-2 `recorded-workflow-persistence: Cannot read properties of null (reading 'currentView')`
 *   UnderstandingPipeline Stage 7 guarded on `persistenceService &&
 *   semanticKnowledge` but not `finalState`, then passed `finalState!` into
 *   KnowledgePersistenceService.persist → persistViews dereferenced
 *   state.currentView (null). Stage 5 has the correct guard; Stage 7 must
 *   match it. Consequence: partial Dexie write (application row only,
 *   steps 2–10 skipped).
 *
 * Spec: .drytis/specs/m9-null-guards.md
 */

import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';

// jsdom lacks chrome.* — stub anything the import graph may touch (inert).
const listeners: Record<string, unknown[]> = {};
(globalThis as any).chrome = {
  runtime: {
    onMessage: {
      addListener: vi.fn((fn: unknown) => {
        listeners.onMessage = listeners.onMessage ?? [];
        listeners.onMessage.push(fn);
      }),
      removeListener: vi.fn(),
    },
  },
};

import { TargetStateSignalExtractor } from '../../src/understanding/signal-extractors/target-state-signals';
import { NetworkSignalExtractor } from '../../src/understanding/signal-extractors/network-signals';
import { SignalExtractionCoordinator } from '../../src/understanding/signal-extractors/signal-extractor';
import { UnderstandingPipeline } from '../../src/understanding/pipeline/understanding-pipeline';
import { createKnowledgeDatabase } from '../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../src/understanding/persistence/knowledge-repository';
import { deriveAppId } from '../../src/understanding/persistence/knowledge-persistence-service';
import type { NetworkActivity } from '../../src/shared/behavioral-evidence-types';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { TargetEvidence } from '../../src/shared/behavioral-evidence-types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeNetActivity(overrides?: Partial<NetworkActivity>): NetworkActivity {
  return {
    url: 'https://www.amazon.in/cart/add-to-cart',
    method: 'POST',
    status: 200,
    startRelativeToEvent: 10,
    endRelativeToEvent: 120,
    durationMs: 110,
    resourceType: 'xhr',
    source: 'main-world',
    ...overrides,
  };
}

function targetEvidence(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): TargetEvidence {
  return {
    identity: {
      accessibleName: 'Add to cart', ariaRole: 'button', ariaLabel: null,
      ariaLabelledBy: null, placeholder: null, tag: 'INPUT', className: null,
      name: null, stableId: null, testId: null, dataCy: null, dataQa: null,
      cssSelector: '#add-to-cart-button', xPath: '', inIframe: false,
      shadowDom: false, href: null, inputType: 'submit', elementId: 'add-to-cart-button',
    },
    identityCapturedAt: 1000,
    before: before as any,
    after: after as any,
    focusMovement: null,
  } as unknown as TargetEvidence;
}

function baseInteraction(id: string, evidence: {
  target: TargetEvidence | null;
  net?: NetworkActivity[];
}): ComponentInteraction {
  return {
    interactionId: id,
    type: 'Click',
    trigger: { kind: 'element', tagName: 'INPUT', accessibleName: 'Add to cart' },
    triggerEvent: { eventId: `evt-${id}`, eventType: 'click' },
    memberEvents: [],
    startTime: 1000,
    endTime: 1161,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      sourceEventId: `evt-${id}`,
      sourceEventType: 'click',
      windowId: `w-${id}`,
      frameId: 'main',
      window: { openedAt: 1000, closedAt: 1161, durationMs: 161, endReason: 'lifecycle-complete', stabilityTrace: [] },
      // NG-1: G3 late-network re-collect supplements deliver targetEvidence: null.
      targetEvidence: evidence.target,
      applicationEvidence: {
        domChanges: [], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [],
        networkActivity: evidence.net ?? [],
        performanceCondition: { mainThreadBlocked: false, highChurnMode: false, longestBatchMs: 0, totalBatches: 0 },
      },
    },
  } as unknown as ComponentInteraction;
}

/** Interaction whose final evidence is a G3 network-only supplement. */
function nullTargetInteraction(id: string, net?: NetworkActivity[]): ComponentInteraction {
  return baseInteraction(id, { target: null, net });
}

/** Healthy interaction: full before/after target evidence + network rows. */
function healthyInteraction(id: string): ComponentInteraction {
  return baseInteraction(id, {
    target: targetEvidence(
      { value: '1', checked: null, ariaExpanded: null, ariaChecked: null, ariaPressed: null, selectedValues: null, controlledValue: null, scrollTop: null, scrollLeft: null, textContent: null, disabled: null, visible: null },
      { value: '2', checked: null, ariaExpanded: null, ariaChecked: null, ariaPressed: null, selectedValues: null, controlledValue: null, scrollTop: null, scrollLeft: null, textContent: null, disabled: null, visible: null },
    ),
    net: [makeNetActivity()],
  });
}

// ── NG-1: TargetStateSignalExtractor null guard ────────────────────────

describe('NG-1: targetEvidence === null (target-state-signals)', () => {
  it('R1: null targetEvidence → [] and no throw', () => {
    const extractor = new TargetStateSignalExtractor();
    const interaction = nullTargetInteraction('int-null');
    expect(() => extractor.extract(interaction)).not.toThrow();
    expect(extractor.extract(interaction)).toEqual([]);
  });

  it('R3a: before-only / after-only / both-null still return []', () => {
    const extractor = new TargetStateSignalExtractor();
    const before = { value: 'a', checked: null, ariaExpanded: null, ariaChecked: null, ariaPressed: null, selectedValues: null, controlledValue: null, scrollTop: null, scrollLeft: null, textContent: null, disabled: null, visible: null };
    const after = { value: 'a', checked: null, ariaExpanded: null, ariaChecked: null, ariaPressed: null, selectedValues: null, controlledValue: null, scrollTop: null, scrollLeft: null, textContent: null, disabled: null, visible: null };

    const beforeOnly = baseInteraction('int-bo', { target: targetEvidence(before, null) });
    const afterOnly = baseInteraction('int-ao', { target: targetEvidence(null, after) });
    const bothNull = baseInteraction('int-bn', { target: targetEvidence(null, null) });

    expect(extractor.extract(beforeOnly)).toEqual([]);
    expect(extractor.extract(afterOnly)).toEqual([]);
    expect(extractor.extract(bothNull)).toEqual([]);
  });

  it('R3b: full before/after diff still emits input-value-change (no behavior change)', () => {
    const extractor = new TargetStateSignalExtractor();
    const interaction = healthyInteraction('int-full');
    const signals = extractor.extract(interaction);
    const valueChange = signals.find((s) => s.type === 'input-value-change');
    expect(valueChange).toBeDefined();
    expect((valueChange as any).oldValue).toBe('1');
    expect((valueChange as any).newValue).toBe('2');
  });

  it('R2: one null-target interaction does NOT kill the batch — the healthy interaction keeps its api-operation signals', () => {
    const coordinator = new SignalExtractionCoordinator();
    coordinator.register(new NetworkSignalExtractor());
    coordinator.register(new TargetStateSignalExtractor());

    const batch = [
      nullTargetInteraction('int-null', [makeNetActivity({ url: 'https://www.amazon.in/cart/other' })]),
      healthyInteraction('int-healthy'),
    ];

    // Pre-fix: this call itself threw (reading 'before'), nulling the whole batch.
    let result: ReturnType<SignalExtractionCoordinator['extract']>;
    expect(() => {
      result = coordinator.extract(batch);
    }).not.toThrow();

    const healthy = result!.signals.get('int-healthy');
    expect(healthy).toBeDefined();
    expect(healthy!.apiOperations.length).toBeGreaterThanOrEqual(1);
    expect((healthy!.apiOperations[0] as any).operation).toBe('add-to-cart');

    // The null-target interaction yields a SignalSet too (network signals),
    // just no target-state signals.
    const nullOne = result!.signals.get('int-null');
    expect(nullOne).toBeDefined();
    expect(nullOne!.inputChanges).toEqual([]);
  });
});

// ── NG-2: Stage 7 finalState guard ─────────────────────────────────────

describe('NG-2: finalState === null at Stage 7 (understanding-pipeline)', () => {
  it('R4: Stage 1 failure → Stage 7 must NOT persist (no warning, no partial Dexie write)', async () => {
    const db = createKnowledgeDatabase();
    const pipeline = new UnderstandingPipeline({ db }) as any;

    // Engineer a Stage-1 throw (any extractor-level failure) with the same
    // shape the real null-targetEvidence bug produced: the coordinator call
    // throws and Stage 1 catches it, leaving finalState null.
    const coordinator = (pipeline as any).coordinator;
    coordinator.extract = () => {
      throw new Error('boom (simulated Stage-1 failure)');
    };

    const result = await pipeline.run({
      interactions: [healthyInteraction('int-1'), healthyInteraction('int-2')],
      origin: 'https://www.amazon.in',
      sessionId: 's-ng4',
      seed: null,
    });

    // Stage 1 failure is reported…
    expect(result.warnings.some((w: string) => w.startsWith('signal-extraction:'))).toBe(true);
    // …but Stage 7 no longer attempts a null applicationState persist.
    expect(result.warnings.some((w: string) => w.startsWith('recorded-workflow-persistence:'))).toBe(false);

    // Stage 6 enrichment still runs (reads interactions directly).
    expect(result.finalState).toBeNull();
    expect(result.semanticKnowledge).not.toBeNull();

    // No partial Dexie write: pre-fix, upsertApplication (step 1 of 10)
    // succeeded before persistViews threw — a lone application row.
    const repo = new KnowledgeRepository(db);
    const appId = deriveAppId('https://www.amazon.in');
    const app = await repo.getApplication(appId);
    expect(app).toBeUndefined();
    db.close();
  }, 20000);

  it('R5: happy path — finalState non-null → Stage 7 persists exactly as before', async () => {
    const db = createKnowledgeDatabase();
    const pipeline = new UnderstandingPipeline({ db });

    const result = await pipeline.run({
      interactions: [healthyInteraction('int-1'), healthyInteraction('int-2')],
      origin: 'https://www.amazon.in',
      sessionId: 's-ng5',
      seed: null,
    });

    expect(result.finalState).not.toBeNull();
    expect(result.semanticKnowledge).not.toBeNull();
    expect(result.warnings.some((w: string) => w.startsWith('recorded-workflow-persistence:'))).toBe(false);

    // Persistence DID run (Stage 5 + Stage 7) — application row exists.
    const repo = new KnowledgeRepository(db);
    const appId = deriveAppId('https://www.amazon.in');
    const app = await repo.getApplication(appId);
    expect(app).toBeDefined();
    db.close();
  }, 20000);
});
