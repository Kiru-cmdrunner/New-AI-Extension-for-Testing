/**
 * Spec: .drytis/specs/hover-capture-evidence-contract-v1.md §4 (T1b, T1b-R), §5 (R-Q1..R-Q9), §12 AC-1/4/20/21
 * Pins 1 (baseline fixtures) + 4 (frozen) + 9 (baseline-degradation) of §14.
 *
 * openHoverWindow must capture the T1b owned-surface baseline at the enter
 * instant; hover-window close must compute + freeze the HoverQualification and
 * attach it to the delivered BehavioralEvidence envelope.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import { isHoverDiscoveryEnter } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { ObservedEvent } from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';

describe('HEC: T1b baseline + qualification at hover-window close', () => {
  let cache: TargetStateCache;
  let observer: DOMObserver;
  let collector: EvidenceCollector;
  let delivered: BehavioralEvidence[];
  let mockNow: number;

  beforeEach(() => {
    document.body.innerHTML = '';
    delivered = [];
    mockNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
    vi.useFakeTimers();

    global.chrome = {
      runtime: {
        sendMessage: vi.fn((msg: { type: string; payload?: unknown }, cb?: () => void) => {
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            delivered.push(msg.payload as BehavioralEvidence);
          }
          if (cb) cb();
        }),
        lastError: undefined,
      },
    } as unknown as typeof chrome;

    cache = new TargetStateCache();
    observer = new DOMObserver();
    collector = new EvidenceCollector({ targetStateCache: cache, domObserver: observer });
    collector.start();
  });

  afterEach(() => {
    collector.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function advance(ms: number): void {
    mockNow += ms;
    vi.advanceTimersByTime(ms);
  }

  function gatedEnterEvent(el: Element, eventId: string, seq: number): ObservedEvent {
    const ev = makeObservedEvent({
      eventId,
      eventType: 'mouseenter',
      captureSeq: seq,
      timestamp: mockNow,
      target: {
        stableId: el.id || null,
        cssSelector: el.id ? `#${el.id}` : 'div',
        tag: el.tagName,
        ariaRole: el.getAttribute('role'),
      },
      domContext: {
        ariaExpanded: el.getAttribute('aria-expanded'),
        ariaHasPopup: el.getAttribute('aria-haspopup'),
        tabIndex: 0,
      } as never,
    });
    return ev;
  }

  /** Mirror EventTap: a real ElementIdentity record rides the enter. */
  function identityOf(el: Element): Record<string, unknown> {
    return {
      stableId: el.id || null,
      cssSelector: el.id ? `#${el.id}` : 'div',
      xPath: `/html/body/${el.tagName.toLowerCase()}[@id='${el.id}']`,
      tag: el.tagName,
      ariaRole: el.getAttribute('role'),
    };
  }

  it('AC-20: pre-existing open state at enter never earns reveal (T1b-R)', () => {
    // Anchor already aria-expanded=true BEFORE the enter — a later
    // true→true "flip" is not a transition.
    const trigger = document.createElement('div');
    trigger.id = 'menu-trigger';
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-expanded', 'true');
    document.body.appendChild(trigger);

    const ev = gatedEnterEvent(trigger, 'evt-p1-1', 1);
    expect(isHoverDiscoveryEnter(ev)).toBe(true);

    collector.onAfterEvent(trigger, 'evt-p1-1', 'mouseenter', '', identityOf(trigger) as never, ev);
    expect(collector.getActiveWindowCount()).toBe(1);

    // Drain at STOP: closes the provisional hover window and delivers.
    collector.drainHoverWindowsAtStop();

    const env = delivered.find((d) => d.sourceEventId === 'evt-p1-1');
    expect(env).toBeTruthy();
    const q = (env as { hoverQualification?: { verdict: string; evidenceReason: string } }).hoverQualification;
    expect(q).toBeTruthy();
    expect(q!.verdict).toBe('gesture-only');
    expect(q!.evidenceReason).toContain('gesture-only');
  });

  it('AC-20: post-enter aria-expanded false→true earns reveal (transition)', async () => {
    const trigger = document.createElement('div');
    trigger.id = 'menu-trigger-2';
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-expanded', 'false');
    document.body.appendChild(trigger);

    const ev = gatedEnterEvent(trigger, 'evt-p1-2', 2);
    expect(isHoverDiscoveryEnter(ev)).toBe(true);
    collector.onAfterEvent(trigger, 'evt-p1-2', 'mouseenter', '', identityOf(trigger) as never, ev);

    advance(100);
    // Post-enter transition: the app expands the anchor (batch after open).
    // Real MutationObserver callbacks are microtask-delivered — let them run
    // BEFORE flipping the attribute, then flush the microtask queue again.
    await Promise.resolve();
    await Promise.resolve();
    trigger.setAttribute('aria-expanded', 'true');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    advance(1);

    collector.drainHoverWindowsAtStop();

    const env = delivered.find((d) => d.sourceEventId === 'evt-p1-2');
    expect(env).toBeTruthy();
    const q = (env as { hoverQualification?: { verdict: string; evidenceClass: string; evidenceReason: string } }).hoverQualification;
    expect(q).toBeTruthy();
    expect(q!.verdict).toBe('evidenced');
    expect(q!.evidenceClass).toBe('reveal');
    expect(q!.evidenceReason).toContain('aria-expanded');
  });

  it('AC-4: the qualification record is frozen on the envelope', () => {
    const trigger = document.createElement('div');
    trigger.id = 'menu-trigger-3';
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    document.body.appendChild(trigger);

    const ev = gatedEnterEvent(trigger, 'evt-p1-3', 3);
    collector.onAfterEvent(trigger, 'evt-p1-3', 'mouseenter', '', identityOf(trigger) as never, ev);
    collector.drainHoverWindowsAtStop();

    const env = delivered.find((d) => d.sourceEventId === 'evt-p1-3');
    expect(env).toBeTruthy();
    const q = (env as { hoverQualification?: object }).hoverQualification;
    expect(q).toBeTruthy();
    expect(Object.isFrozen(q)).toBe(true);
  });

  it('AC-21: missing baseline degrades honestly — no fabricated transition', () => {
    // Anchor with NO recorded baseline state (window opened without baseline
    // capture — e.g. degraded path). A visibility flip must NOT earn reveal
    // because the from-state is unknown... unless the flip is itself the
    // recorded transition with its own old/new pair (R-Q8: only missing
    // baseline ENTRIES degrade; explicit transitions carry their own pair).
    const trigger = document.createElement('div');
    trigger.id = 'menu-trigger-4';
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    document.body.appendChild(trigger);

    const ev = gatedEnterEvent(trigger, 'evt-p1-4', 4);
    collector.onAfterEvent(trigger, 'evt-p1-4', 'mouseenter', '', identityOf(trigger) as never, ev);
    collector.drainHoverWindowsAtStop();

    const env = delivered.find((d) => d.sourceEventId === 'evt-p1-4');
    expect(env).toBeTruthy();
    const q = (env as { hoverQualification?: { verdict: string } }).hoverQualification;
    expect(q).toBeTruthy();
    expect(q!.verdict).toBe('gesture-only');
  });
});

