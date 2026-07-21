/**
 * V2 Event Observer — Pipeline V2 Layer 1 (Content Script)
 *
 * Captures DOM events in the page and emits PipelineEvent objects using
 * the CANONICAL EVENT SCHEMA. This is the ONLY producer of PipelineEvents.
 *
 * LEARNING 1 (Event Schema Mismatch): Every event is emitted with the
 * element identity under the `element` field — the SAME field name that
 * every downstream layer reads. No field name mismatch is possible.
 *
 * LEARNING 2 (Event Vocabulary Mismatch): The observer only emits event
 * types from the closed RecordedEventType vocabulary. No event type can
 * be "unknown" to the pipeline.
 *
 * LEARNING 4 (Missing Event Producers): EVERY event type in the vocabulary
 * has a real producer here:
 *   - click, dblclick     → click/dblclick DOM events
 *   - change, input       → form control events
 *   - focus, blur         → focus events
 *   - keydown             → keyboard events
 *   - mouseenter/leave    → mouse events
 *   - submit              → form submit
 *   - navigation          → (sent by service worker via webNavigation API)
 *   - surface_open/close  → MutationObserver detecting overlays appearing/disappearing
 *   - scroll              → scroll events (throttled)
 *
 * LEARNING 6 (Stale Comment): This comment accurately describes what the
 * observer captures. DOM mutations ARE captured (for surface detection).
 *
 * LEARNING 7 (collectIdentity): The extractIdentity() helper (from the
 * existing observer-helpers.ts) is called for every event, populating ALL
 * 18 fields of ElementIdentity. No field is left unset.
 */

import type { PipelineEvent, EventPayload, EventModifiers, RecordedEventType, StateSnapshot, SurfaceType } from './canonical-event-schema';
import { extractIdentity, resolveTarget } from '../observer/observer-helpers';
import { snapshotState } from './state-diff-engine';
import type { ElementIdentity } from '../../shared/types';

// ── Configuration ───────────────────────────────────────────────────────

export interface V2ObserverConfig {
  /**
   * Whether to capture scroll events. Default: false (scroll is noisy).
   * When true, scroll events are throttled to one per 500ms.
   */
  captureScroll: boolean;

  /**
   * Whether to capture mouseenter/mouseleave. Default: true.
   */
  captureHover: boolean;

  /**
   * Whether to capture keydown events. Default: true.
   */
  captureKeyboard: boolean;

  /**
   * Minimum dwell time (ms) before a mouseenter is considered intentional.
   * Default: 500ms.
   */
  hoverDwellThresholdMs: number;
}

const DEFAULT_CONFIG: V2ObserverConfig = {
  captureScroll: false,
  captureHover: false, // Disabled by default — hover floods on complex pages.
  // Hover intent is better detected via surface_open events (submenus appearing)
  // rather than raw mouseover. Enable only when testing hover-specific features.
  captureKeyboard: true,
  hoverDwellThresholdMs: 500,
};

// ── Event Callback ──────────────────────────────────────────────────────

/**
 * Callback invoked when the observer produces a PipelineEvent.
 * In production, this sends a chrome.runtime message.
 * In tests, this can be a simple function.
 */
export type OnPipelineEvent = (event: PipelineEvent) => void;

// ── V2 Event Observer ───────────────────────────────────────────────────

/**
 * The V2 Event Observer captures DOM events and emits PipelineEvents.
 *
 * It uses event delegation (capture phase listeners on document) to catch
 * all events, including those from Shadow DOM elements (via composedPath).
 *
 * Surface detection uses a MutationObserver to detect when overlay elements
 * (dialogs, dropdowns, menus, popovers) appear or disappear.
 */
export class V2EventObserver {
  private readonly config: V2ObserverConfig;
  private callback: OnPipelineEvent | null = null;
  private eventCounter = 0;
  private mutationObserver: MutationObserver | null = null;
  private knownSurfaces = new Set<Element>();
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollThrottle: ReturnType<typeof setTimeout> | null = null;
  private boundHandlers: Array<{ type: string; handler: EventListener }> = [];

  // RC-2 FIX: Pre-state tracking — capture element state at focus time
  // so the pipeline can compare before/after without depending on snapshot timing.
  // Key: element identity (tag + id + cssSelector), Value: serialized state
  private preStateMap = new Map<Element, string>();

