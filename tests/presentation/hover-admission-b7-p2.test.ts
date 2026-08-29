/**
 * B7-P2 §5.2.7 — evidence-keyed admission rule + compat bridge.
 *
 * admit ⇔ endState === 'completed' ∧ consequence-bearing
 * consequence-bearing ⇔ evidence contains ≥1 recorded fact of class:
 *   reveal | insertion | removal | stamped-fetch | nav | revert | pointer-reach
 *
 * COMPAT BRIDGE: metadata.consequenceClasses: string[] is derived and
 * metadata.meaningful === (classes.length > 0) is emitted as a read-only
 * projection until P4 deletes it.
 */

import { describe, it, expect } from 'vitest';
import {
  filterProductionInteractions,
  isProductionInteraction,
  deriveConsequenceClasses,
} from '../../src/presentation/output-adapter';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { BehavioralEvidence as BE } from '../../src/shared/behavioral-evidence-types';

function makeHover(opts: {
  endState?: string;
  evidence?: Partial<BE>;
  metadata?: Record<string, unknown>;
}): ComponentInteraction {
  return {
    interactionId: 'int-1',
    lifecycleId: 'lc-1',
    type: 'Hover',
    trigger: {} as never,
    triggerEvent: {
      eventId: 'evt-src-1',
      eventType: 'mouseenter',
    } as never,
    memberEvents: [],
    startTime: 1000,
    endTime: 2000,
    endState: (opts.endState ?? 'completed') as ComponentInteraction['endState'],
    metadata: { dwellMs: 500, ...opts.metadata },
    behavioralEvidence: opts.evidence
      ? ({
          sourceEventId: 'evt-src-1',
          sourceEventType: 'mouseenter',
          windowId: 'bev-evt-src-1',
          frameId: 'main',
          window: {
            openedAt: 0, closedAt: 1000, durationMs: 1000,
            endReason: 'lifecycle-complete', stabilityTrace: [],
          },
          targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, focusMovement: null },
          applicationEvidence: {
            domChanges: [], domChangeOverflow: 0, coarseMode: false,
            newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
            navigation: [], networkActivity: [],
            performanceCondition: null,
            ...opts.evidence.applicationEvidence,
          },
        } as BehavioralEvidence)
      : undefined,
  };
}

