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
  let pageCounter = 0;

  // Generate a page-unique counter for event IDs
  const pageId = `p${Date.now().toString(36)}`;
  function nextEventId(): string {
    pageCounter++;
    return `evt-${pageId}-${pageCounter}`;
  }

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

    // Resolve target (pierces Shadow DOM via composedPath)
    const targetEl = resolveTarget(rawEvent);
    if (!targetEl) return;

    // Extract identity at capture time (immutable snapshot)
    const identity = extractIdentity(targetEl);

    // Extract DOM context
    const domContext = extractDomContext(targetEl);

    // Build the observed event
    const observed = assembleObservedEvent(rawEvent, eventType, identity, domContext);

    config.onEvent(observed);
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
    'click', 'mousedown', 'contextmenu',
    'focus', 'blur',
    'input', 'change',
    'mouseenter', 'mouseleave', 'mousemove',
    'keydown',
    'scroll',
  ];

  for (const type of eventTypes) {
    register(type, handleRawEvent as EventListener);
  }

  // ── Stop ────────────────────────────────────────────────────────────

  return {
    stop(): void {
      for (const { type, listener, options } of listeners) {
        document.removeEventListener(type, listener, options);
      }
      listeners.length = 0;
    },
  };
}
