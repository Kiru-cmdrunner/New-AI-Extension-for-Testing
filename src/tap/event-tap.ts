/**
 * Event Tap — Capture-Phase DOM Event Listener (Layer 1)
 *
 * A single observer that captures ALL trusted DOM events on ALL elements.
 * No classification, no skipping, no ownership. Produces ObservedEvent
 * objects and forwards them via a callback.
 *
 * This module is consumed by the content script (recorder-entry.ts).
 * It operates on the live DOM (document) and produces immutable
 * ObservedEvent snapshots.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.2 Stage 1
 * Principle: AP1 (Separation of evidence and classification)
 */

import type { BrowserEventType, ObservedEvent, DomContext } from '../shared/component-types';
import {
  extractIdentity,
  resolveTarget,
  captureValue,
  captureCheckedState,
} from './identity-extractor';
import { extractDomContext } from '../definitions/dom-context-extractor';

/** Minimum interval between scroll events (ms) — rate limiting. */
const SCROLL_MIN_INTERVAL_MS = 16;

/** Minimum interval between mousemove events (ms) — throttle to ~20fps max. */
const MOUSEMOVE_MIN_INTERVAL_MS = 50;

/**
 * Delay for deferred blur value capture (ms).
 * Must be a macrotask (setTimeout) so it runs AFTER all synchronous event
 * processing (including the click that updates the value in React/Vue SPAs).
 * 0ms is sufficient — it defers to the next event loop turn, which is after
 * the current event chain completes.
 */
const DEFERRED_BLUR_DELAY_MS = 0;

/**
 * Multi-poll intervals for post-click value detection (ms).
 *
 * After a click inside a dropdown/calendar/autocomplete surface, we poll
 * the trigger element's value at these intervals. If ANY poll detects a
 * value change, we emit a supplementary change event immediately and stop
 * polling. This covers both fast frameworks (flush within 50ms) and heavy
 * SPAs that take 300ms+ to flush state.
 */
const POST_CLICK_POLL_INTERVALS_MS = [50, 150, 400];

/**
 * Test hook: when true, all events are treated as trusted regardless of
 * the actual isTrusted property. This is ONLY set by test code — in
 * production, jsdom's non-configurable isTrusted doesn't exist.
 */
export const TEST_HOOK = { forceTrusted: false };

/**
 * EventTap control handle. Call stop() to remove all listeners.
 */
export interface EventTapHandle {
  stop(): void;
}

/**
 * Configuration for createEventTap.
 */
export interface EventTapConfig {
  /** Called for every captured event. */
  onEvent: (event: ObservedEvent) => void;
}

/**
 * Create an EventTap that registers capture-phase DOM listeners.
 *
 * Listens for: click, mousedown, contextmenu, focus, blur, input, change,
 * mouseenter, mouseleave, keydown, scroll.
 *
 * Returns a handle to stop() listening.
 */
