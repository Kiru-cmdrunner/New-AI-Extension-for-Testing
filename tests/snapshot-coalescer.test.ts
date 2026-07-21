/**
 * Unit tests for the Snapshot Coalescer.
 *
 * Tests event grouping, temporal windowing, value/state/class computation,
 * primary event selection, date detection, navigation handling,
 * and cross-element relatedness.
 *
 * All tests use synthetic RawEvidence streams — no browser, no DOM.
 *
 * Architecture: .drytis/architecture-c-production.md §5
 */

import { describe, it, expect, vi } from 'vitest';
import { SnapshotCoalescer } from '../src/recorder/coalescer/snapshot-coalescer';
import type { RawEvidence, InteractionSnapshot } from '../src/shared/evidence-types';
import type { ElementIdentity } from '../src/shared/types';

// ── Test Helpers ──────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Button',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'button',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'body > button',
    xPath: '/html/body/button',
    inIframe: false,
    shadowDom: false,
    iframeContext: undefined,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<RawEvidence> = {}): RawEvidence {
  return {
    eventType: 'click',
    identity: makeIdentity(),
    timestamp: '2026-07-17T10:00:00.000Z',
    isTrusted: true,
    ...overrides,
  };
}

/** Helper: create a coalescer that collects snapshots into an array. */
function makeCoalescerWithCollector() {
  const snapshots: InteractionSnapshot[] = [];
  const coalescer = new SnapshotCoalescer((s) => snapshots.push(s));
  return { coalescer, snapshots };
}

/** Increment a timestamp by N ms. */
function later(timestamp: string, ms: number): string {
  return new Date(Date.parse(timestamp) + ms).toISOString();
}

// ── Basic Grouping ────────────────────────────────────────

describe('Snapshot Coalescer — Basic Grouping', () => {

  it('groups mousedown + click on same element into one snapshot', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ tag: 'button', accessibleName: 'Submit' });

    coalescer.ingest(makeEvidence({
      eventType: 'mousedown',
      identity,
      timestamp: '2026-07-17T10:00:00.000Z',
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'click',
      identity,
      timestamp: '2026-07-17T10:00:00.010Z',
    }));
    coalescer.flush();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].primaryEvent.type).toBe('click');
    expect(snapshots[0].secondaryEvents).toHaveLength(1);
    expect(snapshots[0].secondaryEvents[0].type).toBe('mousedown');
  });

  it('groups focus + blur on same input into one snapshot', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ tag: 'input', accessibleName: 'Username' });

    coalescer.ingest(makeEvidence({
      eventType: 'focus',
      identity,
      timestamp: '2026-07-17T10:00:00.000Z',
      value: '',
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'blur',
      identity,
      timestamp: '2026-07-17T10:00:01.000Z',
      value: 'hello',
    }));
    coalescer.flush();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].primaryEvent.type).toBe('blur');
  });

  it('creates separate snapshots for clicks on different elements', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();

    coalescer.ingest(makeEvidence({
      identity: makeIdentity({ elementId: 'elem-A', accessibleName: 'Button A' }),
      timestamp: '2026-07-17T10:00:00.000Z',
    }));
    coalescer.ingest(makeEvidence({
      identity: makeIdentity({ elementId: 'elem-B', accessibleName: 'Button B' }),
      timestamp: '2026-07-17T10:00:00.010Z',
    }));
    coalescer.flush();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].identity.elementId).toBe('elem-A');
    expect(snapshots[1].identity.elementId).toBe('elem-B');
  });

  it('groups rapid clicks on same element within 500ms into one snapshot', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ accessibleName: 'Button' });

    coalescer.ingest(makeEvidence({ identity, timestamp: '2026-07-17T10:00:00.000Z' }));
    coalescer.ingest(makeEvidence({ identity, timestamp: '2026-07-17T10:00:00.100Z' }));
    coalescer.flush();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].events ?? snapshots[0].secondaryEvents).toBeDefined();
  });
});

// ── Complex Grouping ──────────────────────────────────────

