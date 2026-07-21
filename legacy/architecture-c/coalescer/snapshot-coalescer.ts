/**
 * Snapshot Coalescer — Architecture C Layer 2.
 *
 * Groups raw browser events from the Universal Interaction Observer
 * into coherent InteractionSnapshots. Operates on temporal windows,
 * deduplicates related events, and computes the rich evidence fields
 * (value changes, state changes, class changes, ancestor context)
 * that the Multi-Tier Classifier needs.
 *
 * Key responsibilities:
 *   1. Open/close coalescing windows based on element identity + timing
 *   2. Group related events (mousedown+click+change+blur → one snapshot)
 *   3. Compute valueChange, stateChange, classChange from pre/post states
 *   4. Select the primary event (most semantically meaningful)
 *   5. Build ancestorContext from element's DOM hierarchy
 *   6. Detect date-like values
 *
 * Architecture: .drytis/architecture-c-production.md §5
 * Types: src/shared/evidence-types.ts
 */

import type {
  RawEvidence,
  InteractionSnapshot,
  PrimaryEvent,
  SecondaryEvent,
  ValueChange,
  StateChange,
  ClassChange,
  AncestorContext,
  AriaEvidence,
  DomMutationEvidence,
  CoalescingConfig,
} from '../../shared/evidence-types';
import type { ElementIdentity } from '../../shared/types';
import {
  COALESCING_WINDOW_MS,
  DWELL_THRESHOLD,
  FOCUS_DEBOUNCE_MS,
  AI_CONFIDENCE_THRESHOLD,
  isDateLikeValue,
  hasSelectionClass,
  CALENDAR_ROLES,
  COMBOBOX_ROLES,
  MENU_ROLES,
  DIALOG_ROLES,
  CALENDAR_CLASS_PATTERNS,
  DROPDOWN_CLASS_PATTERNS,
  DEFAULT_COALESCING_CONFIG,
} from '../../shared/classifier-constants';

// ── Coalescing Window ─────────────────────────────────────

/**
 * An open coalescing window accumulating events for a single user action.
 */
interface CoalescingWindow {
  /** Hash of the primary element identity for grouping. */
  elementKey: string;
  /** All raw evidence events in this window. */
  events: RawEvidence[];
  /** Timestamp (epoch ms) the window was opened. */
  openedAt: number;
  /** Timestamp (epoch ms) of the last event added. */
  lastEventAt: number;
  /** Identity of the primary element. */
  identity: ElementIdentity;
  /** Value captured at focus/mousedown (pre-interaction state). */
  preValue: string | null;
  /** Checked/ARIA state captured at mousedown (pre-interaction state). */
  preState: string | null;
  /** Pre-interaction ARIA state string. */
  preAriaState: string | null;
  /** Accumulated mutation data across all events in this window. */
  mutations: {
    childListAdded: number;
    childListRemoved: number;
    attributeChanges: number;
    visibilityChanges: number;
    semanticChanges: string[];
  };
  /** Whether the window started with a mouseenter (hover tracking). */
  isHoverWindow: boolean;
  /** Timestamp of the mouseenter (for dwell computation). */
  mouseenterAt: number | null;
  /** Timestamp of focus (for focus duration computation). */
  focusAt: number | null;
}

// ── Snapshot Coalescer ────────────────────────────────────

export class SnapshotCoalescer {
  private openWindow: CoalescingWindow | null = null;
  private readonly config: CoalescingConfig;
  private readonly onSnapshot: (snapshot: InteractionSnapshot) => void;

  constructor(
    onSnapshot: (snapshot: InteractionSnapshot) => void,
    config?: Partial<CoalescingConfig>,
  ) {
    this.onSnapshot = onSnapshot;
    this.config = { ...DEFAULT_COALESCING_CONFIG, ...config };
  }

  /**
   * Ingest a raw evidence event from the observer.
   * Groups it into an existing window or opens a new one.
   */
  ingest(evidence: RawEvidence): void {
    const now = Date.parse(evidence.timestamp);

    // Check if this event belongs in the open window
    if (this.openWindow && this.belongsToWindow(evidence, now)) {
      this.addToWindow(evidence, now);
    } else {
      // Close existing window and emit its snapshot
      if (this.openWindow) {
        this.closeWindow();
      }
      // Open new window
      this.openWindow = this.createWindow(evidence, now);
    }
  }

