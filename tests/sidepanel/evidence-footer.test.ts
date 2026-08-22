/**
 * MS-U1 — evidence footer pin.
 *
 * Spec: .drytis/specs/phase-6-u1-observed-workflow-cards.md (P6/P6b).
 *
 *  P6  `N dom changes · N network · N new surfaces` from ApplicationEvidence.
 *  P6b absent evidence → no footer (honesty).
 */

import { describe, it, expect } from 'vitest';
import { buildEvidenceFooter } from '../../src/sidepanel/evidence-footer';
import type {
  BehavioralEvidence,
  ApplicationEvidence,
  NetworkActivity,
  SurfaceChange,
  DomChangeSummary,
} from '../../src/shared/behavioral-evidence-types';

function net(url: string): NetworkActivity {
  return {
    url,
    method: 'GET',
    status: 200,
    startRelativeToEvent: 0,
    endRelativeToEvent: 10,
    durationMs: 10,
    resourceType: 'xhr',
    source: 'main-world',
  } as NetworkActivity;
}

function surface(): SurfaceChange {
  return {
    path: 'body > div#x',
    tagName: 'DIV',
    ariaRole: null,
    accessibleName: null,
    shadowContext: null,
    descendantCount: 0,
    relativeTime: 0,
    batchIndex: 0,
    kind: 'added',
  };
}

function domChange(): DomChangeSummary {
  return {
    types: ['childList'],
    targetPath: 'body > span#cart',
    targetTag: 'SPAN',
    shadowContext: null,
    changedAttributes: [],
    attributeDeltas: {},
    addedNodesCount: 0,
    removedNodesCount: 0,
    characterDataDelta: null,
    firstMutationAt: 0,
    lastMutationAt: 0,
    rawMutationCount: 1,
    firstBatchIndex: 0,
    lastBatchIndex: 0,
  };
}

function evidence(app: Partial<ApplicationEvidence> = {}): BehavioralEvidence {
  return {
    sourceEventId: 'evt-1',
    sourceEventType: 'click',
    windowId: 'bev-evt-1',
    frameId: 'main',
    window: {
      openedAt: 0,
      closedAt: 100,
      durationMs: 100,
      endReason: 'stabilized',
      stabilityTrace: [],
    },
    targetEvidence: {
      identity: null,
      identityCapturedAt: 0,
      before: null,
      after: null,
      focusMovement: null,
    },
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [],
      performanceCondition: null,
      ...app,
    },
  };
}

describe('P6 — buildEvidenceFooter', () => {
  it('7 dom changes · 2 network · 1 new surface → exact footer string', () => {
    const footer = buildEvidenceFooter(evidence({
      domChanges: Array.from({ length: 7 }, domChange),
      networkActivity: [net('https://x'), net('https://y')],
      newSurfaces: [surface()],
    }));
    expect(footer).toBe('7 dom changes · 2 network · 1 new surface');
  });

  it('domChangeOverflow adds the dropped suffix', () => {
    const footer = buildEvidenceFooter(evidence({
      domChanges: [domChange(), domChange(), domChange()],
      domChangeOverflow: 12,
    }));
    expect(footer).toBe('3 dom changes · +12 dropped');
  });

  it('singular forms', () => {
    const footer = buildEvidenceFooter(evidence({
      domChanges: [domChange()],
      networkActivity: [net('https://x')],
    }));
    expect(footer).toBe('1 dom change · 1 network');
  });

  it('P6b: no counts at all → null (honesty)', () => {
    expect(buildEvidenceFooter(evidence())).toBeNull();
  });

  it('network-only evidence still renders a footer', () => {
    expect(buildEvidenceFooter(evidence({ networkActivity: [net('https://x')] })))
      .toBe('1 network');
  });

  it('null behavioralEvidence → null', () => {
    expect(buildEvidenceFooter(null as unknown as BehavioralEvidence)).toBeNull();
  });
});