describe('B7-P2: admission rule — truth table (completed ∧ consequence-bearing)', () => {
  const revealEvidence = {
    applicationEvidence: {
      newSurfaces: [{
        path: 'div#menu', tagName: 'DIV', ariaRole: 'menu', accessibleName: 'Products',
        shadowContext: null, descendantCount: 4, relativeTime: 50, batchIndex: 2,
        kind: 'added' as const, emergence: 'revealed' as const,
      }],
    },
  };
  const insertionEvidence = {
    applicationEvidence: {
      domChanges: [{
        types: ['childList'] as never, targetPath: 'body/div', targetTag: 'DIV',
        shadowContext: null, changedAttributes: [], attributeDeltas: {},
        addedNodesCount: 3, removedNodesCount: 0, characterDataDelta: null,
        firstMutationAt: 30, lastMutationAt: 40, rawMutationCount: 1,
        firstBatchIndex: 1, lastBatchIndex: 1,
      }],
    },
  };
  const removalEvidence = {
    applicationEvidence: {
      domChanges: [{
        types: ['childList'] as never, targetPath: 'body/div', targetTag: 'DIV',
        shadowContext: null, changedAttributes: [], attributeDeltas: {},
        addedNodesCount: 0, removedNodesCount: 1, characterDataDelta: null,
        firstMutationAt: 30, lastMutationAt: 40, rawMutationCount: 1,
        firstBatchIndex: 1, lastBatchIndex: 1,
      }],
    },
  };
  const stampedFetchEvidence = {
    applicationEvidence: {
      networkActivity: [{
        url: '/api/menu', method: 'GET', status: 200,
        startRelativeToEvent: 10, endRelativeToEvent: 400, durationMs: 390,
        resourceType: 'fetch' as const, source: 'webrequest' as const,
        sourceEventId: 'evt-src-1',
      }],
    },
  };
  const navEvidence = {
    applicationEvidence: {
      navigation: [{
        type: 'spa' as never, fromUrl: '/a', toUrl: '/b',
        relativeTime: 20, batchIndex: 1,
      }],
    },
  };
  const revertEvidence = {
    applicationEvidence: {
      visibilityChanges: [{
        path: 'div#menu',
        property: 'display',
        oldValue: 'block',
        newValue: 'none',
        relativeTime: 90,
        batchIndex: 3,
      }] as never,
    },
  };
  const pointerReachInsertionApp = {
    applicationEvidence: {
      // An inserted surface AND a pointer-path enter on an element whose
      // identity matches the insertion (path join) recorded in the SAME
      // window — the click-through proof.
      domChanges: [{
        types: ['childList'] as never, targetPath: 'body/nav/div#submenu', targetTag: 'DIV',
        shadowContext: null, changedAttributes: [], attributeDeltas: {},
        addedNodesCount: 1, removedNodesCount: 0, characterDataDelta: null,
        firstMutationAt: 30, lastMutationAt: 30, rawMutationCount: 1,
        firstBatchIndex: 1, lastBatchIndex: 1,
      }],
    },
  };

  it.each([
    ['reveal', revealEvidence],
    ['insertion', insertionEvidence],
    ['removal', removalEvidence],
    ['stamped-fetch', stampedFetchEvidence],
    ['nav', navEvidence],
    ['revert', revertEvidence],
  ] as const)('class %s admits a completed hover', (_name, ev) => {
    const hover = makeHover({ evidence: ev as never });
    expect(isProductionInteraction(hover)).toBe(true);
  });

  it('pointer-reach admits (enter identity joins an insertion/reveal fact in the SAME window)', () => {
    const hover = makeHover({
      evidence: pointerReachInsertionApp as never,
      metadata: {
        pointerPathEnters: [{
          target: { cssSelector: 'div', xPath: '/html/body/nav/div', tag: 'DIV' },
          eventId: 'evt-enter-2',
        }],
      },
    });
    expect(isProductionInteraction(hover)).toBe(true);
  });

  it('pointer-reach NEGATIVE: an enter on a pre-existing unrelated element does NOT admit', () => {
    // Isolate the JOIN: same window has an insertion/reveal fact, and a
    // pointer-path enter exists — but on an element whose identity does
    // NOT match. Insertion alone would admit; the negative here pins the
    // JOIN SCHEMA specifically, so this fixture uses a NON-inserting
    // window (attribute-only change) where only the join can admit.
    const attrOnlyEvidence = {
      applicationEvidence: {
        domChanges: [{
          types: ['attributes'] as never, targetPath: 'button#menu', targetTag: 'BUTTON',
          shadowContext: null, changedAttributes: ['title'],
          attributeDeltas: { 'title': { old: null, new: 'Products menu' } },
          addedNodesCount: 0, removedNodesCount: 0, characterDataDelta: null,
          firstMutationAt: 30, lastMutationAt: 30, rawMutationCount: 1,
          firstBatchIndex: 1, lastBatchIndex: 1,
        }],
      },
    };
    const hover = makeHover({
      evidence: attrOnlyEvidence as never,
      metadata: {
        pointerPathEnters: [{
          target: { cssSelector: 'footer', xPath: '/html/body/footer', tag: 'FOOTER' },
          eventId: 'evt-enter-9',
        }],
      },
    });
    expect(isProductionInteraction(hover)).toBe(false);
    // Control: the SAME window with a reveal fact + a MATCHING enter admits
    // via the join (pointer-reach positive in an attr-reveal window).
    const revealJoinEvidence = {
      applicationEvidence: {
        domChanges: [{
          types: ['attributes'] as never, targetPath: 'button#menu', targetTag: 'BUTTON',
          shadowContext: null, changedAttributes: ['aria-expanded'],
          attributeDeltas: { 'aria-expanded': { old: 'false', new: 'true' } },
          addedNodesCount: 0, removedNodesCount: 0, characterDataDelta: null,
          firstMutationAt: 30, lastMutationAt: 30, rawMutationCount: 1,
          firstBatchIndex: 1, lastBatchIndex: 1,
        }],
      },
    };
    const admitHover = makeHover({
      evidence: revealJoinEvidence as never,
      metadata: {
        pointerPathEnters: [{
          target: { cssSelector: 'button#menu', xPath: '/html/body/button', tag: 'BUTTON', ariaRole: null },
          eventId: 'evt-enter-2',
        }],
      },
    });
    expect(isProductionInteraction(admitHover)).toBe(true);
  });

  it('pointer-reach admits with REAL locator grammars (B7-P3 B-3 parity: css `#id`/xPath id joins DOM-path facts)', () => {
    // Real capture shapes (p2-reveal-consume dump): surface path
    // `body > div > div#mega-products`; pointer enter identity carries
    // cssSelector '#mega-products' + xPath "//div[@id='mega-products']".
    // The pre-P3 exact-equality matcher could NEVER fire on these.
    const realFormatEvidence = {
      applicationEvidence: {
        domChanges: [{
          types: ['attributes'] as never, targetPath: 'body > div > div#mega-products', targetTag: 'DIV',
          shadowContext: null, changedAttributes: ['aria-expanded'],
          attributeDeltas: { 'aria-expanded': { old: 'false', new: 'true' } },
          addedNodesCount: 0, removedNodesCount: 0, characterDataDelta: null,
          firstMutationAt: 30, lastMutationAt: 30, rawMutationCount: 1,
          firstBatchIndex: 1, lastBatchIndex: 1,
        }],
      },
    };
    const hover = makeHover({
      evidence: realFormatEvidence as never,
      metadata: {
        pointerPathEnters: [{
          target: { cssSelector: '#mega-products', xPath: "//div[@id='mega-products']", tag: 'DIV' },
          eventId: 'evt-enter-real-1',
        }],
      },
    });
    expect(isProductionInteraction(hover)).toBe(true);
  });

  it('NO evidence at all → NOT admitted (gesture-only hover)', () => {
    const hover = makeHover({});
    expect(isProductionInteraction(hover)).toBe(false);
  });

  it('empty evidence (all arrays empty) → NOT admitted', () => {
    const hover = makeHover({ evidence: {} });
    expect(isProductionInteraction(hover)).toBe(false);
  });

  it.each([
    ['reveal (abandoned)', revealEvidence],
    ['stamped-fetch (abandoned)', stampedFetchEvidence],
  ] as const)('consequence evidence with %s but ABANDONED endState → NOT admitted', (_name, ev) => {
    const hover = makeHover({ endState: 'abandoned', evidence: ev as never });
    expect(isProductionInteraction(hover)).toBe(false);
  });

  it('metadata.meaningful is IGNORED as a stored judgment (old field never gates)', () => {
    // Old field true but NO evidence → rejected. The stored boolean is dead.
    const hover = makeHover({ metadata: { meaningful: true } });
    expect(isProductionInteraction(hover)).toBe(false);
    // Old field false BUT real evidence → admitted (the reverse direction).
    const hover2 = makeHover({ evidence: revealEvidence as never, metadata: { meaningful: false } });
    expect(isProductionInteraction(hover2)).toBe(true);
  });
});

