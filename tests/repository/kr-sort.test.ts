/**
 * MS-U4 pins — deterministic ordering + caps for the KR browser sections.
 *
 * Spec: .drytis/specs/phase-6-u4-kr-browser.md (§6 P1–P5, P12).
 * Pure functions, no DB — fixtures mirror knowledge-types.ts rows.
 */

import { describe, it, expect } from 'vitest';
import {
  sortSignatures,
  sortWorkflows,
  sortViewEdges,
  sortGaps,
  KR_CAPS,
  overflowMarker,
  reasonSummary,
  fmtDate,
} from '../../src/repository/kr-browser/kr-sort';
import type {
  KnowledgeActionSignatureRow,
  KnowledgeRecordedWorkflowRow,
  KnowledgeViewTransitionRow,
  KnowledgeGapRow,
} from '../../src/understanding/persistence/knowledge-types';

// ── fixtures ────────────────────────────────────────────────────────────

function sigRow(o: Partial<KnowledgeActionSignatureRow>): KnowledgeActionSignatureRow {
  return {
    key: 'app1:sig:a',
    appId: 'app1',
    actionType: 'Click',
    normalizedTarget: 'button.search',
    anchorViewId: null,
    firstSeenAtSession: 'session-1',
    lastSeenAtSession: 'session-3',
    firstSeenSeq: 1,
    lastSeenSeq: 3,
    occurrenceCount: 2,
    sessionsSinceSeen: 0,
    status: 'active',
    source: 'behavior',
    consequenceProfile: [],
    divergenceFlags: [],
    lastSeenAtMs: 0,
    ...o,
  } as KnowledgeActionSignatureRow;
}

function wfRow(o: Partial<KnowledgeRecordedWorkflowRow>): KnowledgeRecordedWorkflowRow {
  return {
    key: 'app1:wf-1',
    appId: 'app1',
    patternId: 'wf-1',
    label: 'Search then open result',
    canonicalSteps: ['navigate', 'fill', 'click'],
    viewSequence: ['home', 'results'],
    sessionIds: ['session-1'],
    occurrenceCount: 1,
    instances: ['inst-1'],
    firstSeenAt: 100,
    lastSeenAt: 100,
    ...o,
  } as KnowledgeRecordedWorkflowRow;
}

function edgeRow(o: Partial<KnowledgeViewTransitionRow>): KnowledgeViewTransitionRow {
  return {
    key: 'app1:home->results',
    appId: 'app1',
    fromViewId: 'home',
    toViewId: 'results',
    count: 1,
    firstSeenAt: 0,
    lastSeenAt: 0,
    lastSessionId: 'session-1',
    ...o,
  } as KnowledgeViewTransitionRow;
}

function gapRow(o: Partial<KnowledgeGapRow>): KnowledgeGapRow {
  return {
    key: 'app1:session-1:gap-1',
    appId: 'app1',
    sessionId: 'session-1',
    gapId: 'gap-1',
    observedKind: 'ui',
    reason: 'no-live-horizon',
    detail: 'evidence window outside every uiOwnership horizon',
    observedAtMs: 100,
    tabId: null,
    windowRefJson: '{}',
    ...o,
  } as KnowledgeGapRow;
}

// ── P1: signature ordering ─────────────────────────────────────────────

describe('P1 — signature ordering', () => {
  it('active before stale; within status occurrenceCount desc; then key asc', () => {
    const rows = [
      sigRow({ key: 'app1:sig:a', status: 'stale', occurrenceCount: 99 }),
      sigRow({ key: 'app1:sig:c', status: 'active', occurrenceCount: 2 }),
      sigRow({ key: 'app1:sig:b', status: 'active', occurrenceCount: 2 }),
      sigRow({ key: 'app1:sig:d', status: 'active', occurrenceCount: 5 }),
    ];
    const sorted = sortSignatures(rows);
    expect(sorted.map((r) => r.key)).toEqual([
      'app1:sig:d',
      'app1:sig:b',
      'app1:sig:c',
      'app1:sig:a',
    ]);
  });

  it('stable for identical keys/status/counts (no reordering between calls)', () => {
    const rows = [
      sigRow({ key: 'app1:sig:x', occurrenceCount: 3 }),
      sigRow({ key: 'app1:sig:x2', occurrenceCount: 3, actionType: 'TextEntry' }),
    ];
    expect([...sortSignatures(rows)].map((r) => r.key)).toEqual(
      [...sortSignatures(rows)].map((r) => r.key)
    );
  });
});

// ── P2: workflow ordering ──────────────────────────────────────────────

