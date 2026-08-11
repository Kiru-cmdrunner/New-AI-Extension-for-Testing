/**
 * M1 Unit Tests: EventTap navigation events fire onAfterEvent + navType
 *
 * Verifies that:
 *   1. emitSpaNavigation fires onAfterEvent (not just onEvent)
 *   2. Navigation events carry the correct navType
 *   3. All four navigation triggers work: pushState, replaceState, popstate, hashchange
 *
 * Architecture: Behavioral Evidence Model v3.0 §7.2, §7.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createEventTap, TEST_HOOK } from '../../src/tap/event-tap';
import type { ObservedEvent } from '../../src/shared/component-types';

describe('EventTap — navigation onAfterEvent + navType (M1)', () => {
  beforeEach(() => {
    // Force all events as trusted for testing
    TEST_HOOK.forceTrusted = true;
    // Reset URL
    window.history.replaceState({}, '', '/test');
  });

  it('fires onAfterEvent when pushState triggers navigation', () => {
    let onEventCalled = false;
    let onAfterEventCalled = false;
    let onAfterEventType = '';
    let onAfterEventId = '';

    const handle = createEventTap({
      onEvent: (event: ObservedEvent) => {
        if (event.eventType === 'navigation') {
          onEventCalled = true;
        }
      },
      onAfterEvent: (_el, eventId, eventType) => {
        onAfterEventCalled = true;
        onAfterEventType = eventType;
        onAfterEventId = eventId;
      },
    });

    // Trigger pushState
    history.pushState({}, '', '/new-page');

    expect(onEventCalled).toBe(true);
    expect(onAfterEventCalled).toBe(true);
    expect(onAfterEventType).toBe('navigation');
    expect(onAfterEventId).toBeTruthy();

    handle.stop();
  });

  it('fires onAfterEvent when replaceState triggers navigation', () => {
    let onAfterEventCalled = false;

    const handle = createEventTap({
      onEvent: () => {},
      onAfterEvent: () => {
        onAfterEventCalled = true;
      },
    });

    history.replaceState({}, '', '/replaced');

    expect(onAfterEventCalled).toBe(true);

    handle.stop();
  });

  it('navigation ObservedEvent has navType="pushState" for pushState', () => {
    let navEvent: ObservedEvent | null = null;

    const handle = createEventTap({
      onEvent: (event: ObservedEvent) => {
        if (event.eventType === 'navigation') {
          navEvent = event;
        }
      },
    });

    history.pushState({}, '', '/push-test');

    expect(navEvent).not.toBeNull();
    expect(navEvent!.navType).toBe('pushState');

    handle.stop();
  });

  it('navigation ObservedEvent has navType="replaceState" for replaceState', () => {
    let navEvent: ObservedEvent | null = null;

    const handle = createEventTap({
      onEvent: (event: ObservedEvent) => {
        if (event.eventType === 'navigation') {
          navEvent = event;
        }
      },
    });

    history.replaceState({}, '', '/replace-test');

    expect(navEvent).not.toBeNull();
    expect(navEvent!.navType).toBe('replaceState');

    handle.stop();
  });

  it('navigation ObservedEvent has navType="popstate" for popstate', () => {
    // Set up two history entries BEFORE creating EventTap (so pushState doesn't interfere)
    history.pushState({}, '', '/page1');
    history.pushState({}, '', '/page2');

    let navEvent: ObservedEvent | null = null;

    const handle = createEventTap({
      onEvent: (event: ObservedEvent) => {
        if (event.eventType === 'navigation') {
          navEvent = event;
        }
      },
    });

    // Pop back — URL changes from /page2 to /page1
    window.history.back();

    // jsdom fires popstate asynchronously, so we need to wait
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(navEvent).not.toBeNull();
        expect(navEvent!.navType).toBe('popstate');
        handle.stop();
        resolve();
      }, 50);
    });
  });

  it('navigation ObservedEvent has navType="hashchange" for hashchange', () => {
    let navEvent: ObservedEvent | null = null;

    const handle = createEventTap({
      onEvent: (event: ObservedEvent) => {
        if (event.eventType === 'navigation') {
          navEvent = event;
        }
      },
    });

    // Change hash
    window.location.hash = '#section1';

    // Dispatch hashchange event
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(navEvent).not.toBeNull();
    expect(navEvent!.navType).toBe('hashchange');

    handle.stop();
  });

  it('onAfterEvent is NOT called when onAfterEvent is not provided', () => {
    let onEventCalled = false;

    // No onAfterEvent callback — should not crash
    const handle = createEventTap({
      onEvent: () => {
        onEventCalled = true;
      },
    });

    history.pushState({}, '', '/no-after-event');

    expect(onEventCalled).toBe(true);
    // No crash = success

    handle.stop();
  });

  it('navigation events include correct pageUrl and pageTitle', () => {
    let navEvent: ObservedEvent | null = null;

    document.title = 'Test Page Title';

    const handle = createEventTap({
      onEvent: (event: ObservedEvent) => {
        if (event.eventType === 'navigation') {
          navEvent = event;
        }
      },
    });

    history.pushState({}, '', '/url-test');

    expect(navEvent).not.toBeNull();
    expect(navEvent!.pageUrl).toContain('/url-test');
    expect(navEvent!.pageTitle).toBe('Test Page Title');

    handle.stop();
  });

  it('duplicate navigation (same URL) is suppressed', () => {
    let navCount = 0;

    const handle = createEventTap({
      onEvent: (event: ObservedEvent) => {
        if (event.eventType === 'navigation') {
          navCount++;
        }
      },
    });

    history.pushState({}, '', '/dup-test');
    // Push same URL again — should be suppressed
    history.pushState({}, '', '/dup-test');

    expect(navCount).toBe(1);

    handle.stop();
  });

  it('stop() removes navigation listeners', () => {
    let navCount = 0;

    const handle = createEventTap({
      onEvent: (event: ObservedEvent) => {
        if (event.eventType === 'navigation') {
          navCount++;
        }
      },
    });

    handle.stop();

    // After stop, navigation should not fire
    history.pushState({}, '', '/after-stop');

    expect(navCount).toBe(0);
  });
});
