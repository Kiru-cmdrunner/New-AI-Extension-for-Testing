/**
 * State Tracker — Session Context Layer 1 (Deterministic State)
 *
 * Architecture C — Phase 3
 * Blueprint: .drytis/architecture-c-production.md §5
 *
 * Maintains a real-time snapshot of the page's deterministic state:
 *   - current URL and page title
 *   - open dialogs (role="dialog", aria-modal)
 *   - open dropdowns (aria-expanded="true", visible listboxes)
 *   - active form
 *   - active element
 *
 * This is a content script — it needs DOM access. It emits state updates
 * to the service worker via chrome.runtime.sendMessage.
 *
 * MV3-safe: the SW persists the last known state to chrome.storage.local
 * so it survives SW restarts. The content script re-syncs on the next
 * DOM mutation or navigation event.
 */

import type {
  DeterministicState,
  ElementDescriptor,
} from '../../shared/architecture-types';
import {
  CALENDAR_CLASS_PATTERNS,
  DROPDOWN_CLASS_PATTERNS,
} from '../../shared/classifier-constants';

// ── Pure helper functions (unit-testable with jsdom) ──────────────────

/**
 * Check whether an element is currently visible on the page.
 *
 * An element is visible if:
 *   - It is connected to the document
 *   - It has non-zero bounding box (display:none / visibility:hidden → false)
 *   - It is not [hidden] or [aria-hidden="true"]
 */
export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;

  const htmlEl = el as HTMLElement;
  if (htmlEl.hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;

  // checkComputedStyle: the style property covers inline display:none
  // without needing getComputedStyle (which is expensive).
  const style = htmlEl.style;
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;

  // NOTE: We intentionally do NOT check getBoundingClientRect here.
  // jsdom and other test environments don't compute layout, so rects are
  // always zeros. In real browsers, elements with display:none or
  // visibility:hidden are already caught by the checks above. Elements
  // collapsed via CSS (height:0; overflow:hidden) are a rare edge case
  // that can be addressed with a heuristic later if needed.

  return true;
}

/**
 * Compute an accessible name for a DOM element using the standard cascade.
 *
 * Priority: aria-label > aria-labelledby > label[for] > textContent > title.
 * Returns '' if no accessible name can be derived.
 */
export function computeAccessibleName(el: Element): string {
  // 1. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  // 2. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref && ref.textContent) return ref.textContent.trim();
  }

  // 3. Associated <label> (for form controls with id)
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label && label.textContent) return label.textContent.trim();
  }

  // 4. <label> wrapping the element
  const parentLabel = el.closest('label');
  if (parentLabel && parentLabel.textContent) return parentLabel.textContent.trim();

  // 5. textContent for elements with text
  const text = el.textContent;
  if (text && text.trim()) return text.trim().slice(0, 200);

  // 6. title attribute
  const title = el.getAttribute('title');
  if (title && title.trim()) return title.trim();

  // 7. value or placeholder for form controls
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return el.placeholder.trim();
    if (el.value) return el.value.trim();
  }

  // 8. alt for images
  const alt = el.getAttribute('alt');
  if (alt && alt.trim()) return alt.trim();

  return '';
}

/**
 * Create a lightweight ElementDescriptor from a DOM element.
 *
 * Used for openDialogs, openDropdowns, activeForm, activeElement.
 */
export function describeElement(el: Element | null): ElementDescriptor | null {
  if (!el) return null;

  const role = el.getAttribute('role');
  return {
    tag: el.tagName.toLowerCase(),
    role: role,
    accessibleName: computeAccessibleName(el),
    className: el.className || null,
  };
}

/**
 * Find all open dialogs on the page.
 *
 * A dialog is open if it matches [role="dialog"] or [aria-modal="true"]
 * and is visible per isVisible().
 */
export function findOpenDialogs(doc: Document): ElementDescriptor[] {
  return Array.from(
    doc.querySelectorAll('[role="dialog"], [aria-modal="true"]'),
  )
    .filter((el) => isVisible(el))
    .map((el) => describeElement(el)!)
    .filter((d): d is ElementDescriptor => d !== null);
}