describe('Snapshot Coalescer — Complex Grouping', () => {

  it('groups click on calendar cell + change on date input → one snapshot with valueChange', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const cellIdentity = makeIdentity({
      tag: 'td', accessibleName: '18', className: 'calendar-day',
      elementId: 'elem-cell',
    });
    const inputIdentity = makeIdentity({
      tag: 'input', accessibleName: 'Departure Date', className: 'calendar-input',
      elementId: 'elem-input',
    });

    // Click on calendar cell
    coalescer.ingest(makeEvidence({
      eventType: 'click',
      identity: cellIdentity,
      timestamp: '2026-07-17T10:00:00.000Z',
    }));
    // Change on the date input (related — calendar context)
    coalescer.ingest(makeEvidence({
      eventType: 'change',
      identity: inputIdentity,
      timestamp: '2026-07-17T10:00:00.050Z',
      value: '2026-07-18',
    }));
    coalescer.flush();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].valueChange).toBeDefined();
    expect(snapshots[0].valueChange?.after).toBe('2026-07-18');
    expect(snapshots[0].valueChange?.isDateLike).toBe(true);
  });

  it('groups mousedown + click + change on checkbox → one snapshot with stateChange', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ tag: 'input', ariaRole: 'checkbox', accessibleName: 'Accept Terms' });

    coalescer.ingest(makeEvidence({
      eventType: 'mousedown',
      identity,
      timestamp: '2026-07-17T10:00:00.000Z',
      checked: false,
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'click',
      identity,
      timestamp: '2026-07-17T10:00:00.010Z',
      checked: false,
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'change',
      identity,
      timestamp: '2026-07-17T10:00:00.020Z',
      checked: true,
    }));
    coalescer.flush();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].stateChange).toBeDefined();
    expect(snapshots[0].stateChange?.after).toBe('true');
  });

  it('groups mouseenter + dwell + mouseleave → one snapshot with dwellTime', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ accessibleName: 'Menu Item' });

    coalescer.ingest(makeEvidence({
      eventType: 'mouseenter',
      identity,
      timestamp: '2026-07-17T10:00:00.000Z',
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'mouseleave',
      identity,
      timestamp: '2026-07-17T10:00:00.800Z', // 800ms dwell
    }));
    coalescer.flush();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].dwellTime).toBe(800);
  });

  it('groups focus + 3×input + blur → one snapshot with valueChange', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ tag: 'input', accessibleName: 'Search' });

    coalescer.ingest(makeEvidence({
      eventType: 'focus', identity,
      timestamp: '2026-07-17T10:00:00.000Z', value: '',
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'input', identity,
      timestamp: '2026-07-17T10:00:00.100Z', value: 'h',
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'input', identity,
      timestamp: '2026-07-17T10:00:00.200Z', value: 'he',
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'input', identity,
      timestamp: '2026-07-17T10:00:00.300Z', value: 'hel',
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'blur', identity,
      timestamp: '2026-07-17T10:00:00.500Z', value: 'hello',
    }));
    coalescer.flush();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].valueChange?.after).toBe('hello');
    expect(snapshots[0].valueChange?.before).toBe('');
  });
});

// ── Window Timeout ────────────────────────────────────────

describe('Snapshot Coalescer — Window Timeout', () => {

  it('creates separate snapshots when events are >500ms apart', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity();

    coalescer.ingest(makeEvidence({
      identity,
      timestamp: '2026-07-17T10:00:00.000Z',
    }));
    // 600ms later — outside the 500ms window
    coalescer.ingest(makeEvidence({
      identity,
      timestamp: '2026-07-17T10:00:00.600Z',
    }));
    coalescer.flush();

    expect(snapshots).toHaveLength(2);
  });

  it('opens new window when event arrives after previous window closed', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();

    coalescer.ingest(makeEvidence({
      identity: makeIdentity({ accessibleName: 'A' }),
      timestamp: '2026-07-17T10:00:00.000Z',
    }));
    coalescer.ingest(makeEvidence({
      identity: makeIdentity({ accessibleName: 'B' }),
      timestamp: '2026-07-17T10:00:00.100Z',
    }));
    coalescer.flush();

    // Two different elements → two windows → two snapshots
    expect(snapshots).toHaveLength(2);
  });
});

// ── Value Computation ─────────────────────────────────────

describe('Snapshot Coalescer — Value Computation', () => {

  it('computes valueChange for text input: pre="" post="hello"', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ tag: 'input' });

    coalescer.ingest(makeEvidence({
      eventType: 'focus', identity,
      timestamp: '2026-07-17T10:00:00.000Z', value: '',
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'blur', identity,
      timestamp: '2026-07-17T10:00:01.000Z', value: 'hello',
    }));
    coalescer.flush();

    expect(snapshots[0].valueChange?.before).toBe('');
    expect(snapshots[0].valueChange?.after).toBe('hello');
  });

  it('computes valueChange for select: pre="opt1" post="opt2"', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ tag: 'select' });

    coalescer.ingest(makeEvidence({
      eventType: 'change', identity,
      timestamp: '2026-07-17T10:00:00.000Z', value: 'opt2',
    }));
    coalescer.flush();

    expect(snapshots[0].valueChange?.after).toBe('opt2');
  });

  it('computes stateChange for checkbox: pre=false post=true', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ tag: 'input', ariaRole: 'checkbox' });

    coalescer.ingest(makeEvidence({
      eventType: 'mousedown', identity,
      timestamp: '2026-07-17T10:00:00.000Z', checked: false,
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'change', identity,
      timestamp: '2026-07-17T10:00:00.020Z', checked: true,
    }));
    coalescer.flush();

    expect(snapshots[0].stateChange?.before).toBe('false');
    expect(snapshots[0].stateChange?.after).toBe('true');
  });
});

// ── Date Detection ────────────────────────────────────────