  /**
   * Ingest a navigation event — always produces a standalone snapshot.
   * Closes any open window first.
   */
  ingestNavigation(url: string, timestamp: string): void {
    // Close any open window first
    if (this.openWindow) {
      this.closeWindow();
    }

    // Create a navigation snapshot
    const navSnapshot: InteractionSnapshot = {
      identity: {
        accessibleName: url,
        ariaRole: null,
        ariaLabel: null,
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'navigation',
        className: null,
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        cssSelector: '',
        xPath: '',
        inIframe: false,
        shadowDom: false,
        iframeContext: undefined,
        elementId: `nav-${Date.now()}`,
      },
      primaryEvent: {
        type: 'navigation',
        timestamp,
        isTrusted: true,
      },
      secondaryEvents: [],
      ancestorContext: {
        roles: [],
        containerClasses: [],
        hasCalendarAncestor: false,
        hasListboxAncestor: false,
        hasMenuAncestor: false,
        hasDialogAncestor: false,
      },
      ariaAttributes: {
        role: null,
        ariaLabel: null,
        ariaHasPopup: null,
        ariaSelected: null,
        ariaChecked: null,
        ariaPressed: null,
        ariaExpanded: null,
      },
      timestamp,
    };

    this.onSnapshot(navSnapshot);
  }

  /**
   * Force-close any open window (called on STOP_RECORDING).
   */
  flush(): void {
    if (this.openWindow) {
      this.closeWindow();
    }
  }

  /**
   * Reset state (called on START_RECORDING).
   */
  reset(): void {
    this.openWindow = null;
  }

  // ── Window Management ───────────────────────────────────

  /**
   * Determine whether an evidence event belongs in the currently open window.
   *
   * Checks:
   *   1. Same element identity (by key hash)
   *   2. Within temporal window
   *   3. Or: related element (ancestor chain overlap) within temporal window
   */
  private belongsToWindow(evidence: RawEvidence, eventTime: number): boolean {
    if (!this.openWindow) return false;

    const elapsed = eventTime - this.openWindow.lastEventAt;
    // Use extended window for ongoing interaction sequences (focus→blur, mouseenter→mouseleave)
    // These can last seconds (user typing) or hundreds of ms (hover dwell)
    const isOngoingFocus = this.openWindow.focusAt !== null && evidence.eventType !== 'blur';
    const isOngoingHover = this.openWindow.mouseenterAt !== null && evidence.eventType !== 'mouseleave';
    const isClosingFocus = evidence.eventType === 'blur' && this.openWindow.focusAt !== null;
    const isClosingHover = evidence.eventType === 'mouseleave' && this.openWindow.mouseenterAt !== null;

    if (!isOngoingFocus && !isOngoingHover && !isClosingFocus && !isClosingHover) {
      if (elapsed > this.config.windowMs) return false;
    }

    // Same element?
    const key = this.computeElementKey(evidence.identity);
    if (key === this.openWindow.elementKey) return true;

    // Related element (different element but same interaction family)?
    if (this.areRelated(evidence.identity, this.openWindow.identity)) {
      return true;
    }

    return false;
  }

  /**
   * Check if two element identities are "related" — different elements
   * that are part of the same user action (e.g., clicking a calendar cell
   * that triggers a change on a date input field).
   *
   * Heuristic: check if they share container CSS classes or are in a
   * known interaction family (calendar, dropdown).
   */
  private areRelated(a: ElementIdentity, b: ElementIdentity): boolean {
    // If both are in the same iframe or shadow DOM scope, they might be related
    const aClass = (a.className ?? '').toLowerCase();
    const bClass = (b.className ?? '').toLowerCase();

    // Calendar family: one element has calendar class, the other is a date input
    const aCalendar = CALENDAR_CLASS_PATTERNS.some((p) => aClass.includes(p));
    const bCalendar = CALENDAR_CLASS_PATTERNS.some((p) => bClass.includes(p));
    if (aCalendar || bCalendar) {
      // If one is an input and the other has calendar context, they're related
      if (a.tag === 'input' || b.tag === 'input') return true;
    }

    // Dropdown family: one element has dropdown class
    const aDropdown = DROPDOWN_CLASS_PATTERNS.some((p) => aClass.includes(p));
    const bDropdown = DROPDOWN_CLASS_PATTERNS.some((p) => bClass.includes(p));
    if (aDropdown || bDropdown) {
      // Options clicking that changes a related input
      if (a.tag === 'input' || b.tag === 'input') return true;
      if (a.tag === 'select' || b.tag === 'select') return true;
    }

    return false;
  }