export function createEventTap(config: EventTapConfig): EventTapHandle {
  const listeners: Array<{ type: string; listener: EventListenerOrEventListenerObject; options: AddEventListenerOptions }> = [];
  let lastScrollTime = 0;
  let lastMouseMoveTime = 0;
  let pageCounter = 0;

  // Generate a page-unique counter for event IDs
  const pageId = `p${Date.now().toString(36)}`;
  function nextEventId(): string {
    pageCounter++;
    return `evt-${pageId}-${pageCounter}`;
  }

  // ── SPA Deferred Value Tracking ─────────────────────────────────────
  //
  // React, Vue, Angular, and other SPA frameworks batch state updates and
  // apply them asynchronously (after the current event chain). This means:
  //
  //   1. When blur fires on an input, el.value is still the OLD value.
  //      React hasn't re-rendered yet.
  //   2. When a click on a dropdown option fires, the trigger input's value
  //      doesn't update until AFTER React processes the click.
  //
  // To handle this, we track the last-focused element and:
  //   - On blur: defer value reading to the next macrotask (setTimeout 0).
  //   - On click: after a short delay, check if a previously-focused input's
  //     value changed. If so, emit a supplementary change event.

  /** The element that most recently received focus. */
  let lastFocusedEl: Element | null = null;
  /** The value of lastFocusedEl at focus time (for change detection). */
  let lastFocusedValue: string | undefined = undefined;
  /** Whether the last-focused element was an input/select/textarea. */
  let lastFocusedIsFormControl = false;
  /** Guard flag: prevent double-scheduling post-click checks (mousedown+click). */
  let postClickCheckPending = false;
  /** Phase 0b: surfaceId at focus time. Used as a fallback for the synthetic
   *  change event when the DOM mutates between focus and the post-click poll.
   *  When the poll fires, we re-extract domContext (which gets the current
   *  surfaceId). If that returns null (surface closed), we fall back to this
   *  stored value so the synthetic event can still be claimed by the session
   *  that opened the surface. */
  let lastFocusedSurfaceId: string | null = null;

  /**
   * Check if an element is a form control whose value we should track.
   */
  function isValueTrackable(el: Element): boolean {
    return el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement;
  }

  // ── SPA Navigation Detection ───────────────────────────────────────
  //
  // Modern SPAs (React Router, Next.js, Vue Router, etc.) change routes
  // via history.pushState/replaceState. These don't fire native events,
  // so we monkey-patch the History API to emit synthetic 'navigation'
  // ObservedEvents. We also listen for popstate (back/forward) and
  // hashchange (hash-based routers).

  /** Track last known URL to suppress duplicate navigation events. */
  let lastKnownUrl = location.href;

  /**
   * Emit a synthetic navigation event when the URL changes.
   * Called after history.pushState/replaceState or on popstate/hashchange.
   */
  function emitSpaNavigation(): void {
    const currentUrl = location.href;
    if (currentUrl === lastKnownUrl) return; // suppress duplicates
    lastKnownUrl = currentUrl;

    const navEvent: ObservedEvent = {
      eventId: nextEventId(),
      eventType: 'navigation',
      timestamp: Date.now(),
      isTrusted: true, // user-initiated navigation (even if programmatic in the SPA)
      target: extractIdentity(document.body || document.documentElement),
      domContext: extractDomContext(document.body || document.documentElement),
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: null,
      clientY: null,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: currentUrl,
      pageTitle: document.title,
    };

    config.onEvent(navEvent);
  }

  // Monkey-patch History API to detect SPA pushState/replaceState
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function patchedPushState(...args: Parameters<typeof history.pushState>): void {
    originalPushState(...args);
    emitSpaNavigation();
  } as typeof history.pushState;

  history.replaceState = function patchedReplaceState(...args: Parameters<typeof history.replaceState>): void {
    originalReplaceState(...args);
    emitSpaNavigation();
  } as typeof history.replaceState;

  function register(
    type: string,
    handler: EventListenerOrEventListenerObject,
  ): void {
    const options: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener(type, handler, options);
    listeners.push({ type, listener: handler, options });
  }

  // ── Core event handler ──────────────────────────────────────────────

  function handleRawEvent(rawEvent: Event): void {
    // Filter: only trusted events (user-initiated)
    if (!TEST_HOOK.forceTrusted && !rawEvent.isTrusted) return;

    const eventType = rawEvent.type as BrowserEventType;
    if (!eventType) return;

    // Scroll rate limiting
    if (eventType === 'scroll') {
      const now = Date.now();
      if (now - lastScrollTime < SCROLL_MIN_INTERVAL_MS) return;
      lastScrollTime = now;
    }

    // mousemove rate limiting — throttle to prevent message pipeline flooding.
    // The Hover definition only needs ~20fps for pointer stationarity tracking.
    if (eventType === 'mousemove') {
      const now = Date.now();
      if (now - lastMouseMoveTime < MOUSEMOVE_MIN_INTERVAL_MS) return;
      lastMouseMoveTime = now;
    }

    // Resolve target (pierces Shadow DOM via composedPath)
    const targetEl = resolveTarget(rawEvent);
    if (!targetEl) return;

    // ── SPA Focus/Blur Tracking ──────────────────────────────────────
    //
    // Track focus to know which element the user is interacting with.
    // On blur, defer value reading for SPA frameworks.
    if (eventType === 'focus') {
      lastFocusedEl = targetEl;
      lastFocusedValue = captureValue(targetEl);
      lastFocusedIsFormControl = isValueTrackable(targetEl);
      // Phase 0b: capture surfaceId at focus time for post-click poll binding.
      const focusDomContext = extractDomContext(targetEl);
      lastFocusedSurfaceId = focusDomContext.surfaceId ?? null;
    }

    // On blur: defer value reading to the next macrotask so SPA frameworks
    // (React, Vue, Angular) have time to flush state updates to the DOM.
    // The blur event fires synchronously DURING the event chain — but the
    // actual DOM value update from React happens AFTER the click completes.
    // By deferring with setTimeout(0), we read the value AFTER all
    // synchronous event processing is done.
    if (eventType === 'blur') {
      handleBlurWithDeferredValue(rawEvent, targetEl);
      return; // The deferred handler will emit the event
    }

    // On click: schedule a post-click check. If the click is on a
    // dropdown/autocomplete option, the trigger input's value may change
    // AFTER the click handler completes (React state update). We check
    // for this and emit a supplementary change event.
    // Guard against double-fire: both mousedown and click fire for the same
    // user interaction. Only schedule one check per focus target.
    if ((eventType === 'click' || eventType === 'mousedown') && lastFocusedEl && !postClickCheckPending) {
      postClickCheckPending = true;
      schedulePostClickValueCheck();
    }

    // Extract identity at capture time (immutable snapshot)
    const identity = extractIdentity(targetEl);

    // Extract DOM context
    const domContext = extractDomContext(targetEl);

    // Build the observed event
    const observed = assembleObservedEvent(rawEvent, eventType, identity, domContext);

    config.onEvent(observed);
  }

  /**
   * Handle blur with deferred value reading for SPA frameworks.
   *
   * The blur event is captured immediately for identity and timing, but the
   * value reading is deferred to the next macrotask. This ensures that when
   * React/Vue/Angular batched state updates finally flush to the DOM, we
   * read the updated value.
   *
   * The ObservedEvent is created immediately (with the stale value in
   * valueBefore), and the deferred callback updates valueAfter with the
   * real value.
   */
  function handleBlurWithDeferredValue(rawEvent: Event, targetEl: Element): void {
    // Build the event immediately with identity/timing captured NOW
    const identity = extractIdentity(targetEl);
    const domContext = extractDomContext(targetEl);

    // The observed event with stale value initially
    const observed = assembleObservedEvent(rawEvent, 'blur', identity, domContext);

    // Defer value reading to the next macrotask
    setTimeout(() => {
      // Re-read the value after framework state updates have flushed
      const deferredValue = captureValue(targetEl);

      // Update valueAfter with the deferred value
      observed.valueAfter = deferredValue ?? null;

      // Emit the event
      config.onEvent(observed);
    }, DEFERRED_BLUR_DELAY_MS);
  }

  /**
   * Schedule a multi-poll check after a click to see if a previously-focused
   * input's value has changed. This handles React/Vue controlled inputs where
   * the value is updated asynchronously after a dropdown/autocomplete selection.
   *
   * Scenario: user focuses a date input → opens a calendar/popover → clicks
   * a date. The click handler updates React state → React re-renders →
   * the input value changes. But by the time `change` fires (if it fires at
   * all), it might use a stale value or be swallowed by the framework.
   *
   * We detect this by polling the input's value at multiple intervals
   * (50ms, 150ms, 400ms). If ANY poll detects a change, we emit a
   * supplementary change event and stop. This handles both fast frameworks
   * and heavy SPAs where the state flush takes 300ms+.
   */
  function schedulePostClickValueCheck(): void {
    if (!lastFocusedEl || !lastFocusedIsFormControl) {
      postClickCheckPending = false;
      return;
    }

    const trackedEl = lastFocusedEl;
    const preClickValue = lastFocusedValue;
    let pollIndex = 0;

    function pollOnce(): void {
      // Clear the guard flag on the first poll so future clicks can schedule
      postClickCheckPending = false;

      // Re-read the value after framework state updates
      if (!trackedEl || !trackedEl.isConnected) return;

      const postClickValue = captureValue(trackedEl);

      // If the value changed, emit a supplementary change event
      if (postClickValue !== undefined && postClickValue !== preClickValue) {
        const identity = extractIdentity(trackedEl);
        const domContext = extractDomContext(trackedEl);

        // Phase 0b: If the live surfaceId is null (surface may have closed or
        // DOM mutated), fall back to the surfaceId captured at focus time.
        // This ensures the synthetic change event can be claimed by the session
        // that opened the surface, even if the surface closed between the click
        // and the poll.
        if (!domContext.surfaceId && lastFocusedSurfaceId) {
          domContext.surfaceId = lastFocusedSurfaceId;
        }

        const syntheticChange: ObservedEvent = {
          eventId: nextEventId(),
          eventType: 'change',
          timestamp: Date.now(),
          isTrusted: true,
          target: identity,
          domContext,
          valueBefore: preClickValue ?? null,
          valueAfter: postClickValue ?? null,
          checkedBefore: null,
          checkedAfter: null,
          clientX: null,
          clientY: null,
          key: null,
          code: null,
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          metaKey: false,
          scrollDeltaY: null,
          scrollDeltaX: null,
          pageUrl: location.href,
          pageTitle: document.title,
        };

        config.onEvent(syntheticChange);
        return; // value detected, stop polling
      }

      // Schedule the next poll if intervals remain
      pollIndex++;
      if (pollIndex < POST_CLICK_POLL_INTERVALS_MS.length) {
        const nextDelay = POST_CLICK_POLL_INTERVALS_MS[pollIndex] -
          POST_CLICK_POLL_INTERVALS_MS[pollIndex - 1];
        setTimeout(pollOnce, nextDelay);
      }
    }

    setTimeout(pollOnce, POST_CLICK_POLL_INTERVALS_MS[0]);
  }

  // ── Event assembly ──────────────────────────────────────────────────

  function assembleObservedEvent(
    rawEvent: Event,
    eventType: BrowserEventType,
    identity: ReturnType<typeof extractIdentity>,
    domContext: DomContext,
  ): ObservedEvent {
    const targetEl = resolveTarget(rawEvent);
    const value = targetEl ? captureValue(targetEl) : undefined;
    const checked = targetEl ? captureCheckedState(targetEl) : undefined;

    // Pointer events
    const mouseEvent = rawEvent as MouseEvent;
    const keyboardEvent = rawEvent as KeyboardEvent;

    // Scroll deltas
    let scrollDeltaY: number | null = null;
    let scrollDeltaX: number | null = null;
    if (eventType === 'scroll') {
      const scrollTarget = rawEvent.target as Element | Document;
      const scrollTop = scrollTarget === document
        ? (document.scrollingElement?.scrollTop ?? window.scrollY)
        : (rawEvent.target as Element)?.scrollTop ?? 0;
      const scrollLeft = scrollTarget === document
        ? (document.scrollingElement?.scrollLeft ?? window.scrollX)
        : (rawEvent.target as Element)?.scrollLeft ?? 0;
      scrollDeltaY = Math.round(scrollTop);
      scrollDeltaX = Math.round(scrollLeft);
    }

    // Determine valueBefore/after based on event type
    let valueBefore: string | null = null;
    let valueAfter: string | null = null;

    if (eventType === 'focus' || eventType === 'click' || eventType === 'mousedown') {
      valueBefore = value ?? null;
    }
    if (eventType === 'input' || eventType === 'change') {
      valueAfter = value ?? null;
    }
    if (eventType === 'blur') {
      // Capture value at blur time — this is the final value the user left
      // in the field. Critical for TextEntry completion, especially when
      // input events were missed (autofill, paste, React controlled inputs).
      valueAfter = value ?? null;
    }

    // Determine checkedBefore/after
    let checkedBefore: boolean | null = null;
    let checkedAfter: boolean | null = null;

    if (eventType === 'click' || eventType === 'mousedown') {
      // For click events on checkboxes/radios, checkedBefore is captured
      // at this moment (before the browser updates state for the click).
      // checkedAfter will be the negation (for checkbox) or true (for radio).
      checkedBefore = checked ?? null;
    }
    if (eventType === 'change') {
      checkedAfter = checked ?? null;
    }

    return {
      eventId: nextEventId(),
      eventType,
      timestamp: Date.now(),
      isTrusted: rawEvent.isTrusted,
      target: identity,
      domContext,
      valueBefore,
      valueAfter,
      checkedBefore,
      checkedAfter,
      clientX: mouseEvent.clientX ?? null,
      clientY: mouseEvent.clientY ?? null,
      key: keyboardEvent.key ?? null,
      code: keyboardEvent.code ?? null,
      shiftKey: mouseEvent.shiftKey ?? false,
      ctrlKey: mouseEvent.ctrlKey ?? false,
      altKey: mouseEvent.altKey ?? false,
      metaKey: mouseEvent.metaKey ?? false,
      scrollDeltaY,
      scrollDeltaX,
      pageUrl: location.href,
      pageTitle: document.title,
    };
  }

  // ── Register listeners ──────────────────────────────────────────────

  const eventTypes: string[] = [
    'click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu',
    'focus', 'blur',
    'input', 'change',
    'mouseenter', 'mouseleave', 'mousemove',
    'keydown',
    'scroll',
    'dragstart', 'dragover', 'drop', 'dragend',
  ];

  for (const type of eventTypes) {
    register(type, handleRawEvent as EventListener);
  }

  // SPA navigation listeners (popstate = back/forward, hashchange = hash routers)
  window.addEventListener('popstate', emitSpaNavigation);
  window.addEventListener('hashchange', emitSpaNavigation);

  // ── Stop ────────────────────────────────────────────────────────────

  return {
    stop(): void {
      for (const { type, listener, options } of listeners) {
        document.removeEventListener(type, listener, options);
      }
      listeners.length = 0;

      // Restore original History API
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;

      // Remove SPA navigation listeners
      window.removeEventListener('popstate', emitSpaNavigation);
      window.removeEventListener('hashchange', emitSpaNavigation);

      // Clear focus tracking
      lastFocusedEl = null;
      lastFocusedValue = undefined;
      lastFocusedIsFormControl = false;
      postClickCheckPending = false;
      lastFocusedSurfaceId = null;
    },
  };
}
