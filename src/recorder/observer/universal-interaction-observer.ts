/**
 * Universal Interaction Observer
 *
 * Architecture C — Phase 4
 * Blueprint: .drytis/architecture-c-production.md §4
 *
 * The single content script that replaces all six current content scripts.
 * Captures ALL browser events + DOM context and sends RawEvidence messages
 * to the service worker. No classification, no skipping, no ownership.
 *
 * Design:
 *   - Capture-phase listeners (addEventListener type 3rd arg = true)
 *   - Events → RawEvidence via observer-helpers.ts
 *   - MutationObserver lifecycle: starts on mousedown/click, auto-stops after 500ms
 *   - Recording-gated: events only captured when isRecording === true
 *   - Single message type: RAW_EVIDENCE
 */

import type { RawEvidence } from '../../shared/evidence-types';
import { COALESCING_WINDOW_MS } from '../../shared/classifier-constants';
import {
  extractIdentity,
  captureValue,
  captureCheckedState,
  captureAriaState,
  resolveTarget,
  summarizeMutations,
} from './observer-helpers';

interface EventListenerEntry {
  type: string;
  handler: EventListener;
}

export class UniversalInteractionObserver {
  private listeners: EventListenerEntry[] = [];
  private mutationObserver: MutationObserver | null = null;
  private mutationWindow: { active: boolean; start: number } = {
    active: false,
    start: 0,
  };
  private accumulatedMutations: MutationRecord[] = [];
  private mutationTimer: ReturnType<typeof setTimeout> | null = null;

  private isRecording = false;
  private mouseenterTime: number | null = null;
  private mouseenterTarget: Element | null = null;

  /**
   * When true, skip the isTrusted filter (for testing with synthetic events).
   * In production, only real user events have isTrusted=true.
   */
  private allowUntrusted = false;

  /** Callback invoked for each captured evidence. Decoupled from chrome API. */
  private emitCallback: ((evidence: RawEvidence) => void) | null = null;

  /**
   * Set the callback invoked when evidence is captured.
   * In production, this calls chrome.runtime.sendMessage.
   */
  onEmit(callback: (evidence: RawEvidence) => void): void {
    this.emitCallback = callback;
  }

  /**
   * Set the recording state. Called externally when recording starts/stops.
   */
  setRecording(recording: boolean): void {
    this.isRecording = recording;
    if (!recording) {
      this.stopMutationObservation();
    }
  }

  /**
   * Allow untrusted (synthetic) events to be captured.
   * Used in testing — production always has this as false.
   */
  setAllowUntrusted(allow: boolean): void {
    this.allowUntrusted = allow;
  }

  /**
   * Check if an event should be captured based on recording + trust.
   */
  private shouldCapture(event: Event): boolean {
    if (!this.isRecording) return false;
    if (!event.isTrusted && !this.allowUntrusted) return false;
    return true;
  }

  /**
   * Start the observer — register all event listeners.
   */
  start(): void {
    // Register capture-phase listeners for all event types
    this.addListener('click', this.onCaptureEvent);
    this.addListener('mousedown', this.onCaptureEvent);
    this.addListener('change', this.onCaptureEvent);
    this.addListener('focus', this.onFocusEvent);
    this.addListener('blur', this.onBlurEvent);
    this.addListener('input', this.onInputEvent);
    this.addListener('mouseenter', this.onMouseEnterEvent);
    this.addListener('mouseleave', this.onMouseLeaveEvent);
    this.addListener('keydown', this.onKeyEvent);
  }

  /**
   * Stop the observer — remove all listeners and stop mutation observation.
   */
  stop(): void {
    this.removeAllListeners();
    this.stopMutationObservation();
    this.mouseenterTime = null;
    this.mouseenterTarget = null;
  }

  // ── Event Handlers ────────────────────────────────────────────────────

  /**
   * Generic capture handler for click, mousedown, change events.
   */
  private onCaptureEvent = (event: Event): void => {
    if (!this.shouldCapture(event)) return;

    const target = resolveTarget(event);
    if (!target) return;

    // Start mutation observation window on mousedown/click
    if (event.type === 'mousedown' || event.type === 'click') {
      this.startMutationObservation();
    }

    this.emitEvidence(event, target);
  };

  /**
   * Focus event handler.
   */
  private onFocusEvent = (event: Event): void => {
    if (!this.shouldCapture(event)) return;

    const target = resolveTarget(event);
    if (!target) return;

    this.emitEvidence(event, target);
  };

