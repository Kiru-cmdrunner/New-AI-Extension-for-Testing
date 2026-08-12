/**
 * M1 Unit Tests: behavioral-evidence-types.ts compilation check
 *
 * Verifies that all type definitions from spec §3 compile correctly,
 * are exported, and can be constructed with valid values.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §3
 */

import { describe, it, expect } from 'vitest';
import type {
  BehavioralEvidence,
  EvidenceWindow,
  TargetStateSnapshot,
  FocusMovement,
  DomChangeSummary,
  NavigationEvidence,
  NetworkActivity,
  PerformanceCondition,
} from '../../src/shared/behavioral-evidence-types';
import type { ElementIdentity } from '../../src/shared/types';

describe('behavioral-evidence-types', () => {
  it('BehavioralEvidence compiles with all required fields', () => {
    const evidence: BehavioralEvidence = {
      sourceEventId: 'evt-001',
      sourceEventType: 'click',
      windowId: 'bev-evt-001',
      frameId: 'main',
      window: {
        openedAt: 1000,
        closedAt: 1300,
        durationMs: 300,
        endReason: 'stabilized',
        stabilityTrace: [],
      },
      targetEvidence: {
        identity: {} as ElementIdentity,
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
      },
    };

    expect(evidence.sourceEventId).toBe('evt-001');
    expect(evidence.window.endReason).toBe('stabilized');
  });

  it('EvidenceWindow supports all endReason values', () => {
    const reasons: EvidenceWindow['endReason'][] = [
      'stabilized',
      'max-duration',
      'element-removed',
      'recording-stopped',
      'navigation',
      'typing-complete',
      'displaced',
    ];

    for (const reason of reasons) {
      const w: EvidenceWindow = {
        openedAt: 0,
        closedAt: 1,
        durationMs: 1,
        endReason: reason,
        stabilityTrace: [],
      };
      expect(w.endReason).toBe(reason);
    }
  });

  it('TargetStateSnapshot has all properties + capturedAt', () => {
    const snap: TargetStateSnapshot = {
      value: 'hello',
      checked: true,
      className: 'btn active',
      disabled: false,
      ariaExpanded: true,
      ariaChecked: null,
      ariaPressed: false,
      textContent: 'Submit',
      childCount: 3,
      scrollTop: null,
      scrollLeft: null,
      selectedValues: null,
      controlledValue: null,
      capturedAt: 1234.5,
    };

    expect(snap.value).toBe('hello');
    expect(snap.checked).toBe(true);
    expect(snap.ariaExpanded).toBe(true);
    expect(snap.ariaChecked).toBeNull();
    expect(snap.childCount).toBe(3);
    expect(snap.capturedAt).toBe(1234.5);
  });

  it('NetworkActivity supports both source types', () => {
    const mainWorld: NetworkActivity = {
      url: '/api/search',
      method: 'GET',
      status: 200,
      startRelativeToEvent: 50,
      endRelativeToEvent: 120,
      durationMs: 70,
      resourceType: 'fetch',
      source: 'main-world',
    };

    const webrequest: NetworkActivity = {
      url: '/api/search',
      method: 'GET',
      status: 200,
      startRelativeToEvent: 50,
      endRelativeToEvent: null,
      durationMs: null,
      resourceType: 'unknown',
      source: 'webrequest',
    };

    expect(mainWorld.source).toBe('main-world');
    expect(webrequest.source).toBe('webrequest');
  });

  it('DomChangeSummary has batch index fields', () => {
    const summary: DomChangeSummary = {
      types: ['attributes', 'childList'],
      targetPath: 'body > div.container',
      targetTag: 'DIV',
      shadowContext: null,
      changedAttributes: ['class'],
      attributeDeltas: { class: { old: 'hidden', new: 'visible' } },
      addedNodesCount: 2,
      removedNodesCount: 0,
      characterDataDelta: null,
      firstMutationAt: 5,
      lastMutationAt: 15,
      rawMutationCount: 3,
      firstBatchIndex: 0,
      lastBatchIndex: 2,
    };

    expect(summary.firstBatchIndex).toBe(0);
    expect(summary.lastBatchIndex).toBe(2);
    expect(summary.types).toContain('attributes');
  });

  it('NavigationEvidence supports all navigation types', () => {
    const types: NavigationEvidence['type'][] = [
      'pushState',
      'replaceState',
      'hashchange',
      'popstate',
      'full-reload',
    ];

    for (const t of types) {
      const nav: NavigationEvidence = {
        type: t,
        fromUrl: 'https://example.com/old',
        toUrl: 'https://example.com/new',
        relativeTime: 100,
        batchIndex: 5,
      };
      expect(nav.type).toBe(t);
    }
  });

  it('FocusMovement has before/after/detectedAt', () => {
    const fm: FocusMovement = {
      before: { tagName: 'INPUT', ariaRole: 'textbox', accessibleName: 'Search' },
      after: { tagName: 'BUTTON', ariaRole: 'button', accessibleName: 'Submit' },
      detectedAt: 500,
    };

    expect(fm.before?.tagName).toBe('INPUT');
    expect(fm.after?.ariaRole).toBe('button');
  });

  it('PerformanceCondition has all fields', () => {
    const pc: PerformanceCondition = {
      mainThreadBlocked: true,
      highChurnMode: false,
      longestBatchMs: 23,
      totalBatches: 15,
    };

    expect(pc.mainThreadBlocked).toBe(true);
    expect(pc.totalBatches).toBe(15);
  });
});