  constructor(config?: Partial<V2ObserverConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the callback for when a PipelineEvent is produced.
   */
  onEvent(callback: OnPipelineEvent): void {
    this.callback = callback;
  }

  /**
   * Start observing DOM events.
   */
  start(): void {
    this.registerDOMListeners();
    this.startMutationObserver();
  }

  /**
   * Stop observing and clean up.
   */
  stop(): void {
    this.unregisterDOMListeners();
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (this.scrollThrottle) {
      clearTimeout(this.scrollThrottle);
      this.scrollThrottle = null;
    }
    this.knownSurfaces.clear();
  }

  /**
   * Get the current count of events produced (for debugging).
   */
  get eventCount(): number {
    return this.eventCounter;
  }

  // ── DOM Event Registration ─────────────────────────────────────────

  private registerDOMListeners(): void {
    const events: Array<{ type: string; handler: EventListener }> = [
      // RC-2 FIX: mousedown fires BEFORE the DOM state changes (checked,
      // selected, value). Register it before click so we capture pre-state.
      { type: 'mousedown', handler: this.onMousedown as EventListener },
      { type: 'click', handler: this.onClick },
      { type: 'dblclick', handler: this.onDblClick },
      { type: 'change', handler: this.onChange },
      { type: 'input', handler: this.onInput },
      { type: 'focus', handler: this.onFocus },
      { type: 'blur', handler: this.onBlur },
      { type: 'submit', handler: this.onSubmit },
    ];

    if (this.config.captureKeyboard) {
      events.push({ type: 'keydown', handler: this.onKeydown as EventListener });
    }

    if (this.config.captureHover) {
      events.push(
        { type: 'mouseover', handler: this.onMouseOver },
        { type: 'mouseout', handler: this.onMouseOut },
      );
    }

    if (this.config.captureScroll) {
      events.push({ type: 'scroll', handler: this.onScroll });
    }

    for (const { type, handler } of events) {
      document.addEventListener(type, handler, true); // capture phase
      this.boundHandlers.push({ type, handler });
    }
  }

  private unregisterDOMListeners(): void {
    for (const { type, handler } of this.boundHandlers) {
      document.removeEventListener(type, handler, true);
    }
    this.boundHandlers = [];
  }

  // ── Event Handlers ─────────────────────────────────────────────────

  /**
   * RC-2 FIX: mousedown handler captures element state BEFORE the browser
   * processes the click (which changes checkbox/radio/select state).
   * This is the same pattern used by the legacy select-content-script.ts
   * (mousedown + setTimeout(0) for deferred ARIA reads).
   */
  private onMousedown = (e: Event): void => {
    const target = resolveTarget(e);
    if (!target) return;

    // Capture pre-click state for checkboxes, radios, selects, ARIA widgets
    this.preStateMap.set(target, this.serializeElementState(target));

    // RC-3 FIX: For ARIA widgets, also use a deferred read to capture
    // the state change (setTimeout 0 lets the framework update the DOM).
    // This catches custom checkboxes/radios/toggles that update
    // aria-checked/aria-pressed asynchronously after mousedown.
    setTimeout(() => {
      // Check if this element's ARIA state actually changed
      const afterState = this.serializeElementState(target);
      const beforeState = this.preStateMap.get(target);
      if (beforeState !== undefined && beforeState !== afterState) {
        // State changed — emit a synthetic change event
        const value = this.captureValue(target);
        this.emit('change', extractIdentity(target), target.tagName,
          { value, previousValue: beforeState }, e.isTrusted);
      }
    }, 0);
  };

  private onClick = (e: Event): void => {
    this.emitFromEvent(e, 'click', {
      clickCount: 1,
      button: (e as MouseEvent).button,
      modifiers: this.extractModifiers(e),
    });

    // RC-4 FIX: Proactive surface detection — when a click fires on an element
    // with aria-haspopup, check if it expanded and emit surface_open immediately.
    // This bridges the gap between the trigger click and the MutationObserver
    // callback (which may fire 50-200ms later, causing the boundary detector to
    // split the trigger click and option click into separate units).
    const target = resolveTarget(e);
    if (target) {
      this.proactiveSurfaceCheck(target, e);
      // RC-5 FIX: Capture the clicked option's text/value if we're inside an open surface.
      // Many custom dropdowns, date pickers, and multi-selects use click events
      // on div/span/li elements instead of native change events.
      this.extractValueFromClick(target, e);
    }
  };

  private onDblClick = (e: Event): void => {
    this.emitFromEvent(e, 'dblclick', {
      clickCount: 2,
      button: (e as MouseEvent).button,
      modifiers: this.extractModifiers(e),
    });
  };

  /**
   * RC-4 FIX: Proactive surface detection.
   *
   * When a user clicks an element with aria-haspopup or a known dropdown/date
   * trigger class, check if the element's state actually expanded. If so, emit
   * a surface_open immediately — BEFORE the MutationObserver fires.
   *
   * This eliminates the race condition where the boundary detector closes the
   * trigger-click unit before the MutationObserver detects the surface.
   */
  private proactiveSurfaceCheck(target: Element, _e: Event): void {
    // Check aria-expanded
    const expanded = target.getAttribute('aria-expanded');
    const hasPopup = target.getAttribute('aria-haspopup');

    if (expanded === 'true' && hasPopup && !this.knownSurfaces.has(target)) {
      const surfaceType = this.mapHasPopupToSurface(hasPopup);
      this.knownSurfaces.add(target);
      this.emitSurfaceEvent('surface_open', target, surfaceType);
      return;
    }

    // Check for CSS class changes (React Select, MUI, Ant Design patterns)
    // These frameworks toggle classes like 'menu--open', 'Mui-expanded', 'ant-select-open'
    const cls = target.className;
    if (typeof cls === 'string') {
      const lower = cls.toLowerCase();
      if ((lower.includes('open') || lower.includes('expanded') || lower.includes('active')) &&
          (lower.includes('select') || lower.includes('dropdown') || lower.includes('combo') ||
           lower.includes('picker') || lower.includes('calendar'))) {
        if (!this.knownSurfaces.has(target)) {
          this.knownSurfaces.add(target);
          this.emitSurfaceEvent('surface_open', target, 'dropdown');
        }
      }
    }

    // Defer a microtask to check for surface appearance after framework renders
    // (React, Vue, Angular update the DOM asynchronously after the click handler)
    setTimeout(() => {
      // Look for surface elements that appeared as a result of this click
      // Check next sibling, parent's children, and aria-controls reference
      const controlsId = target.getAttribute('aria-controls');
      if (controlsId) {
        const controlled = document.getElementById(controlsId);
        if (controlled && this.isVisible(controlled) && !this.knownSurfaces.has(controlled)) {
          const surfaceType = this.identifySurface(controlled) || 'dropdown';
          this.knownSurfaces.add(controlled);
          this.emitSurfaceEvent('surface_open', controlled, surfaceType);
        }
      }

      // Also check if a popup appeared near the trigger (common pattern)
      const popup = target.parentElement?.querySelector(
        '[role="listbox"], [role="menu"], [role="dialog"], .dropdown-menu, .menu, .popover, .calendar, [class*="popup"]'
      );
      if (popup instanceof Element && this.isVisible(popup) && !this.knownSurfaces.has(popup)) {
        const surfaceType = this.identifySurface(popup) || 'dropdown';
        this.knownSurfaces.add(popup);
        this.emitSurfaceEvent('surface_open', popup, surfaceType);
      }
    }, 0);
  }

  /**
   * RC-5 FIX: Extract selected value from click events.
   *
   * Many custom dropdowns, date pickers, and multi-selects don't fire native
   * change events. Instead, the user clicks a div/span/li element, and the
   * framework updates state internally. We capture the clicked element's
   * text content as the "value" and emit a synthetic change event.
   *
   * Detection: the clicked element has role=option, is inside a known surface
   * (listbox, menu, calendar), or has data-value attribute.
   */
  private extractValueFromClick(target: Element, _e: Event): void {
    let shouldExtract = false;
    let value = '';
    let contextElement: Element | null = target;

    // Pattern 1: role="option" (ARIA listbox/combobox pattern)
    const role = target.getAttribute('role');
    if (role === 'option' || role === 'menuitem' || role === 'menuitemradio' || role === 'menuitemcheckbox') {
      shouldExtract = true;
      value = target.textContent?.trim() || target.getAttribute('data-value') || '';
    }

    // Pattern 2: Element with data-value inside a dropdown/calendar
    if (!shouldExtract && target.getAttribute('data-value')) {
      shouldExtract = true;
      value = target.getAttribute('data-value') || '';
    }

    // Pattern 3: Calendar cell — td/div with a date number, inside a calendar surface
    if (!shouldExtract) {
      const parent = target.closest('[class*="calendar"], [class*="datepicker"], [class*="date-picker"], [data-datepicker]');
      if (parent) {
        const cellText = target.textContent?.trim() || '';
        // Check if it looks like a date cell (number, day name, etc.)
        if (cellText && cellText.length <= 30 && /^\d/.test(cellText)) {
          shouldExtract = true;
          value = cellText;

          // Try to construct a more complete date from the calendar context
          const monthYearEl = parent.querySelector('[class*="month"], [class*="header"], [class*="title"]');
          if (monthYearEl) {
            const monthYear = monthYearEl.textContent?.trim() || '';
            if (monthYear) {
              value = `${cellText} ${monthYear}`;
            }
          }
        }
      }
    }

    // Pattern 4: Clicked element is inside a known open surface
    if (!shouldExtract) {
      for (const surface of this.knownSurfaces) {
        if (surface.contains(target)) {
          // We're inside an open dropdown/menu — the clicked element is likely a selection
          const text = target.textContent?.trim() || '';
          if (text && text.length <= 100) {
            shouldExtract = true;
            value = text;
          }
          break;
        }
      }
    }

    if (shouldExtract && value) {
      // Emit a synthetic change event with the clicked value
      // This ensures the pipeline picks up the selection even without a native change event
      const identity = extractIdentity(target);
      this.emit('change', identity, target.tagName, { value }, _e.isTrusted);

      console.log(
        `[CmdRunner V2 Observer] RC-5: Extracted value "${value}" from click on ` +
        `<${target.tagName.toLowerCase()}> inside surface`,
      );
    }
  }

  private onChange = (e: Event): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const value = this.captureValue(target);
    // RC-2 FIX: Include previous value from pre-state tracking
    const prevValue = this.preStateMap.get(target);
    const payload: Partial<EventPayload> = { value };
    if (prevValue !== undefined && prevValue !== this.serializeElementState(target)) {
      payload.previousValue = prevValue;
    }
    this.emitFromEvent(e, 'change', payload);
  };