  /**
   * Create a new coalescing window for a raw evidence event.
   */
  private createWindow(evidence: RawEvidence, eventTime: number): CoalescingWindow {
    const key = this.computeElementKey(evidence.identity);

    // Capture pre-interaction state.
    // For focus/mousedown, evidence.value IS the pre-value.
    // For change/blur/click, evidence.value is the POST-value — don't capture as preValue.
    const isPreEvent = evidence.eventType === 'focus' || evidence.eventType === 'mousedown';
    const preValue = isPreEvent ? (evidence.value ?? '') : '';
    const preState = isPreEvent ? this.extractState(evidence) : null;
    const preAriaState = isPreEvent ? (evidence.ariaState ?? null) : null;

    // Track mouseenter for hover windows
    const isHoverWindow = evidence.eventType === 'mouseenter';

    // Initialize mutations and process the first event's mutations immediately
    const mutations = {
      childListAdded: 0,
      childListRemoved: 0,
      attributeChanges: 0,
      visibilityChanges: 0,
      semanticChanges: [] as string[],
    };

    if (evidence.mutations) {
      mutations.childListAdded += evidence.mutations.childListAdded;
      mutations.childListRemoved += evidence.mutations.childListRemoved;
      mutations.attributeChanges += evidence.mutations.attributeChanges;
      mutations.visibilityChanges += evidence.mutations.visibilityChanges;
      if (evidence.mutations.semanticChanges.length > 0) {
        mutations.semanticChanges.push(...evidence.mutations.semanticChanges);
      }
    }

    return {
      elementKey: key,
      events: [evidence],
      openedAt: eventTime,
      lastEventAt: eventTime,
      identity: evidence.identity,
      preValue,
      preState,
      preAriaState,
      mutations,
      isHoverWindow,
      mouseenterAt: isHoverWindow ? eventTime : null,
      focusAt: evidence.eventType === 'focus' ? eventTime : null,
    };
  }

  /**
   * Add an evidence event to the open window.
   */
  private addToWindow(evidence: RawEvidence, eventTime: number): void {
    if (!this.openWindow) return;

    this.openWindow.events.push(evidence);
    this.openWindow.lastEventAt = eventTime;

    // Track focus for focus duration
    if (evidence.eventType === 'focus' && this.openWindow.focusAt === null) {
      this.openWindow.focusAt = eventTime;
    }

    // Track mouseenter for hover dwell
    if (evidence.eventType === 'mouseenter' && this.openWindow.mouseenterAt === null) {
      this.openWindow.mouseenterAt = eventTime;
    }

    // Accumulate mutations
    if (evidence.mutations) {
      this.openWindow.mutations.childListAdded += evidence.mutations.childListAdded;
      this.openWindow.mutations.childListRemoved += evidence.mutations.childListRemoved;
      this.openWindow.mutations.attributeChanges += evidence.mutations.attributeChanges;
      this.openWindow.mutations.visibilityChanges += evidence.mutations.visibilityChanges;
      if (evidence.mutations.semanticChanges.length > 0) {
        this.openWindow.mutations.semanticChanges.push(...evidence.mutations.semanticChanges);
      }
    }

    // Track class changes for selection pattern detection
    if (evidence.mutations?.semanticChanges) {
      for (const change of evidence.mutations.semanticChanges) {
        if (change.startsWith('class:')) {
          const className = change.replace('class:', '').replace('-added', '').replace('-removed', '');
          // Will be checked at closeWindow time via hasSelectionClass
        }
      }
    }
  }

