/**
 * Interaction Assembler — Architecture C Enhancement.
 *
 * Collapses multiple classified snapshots into single business actions
 * when the user interacts with a composite UI component (dropdown,
 * date picker, autocomplete, dialog, etc.).
 *
 * Uses a transaction state machine:
 *   IDLE → PENDING → COMMITTED (or CANCELLED)
 *
 * Detection: transient UI surface transitions via DeterministicState
 * (openDropdowns, openDialogs) + fallback ancestor context signals.
 *
 * Architecture: .drytis/specs/interaction-assembler.md
 * Types: src/shared/evidence-types.ts, src/shared/architecture-types.ts
 */

import type {
  InteractionSnapshot,
  ClassifyOutput,
} from '../../shared/evidence-types';
import type { DeterministicState } from '../../shared/architecture-types';
import type { SessionEvent } from '../../shared/types';

// ── Types ──────────────────────────────────────────────────────────────

/** Transaction states for the assembler. */
export type TransactionState = 'IDLE' | 'PENDING' | 'COMMITTED' | 'CANCELLED';

/**
 * The label/type for the composite interaction.
 * Used to generate the business action label and to determine the
 * correct canonical type for the collapsed event.
 */
export type CompositeType =
  | 'dropdown'
  | 'datepicker'
  | 'autocomplete'
  | 'dialog'
  | 'menu'
  | 'tabs'
  | 'generic';

/** A classified snapshot buffered in the transaction. */
export interface BufferedSnapshot {
  snapshot: InteractionSnapshot;
  classification: ClassifyOutput;
}

/** Result of the assembler processing a classified snapshot. */
export interface AssemblerResult {
  /**
   * The SessionEvent to emit now (if any).
   * - In IDLE: the event for the current snapshot.
   * - In PENDING: null (buffered) unless the opener needs emission.
   * - On COMMIT: null (the opener event is updated in-place).
   * - On CANCEL: the buffered events emitted individually.
   */
  eventsToEmit: SessionEvent[];
  /**
   * If the opener event should be updated with collapsed data.
   * Contains the opener actionId and the updated fields.
   */
  openerUpdate: { actionId: string; fields: Partial<SessionEvent> } | null;
  /** Whether this snapshot started a transaction. */
  transactionStarted: boolean;
  /** Whether this snapshot committed/cancelled a transaction. */
  transactionEnded: boolean;
  /** Current state after processing. */
  state: TransactionState;
}

// ── Surface detection helpers ──────────────────────────────────────────

/**
 * Check whether a deterministic state has any transient surface open.
 */
export function hasOpenSurface(state: DeterministicState | null | undefined): boolean {
  if (!state) return false;
  return state.openDropdowns.length > 0 || state.openDialogs.length > 0;
}

/**
 * Detect whether a snapshot's interaction likely triggered a surface opening.
 *
 * Checks:
 *   - The snapshot's DOM mutations show childListAdded (surface appeared).
 *   - The interacted element has aria-expanded semantics (popup trigger).
 *   - The element is typically a trigger (button, combobox, link with aria-haspopup).
 *
 * This is a heuristic — the authoritative signal is DeterministicState.
 */