describe('P2 — workflow ordering', () => {
  it('lastSeenAt desc, then key asc', () => {
    const rows = [
      wfRow({ key: 'app1:wf-old', lastSeenAt: 50 }),
      wfRow({ key: 'app1:wf-b', lastSeenAt: 900 }),
      wfRow({ key: 'app1:wf-a', lastSeenAt: 900 }),
      wfRow({ key: 'app1:wf-mid', lastSeenAt: 300 }),
    ];
    expect(sortWorkflows(rows).map((r) => r.key)).toEqual([
      'app1:wf-a',
      'app1:wf-b',
      'app1:wf-mid',
      'app1:wf-old',
    ]);
  });
});

// ── P3: view-edge graph ordering ───────────────────────────────────────

describe('P3 — view-edge graph ordering', () => {
  it('count desc, then key asc (deterministic textual graph order)', () => {
    const rows = [
      edgeRow({ key: 'app1:home->zzz', count: 2 }),
      edgeRow({ key: 'app1:home->abc', count: 5 }),
      edgeRow({ key: 'app1:home->mid', count: 5 }),
      edgeRow({ key: 'app1:aaa->home', count: 9 }),
    ];
    expect(sortViewEdges(rows).map((r) => r.key)).toEqual([
      'app1:aaa->home',
      'app1:home->abc',
      'app1:home->mid',
      'app1:home->zzz',
    ]);
  });
});

// ── P4: gaps ───────────────────────────────────────────────────────────

describe('P4 — gaps', () => {
  it('newest first (observedAtMs desc), then key asc', () => {
    const rows = [
      gapRow({ key: 'app1:s1:g-old', observedAtMs: 10 }),
      gapRow({ key: 'app1:s1:g-b', observedAtMs: 900 }),
      gapRow({ key: 'app1:s1:g-a', observedAtMs: 900 }),
    ];
    expect(sortGaps(rows).map((r) => r.key)).toEqual([
      'app1:s1:g-a',
      'app1:s1:g-b',
      'app1:s1:g-old',
    ]);
  });

  it('reason summary groups deterministically (count desc, reason asc)', () => {
    const rows = [
      gapRow({ reason: 'no-live-horizon' }),
      gapRow({ reason: 'no-live-horizon' }),
      gapRow({ reason: 'api-no-stamp' }),
      gapRow({ reason: 'zeta-reason' }),
    ];
    const summary = reasonSummary(rows);
    expect(summary).toEqual([
      { reason: 'no-live-horizon', count: 2 },
      { reason: 'api-no-stamp', count: 1 },
      { reason: 'zeta-reason', count: 1 },
    ]);
  });
});

// ── P5: caps + overflow ────────────────────────────────────────────────

describe('P5 — caps + overflow markers', () => {
  it('exposes the spec caps (signatures 50, workflows 30, views 30, edges 60, gaps 50, outcomes 50, entities 100, collections 30, counters 30, notifications 50, sessions 10, edges-per-session 20, api seeds 25)', () => {
    expect(KR_CAPS.signatures).toBe(50);
    expect(KR_CAPS.workflows).toBe(30);
    expect(KR_CAPS.views).toBe(30);
    expect(KR_CAPS.viewEdges).toBe(60);
    expect(KR_CAPS.gaps).toBe(50);
    expect(KR_CAPS.outcomes).toBe(50);
    expect(KR_CAPS.entities).toBe(100);
    expect(KR_CAPS.collections).toBe(30);
    expect(KR_CAPS.counters).toBe(30);
    expect(KR_CAPS.notifications).toBe(50);
    expect(KR_CAPS.behaviorSessions).toBe(10);
    expect(KR_CAPS.edgesPerSession).toBe(20);
    expect(KR_CAPS.apiSeeds).toBe(25);
  });

  it('overflowMarker returns null at/below cap, "… N more" above', () => {
    expect(overflowMarker(50, 50)).toBeNull();
    expect(overflowMarker(10, 50)).toBeNull();
    expect(overflowMarker(75, 50)).toBe('… 25 more');
    expect(overflowMarker(51, 50)).toBe('… 1 more');
  });
});

// ── P12: deterministic date rendering ──────────────────────────────────

describe('P12 — deterministic dates', () => {
  it('same epoch always renders the same string (no locale drift)', () => {
    const a = fmtDate(1787300000000);
    const b = fmtDate(1787300000000);
    expect(a).toBe(b);
    expect(a).toMatch(/2026/);
  });

  it('null/undefined/0 render honest "—" not Invalid Date', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate(0)).toBe('—');
  });
});