  private onInput = (e: Event): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const value = this.captureValue(target);
    this.emitFromEvent(e, 'input', { value });
  };

  private onFocus = (e: Event): void => {
    // RC-2 FIX: Capture element's state at focus time so the pipeline
    // can compare before/after values when the element changes.
    const target = e.target;
    if (target instanceof Element) {
      this.preStateMap.set(target, this.serializeElementState(target));
    }
    this.emitFromEvent(e, 'focus', {});
  };

  private onBlur = (e: Event): void => {
    // RC-2 FIX: Compare current state with focus-time state and emit
    // a change if the value changed (catches programmatic value changes
    // that don't fire a separate change event)
    const target = e.target;
    if (target instanceof Element && this.preStateMap.has(target)) {
      const before = this.preStateMap.get(target);
      const after = this.serializeElementState(target);
      if (before !== after) {
        this.emitFromEvent(e, 'change', { value: this.captureValue(target) });
      }
      this.preStateMap.delete(target);
    }
    this.emitFromEvent(e, 'blur', {});
  };

  private onSubmit = (e: Event): void => {
    const target = e.target;
    const formAction = target instanceof HTMLFormElement ? target.action : '';
    this.emitFromEvent(e, 'submit', { formAction });
  };

  private onKeydown = (e: KeyboardEvent): void => {
    this.emitFromEvent(e, 'keydown', {
      key: e.key,
      code: e.code,
      modifiers: this.extractModifiers(e),
    });
  };

  private onMouseOver = (e: Event): void => {
    const target = resolveTarget(e);
    if (!target) return;

    // Cancel previous hover timer
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
    }

    // Start dwell timer
    this.hoverTimer = setTimeout(() => {
      this.emitFromEvent(e, 'mouseenter', {});
      this.hoverTimer = null;
    }, this.config.hoverDwellThresholdMs);
  };

  private onMouseOut = (e: Event): void => {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
      return; // Didn't dwell long enough — not an intentional hover
    }
    this.emitFromEvent(e, 'mouseleave', {});
  };

  private onScroll = (_e: Event): void => {
    if (this.scrollThrottle) return;
    this.scrollThrottle = setTimeout(() => {
      this.emit(
        'scroll',
        null,
        null,
        { scrollX: window.scrollX, scrollY: window.scrollY },
        true,
      );
      this.scrollThrottle = null;
    }, 500);
  };

  // ── Surface Detection (MutationObserver) ───────────────────────────

  private startMutationObserver(): void {
    if (typeof MutationObserver === 'undefined') return;

    this.mutationObserver = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'aria-hidden', 'hidden', 'style', 'class'],
    });
  }

  private handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        // Check added nodes for surfaces
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            this.checkForSurfaceOpen(node);
          }
        }
        // Check removed nodes for surface close
        for (const node of mutation.removedNodes) {
          if (node instanceof Element && this.knownSurfaces.has(node)) {
            this.emitSurfaceEvent('surface_close', node);
            this.knownSurfaces.delete(node);
          }
        }
      }

      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (!(target instanceof Element)) continue;
        this.checkForAttributeSurfaceChange(target, mutation.attributeName);
      }
    }
  }

  /**
   * Check if a newly-added element is a surface (dialog, dropdown, menu).
   */
  private checkForSurfaceOpen(el: Element): void {
    const surfaceType = this.identifySurface(el);
    if (surfaceType && !this.knownSurfaces.has(el) && this.isVisible(el)) {
      this.knownSurfaces.add(el);
      this.emitSurfaceEvent('surface_open', el, surfaceType);
    }

    // Also check children of added nodes (e.g. a div containing a dialog)
    for (const child of el.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], dialog, .dropdown-menu, .popover')) {
      if (child instanceof Element && !this.knownSurfaces.has(child) && this.isVisible(child)) {
        const childType = this.identifySurface(child);
        if (childType) {
          this.knownSurfaces.add(child);
          this.emitSurfaceEvent('surface_open', child, childType);
        }
      }
    }
  }

  /**
   * Check if an attribute change indicates a surface opened or closed.
   */
  private checkForAttributeSurfaceChange(el: Element, attrName: string | null): void {
    if (!attrName) return;

    // aria-expanded change
    if (attrName === 'aria-expanded') {
      const expanded = el.getAttribute('aria-expanded');
      const hasPopup = el.getAttribute('aria-haspopup');
      if (expanded === 'true' && hasPopup && !this.knownSurfaces.has(el)) {
        const surfaceType = this.mapHasPopupToSurface(hasPopup);
        this.knownSurfaces.add(el);
        this.emitSurfaceEvent('surface_open', el, surfaceType);
      } else if (expanded === 'false' && this.knownSurfaces.has(el)) {
        this.emitSurfaceEvent('surface_close', el);
        this.knownSurfaces.delete(el);
      }
    }

    // aria-hidden or hidden or style display change
    if (attrName === 'aria-hidden' || attrName === 'hidden' || attrName === 'style') {
      if (this.knownSurfaces.has(el) && !this.isVisible(el)) {
        this.emitSurfaceEvent('surface_close', el);
        this.knownSurfaces.delete(el);
      }
    }
  }

  /**
   * Identify the surface type of an element.
   *
   * Checks ARIA roles first (most reliable), then class names and common
   * framework patterns. Many custom date pickers, autocomplete widgets, and
   * SPA dropdowns don't use ARIA attributes — we catch them via class name
   * heuristics.
   */
  private identifySurface(el: Element): SurfaceType | null {
    // ARIA roles (most reliable)
    const role = el.getAttribute('role');
    if (role === 'dialog') return 'dialog';
    if (role === 'menu') return 'menu';
    if (role === 'listbox') return 'dropdown';
    if (role === 'tooltip') return 'popover';
    if (el.getAttribute('aria-modal') === 'true') return 'modal';

    // Native elements
    if (el.tagName === 'DIALOG') return 'dialog';

    // Class-based detection (covers most framework patterns)
    const cls = el.className;
    if (typeof cls === 'string') {
      const lower = cls.toLowerCase();
      if (lower.includes('dropdown') || lower.includes('combo')) return 'dropdown';
      if (lower.includes('popover') || lower.includes('tooltip')) return 'popover';
      if (lower.includes('modal') && lower.includes('open')) return 'modal';
      if (lower.includes('dialog')) return 'dialog';
      if (lower.includes('menu') && !lower.includes('breadcrumb')) return 'menu';
      // Date/calendar pickers — common class patterns across frameworks
      if (lower.includes('calendar') || lower.includes('datepicker') ||
          lower.includes('date-picker') || lower.includes('picker')) return 'dropdown';
      // Autocomplete suggestions
      if (lower.includes('autocomplete') || lower.includes('suggestion') ||
          lower.includes('typeahead')) return 'dropdown';
    }

    // Data attributes used by frameworks
    if (el.getAttribute('data-datepicker') || el.getAttribute('data-calendar')) return 'dropdown';
    if (el.getAttribute('data-dropdown') || el.getAttribute('data-combobox')) return 'dropdown';

    // Position-based heuristic: fixed/absolute positioned overlay with high z-index
    // that contains clickable items (catches many custom popups)
    try {
      const style = window.getComputedStyle(el);
      if ((style.position === 'fixed' || style.position === 'absolute') &&
          parseInt(style.zIndex || '0') >= 100 &&
          el.children.length > 0) {
        // Check if it looks like a popup (has clickable children)
        const hasClickable = el.querySelector('button, a, [role="option"], [role="menuitem"], [data-value], li');
        if (hasClickable) return 'dropdown';
      }
    } catch {
      // getComputedStyle may fail in some contexts
    }

    return null;
  }

  private mapHasPopupToSurface(hasPopup: string): SurfaceType {
    switch (hasPopup.toLowerCase()) {
      case 'dialog': return 'dialog';
      case 'menu': return 'menu';
      case 'listbox': return 'dropdown';
      case 'grid': return 'dropdown';
      case 'tree': return 'dropdown';
      default: return 'popover';
    }
  }

  private emitSurfaceEvent(type: 'surface_open' | 'surface_close', el: Element, surfaceType?: SurfaceType): void {
    const resolvedType: SurfaceType = surfaceType || this.identifySurface(el) || 'popover';
    const identity = extractIdentity(el);
    this.emit(type, identity, el.tagName, { surfaceType: resolvedType }, true);
  }

  // ── Event Emission ─────────────────────────────────────────────────

  /**
   * Core method: emit a PipelineEvent from a DOM event.
   *
   * LEARNING 7 (collectIdentity): extractIdentity() is ALWAYS called,
   * populating all 18 fields of ElementIdentity.
   */
  private emitFromEvent(
    e: Event,
    type: RecordedEventType,
    payloadOverrides: Partial<EventPayload>,
  ): void {
    const target = resolveTarget(e);
    if (!target) return;

    const identity = extractIdentity(target);
    const targetTag = target?.tagName || null;

    this.emit(type, identity, targetTag, payloadOverrides, e.isTrusted);
  }

  /**
   * Emit a PipelineEvent.
   *
   * STATE SNAPSHOT: The content script captures a StateSnapshot and embeds it
   * in the event payload. The Pipeline V2 orchestrator (service worker) has
   * no DOM access — it relies on these content-script-captured snapshots to
   * compute the state diff. This is the fix for the architectural gap where
   * the service worker cannot call snapshotState() itself.
   */
  private emit(
    type: RecordedEventType,
    identity: ElementIdentity | null,
    targetTag: string | null,
    payload: EventPayload,
    isTrusted: boolean,
  ): void {
    // Capture a state snapshot from the content script's DOM context.
    // This runs in the page, where document is accessible.
    let stateSnapshot: StateSnapshot | undefined;
    try {
      stateSnapshot = snapshotState();
    } catch {
      // DOM may not be fully ready in rare edge cases
    }

    const event: PipelineEvent = {
      eventId: `evt-${String(++this.eventCounter).padStart(5, '0')}`,
      type,
      timestamp: new Date().toISOString(),
      element: identity,
      targetTag,
      payload: { ...payload, stateSnapshot },
      isTrusted,
    };

    console.log(
      `[CmdRunner V2 Observer] CAPTURED: ${type} on ${targetTag || 'N/A'} ` +
      `element="${identity?.accessibleName || 'N/A'}" trusted=${isTrusted} ` +
      `eventId=${event.eventId}`,
    );

    if (this.callback) {
      this.callback(event);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private extractModifiers(e: Event): EventModifiers {
    const me = e as MouseEvent | KeyboardEvent;
    return {
      ctrlKey: me.ctrlKey || false,
      altKey: me.altKey || false,
      shiftKey: me.shiftKey || false,
      metaKey: me.metaKey || false,
    };
  }

  /**
   * RC-2 FIX: Serialize an element's interactive state to a comparable string.
   * Used by pre-state tracking to detect before/after state changes.
   *
   * Captures: checked state, selected option, value, ARIA attributes.
   * This enables the pipeline to detect changes even when the state diff
   * snapshots (taken at event time) are identical.
   */
  private serializeElementState(el: Element): string {
    const parts: string[] = [];

    // Native form element state
    if (el instanceof HTMLInputElement) {
      parts.push(`type=${el.type}`);
      parts.push(`value=${el.value}`);
      if (el.type === 'checkbox' || el.type === 'radio') {
        parts.push(`checked=${el.checked}`);
      }
    } else if (el instanceof HTMLSelectElement) {
      parts.push(`selectIndex=${el.selectedIndex}`);
      const opt = el.options[el.selectedIndex];
      parts.push(`selectValue=${opt ? opt.value : ''}`);
      parts.push(`selectText=${opt ? opt.text : ''}`);
    } else if (el instanceof HTMLTextAreaElement) {
      parts.push(`value=${el.value}`);
    }

    // ARIA attributes (critical for custom widgets)
    const ariaChecked = el.getAttribute('aria-checked');
    if (ariaChecked !== null) parts.push(`aria-checked=${ariaChecked}`);
    const ariaPressed = el.getAttribute('aria-pressed');
    if (ariaPressed !== null) parts.push(`aria-pressed=${ariaPressed}`);
    const ariaSelected = el.getAttribute('aria-selected');
    if (ariaSelected !== null) parts.push(`aria-selected=${ariaSelected}`);
    const ariaExpanded = el.getAttribute('aria-expanded');
    if (ariaExpanded !== null) parts.push(`aria-expanded=${ariaExpanded}`);
    const ariaValuenow = el.getAttribute('aria-valuenow');
    if (ariaValuenow !== null) parts.push(`aria-valuenow=${ariaValuenow}`);

    // Data attributes used by frameworks to store widget state
    const dataValue = el.getAttribute('data-value');
    if (dataValue !== null) parts.push(`data-value=${dataValue}`);

    // textContent for display elements (custom dropdowns showing selected value)
    const tag = el.tagName.toLowerCase();
    if (tag === 'div' || tag === 'span' || tag === 'button') {
      const text = el.textContent?.trim().substring(0, 50) || '';
      if (text) parts.push(`text=${text}`);
    }

    return parts.join('|');
  }

  private captureValue(el: Element): string {
    if (el instanceof HTMLSelectElement) {
      const option = el.options[el.selectedIndex];
      return option ? (option.text?.trim() || option.value || '') : '';
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.value ?? '';
    }
    // ARIA combobox
    const descendantId = el.getAttribute('aria-activedescendant');
    if (descendantId) {
      const option = document.getElementById(descendantId);
      if (option) return option.textContent?.trim() || '';
    }
    return '';
  }

  private isVisible(el: Element): boolean {
    if (!el.isConnected) return false;
    const htmlEl = el as HTMLElement;
    if (htmlEl.hidden) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = htmlEl.style;
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    return true;
  }

  /**
   * Process a navigation event from the service worker (webNavigation API).
   * Called externally — navigation events don't come from DOM listeners.
   */
  ingestNavigation(url: string, title: string): void {
    this.emit('navigation', null, null, { url, title }, true);
  }
}