  /**
   * Close the open window, compute the InteractionSnapshot, and emit it.
   */
  private closeWindow(): void {
    if (!this.openWindow) return;

    const window = this.openWindow;
    this.openWindow = null;

    // Select the primary event
    const primaryEventRaw = this.selectPrimaryEvent(window.events);
    const primaryEvent = this.toPrimaryEvent(primaryEventRaw, window);

    // Build secondary events
    const secondaryEvents: SecondaryEvent[] = window.events
      .filter((e) => e !== primaryEventRaw)
      .map((e) => ({ type: e.eventType, timestamp: e.timestamp }));

    // Compute value change
    const valueChange = this.computeValueChange(window);

    // Compute state change
    const stateChange = this.computeStateChange(window);

    // Compute class change
    const classChange = this.computeClassChange(window);

    // Build ancestor context
    const ancestorContext = this.buildAncestorContext(window.identity);

    // Build ARIA evidence
    const ariaAttributes = this.buildAriaEvidence(window.identity);

    // Compute dwell time (for hover)
    let dwellTime: number | undefined;
    if (window.mouseenterAt !== null) {
      const mouseleave = window.events.find((e) => e.eventType === 'mouseleave');
      const endTime = mouseleave
        ? Date.parse(mouseleave.timestamp)
        : window.lastEventAt;
      dwellTime = endTime - window.mouseenterAt;
    }

    // Compute focus duration
    let focusDuration: number | undefined;
    if (window.focusAt !== null) {
      const blur = window.events.find((e) => e.eventType === 'blur');
      if (blur) {
        focusDuration = Date.parse(blur.timestamp) - window.focusAt;
      }
    }

    // Collect key events
    const keyEvents = window.events
      .filter((e) => e.eventType === 'keydown')
      .map((e) => e.value)  // key identifier stored in value field
      .filter((k): k is string => !!k);

    // Build DOM mutation evidence
    const hasMutations = window.mutations.childListAdded > 0 ||
                         window.mutations.childListRemoved > 0 ||
                         window.mutations.attributeChanges > 0 ||
                         window.mutations.visibilityChanges > 0;

    const domMutations: DomMutationEvidence | undefined = hasMutations
      ? {
          childListChanges: window.mutations.childListAdded + window.mutations.childListRemoved,
          attributeChanges: window.mutations.attributeChanges,
          visibilityChanges: window.mutations.visibilityChanges,
          observedWindow: window.lastEventAt - window.openedAt,
        }
      : undefined;

    // Build the snapshot
    const snapshot: InteractionSnapshot = {
      identity: window.identity,
      primaryEvent,
      secondaryEvents,
      ...(valueChange ? { valueChange } : {}),
      ...(stateChange ? { stateChange } : {}),
      ...(classChange ? { classChange } : {}),
      ancestorContext,
      ariaAttributes,
      ...(dwellTime !== undefined ? { dwellTime } : {}),
      ...(focusDuration !== undefined ? { focusDuration } : {}),
      ...(keyEvents.length > 0 ? { keyEvents } : {}),
      ...(domMutations ? { domMutations } : {}),
      timestamp: primaryEvent.timestamp,
    };

    this.onSnapshot(snapshot);
  }

  // ── Evidence Computation ────────────────────────────────

  /**
   * Select the most semantically meaningful event as the primary event.
   * Priority: change > click > mousedown > blur > mouseenter > focus > keydown > input
   */
  private selectPrimaryEvent(events: RawEvidence[]): RawEvidence {
    // Priority order: most semantically meaningful event type wins.
    // mouseenter is ranked higher than mouseleave because it represents the
    // initiation of a hover interaction (the user's intent).
    const priority = ['change', 'click', 'mousedown', 'mouseenter', 'mouseleave', 'blur', 'focus', 'keydown', 'input'];

    for (const type of priority) {
      const match = events.find((e) => e.eventType === type);
      if (match) return match;
    }
    return events[0];
  }

  /**
   * Convert a RawEvidence into a PrimaryEvent.
   */
  private toPrimaryEvent(raw: RawEvidence, window: CoalescingWindow): PrimaryEvent {
    const type = raw.eventType as PrimaryEvent['type'];
    return {
      type,
      timestamp: raw.timestamp,
      isTrusted: raw.isTrusted,
    };
  }

  /**
   * Compute the value change from pre-interaction and post-interaction values.
   */
  private computeValueChange(window: CoalescingWindow): ValueChange | undefined {
    // Find the last value in the window
    let postValue: string | null = null;
    for (let i = window.events.length - 1; i >= 0; i--) {
      if (window.events[i].value !== undefined) {
        postValue = window.events[i].value!;
        break;
      }
    }

    if (postValue === null) return undefined;

    // preValue: the first value captured in the window (before the change)
    // For change events without prior focus, preValue is the value on the
    // first event in the window (which the observer captures from the element
    // before the change takes effect).
    let preValue = window.preValue ?? '';

    // If there are multiple events, find the pre-value from the earliest event
    // that has a value different from postValue
    if (window.events.length > 1) {
      for (let i = 0; i < window.events.length; i++) {
        const ev = window.events[i];
        if (ev.value !== undefined && ev.value !== postValue) {
          preValue = ev.value!;
          break;
        }
      }
    }
    if (preValue === postValue) return undefined;

    // Determine input type
    const identity = window.identity;
    const tag = identity.tag?.toLowerCase() ?? '';
    let inputType = 'text';

    if (tag === 'select') {
      inputType = 'select-one';
    } else if (tag === 'textarea') {
      inputType = 'textarea';
    } else if (tag === 'input') {
      // Check className or other identity fields for input type
      // In the full implementation, the observer captures the input type.
      // For now, infer from class or default to text.
      inputType = 'text';
    }

    return {
      before: preValue,
      after: postValue,
      inputType,
      isDateLike: isDateLikeValue(postValue),
    };
  }