describe('HEC T3 hidden-removal earning (round-2 defect pin)', () => {
  it('hidden removed (old truthy → null) with baseline hidden:true EARNS reveal', async () => {
    const { computeHoverQualification } = await import('../../src/tap/hover-qualification');
    const q = computeHoverQualification({
      anchorIdentity: {
        tag: 'DIV', stableId: 'm', accessibleName: 'Menu', cssSelector: '#m',
        domPath: 'html>body>div#m', classes: '', ariaRole: null, testId: null,
      },
      anchorKey: 'id:m', clickAnchorKey: 'id:m', resolution: 'self',
      hoverReveal: false, shaped: true,
      baseline: { anchor: { ariaExpanded: null, ariaHidden: null, hidden: true } },
      // dom-observer records new: getAttribute() → null after removal.
      domChanges: [{
        types: ['attributes'],
        targetPath: 'html>body>div#m',
        target: '#m', path: 'html>body>div#m', targetTag: 'DIV',
        shadowContext: null,
        attributeDeltas: { hidden: { old: 'hidden', new: null } },
        addedNodesCount: 0, removedNodesCount: 0, characterDataDelta: null,
        changedAttributes: ['hidden'], firstBatchIndex: 0, firstMutationAt: 5,
      }],
      newSurfaces: [], visibilityChanges: [], pointerPathEnters: [], networkRows: [],
      navigationCount: 0,
    });
    expect(q.verdict).toBe('evidenced');
    expect(q.evidenceClass).toBe('reveal');
  });

  it('hidden removal without a baseline degrades honestly (R-Q8)', async () => {
    const { computeHoverQualification } = await import('../../src/tap/hover-qualification');
    const q = computeHoverQualification({
      anchorIdentity: {
        tag: 'DIV', stableId: 'm', accessibleName: 'Menu', cssSelector: '#m',
        domPath: 'html>body>div#m', classes: '', ariaRole: null, testId: null,
      },
      anchorKey: 'id:m', clickAnchorKey: 'id:m', resolution: 'self',
      hoverReveal: false, shaped: true,
      baseline: null,
      domChanges: [{
        types: ['attributes'],
        targetPath: 'html>body>div#m',
        target: '#m', path: 'html>body>div#m', targetTag: 'DIV',
        shadowContext: null,
        attributeDeltas: { hidden: { old: 'hidden', new: null } },
        addedNodesCount: 0, removedNodesCount: 0, characterDataDelta: null,
        changedAttributes: ['hidden'], firstBatchIndex: 0, firstMutationAt: 5,
      }],
      newSurfaces: [], visibilityChanges: [], pointerPathEnters: [], networkRows: [],
      navigationCount: 0,
    });
    expect(q.verdict).toBe('gesture-only');
  });
});