export function triggeredSurfaceOpen(snapshot: InteractionSnapshot): boolean {
  // DOM mutations: elements were added to the page
  if (snapshot.domMutations && snapshot.domMutations.childListChanges > 0) {
    return true;
  }

  // Element with aria-haspopup or combobox role
  const role = snapshot.identity.ariaRole;
  if (role === 'combobox') return true;

  // ariaExpanded evidence (would be 'true' if captured)
  if (snapshot.ariaAttributes.ariaExpanded === 'true') return true;

  // Input elements with date-like classes (fallback for custom date pickers).
  // Only applies to click events — focus/change/blur are handled by the
  // coalescer as text entry, not surface triggers.
  if (snapshot.primaryEvent.type === 'click') {
    const className = (snapshot.identity.className ?? '').toLowerCase();
    const accessibleName = (snapshot.identity.accessibleName ?? '').toLowerCase();
    const placeholder = (snapshot.identity.placeholder ?? '').toLowerCase();
    const textBlob = `${className} ${accessibleName} ${placeholder}`;
    if (
      textBlob.includes('depart') ||
      textBlob.includes('arrival') ||
      textBlob.includes('return') ||
      textBlob.includes('onward') ||
      (textBlob.includes('date') && textBlob.includes('picker'))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Detect whether a snapshot occurred inside an open surface.
 * This is the fallback when DeterministicState hasn't updated yet.
 */
export function isInsideSurface(snapshot: InteractionSnapshot): boolean {
  const ctx = snapshot.ancestorContext;
  return (
    ctx.hasListboxAncestor ||
    ctx.hasMenuAncestor ||
    ctx.hasCalendarAncestor ||
    ctx.hasDialogAncestor
  );
}

/**
 * Determine the composite type based on context signals.
 */
export function classifyCompositeType(
  snapshots: BufferedSnapshot[],
): CompositeType {
  if (!snapshots.length) return 'generic';

  // Check ALL snapshots' ancestor contexts (the opener may not have
  // surface context — the surface opens AFTER the opener click).
  const hasCalendar = snapshots.some(s => s.snapshot.ancestorContext.hasCalendarAncestor);
  const hasDialog = snapshots.some(s => s.snapshot.ancestorContext.hasDialogAncestor);
  const hasMenu = snapshots.some(s => s.snapshot.ancestorContext.hasMenuAncestor);
  const hasListbox = snapshots.some(s => s.snapshot.ancestorContext.hasListboxAncestor);

  // Date picker: calendar context
  if (hasCalendar) return 'datepicker';

  // Dialog/modal
  if (hasDialog) return 'dialog';

  // Menu
  if (hasMenu) return 'menu';

  // Listbox/combobox → dropdown or autocomplete
  if (hasListbox) {
    // If there was a text-entry classification in the body (user typed
    // to filter), it's autocomplete. A value change on the selection
    // click is normal (the dropdown value changes when you pick an option).
    const hasTextInput = snapshots.some(
      (s) => s.classification.classified.canonicalType === 'fill',
    );
    return hasTextInput ? 'autocomplete' : 'dropdown';
  }

  // Check element roles in the buffer for date-like values
  const hasDateValue = snapshots.some(
    (s) => s.snapshot.valueChange?.isDateLike,
  );
  if (hasDateValue) return 'datepicker';

  return 'generic';
}

/**
 * Check whether the last buffered snapshot represents a definitive selection.
 *
 * A definitive selection is one where the user chose an option, date, or item
 * — not just hovered or navigated within the surface.
 */
export function isDefinitiveSelection(
  classification: ClassifyOutput,
  snapshot: InteractionSnapshot,
): boolean {
  const canonical = classification.classified.canonicalType;

  // Option selection in a listbox/menu → definitive
  if (canonical === 'select') return true;

  // Date selection → definitive
  if (canonical === 'selectDate') return true;

  // A click inside a surface that has a value change → likely a selection
  if (canonical === 'click' && snapshot.valueChange?.after) return true;

  // ARIA role check: option, menuitem, treeitem, tab are selection-like
  const role = snapshot.identity.ariaRole;
  if (role === 'option' || role === 'menuitem' || role === 'treeitem' || role === 'tab') {
    return true;
  }

  return false;
}

/**
 * Determine the canonical type to use for a collapsed composite action.
 *
 * If the selection snapshot already classified as select/selectDate, use that.
 * If it was classified as 'click' but is inside a surface, upgrade based on
 * context signals (date-like value → selectDate, otherwise select).
 */
export function resolveCollapsedType(
  selectionClassification: ClassifyOutput,
  snapshots: BufferedSnapshot[],
): ClassifyOutput {
  const canonical = selectionClassification.classified.canonicalType;

  // Already correctly classified
  if (canonical === 'select' || canonical === 'selectDate') {
    return selectionClassification;
  }

  // Upgrade click → select/selectDate based on context
  const compositeType = classifyCompositeType(snapshots);
  const selectionSnapshot = snapshots[snapshots.length - 1].snapshot;

  if (compositeType === 'datepicker' || selectionSnapshot.valueChange?.isDateLike) {
    return {
      ...selectionClassification,
      classified: {
        ...selectionClassification.classified,
        canonicalType: 'selectDate',
        evidence: {
          ...selectionClassification.classified.evidence,
          ruleId: 'ASSEMBLER',
          ruleDescription: 'Composite date picker selection collapsed by Interaction Assembler',
        },
      },
    };
  }

  // Default upgrade: click → select for dropdowns, menus, autocomplete
  if (canonical === 'click') {
    return {
      ...selectionClassification,
      classified: {
        ...selectionClassification.classified,
        canonicalType: 'select',
        evidence: {
          ...selectionClassification.classified.evidence,
          ruleId: 'ASSEMBLER',
          ruleDescription: 'Composite selection collapsed by Interaction Assembler',
        },
      },
    };
  }

  return selectionClassification;
}

/**
 * Extract the selected value from a collapsed transaction.
 *
 * For a dropdown: the accessible name of the selected option.
 * For a date picker: the date value.
 */
export function extractSelectedValue(
  selectionSnapshot: InteractionSnapshot,
  compositeType: CompositeType,
): string {
  // Date picker: use the value change
  if (
    compositeType === 'datepicker' &&
    selectionSnapshot.valueChange?.after
  ) {
    return selectionSnapshot.valueChange.after;
  }

  // Dropdown/menu: use the element's accessible name
  if (selectionSnapshot.identity.accessibleName) {
    return selectionSnapshot.identity.accessibleName;
  }

  // Fallback to value change
  if (selectionSnapshot.valueChange?.after) {
    return selectionSnapshot.valueChange.after;
  }

  return '';
}

/**
 * Extract the opener's label (what the user clicked to open the surface).
 * This becomes part of the business action description.
 */
export function extractOpenerLabel(snapshot: InteractionSnapshot): string {
  return (
    snapshot.identity.accessibleName ||
    snapshot.identity.ariaLabel ||
    snapshot.identity.tag ||
    'control'
  );
}

// ── InteractionAssembler Class ─────────────────────────────────────────

export class InteractionAssembler {
  /** Current transaction state. */
  private state: TransactionState = 'IDLE';

  /** Buffered snapshots in the current transaction. */
  private buffer: BufferedSnapshot[] = [];

  /** The actionId of the opener event (already emitted). */
  private openerActionId: string | null = null;

  /** The opener's label for building the business action description. */
  private openerLabel: string = '';


  /**
   * Previous surface state — used to detect open → close transitions.
   * Set via onSessionContextUpdate().
   */
  private surfaceWasOpen: boolean = false;

  /**
   * Flag set when onSessionContextUpdate detects surface closed while
   * in PENDING state. The next process() call will commit/cancel using
   * the buffered snapshots (which include the selection).
   */
  private surfaceJustClosed: boolean = false;

  /** Callback for emitting events. */
  private emitCallback: ((event: SessionEvent) => void) | null = null;

  /** Callback for updating a previously emitted event. */
  private updateCallback: ((actionId: string, fields: Partial<SessionEvent>) => void) | null = null;

  /**
   * Events emitted via callback during the last process() call that
   * bypassed the AssemblerResult.eventsToEmit array (e.g., cancel-path).
   * The pipeline reads this via getEmittedViaCallback() after process()
   * to track them in emittedEvents and timeline.
   */
  private _emittedViaCallback: SessionEvent[] = [];

  /**
   * Function that the pipeline provides to convert a ClassifyOutput
   * + snapshot into a SessionEvent (reuses the pipeline's toSessionEvent logic).
   */
  private buildEventFn:
    | ((classification: ClassifyOutput, snapshot: InteractionSnapshot) => SessionEvent | null)
    | null = null;

  /**
   * Set the emit callback (called when the assembler wants to emit an event).
   */
  onEmit(callback: (event: SessionEvent) => void): void {
    this.emitCallback = callback;
  }

  /**
   * Set the update callback (called when the opener event should be updated).
   */
  onUpdate(callback: (actionId: string, fields: Partial<SessionEvent>) => void): void {
    this.updateCallback = callback;
  }

  /**
   * Set the event builder function (pipeline's toSessionEvent).
   */
  setEventBuilder(
    fn: (classification: ClassifyOutput, snapshot: InteractionSnapshot) => SessionEvent | null,
  ): void {
    this.buildEventFn = fn;
  }

  /**
   * Process a classified snapshot through the transaction state machine.
   *
   * Returns the assembler result (for pipeline awareness) and emits/updates
   * events via callbacks.
   */
  process(
    classification: ClassifyOutput,
    snapshot: InteractionSnapshot,
    deterministicState: DeterministicState | null | undefined,
  ): AssemblerResult {
    // Clear the callback-emitted buffer for this process() call
    this._emittedViaCallback = [];

    const surfaceOpen = hasOpenSurface(deterministicState);
    const insideSurface = isInsideSurface(snapshot);

    // Track surface state for cross-snapshot transition detection
    // (used by onSessionContextUpdate when surface closes between snapshots)
    if (surfaceOpen) {
      this.surfaceWasOpen = true;
    }

    // Deferred commit: surface was open but closed via DeterministicState
    // between snapshots. The selection snapshot may have just been coalesced.
    // Add it to the buffer, then commit/cancel.
    if (this.surfaceJustClosed && this.state === 'PENDING') {
      this.buffer.push({ snapshot, classification });
      this.surfaceJustClosed = false;

      this.commitOrCancel();
      const finalState = this.state as string;

      this.reset();

      if (finalState === 'COMMITTED') {
        return {
          eventsToEmit: [],
          openerUpdate: null,
          transactionStarted: false,
          transactionEnded: true,
          state: 'COMMITTED',
        };
      }

      // Cancelled: the closing snapshot was already emitted by
      // cancelTransaction (it's in the buffer). Don't re-emit it via
      // handleIdle. Just return it as a passthrough event so the
      // pipeline tracks it without double-emitting.
      const passthroughEvent = this.buildEventFn
        ? this.buildEventFn(classification, snapshot)
        : null;
      return {
        eventsToEmit: passthroughEvent ? [] : [],
        openerUpdate: null,
        transactionStarted: false,
        transactionEnded: true,
        state: 'CANCELLED',
      };
    }

    switch (this.state) {
      case 'IDLE':
        return this.handleIdle(classification, snapshot, surfaceOpen, insideSurface);

      case 'PENDING':
        return this.handlePending(classification, snapshot, surfaceOpen, insideSurface);

      default:
        // COMMITTED or CANCELLED — reset to IDLE and reprocess
        this.reset();
        return this.handleIdle(classification, snapshot, surfaceOpen, insideSurface);
    }
  }

  /**
   * Called when the pipeline receives a DeterministicState update.
   * Checks for surface transitions and marks the transaction for deferred commit.
   *
   * IMPORTANT: Does NOT commit immediately. The selection snapshot may
   * not have been coalesced yet (500ms coalescing window). Instead, sets
   * surfaceJustClosed=true; the next process() call will commit using
   * the buffer (which will include the selection by then).
   */
  onSessionContextUpdate(state: DeterministicState | null | undefined): void {
    const surfaceOpen = hasOpenSurface(state);

    // Surface was open, now closed: mark for deferred commit.
    // The next process() call will handle the commit using the buffer,
    // which will include the selection snapshot by then.
    if (this.surfaceWasOpen && !surfaceOpen && this.state === 'PENDING') {
      this.surfaceJustClosed = true;
    }

    this.surfaceWasOpen = surfaceOpen;
  }

  /**
   * Flush any pending transaction (called on STOP_RECORDING).
   */
  flush(): void {
    if (this.state === 'PENDING' && this.buffer.length > 0) {
      this.commitOrCancel();
    }
    this.reset();
  }

  /**
   * Reset to IDLE state.
   */
  reset(): void {
    this.state = 'IDLE';
    this.buffer = [];
    this.openerActionId = null;
    this.openerLabel = '';
    this.surfaceWasOpen = false;
    this.surfaceJustClosed = false;
  }

  /**
   * Get the current state (for testing/debugging).
   */
  getState(): TransactionState {
    return this.state;
  }

  /**
   * Get events emitted via callback during the last process() call
   * that bypassed the AssemblerResult.eventsToEmit array.
   */
  getEmittedViaCallback(): SessionEvent[] {
    return this._emittedViaCallback;
  }

  // ── State handlers ───────────────────────────────────────────────────

  /**
   * IDLE: no transaction in progress.
   *
   * If the snapshot triggers a surface open (or is inside one), start a
   * transaction — emit the opener event and enter PENDING.
   * Otherwise, emit the event directly (passthrough).
   */
  private handleIdle(
    classification: ClassifyOutput,
    snapshot: InteractionSnapshot,
    surfaceOpen: boolean,
    insideSurface: boolean,
  ): AssemblerResult {
    // Check if this snapshot opens or is inside a surface
    const surfaceTriggered = triggeredSurfaceOpen(snapshot);

    if (surfaceOpen || surfaceTriggered || insideSurface) {
      // Start a transaction
      // Emit the opener event immediately (it may be updated on commit)
      const openerEvent = this.buildAndEmit(classification, snapshot);
      this.state = 'PENDING';
      this.openerActionId = openerEvent?.actionId ?? null;
      this.openerLabel = extractOpenerLabel(snapshot);
      this.buffer = [{ snapshot, classification }];

      return {
        eventsToEmit: openerEvent ? [openerEvent] : [],
        openerUpdate: null,
        transactionStarted: true,
        transactionEnded: false,
        state: 'PENDING',
      };
    }

    // Passthrough: no surface involved, emit immediately
    const event = this.buildAndEmit(classification, snapshot);
    return {
      eventsToEmit: event ? [event] : [],
      openerUpdate: null,
      transactionStarted: false,
      transactionEnded: false,
      state: 'IDLE',
    };
  }

  /**
   * PENDING: a surface is open, snapshots are being buffered.
   *
   * If the surface is now closed (detected via DeterministicState transition
   * or via ancestor context), attempt to commit.
   * Otherwise, buffer the snapshot.
   */
  private handlePending(
    classification: ClassifyOutput,
    snapshot: InteractionSnapshot,
    surfaceOpen: boolean,
    insideSurface: boolean,
  ): AssemblerResult {
    // Surface closed: this snapshot may be the selection event.
    // Add it to the buffer first so commitOrCancel can find the selection.
    if (!surfaceOpen && !insideSurface) {
      // Add the current snapshot to the buffer before committing.
      // This snapshot may be the actual selection click.
      this.buffer.push({ snapshot, classification });

      // Commit or cancel the transaction using the full buffer
      this.commitOrCancel();

      // Capture the state before reset for the result
      const finalState = this.state as string;

      // Reset for next transaction
      this.reset();

      // If committed, the opener was updated in-place and the selection
      // was absorbed. Don't emit the current snapshot separately.
      if (finalState === 'COMMITTED') {
        return {
          eventsToEmit: [],
          openerUpdate: null,
          transactionStarted: false,
          transactionEnded: true,
          state: 'COMMITTED',
        };
      }

      // Cancelled: the closing snapshot was already emitted by
      // cancelTransaction (it's in the buffer). Don't re-emit via handleIdle.
      return {
        eventsToEmit: [],
        openerUpdate: null,
        transactionStarted: false,
        transactionEnded: true,
        state: 'CANCELLED',
      };
    }

    // Surface still open: buffer this snapshot
    this.buffer.push({ snapshot, classification });

    return {
      eventsToEmit: [],
      openerUpdate: null,
      transactionStarted: false,
      transactionEnded: false,
      state: 'PENDING',
    };
  }

  /**
   * Attempt to commit the transaction by collapsing buffered snapshots
   * into the opener event, or cancel (emit individually) if no selection.
   * Does NOT call reset() — the caller (process/flush) resets state after.
   */
  private commitOrCancel(): void {
    if (this.buffer.length === 0) {
      return;
    }

    // The last buffered snapshot is the selection candidate.
    const lastBuffered = this.buffer[this.buffer.length - 1];
    const hasSelection = this.isSelectionLike(
      lastBuffered.classification,
      lastBuffered.snapshot,
    );

    if (hasSelection && this.openerActionId) {
      // COMMIT: collapse into the opener event
      this.commitTransaction();
    } else {
      // CANCEL: emit buffered events individually (except the opener, already emitted)
      this.cancelTransaction();
    }
  }

  /**
   * Broader selection detection than isDefinitiveSelection.
   *
   * In real-world composite interactions, the selection click often:
   *   - Is a plain click on a div/li/span (no ARIA role)
   *   - Gets classified as generic 'click' by the fallback rule
   *   - Has no valueChange (the value is set on a hidden input elsewhere)
   *
   * This method accepts any click-type interaction as a valid selection
   * candidate when it occurs as the last event in a surface transaction.
   * The only exclusions are clearly non-selecting interactions:
   *   - Navigation events (page transition)
   *   - Escape key presses
   */
  private isSelectionLike(
    classification: ClassifyOutput,
    snapshot: InteractionSnapshot,
  ): boolean {
    // First check with the strict isDefinitiveSelection
    if (isDefinitiveSelection(classification, snapshot)) return true;

    // Broader: any click-type interaction inside a transaction is a
    // selection candidate. This is safe because we only get here when
    // a surface was confirmed open and then closed.
    const canonical = classification.classified.canonicalType;
    if (canonical === 'click' || canonical === 'select' || canonical === 'selectDate') {
      // Exclude navigation
      if (snapshot.primaryEvent.type === 'navigation') return false;
      // Exclude Escape key
      if (snapshot.keyEvents?.includes('Escape')) return false;
      return true;
    }

    return false;
  }

  /**
   * Collapse the buffered snapshots into the opener event.
   * Fires the update callback to change the opener's type, value, and metadata.
   */
  private commitTransaction(): void {
    if (!this.openerActionId || !this.buildEventFn || !this.updateCallback) {
      // Can't update — fallback to cancel
      this.cancelTransaction();
      return;
    }

    // Find the best selection candidate: prefer snapshots with ARIA option
    // roles, value changes, or different identity from the opener.
    // The last snapshot may be the "surface closed" trigger, not the actual
    // selection — so we search backwards for the most selection-like snapshot.
    const selection = this.findBestSelectionCandidate();
    const compositeType = classifyCompositeType(this.buffer);
    const collapsedClassification = resolveCollapsedType(
      selection.classification,
      this.buffer,
    );
    const selectedValue = extractSelectedValue(selection.snapshot, compositeType);

    // Build the merged event from the selection snapshot + collapsed classification
    const mergedEvent = this.buildEventFn(collapsedClassification, selection.snapshot);

    if (!mergedEvent) {
      this.cancelTransaction();
      return;
    }

    // Update the opener event in-place
    const updates: Partial<SessionEvent> = {};
    const mergedAsRecord = mergedEvent as unknown as Record<string, unknown>;
    const updatesAsRecord = updates as unknown as Record<string, unknown>;

    // Set the canonical type from the merged event
    updates.type = mergedEvent.type;

    // Copy element identity if present
    if (mergedAsRecord.elementIdentity) {
      updatesAsRecord.elementIdentity = mergedAsRecord.elementIdentity;
    }

    // Copy type-specific fields from the merged event
    if ('value' in mergedEvent) {
      updatesAsRecord.value = mergedAsRecord.value;
    }
    if ('isoValue' in mergedEvent) {
      updatesAsRecord.isoValue = mergedAsRecord.isoValue;
      updatesAsRecord.displayValue = mergedAsRecord.displayValue;
      updatesAsRecord.dateType = mergedAsRecord.dateType;
    }
    if ('checked' in mergedEvent) {
      updatesAsRecord.checked = mergedAsRecord.checked;
    }

    // Attach composite metadata
    updatesAsRecord.compositeAction = true;
    updatesAsRecord.compositeType = compositeType;
    updatesAsRecord.compositeSelectedValue = selectedValue;
    updatesAsRecord.compositeOpenerLabel = this.openerLabel;
    updatesAsRecord.compositeSubSteps = this.buffer.length;

    // Copy classification evidence from the merged event
    if ('classificationEvidence' in mergedEvent) {
      updatesAsRecord.classificationEvidence = mergedAsRecord.classificationEvidence;
    }

    this.updateCallback(this.openerActionId, updates);
    this.state = 'COMMITTED';
  }

  /**
   * Find the best selection candidate from the buffer.
   *
   * When the surface closes, the last buffered snapshot may be:
   *   - The actual selection (option click inside the surface)
   *   - A "surface closed" trigger (outside-surface click that caused the close)
   *   - A standalone interaction after the surface closed
   *
   * We search backwards (skipping the opener at index 0) for the most
   * selection-like snapshot using these priority signals:
   *   1. ARIA role option/menuitem/treeitem
   *   2. Has a valueChange
   *   3. Different identity from the opener
   *   4. Fallback: last buffered (non-opener) snapshot
   */
  private findBestSelectionCandidate(): BufferedSnapshot {
    const opener = this.buffer[0];

    // Search backwards for the best candidate
    for (let i = this.buffer.length - 1; i >= 1; i--) {
      const item = this.buffer[i];
      const role = item.snapshot.identity.ariaRole;
      if (role === 'option' || role === 'menuitem' || role === 'treeitem' || role === 'tab') {
        return item;
      }
    }

    // No ARIA role match: look for valueChange
    for (let i = this.buffer.length - 1; i >= 1; i--) {
      const item = this.buffer[i];
      if (item.snapshot.valueChange?.after) {
        return item;
      }
    }

    // Look for a snapshot with a different identity than the opener
    for (let i = this.buffer.length - 1; i >= 1; i--) {
      const item = this.buffer[i];
      if (item.snapshot.identity.elementId !== opener.snapshot.identity.elementId) {
        return item;
      }
    }

    // Fallback: last buffered snapshot
    return this.buffer[this.buffer.length - 1];
  }

  /**
   * Cancel the transaction — emit buffered events individually.
   * The opener (index 0) was already emitted, so we skip it.
   */
  private cancelTransaction(): void {
    if (!this.emitCallback) {
      this.reset();
      return;
    }

    // Emit all buffered snapshots except the opener (index 0, already emitted)
    for (let i = 1; i < this.buffer.length; i++) {
      const { classification, snapshot } = this.buffer[i];
      const event = this.buildEventFn
        ? this.buildEventFn(classification, snapshot)
        : null;
      if (event) {
        this._emittedViaCallback.push(event);
        this.emitCallback(event);
      }
    }

    this.state = 'CANCELLED';
  }

  /**
   * Build an event using the pipeline's builder and emit it.
   */
  private buildAndEmit(
    classification: ClassifyOutput,
    snapshot: InteractionSnapshot,
  ): SessionEvent | null {
    if (!this.buildEventFn || !this.emitCallback) {
      return null;
    }

    const event = this.buildEventFn(classification, snapshot);
    if (event) {
      this.emitCallback(event);
    }
    return event;
  }
}