/**
 * Find all open dropdowns on the page.
 *
 * A dropdown is open if an element has [aria-expanded="true"] and is visible,
 * or if a visible [role="listbox"] or [role="menu"] exists.
 */
export function findOpenDropdowns(doc: Document): ElementDescriptor[] {
  const expanded = Array.from(
    doc.querySelectorAll('[aria-expanded="true"]'),
  )
    .filter((el) => isVisible(el))
    .map((el) => describeElement(el)!)
    .filter((d): d is ElementDescriptor => d !== null);

  const openListboxes = Array.from(
    doc.querySelectorAll('[role="listbox"]:not([hidden]), [role="menu"]:not([hidden])'),
  )
    .filter((el) => isVisible(el))
    .map((el) => describeElement(el)!)
    .filter((d): d is ElementDescriptor => d !== null);

  // Deduplicate by accessibleName + tag to avoid listing the same control twice
  const seen = new Set<string>();

  // Also detect calendar/datepicker surfaces — many custom calendars don't
  // use role="dialog" or role="listbox". They render in a div with classes
  // like "calendar", "datepicker", "pikaday", "flatpickr", etc.
  // Use a safe CSS.escape fallback for environments without CSS global (jsdom).
  const cssEscape = (typeof CSS !== 'undefined' && CSS.escape)
    ? CSS.escape
    : (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  const calendarSelectors = CALENDAR_CLASS_PATTERNS.map(
    (p) => `.${cssEscape(p)}`,
  ).join(', ');
  if (calendarSelectors) {
    const calendars = Array.from(
      doc.querySelectorAll(calendarSelectors),
    )
      .filter((el) => isVisible(el))
      .map((el) => describeElement(el)!)
      .filter((d): d is ElementDescriptor => d !== null);
    expanded.push(...calendars);
  }

  // Also detect generic overlay surfaces — popover/flyout/dropdown classes
  // that are visible and likely overlaying content.
  const dropdownSelectors = DROPDOWN_CLASS_PATTERNS.map(
    (p) => `.${cssEscape(p)}`,
  ).join(', ');
  if (dropdownSelectors) {
    const dropdowns = Array.from(
      doc.querySelectorAll(dropdownSelectors),
    )
      .filter((el) => isVisible(el))
      .map((el) => describeElement(el)!)
      .filter((d): d is ElementDescriptor => d !== null);
    expanded.push(...dropdowns);
  }

  return [...expanded, ...openListboxes].filter((d) => {
    const key = `${d.tag}:${d.accessibleName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Find the form containing the currently focused element, if any.
 */
export function findActiveForm(doc: Document): ElementDescriptor | null {
  const active = doc.activeElement;
  if (!active || active === doc.body) return null;

  const form = active.closest('form');
  if (!form) return null;

  return describeElement(form);
}

/**
 * Describe the currently focused element.
 */
export function describeActiveElement(doc: Document): ElementDescriptor | null {
  const active = doc.activeElement;
  if (!active || active === doc.body) return null;
  return describeElement(active);
}

/**
 * Compute the full DeterministicState from the live DOM.
 *
 * This is a pure function of document — can be called at any time to
 * get the current deterministic snapshot.
 */
export function computeDeterministicState(doc: Document): DeterministicState {
  return {
    currentUrl: doc.location ? doc.location.href : window.location.href,
    pageTitle: doc.title,
    openDialogs: findOpenDialogs(doc),
    openDropdowns: findOpenDropdowns(doc),
    activeForm: findActiveForm(doc),
    activeElement: describeActiveElement(doc),
  };
}

// ── Mutation relevance filter ─────────────────────────────────────────

/** Attributes whose changes may affect dialog/dropdown/form visibility. */
const RELEVANT_ATTRIBUTES = new Set([
  'aria-expanded',
  'aria-modal',
  'aria-hidden',
  'hidden',
  'class',
  'style',
]);

/**
 * Check whether a set of DOM mutations is relevant for state recomputation.
 *
 * Relevant mutations:
 *   - childList changes (elements added/removed — may open/close dialogs)
 *   - attribute changes on relevant attributes (aria-expanded, class, etc.)
 *
 * Non-relevant:
 *   - characterData changes (text content)
 *   - attribute changes on style properties that don't affect visibility
 *     (handled by attribute name filter)
 */
export function isRelevantMutation(mutations: MutationRecord[]): boolean {
  return mutations.some((m) => {
    if (m.type === 'childList') {
      // Only relevant if nodes were actually added or removed
      return m.addedNodes.length > 0 || m.removedNodes.length > 0;
    }
    if (m.type === 'attributes') {
      return m.attributeName !== null && RELEVANT_ATTRIBUTES.has(m.attributeName);
    }
    // characterData changes are never relevant for state tracking
    return false;
  });
}

// ── StateTracker class ────────────────────────────────────────────────

/**
 * State Tracker — maintains L1 of Session Context for the current page.
 *
 * Lifecycle:
 *   const tracker = new StateTracker();
 *   tracker.start();  // begins observing DOM
 *   ...
 *   tracker.stop();   // disconnects all observers
 *
 * On start, computes initial state and sets up a MutationObserver.
 * On relevant mutations, recomputes and emits.
 * On navigation, resets and recomputes.
 *
 * State is emitted via a callback (decoupled from chrome.runtime.sendMessage
 * for testability).
 */
export class StateTracker {
  private observer: MutationObserver | null = null;
  private currentState: DeterministicState | null = null;
  private emitCallback: ((state: DeterministicState) => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEBOUNCE_MS = 100;

  /**
   * Set the callback invoked when state changes.
   * In production, this sends a message to the service worker.
   */
  onEmit(callback: (state: DeterministicState) => void): void {
    this.emitCallback = callback;
  }

  /**
   * Start tracking on the current page.
   *
   * Computes initial state, sets up MutationObserver.
   */
  start(): void {
    // Compute initial state
    this.currentState = computeDeterministicState(document);
    this.emit(this.currentState);

    // Set up MutationObserver for relevant changes
    this.observer = new MutationObserver((mutations) => {
      this.onMutation(mutations);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: Array.from(RELEVANT_ATTRIBUTES),
    });
  }

  /**
   * Stop tracking and disconnect observer.
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.currentState = null;
  }

  /**
   * Get the current state without recomputing.
   * Returns null if tracking hasn't started.
   */
  getState(): DeterministicState | null {
    return this.currentState;
  }

  /**
   * Handle navigation — reset state and recompute for the new page.
   *
   * Called by the content script's navigation listener. The url and title
   * are provided by the navigation API (chrome.webNavigation) and override
   * what computeDeterministicState would read from the document, because
   * the DOM may not yet have updated when this is called.
   */
  onNavigation(url: string, title: string): void {
    // Disconnect existing observer — DOM is being replaced
    if (this.observer) {
      this.observer.disconnect();
    }

    // Recompute state for new page, then override URL/title from navigation data
    this.currentState = computeDeterministicState(document);
    this.currentState.currentUrl = url;
    this.currentState.pageTitle = title;
    this.emit(this.currentState);

    // Reconnect observer for the new DOM
    if (this.observer && document.body) {
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: Array.from(RELEVANT_ATTRIBUTES),
      });
    }
  }

  /**
   * Handle DOM mutations — recompute state if relevant attributes changed.
   * Debounced to avoid excessive recomputation during rapid DOM updates.
   */
  private onMutation(mutations: MutationRecord[]): void {
    if (!isRelevantMutation(mutations)) return;

    // Debounce: wait DEBOUNCE_MS after the last relevant mutation
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.currentState = computeDeterministicState(document);
      this.emit(this.currentState);
      this.debounceTimer = null;
    }, StateTracker.DEBOUNCE_MS);
  }

  /**
   * Emit state to the callback (if set).
   */
  private emit(state: DeterministicState): void {
    if (this.emitCallback) {
      this.emitCallback(state);
    }
  }
}
