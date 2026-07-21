/**
 * Mutation Provider Surface Detection Tests
 *
 * Tests that the MutationProvider emits correct evidence when domContext
 * contains surfaceType data captured by the recorder's MutationObserver.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MutationProvider } from '../../src/classifier/evidence/providers/mutation-provider.ts';
import {
  resetEventCounter,
  makeTarget,
  clickEvent,
} from './helpers.ts';
import type { InteractionBuffer } from '../../src/classifier/evidence/types.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function provider() {
  return new MutationProvider();
}

const emptyBuffer: InteractionBuffer = {
  elementKey: '',
  events: [],
  evidence: [],
  startTime: new Date().toISOString(),
  lastEventTime: new Date().toISOString(),
};

function clickWithSurface(surfaceType: string, surfaceRole?: string, surfaceLabel?: string) {
  const event = clickEvent({
    tag: 'BUTTON',
    accessibleName: 'Delete',
  });
  // Add domContext with surface data
  (event as any).domContext = {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    surfaceType,
    surfaceRole: surfaceRole || null,
    surfaceLabel: surfaceLabel || null,
  };
  return event;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MutationProvider — Surface Detection on Events', () => {
  beforeEach(() => resetEventCounter());

  it('emits Modal evidence when domContext.surfaceType=modal', () => {
    const event = clickWithSurface('modal', 'dialog', 'Delete Confirmation');
    const ev = provider().onEvent(event, emptyBuffer);
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Modal');
    expect(ev[0].confidence).toBe(0.85);
    expect(ev[0].weight).toBe(0.8);
    expect(ev[0].metadata.surfaceRole).toBe('dialog');
    expect(ev[0].metadata.surfaceLabel).toBe('Delete Confirmation');
    expect(ev[0].reason).toContain('modal');
  });

  it('emits Drawer evidence when domContext.surfaceType=drawer', () => {
    const event = clickWithSurface('drawer', null, 'Filters Panel');
    const ev = provider().onEvent(event, emptyBuffer);
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Drawer');
    expect(ev[0].confidence).toBe(0.85);
    expect(ev[0].metadata.surfaceLabel).toBe('Filters Panel');
  });

  it('emits Popover evidence when domContext.surfaceType=popover', () => {
    const event = clickWithSurface('popover', 'menu', 'Context Menu');
    const ev = provider().onEvent(event, emptyBuffer);
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Popover');
    expect(ev[0].confidence).toBe(0.8);
  });

  it('emits Tooltip evidence when domContext.surfaceType=tooltip', () => {
    const event = clickWithSurface('tooltip', 'tooltip', 'Click for help');
    const ev = provider().onEvent(event, emptyBuffer);
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Tooltip');
    expect(ev[0].confidence).toBe(0.8);
  });

  it('returns empty when domContext has no surfaceType', () => {
    const event = clickEvent({
      tag: 'BUTTON',
      accessibleName: 'Submit',
    });
    // Normal click without surface data
    (event as any).domContext = {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
    };
    const ev = provider().onEvent(event, emptyBuffer);
    expect(ev).toHaveLength(0);
  });

  it('returns empty for navigation events', () => {
    const p = provider();
    const navEvent = {
      eventId: 'evt-0001',
      eventType: 'navigation',
      timestamp: new Date().toISOString(),
      url: 'https://example.com',
      title: 'Test',
      transitionType: 'link',
    };
    const ev = p.onEvent(navEvent as any, emptyBuffer);
    expect(ev).toHaveLength(0);
  });
});

// ── InfiniteScroll Detection Tests ──────────────────────────────────────────

describe('MutationProvider — InfiniteScroll Detection on Commit', () => {
  beforeEach(() => resetEventCounter());

  function scrollBuffer(opts: { scrollCount: number; distinctElements?: number }) {
    const events: any[] = [];
    for (let i = 0; i < opts.scrollCount; i++) {
      events.push({
        eventId: `evt-${String(i + 1).padStart(4, '0')}`,
        eventType: 'scroll',
        timestamp: new Date().toISOString(),
        target: makeTarget({
          tag: 'DIV',
          accessibleName: 'Scroll Container',
          elementId: opts.distinctElements && opts.distinctElements > 1
            ? `el-${i % opts.distinctElements}`
            : 'el-1',
        }),
        valueBefore: null,
        valueAfter: null,
        checkedBefore: null,
        checkedAfter: null,
        domContext: null,
      });
    }
    return {
      elementKey: 'DIV|null|.scroll-container',
      events,
      evidence: [],
      startTime: events[0]?.timestamp || new Date().toISOString(),
      lastEventTime: events[events.length - 1]?.timestamp || new Date().toISOString(),
    } as InteractionBuffer;
  }

  it('emits InfiniteScroll evidence for 2+ scrolls with multiple elements', () => {
    const buf = scrollBuffer({ scrollCount: 3, distinctElements: 2 });
    const ev = provider().onCommit(buf);
    const scrollEvidence = ev.filter(e => e.suggestedType === 'InfiniteScroll');
    expect(scrollEvidence).toHaveLength(1);
    expect(scrollEvidence[0].confidence).toBe(0.6);
    expect(scrollEvidence[0].weight).toBe(0.5);
  });

  it('does not emit InfiniteScroll for a single scroll', () => {
    const buf = scrollBuffer({ scrollCount: 1, distinctElements: 1 });
    const ev = provider().onCommit(buf);
    const scrollEvidence = ev.filter(e => e.suggestedType === 'InfiniteScroll');
    expect(scrollEvidence).toHaveLength(0);
  });

  it('does not emit InfiniteScroll for 2 scrolls on same element', () => {
    const buf = scrollBuffer({ scrollCount: 2, distinctElements: 1 });
    const ev = provider().onCommit(buf);
    const scrollEvidence = ev.filter(e => e.suggestedType === 'InfiniteScroll');
    expect(scrollEvidence).toHaveLength(0);
  });
});