  /**
   * Blur event handler.
   */
  private onBlurEvent = (event: Event): void => {
    if (!this.shouldCapture(event)) return;

    const target = resolveTarget(event);
    if (!target) return;

    this.emitEvidence(event, target);
  };

  /**
   * Input event handler (fires on every keystroke in text fields).
   */
  private onInputEvent = (event: Event): void => {
    if (!this.shouldCapture(event)) return;

    const target = resolveTarget(event);
    if (!target) return;

    this.emitEvidence(event, target);
  };

  /**
   * Mouseenter handler — starts hover timing.
   */
  private onMouseEnterEvent = (event: Event): void => {
    if (!this.shouldCapture(event)) return;

    const target = resolveTarget(event);
    if (!target) return;

    this.mouseenterTime = Date.now();
    this.mouseenterTarget = target;
  };

  /**
   * Mouseleave handler — completes hover timing and emits evidence.
   */
  private onMouseLeaveEvent = (event: Event): void => {
    if (!this.shouldCapture(event)) return;

    const target = resolveTarget(event);
    if (!target) return;

    // Compute dwell time if we have a matching mouseenter
    let dwellTime: number | undefined;
    if (this.mouseenterTime !== null) {
      dwellTime = Date.now() - this.mouseenterTime;
    }
    this.mouseenterTime = null;
    this.mouseenterTarget = null;

    this.emitEvidence(event, target, { dwellTime });
  };

  /**
   * Keydown event handler.
   */
  private onKeyEvent = (event: Event): void => {
    if (!this.shouldCapture(event)) return;

    const target = resolveTarget(event);
    if (!target) return;

    this.emitEvidence(event, target);
  };

  // ── Evidence Construction ─────────────────────────────────────────────

  /**
   * Build a RawEvidence object from an event and emit it.
   */
  private emitEvidence(
    event: Event,
    target: Element,
    extra?: { dwellTime?: number },
  ): void {
    const evidence: RawEvidence = {
      eventType: event.type,
      identity: extractIdentity(target),
      timestamp: new Date().toISOString(),
      isTrusted: event.isTrusted,
      value: captureValue(target),
      checked: captureCheckedState(target),
      ariaState: captureAriaState(target),
      mutations: undefined, // assigned from accumulated mutations
    };

    if (extra?.dwellTime !== undefined) {
      evidence.dwellTime = extra.dwellTime;
    }

    // Attach accumulated mutations if mutation window is active
    if (this.mutationWindow.active && this.accumulatedMutations.length > 0) {
      evidence.mutations = summarizeMutations(this.accumulatedMutations);
    }

    if (this.emitCallback) {
      this.emitCallback(evidence);
    }
  }

  // ── MutationObserver Lifecycle ────────────────────────────────────────

  /**
   * Start mutation observation window on interaction.
   *
   * Observes document.body for childList, attributes (relevant only),
   * and subtree changes. Auto-closes after COALESCING_WINDOW_MS (500ms).
   */
  private startMutationObservation(): void {
    // Close any previous window
    this.stopMutationObservation();

    this.mutationWindow = { active: true, start: Date.now() };
    this.accumulatedMutations = [];

    this.mutationObserver = new MutationObserver((mutations) => {
      this.accumulatedMutations.push(...mutations);
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'aria-expanded',
        'aria-hidden',
        'aria-selected',
        'aria-checked',
        'aria-pressed',
        'hidden',
      ],
      subtree: true,
    });

    // Auto-close after coalescing window
    this.mutationTimer = setTimeout(() => {
      this.stopMutationObservation();
    }, COALESCING_WINDOW_MS);
  }

  /**
   * Stop mutation observation and clean up.
   */
  private stopMutationObservation(): void {
    if (this.mutationTimer) {
      clearTimeout(this.mutationTimer);
      this.mutationTimer = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    this.mutationWindow = { active: false, start: 0 };
    this.accumulatedMutations = [];
  }

  // ── Listener Management ───────────────────────────────────────────────

  private addListener(type: string, handler: EventListener): void {
    const entry: EventListenerEntry = { type, handler };
    this.listeners.push(entry);
    document.addEventListener(type, handler, true);
  }

  private removeAllListeners(): void {
    for (const { type, handler } of this.listeners) {
      document.removeEventListener(type, handler, true);
    }
    this.listeners = [];
  }

  // ── Test helpers ──────────────────────────────────────────────────────

  /** Check if the observer is currently recording. */
  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  /** Check if mutation observation window is active. */
  isMutationWindowActive(): boolean {
    return this.mutationWindow.active;
  }
}
