/**
 * 7.1-W1 Unit Tests: MAIN-world nav-inject bridge + double-emission guard
 *
 * Spec: .drytis/specs/phase-7-1-w1-spa-nav-inject.md §5 (tests 1-5)
 *
 * Verifies:
 *   1. A `cmdrunner-nav` CustomEvent (dispatched by the MAIN-world
 *      nav-inject.js) produces exactly one synthetic navigation
 *      ObservedEvent through the existing emit path (navType + pageUrl).
 *   2. Same-URL duplicate details are suppressed (lastKnownUrl dedup).
 *   3. Double emission (isolated patch + bridge both firing for one URL
 *      change) yields exactly ONE ObservedEvent.
 *   4. popstate / hashchange details map to the correct navType.
 *   5. Bridge absent → existing isolated-world path unchanged
 *      (regression pin; plain jsdom, no MAIN world).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createEventTap, TEST_HOOK } from '../../src/tap/event-tap';
import type { ObservedEvent } from '../../src/shared/component-types';

/** Dispatch a MAIN-world-style nav detail on the shared window. */
function dispatchNavDetail(detail: {
  navType: string;
  fromUrl: string;
  toUrl: string;
}): void {
  window.dispatchEvent(
    new CustomEvent('cmdrunner-nav', { detail }),
  );
}

describe('7.1-W1 — MAIN-world nav bridge', () => {
  beforeEach(() => {
    TEST_HOOK.forceTrusted = true;
    window.history.replaceState({}, '', '/w1-test');
  });

  it('test 1: cmdrunner-nav detail → exactly one navigation ObservedEvent with navType + pageUrl', () => {
    const navEvents: ObservedEvent[] = [];
    const handle = createEventTap({
      onEvent: (event) => {
        if (event.eventType === 'navigation') navEvents.push(event);
      },
    });

    // MAIN world changed the URL via the (MAIN-world) history API. In
    // jsdom both worlds share one history object, so move the URL first,
    // then simulate the bridge notification.
    window.history.pushState({}, '', '/search?q=w1');
    dispatchNavDetail({
      navType: 'pushState',
      fromUrl: 'http://localhost:3000/w1-test',
      toUrl: 'http://localhost:3000/search?q=w1',
    });

    expect(navEvents.length).toBe(1);
    expect(navEvents[0].navType).toBe('pushState');
    expect(navEvents[0].pageUrl).toContain('/search?q=w1');
    expect(navEvents[0].pageTitle).toBe(document.title);

    handle.stop();
  });

  it('test 2: same-URL duplicate detail suppressed (lastKnownUrl dedup)', () => {
    const navEvents: ObservedEvent[] = [];
    const handle = createEventTap({
      onEvent: (event) => {
        if (event.eventType === 'navigation') navEvents.push(event);
      },
    });

    window.history.pushState({}, '', '/dedup');
    dispatchNavDetail({ navType: 'pushState', fromUrl: '/w1-test', toUrl: '/dedup' });
    // Duplicate delivery (e.g. both a stale MAIN dispatch and the listener
    // firing twice for the same URL change).
    dispatchNavDetail({ navType: 'pushState', fromUrl: '/w1-test', toUrl: '/dedup' });

    expect(navEvents.length).toBe(1);

    handle.stop();
  });

  it('test 3: isolated patch + bridge both firing for one URL change → exactly ONE event (double-emission pin)', () => {
    const navEvents: ObservedEvent[] = [];
    const handle = createEventTap({
      onEvent: (event) => {
        if (event.eventType === 'navigation') navEvents.push(event);
      },
    });

    // In jsdom the isolated-world patch IS active (shared history), so a
    // pushState here fires the patch; then the MAIN-world bridge delivers
    // its own notification of the SAME URL change.
    window.history.pushState({}, '', '/both-worlds');
    dispatchNavDetail({
      navType: 'pushState',
      fromUrl: '/dedup',
      toUrl: '/both-worlds',
    });

    // lastKnownUrl dedup must collapse the pair into ONE synthetic event.
    expect(navEvents.length).toBe(1);
    expect(navEvents[0].navType).toBe('pushState');

    handle.stop();
  });

  it('test 4: popstate and hashchange details map to correct navType', () => {
    const navEvents: ObservedEvent[] = [];

    // Faithful MAIN-world simulation: capture the RAW pushState BEFORE the
    // tap patches it, then change the URL through it — the tap's isolated
    // patch does NOT see it (exactly how a MAIN-world router call looks
    // from the isolated world). The bridge detail then delivers navType.
    const rawPush = history.pushState;
    const handle = createEventTap({
      onEvent: (event) => {
        if (event.eventType === 'navigation') navEvents.push(event);
      },
    });

    rawPush.call(history, {}, '', '/pop-dest');
    dispatchNavDetail({ navType: 'popstate', fromUrl: '/dedup', toUrl: '/pop-dest' });

    rawPush.call(history, {}, '', '/hash-dest');
    dispatchNavDetail({ navType: 'hashchange', fromUrl: '/pop-dest', toUrl: '/hash-dest' });

    const types = navEvents.map((e) => e.navType);
    expect(types).toContain('popstate');
    expect(types).toContain('hashchange');

    handle.stop();
  });

  it('test 5: bridge absent → isolated path unchanged (regression pin)', () => {
    const navEvents: ObservedEvent[] = [];
    const handle = createEventTap({
      onEvent: (event) => {
        if (event.eventType === 'navigation') navEvents.push(event);
      },
    });

    // No cmdrunner-nav dispatch at all — plain isolated-world behavior.
    window.history.pushState({}, '', '/isolated-only');

    expect(navEvents.length).toBe(1);
    expect(navEvents[0].navType).toBe('pushState');

    handle.stop();
  });

  it('test 6: bridge ignores malformed detail (no invention)', () => {
    const navEvents: ObservedEvent[] = [];
    const handle = createEventTap({
      onEvent: (event) => {
        if (event.eventType === 'navigation') navEvents.push(event);
      },
    });

    // Deliberately malformed detail — CustomEvent detail accepts unknown.
    window.dispatchEvent(new CustomEvent('cmdrunner-nav', { detail: null }));

    expect(navEvents.length).toBe(0);

    handle.stop();
  });
});