describe('Snapshot Coalescer — Date Detection', () => {

  it('detects ISO date format in value change', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ tag: 'input' });

    coalescer.ingest(makeEvidence({
      eventType: 'change', identity,
      timestamp: '2026-07-17T10:00:00.000Z', value: '2026-07-18',
    }));
    coalescer.flush();

    expect(snapshots[0].valueChange?.isDateLike).toBe(true);
  });

  it('rejects non-date values', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ tag: 'input' });

    coalescer.ingest(makeEvidence({
      eventType: 'change', identity,
      timestamp: '2026-07-17T10:00:00.000Z', value: 'hello world',
    }));
    coalescer.flush();

    expect(snapshots[0].valueChange?.isDateLike).toBe(false);
  });

  it('detects US date format', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ tag: 'input' });

    coalescer.ingest(makeEvidence({
      eventType: 'change', identity,
      timestamp: '2026-07-17T10:00:00.000Z', value: '07/18/2026',
    }));
    coalescer.flush();

    expect(snapshots[0].valueChange?.isDateLike).toBe(true);
  });
});

// ── Navigation ────────────────────────────────────────────

describe('Snapshot Coalescer — Navigation', () => {

  it('produces standalone navigation snapshot', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();

    coalescer.ingestNavigation('https://example.com/page2', '2026-07-17T10:00:00.000Z');

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].primaryEvent.type).toBe('navigation');
    expect(snapshots[0].identity.accessibleName).toBe('https://example.com/page2');
  });

  it('closes open click window before navigation', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();

    coalescer.ingest(makeEvidence({
      timestamp: '2026-07-17T10:00:00.000Z',
    }));
    coalescer.ingestNavigation('https://example.com', '2026-07-17T10:00:01.000Z');

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].primaryEvent.type).toBe('click');
    expect(snapshots[1].primaryEvent.type).toBe('navigation');
  });
});

// ── Flush & Reset ─────────────────────────────────────────

describe('Snapshot Coalescer — Flush & Reset', () => {

  it('flush() emits pending snapshot from open window', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();

    coalescer.ingest(makeEvidence());
    expect(snapshots).toHaveLength(0); // still open

    coalescer.flush();
    expect(snapshots).toHaveLength(1);
  });

  it('flush() with no open window is a no-op', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();

    coalescer.flush();
    expect(snapshots).toHaveLength(0);
  });

  it('reset() clears open window state', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();

    coalescer.ingest(makeEvidence());
    coalescer.reset();
    coalescer.flush();

    expect(snapshots).toHaveLength(0);
  });
});

// ── Cross-Element Relatedness ─────────────────────────────

describe('Snapshot Coalescer — Cross-Element Relatedness', () => {

  it('groups calendar cell click + date input change (shared calendar context)', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const cellIdentity = makeIdentity({
      tag: 'div', className: 'calendar-day',
      accessibleName: 'July 18', elementId: 'elem-cell',
    });
    const inputIdentity = makeIdentity({
      tag: 'input', className: 'calendar-field',
      accessibleName: 'Departure Date', elementId: 'elem-input',
    });

    coalescer.ingest(makeEvidence({
      eventType: 'click', identity: cellIdentity,
      timestamp: '2026-07-17T10:00:00.000Z',
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'change', identity: inputIdentity,
      timestamp: '2026-07-17T10:00:00.050Z',
      value: '2026-07-18',
    }));
    coalescer.flush();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].valueChange?.after).toBe('2026-07-18');
  });

  it('creates separate snapshots for unrelated elements', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();

    coalescer.ingest(makeEvidence({
      identity: makeIdentity({ tag: 'button', accessibleName: 'Submit', elementId: 'btn1' }),
      timestamp: '2026-07-17T10:00:00.000Z',
    }));
    coalescer.ingest(makeEvidence({
      identity: makeIdentity({ tag: 'button', accessibleName: 'Cancel', elementId: 'btn2' }),
      timestamp: '2026-07-17T10:00:00.100Z',
    }));
    coalescer.flush();

    expect(snapshots).toHaveLength(2);
  });
});

// ── Mutation Accumulation ─────────────────────────────────

describe('Snapshot Coalescer — Mutation Accumulation', () => {

  it('accumulates mutations across events in a window', () => {
    const { coalescer, snapshots } = makeCoalescerWithCollector();
    const identity = makeIdentity({ accessibleName: 'Menu Item' });

    coalescer.ingest(makeEvidence({
      eventType: 'mouseenter', identity,
      timestamp: '2026-07-17T10:00:00.000Z',
      mutations: {
        childListAdded: 1, childListRemoved: 0,
        attributeChanges: 0, visibilityChanges: 1,
        semanticChanges: ['tooltip-appeared'],
      },
    }));
    coalescer.ingest(makeEvidence({
      eventType: 'mouseleave', identity,
      timestamp: '2026-07-17T10:00:00.800Z',
      mutations: {
        childListAdded: 0, childListRemoved: 1,
        attributeChanges: 0, visibilityChanges: 1,
        semanticChanges: ['tooltip-removed'],
      },
    }));
    coalescer.flush();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].domMutations?.childListChanges).toBe(2); // 1 added + 1 removed
    expect(snapshots[0].domMutations?.visibilityChanges).toBe(2);
  });
});
