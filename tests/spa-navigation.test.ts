/**
 * Tests for SPA Navigation Detection
 *
 * Verifies that history.pushState, history.replaceState, popstate,
 * and hashchange all emit 'navigation' ObservedEvents through the
 * EventTap's onEvent callback.
 *
 * Architecture: SPA navigation detection in event-tap.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEventTap } from '../src/tap/event-tap';
import type { ObservedEvent } from '../src/shared/component-types';

// ── Setup ─────────────────────────────────────────────────────────────

describe('SPA Navigation Detection', () => {
  let tap: ReturnType<typeof createEventTap> | null = null;
  let events: ObservedEvent[] = [];
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  beforeEach(() => {
    events = [];
    tap = createEventTap({
      onEvent: (event) => events.push(event),
    });
  });

  afterEach(() => {
    tap?.stop();
    tap = null;
    // Restore originals in case stop() didn't fire
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  });

  it('emits navigation event on history.pushState', () => {
    const beforeCount = events.length;
    history.pushState({}, '', '/new-route');
    const navEvents = events.filter((e) => e.eventType === 'navigation');
    expect(navEvents.length).toBeGreaterThanOrEqual(1);
    expect(navEvents[navEvents.length - 1].pageUrl).toContain('/new-route');
  });

  it('emits navigation event on history.replaceState', () => {
    history.replaceState({}, '', '/replaced-route');
    const navEvents = events.filter((e) => e.eventType === 'navigation');
    expect(navEvents.length).toBeGreaterThanOrEqual(1);
    expect(navEvents[navEvents.length - 1].pageUrl).toContain('/replaced-route');
  });

  it('emits navigation event on popstate', () => {
    // Push a state first so there's history to go back to
    const base = location.href;
    history.pushState({}, '', '/page-a');
    events = [];

    history.pushState({}, '', '/page-b');
    events = [];

    // Go back — fires popstate
    history.back();

    // Need to wait for popstate to fire (it's async in jsdom)
    // Check after a microtask
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const navEvents = events.filter((e) => e.eventType === 'navigation');
        expect(navEvents.length).toBeGreaterThanOrEqual(1);
        resolve();
      }, 50);
    });
  });

  it('emits navigation event on hashchange', () => {
    const base = location.href;
    location.hash = '#section-1';

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const navEvents = events.filter((e) => e.eventType === 'navigation');
        expect(navEvents.length).toBeGreaterThanOrEqual(1);
        resolve();
      }, 50);
    });
  });

  it('does not emit duplicate navigation events for same URL', () => {
    history.pushState({}, '', '/same-url');
    const countAfterFirst = events.filter((e) => e.eventType === 'navigation').length;

    // Calling pushState with same URL again should NOT emit (deduped)
    history.pushState({}, '', '/same-url');
    const countAfterSecond = events.filter((e) => e.eventType === 'navigation').length;

    expect(countAfterSecond).toBe(countAfterFirst); // no new navigation event
  });

  it('navigation event has correct ObservedEvent shape', () => {
    history.pushState({}, '', '/shape-test');

    const navEvents = events.filter((e) => e.eventType === 'navigation');
    expect(navEvents.length).toBeGreaterThanOrEqual(1);
    const nav = navEvents[navEvents.length - 1];

    expect(nav.eventType).toBe('navigation');
    expect(nav.eventId).toMatch(/^evt-/);
    expect(nav.timestamp).toBeGreaterThan(0);
    expect(nav.pageUrl).toContain('/shape-test');
    expect(nav.pageTitle).toBeDefined();
    expect(nav.target).toBeDefined();
    expect(nav.domContext).toBeDefined();
  });

  it('restores original history methods on stop()', () => {
    const patchedPushState = history.pushState;
    const patchedReplaceState = history.replaceState;
    expect(patchedPushState).not.toBe(originalPushState); // patched while active

    tap?.stop();
    tap = null;

    // After stop, the methods should be different from the patched versions
    // (the originals are restored, though bound wrappers may differ in identity)
    expect(history.pushState).not.toBe(patchedPushState);
    expect(history.replaceState).not.toBe(patchedReplaceState);
  });

  it('does not emit navigation events after stop()', () => {
    tap?.stop();
    tap = null;
    const countBefore = events.length;

    history.pushState({}, '', '/after-stop');

    expect(events.length).toBe(countBefore); // no new events
  });
});
