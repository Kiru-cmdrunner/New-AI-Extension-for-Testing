/**
 * Integration Tests: Observation Pipeline (Phase D)
 *
 * Tests the wired integration of EventTap → ObservationCoordinator →
 * DocumentObserver → ElementStateCache → behavioral result delivery.
 *
 * Uses mock chrome.runtime.sendMessage to capture BEHAVIORAL_EFFECTS
 * messages without a real service worker.
 *
 * Architecture: .drytis/specs/m1-phase-d-detailed-design.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEventTap, TEST_HOOK } from '../../src/tap/event-tap';
import { ElementStateCache } from '../../src/tap/element-state-cache';
import { DocumentObserver } from '../../src/tap/document-observer';
import { ObservationCoordinator } from '../../src/tap/observation-coordinator';
import { setupStateCacheListeners } from '../../src/tap/state-cache-listeners';
import type { ObservationResult } from '../../src/shared/observation-types';
import type { ObservedEvent } from '../../src/shared/component-types';

describe('Observation Pipeline Integration (Phase D)', () => {
  let cache: ElementStateCache;
  let observer: DocumentObserver;
  let coordinator: ObservationCoordinator;
  let cacheCleanup: (() => void) | null = null;
  let eventTapHandle: ReturnType<typeof createEventTap> | null = null;
  let observedEvents: ObservedEvent[];
  let behavioralResults: ObservationResult[];

  beforeEach(() => {
    document.body.innerHTML = '';
    TEST_HOOK.forceTrusted = true;

    cache = new ElementStateCache();
    observer = new DocumentObserver();
    coordinator = new ObservationCoordinator();
    observedEvents = [];
    behavioralResults = [];

    coordinator.configure({
      cache,
      observer,
      windowDurationMs: 50, // short for fast tests
      onResult: (r) => behavioralResults.push(r),
    });

    cacheCleanup = setupStateCacheListeners(cache);
  });

  afterEach(() => {
    eventTapHandle?.stop();
    eventTapHandle = null;
    cacheCleanup?.();
    cacheCleanup = null;
    coordinator.shutdown();
    TEST_HOOK.forceTrusted = false;
  });

  // ── Full Pipeline ────────────────────────────────────────────────────

  it('click → observation window → result with before/after + mutations', async () => {
    document.body.innerHTML =
      '<input type="checkbox" id="cb" class="opt">';
    const cb = document.getElementById('cb') as HTMLInputElement;
    cb.checked = false;

    // Install event tap with onAfterEvent wired to coordinator
    eventTapHandle = createEventTap({
      onEvent: (event) => observedEvents.push(event),
      onAfterEvent: (targetEl, eventId, eventType, _sel) => {
        if ( eventType === 'click' || eventType === 'change') {
          coordinator.openWindow(eventId, eventType, targetEl);
        }
      },
    });

    // Simulate user click (real browsers fire mousedown → focus → click → change)
    cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    cb.click();
    cb.checked = true;
    cb.className = 'opt checked';

    // Wait for mutations to be captured and window to close
    await new Promise((r) => setTimeout(r, 80));

    // EventTap should have captured the click
    expect(observedEvents.length).toBeGreaterThan(0);
    const clickEvent = observedEvents.find((e) => e.eventType === 'click');
    expect(clickEvent).toBeDefined();

    // Coordinator should have delivered results — checkbox click fires
    // both 'click' and 'change', opening two independent windows
    const clickResult = behavioralResults.find(
      (r) => r.sourceEventType === 'click',
    );
    expect(clickResult).toBeDefined();
    const result = clickResult!;
    expect(result.endReason).toBe('completed');
    expect(result.beforeSnapshot).not.toBeNull();
    expect(result.beforeSnapshot!.checked).toBe(false);
    expect(result.finalSnapshot).not.toBeNull();
    expect(result.finalSnapshot!.checked).toBe(true);
    expect(result.mutationCount).toBeGreaterThanOrEqual(1);
  });

  it('change event opens observation window', async () => {
    document.body.innerHTML = '<select id="sel"><option value="a">A</option><option value="b">B</option></select>';
    const sel = document.getElementById('sel') as HTMLSelectElement;

    // Pre-populate cache (simulating focus listener)
    cache.capture(sel);

    eventTapHandle = createEventTap({
      onEvent: (event) => observedEvents.push(event),
      onAfterEvent: (targetEl, eventId, eventType, _sel) => {
        if (eventType === 'click' || eventType === 'change') {
          coordinator.openWindow(eventId, eventType, targetEl);
        }
      },
    });

    // Simulate user changing selection
    sel.value = 'b';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise((r) => setTimeout(r, 80));

    const changeResult = behavioralResults.find(
      (r) => r.sourceEventType === 'change',
    );
    expect(changeResult).toBeDefined();
    expect(changeResult!.beforeSnapshot!.value).toBe('a');
    expect(changeResult!.finalSnapshot!.value).toBe('b');
  });

  it('non-click/change events do NOT open observation windows', async () => {
    document.body.innerHTML = '<input type="text" id="txt">';
    const txt = document.getElementById('txt')!;

    let windowOpened = false;

    eventTapHandle = createEventTap({
      onEvent: (event) => observedEvents.push(event),
      onAfterEvent: (targetEl, eventId, eventType, _sel) => {
        if (eventType === 'click' || eventType === 'change') {
          windowOpened = true;
          coordinator.openWindow(eventId, eventType, targetEl);
        }
      },
    });

    // Focus — should NOT open a window
    txt.focus();
    txt.blur();

    await new Promise((r) => setTimeout(r, 60));

    expect(windowOpened).toBe(false);
    expect(behavioralResults.length).toBe(0);
  });

  // ── Rapid Interactions ───────────────────────────────────────────────

  it('two rapid clicks produce two independent observation results', async () => {
    document.body.innerHTML = '<input type="checkbox" id="cb">';
    const cb = document.getElementById('cb') as HTMLInputElement;
    cb.checked = false;

    eventTapHandle = createEventTap({
      onEvent: () => {},
      onAfterEvent: (targetEl, eventId, eventType, _sel) => {
        if (eventType === 'click' || eventType === 'change') {
          coordinator.openWindow(eventId, eventType, targetEl);
        }
      },
    });

    // First click (mousedown → click → change)
    cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    cb.click();
    cb.checked = true;

    await new Promise((r) => setTimeout(r, 10));

    // Second click (mousedown → click → change)
    cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    cb.click();
    cb.checked = false;

    await new Promise((r) => setTimeout(r, 80));

    // Each checkbox click fires both 'click' and 'change', opening
    // 2 windows per toggle → 4 results for two toggles
    expect(behavioralResults.length).toBe(4);
    const clickResults = behavioralResults.filter(
      (r) => r.sourceEventType === 'click',
    );
    expect(clickResults.length).toBe(2);
    expect(clickResults[0].sourceEventId).not.toBe(
      clickResults[1].sourceEventId,
    );
  });

  // ── Shutdown During Recording ────────────────────────────────────────

  it('shutdown finalizes open windows with recording-stopped', async () => {
    document.body.innerHTML = '<button id="btn">Click</button>';
    const btn = document.getElementById('btn')!;

    eventTapHandle = createEventTap({
      onEvent: () => {},
      onAfterEvent: (targetEl, eventId, eventType, _sel) => {
        if (eventType === 'click' || eventType === 'change') {
          coordinator.openWindow(eventId, eventType, targetEl);
        }
      },
    });

    btn.click();

    // Shutdown BEFORE window timer fires
    coordinator.shutdown();

    expect(behavioralResults.length).toBe(1);
    expect(behavioralResults[0].endReason).toBe('recording-stopped');
  });

  it('shutdown delivers results with mutations captured so far', async () => {
    document.body.innerHTML = '<div id="el" class="before">Text</div>';
    const el = document.getElementById('el')!;

    eventTapHandle = createEventTap({
      onEvent: () => {},
      onAfterEvent: (targetEl, eventId, eventType, _sel) => {
        if (eventType === 'click' || eventType === 'change') {
          coordinator.openWindow(eventId, eventType, targetEl);
        }
      },
    });

    el.click();

    // Trigger a mutation
    el.setAttribute('class', 'after');
    await new Promise((r) => setTimeout(r, 20));

    // Shutdown before window closes
    coordinator.shutdown();

    expect(behavioralResults.length).toBe(1);
    expect(behavioralResults[0].mutationCount).toBeGreaterThanOrEqual(1);
    expect(behavioralResults[0].endReason).toBe('recording-stopped');
  });

  // ── No Mutations Case ────────────────────────────────────────────────

  it('click with no DOM mutations produces result with empty mutations', async () => {
    document.body.innerHTML = '<div id="static">Static</div>';
    const el = document.getElementById('static')!;

    eventTapHandle = createEventTap({
      onEvent: () => {},
      onAfterEvent: (targetEl, eventId, eventType, _sel) => {
        if (eventType === 'click' || eventType === 'change') {
          coordinator.openWindow(eventId, eventType, targetEl);
        }
      },
    });

    el.click();

    await new Promise((r) => setTimeout(r, 80));

    expect(behavioralResults.length).toBe(1);
    expect(behavioralResults[0].mutations).toEqual([]);
    expect(behavioralResults[0].mutationCount).toBe(0);
  });

  // ── Correlation by eventId ───────────────────────────────────────────

  it('result sourceEventId matches the ObservedEvent eventId', async () => {
    document.body.innerHTML = '<button id="btn">Click</button>';
    const btn = document.getElementById('btn')!;

    eventTapHandle = createEventTap({
      onEvent: (event) => observedEvents.push(event),
      onAfterEvent: (targetEl, eventId, eventType, _sel) => {
        if (eventType === 'click' || eventType === 'change') {
          coordinator.openWindow(eventId, eventType, targetEl);
        }
      },
    });

    btn.click();

    await new Promise((r) => setTimeout(r, 80));

    expect(observedEvents.length).toBeGreaterThan(0);
    const clickEvent = observedEvents.find((e) => e.eventType === 'click')!;

    expect(behavioralResults.length).toBe(1);
    expect(behavioralResults[0].sourceEventId).toBe(clickEvent.eventId);
  });
});