describe('B7-P2: deriveConsequenceClasses (compat bridge)', () => {
  it('derives class names from evidence', () => {
    const ev = {
      applicationEvidence: {
        newSurfaces: [{
          path: 'div#m', tagName: 'DIV', ariaRole: 'menu', accessibleName: 'M',
          shadowContext: null, descendantCount: 1, relativeTime: 10, batchIndex: 1,
          kind: 'added' as const, emergence: 'revealed' as const,
        }],
        domChanges: [{
          types: ['childList'] as never, targetPath: 'b/div', targetTag: 'DIV',
          shadowContext: null, changedAttributes: [], attributeDeltas: {},
          addedNodesCount: 2, removedNodesCount: 1, characterDataDelta: null,
          firstMutationAt: 1, lastMutationAt: 2, rawMutationCount: 1,
          firstBatchIndex: 1, lastBatchIndex: 1,
        }],
      },
    } as never;
    const classes = deriveConsequenceClasses(makeHover({ evidence: ev }));
    expect(classes).toEqual(expect.arrayContaining(['reveal', 'insertion', 'removal']));
  });

  it('empty evidence → empty classes', () => {
    expect(deriveConsequenceClasses(makeHover({ evidence: {} }))).toEqual([]);
    expect(deriveConsequenceClasses(makeHover({}))).toEqual([]);
  });
});

describe('B7-P2: admission via filterProductionInteractions', () => {
  it('filter admits evidence-bearing completed hovers and rejects gesture-only ones', () => {
    const admitted = makeHover({
      evidence: {
        applicationEvidence: {
          newSurfaces: [{
            path: 'div#x', tagName: 'DIV', ariaRole: 'menu', accessibleName: 'X',
            shadowContext: null, descendantCount: 1, relativeTime: 5, batchIndex: 1,
            kind: 'added' as const, emergence: 'revealed' as const,
          }],
        },
      } as never,
    });
    const gestureOnly = makeHover({});
    const out = filterProductionInteractions([admitted, gestureOnly]);
    expect(out.length).toBe(1);
    expect(out[0].interactionId).toBe('int-1');
  });
});