describe('7.1-W1 — bridge lifecycle', () => {
  beforeEach(() => {
    TEST_HOOK.forceTrusted = true;
    window.history.replaceState({}, '', '/w1-lifecycle');
  });

  it('stop() removes the bridge listener (no events after stop)', () => {
    const navEvents: ObservedEvent[] = [];
    const handle = createEventTap({
      onEvent: (event) => {
        if (event.eventType === 'navigation') navEvents.push(event);
      },
    });

    window.history.pushState({}, '', '/stopped-soon');
    handle.stop();

    // After stop, a MAIN-world delivery must not resurrect the tap.
    dispatchNavDetail({ navType: 'pushState', fromUrl: '/w1-lifecycle', toUrl: '/stopped-soon' });
    expect(navEvents.length).toBe(1); // only the pre-stop event

    // And the isolated patch was restored — no further events at all.
    window.history.pushState({}, '', '/after-stop');
    expect(navEvents.length).toBe(1);
  });

  it('two sequential taps do not double-emit (independent lastKnownUrl state)', () => {
    const first: ObservedEvent[] = [];
    const h1 = createEventTap({ onEvent: (e) => { if (e.eventType === 'navigation') first.push(e); } });

    window.history.pushState({}, '', '/seq-1');
    dispatchNavDetail({ navType: 'pushState', fromUrl: '/w1-lifecycle', toUrl: '/seq-1' });
    h1.stop();

    const second: ObservedEvent[] = [];
    const h2 = createEventTap({ onEvent: (e) => { if (e.eventType === 'navigation') second.push(e); } });
    window.history.pushState({}, '', '/seq-2');
    dispatchNavDetail({ navType: 'pushState', fromUrl: '/seq-1', toUrl: '/seq-2' });
    h2.stop();

    expect(first.length).toBe(1);
    expect(second.length).toBe(1);
  });
});