  /**
   * Compute the state change from pre/post states.
   */
  private computeStateChange(window: CoalescingWindow): StateChange | undefined {
    // Find the last checked/aria state in the window
    let postState: string | null = null;
    let postProperty: StateChange['property'] | null = null;

    for (let i = window.events.length - 1; i >= 0; i--) {
      const event = window.events[i];
      if (event.checked !== undefined) {
        postState = String(event.checked);
        postProperty = 'checked';
        break;
      }
      if (event.ariaState !== undefined && event.ariaState !== null) {
        postState = event.ariaState;
        // Determine which ARIA property
        const ariaStr = event.ariaState.toLowerCase();
        if (ariaStr.includes('pressed')) {
          postProperty = 'aria-pressed';
        } else if (ariaStr.includes('checked')) {
          postProperty = 'aria-checked';
        } else if (ariaStr.includes('selected')) {
          postProperty = 'aria-selected';
        }
        break;
      }
    }

    if (postState === null || postProperty === null) return undefined;

    const preState = window.preState ?? '';

    // Only report if state actually changed
    if (preState === postState) return undefined;

    return {
      property: postProperty,
      before: preState,
      after: postState,
    };
  }

  /**
   * Compute class changes from mutation data.
   */
  private computeClassChange(window: CoalescingWindow): ClassChange | undefined {
    const addedClasses: string[] = [];
    const removedClasses: string[] = [];

    for (const change of window.mutations.semanticChanges) {
      if (change.startsWith('class:')) {
        const detail = change.replace('class:', '');
        if (detail.endsWith('-added')) {
          addedClasses.push(detail.replace('-added', ''));
        } else if (detail.endsWith('-removed')) {
          removedClasses.push(detail.replace('-removed', ''));
        }
      }
    }

    if (addedClasses.length === 0 && removedClasses.length === 0) return undefined;

    return {
      added: addedClasses,
      removed: removedClasses,
      selectionPattern: hasSelectionClass(addedClasses),
    };
  }

  /**
   * Build ancestor context from element identity.
   *
   * In the full implementation (Phase 4), the observer captures the full
   * ancestor chain. In Phase 2, we infer from the element's own attributes.
   */
  private buildAncestorContext(identity: ElementIdentity): AncestorContext {
    const className = (identity.className ?? '').toLowerCase();
    const roles: string[] = [];
    const containerClasses: string[] = [];

    // Check element's own role
    if (identity.ariaRole) {
      roles.push(identity.ariaRole);
    }

    // Check for calendar context
    const hasCalendarClass = CALENDAR_CLASS_PATTERNS.some((p) => className.includes(p));
    if (hasCalendarClass) {
      containerClasses.push(...CALENDAR_CLASS_PATTERNS.filter((p) => className.includes(p)));
    }

    // Check for dropdown context
    const hasDropdownClass = DROPDOWN_CLASS_PATTERNS.some((p) => className.includes(p));
    if (hasDropdownClass) {
      containerClasses.push(...DROPDOWN_CLASS_PATTERNS.filter((p) => className.includes(p)));
    }

    return {
      roles,
      containerClasses,
      hasCalendarAncestor: hasCalendarClass,
      hasListboxAncestor: roles.some((r) => COMBOBOX_ROLES.includes(r)),
      hasMenuAncestor: roles.some((r) => MENU_ROLES.includes(r)),
      hasDialogAncestor: roles.some((r) => DIALOG_ROLES.includes(r)),
    };
  }

  /**
   * Build ARIA evidence from element identity.
   */
  private buildAriaEvidence(identity: ElementIdentity): AriaEvidence {
    return {
      role: identity.ariaRole ?? null,
      ariaLabel: identity.ariaLabel ?? null,
      ariaHasPopup: null, // Not captured in current ElementIdentity
      ariaSelected: null, // Would be captured by observer
      ariaChecked: null,  // Would be captured by observer
      ariaPressed: null,  // Would be captured by observer
      ariaExpanded: null, // Would be captured by observer
    };
  }

  // ── Utilities ───────────────────────────────────────────

  /**
   * Compute a hash key for an element identity for grouping purposes.
   */
  private computeElementKey(identity: ElementIdentity): string {
    return [
      identity.tag ?? '',
      identity.ariaRole ?? '',
      identity.accessibleName ?? '',
      identity.elementId ?? '',
      identity.name ?? '',
    ].join('|');
  }

  /**
   * Extract the state value from a raw evidence event.
   */
  private extractState(evidence: RawEvidence): string | null {
    if (evidence.checked !== undefined) return String(evidence.checked);
    if (evidence.ariaState !== undefined && evidence.ariaState !== null) return evidence.ariaState;
    return null;
  }
}
