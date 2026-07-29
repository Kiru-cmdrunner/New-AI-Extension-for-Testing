/**
 * Semantic Reasoner — Stage 5
 *
 * Stream-based semantic reasoning engine that transforms a sequence of
 * DetectedInteractions into semantically correct interactions.
 *
 * The reasoner maintains component sessions (dropdowns, date pickers,
 * autocomplete, navigation) and collapses multi-interaction sequences
 * into single semantic interactions.
 *
 * Architecture:
 *
 *   DetectedInteraction[] → SemanticReasoner → DetectedInteraction[]
 *
 *   For each interaction:
 *     1. If any session is active: check completion → check absorption → check cancellation
 *     2. If no session active: check activation
 *     3. If nothing matched: pass through
 *
 *   On end-of-stream: flush all remaining sessions (commit if has value, cancel otherwise)
 *
 * The output is still DetectedInteraction[] — the reasoner REFINES the
 * interaction stream rather than producing a new type. This means:
 *   - The IR bridge continues to work without changes
 *   - The side panel UI continues to work without changes
 *   - The interactions are just semantically more accurate
 */

import type { DetectedInteraction, InteractionType, InteractionMetadata } from '../interaction-types';
import type { SessionEvent } from '../../shared/types';
import type { ComponentSession, ComponentType, SemanticReasoningResult } from './types';
import {
  isDropdownActivation,
  isDatePickerActivation,
  isAutocompleteActivation,
  isDropdownCompletion,
  isDatePickerCompletion,
  isAutocompleteCompletion,
  shouldAbsorb,
  isSessionCancellation,
  extractCompletionValue,
} from './detectors';
import {
  isMultiConfigActivation,
  isMultiConfigCompletion,
  shouldAbsorbMultiConfig,
  extractConfigField,
  isFormSubmitActivation,
  isFormSubmitCompletion,
  buildFormContext,
} from './panel-form-detectors';

// ── Constants ────────────────────────────────────────────────────────────

/** Max time (ms) a component session stays open without activity. */
const DEFAULT_SESSION_TIMEOUT_MS = 15_000;

/** Time window (ms) for a click to be retroactively merged with a navigation event. */
const NAVIGATION_LOOKBACK_MS = 3_000;

// ── Event Lookup Helpers ─────────────────────────────────────────────────

/**
 * Build a lookup map from event actionId → SessionEvent.
 */
function buildEventLookup(events: SessionEvent[]): Map<string, SessionEvent> {
  const map = new Map<string, SessionEvent>();
  for (const e of events) {
    map.set(e.actionId, e);
  }
  return map;
}

/**
 * Extract a numeric timestamp from a DetectedInteraction.
 *
 * Falls back to 0 if no event IDs are available.
 */
function getInteractionTimestamp(
  interaction: DetectedInteraction,
  eventLookup: Map<string, SessionEvent>,
): number {
  const firstEventId = interaction.eventIds?.[0];
  if (firstEventId) {
    const event = eventLookup.get(firstEventId);
    if (event) {
      return new Date(event.timestamp).getTime();
    }
  }
  // Fall back to metadata or 0
  return 0;
}

// ── Session ID Generator ─────────────────────────────────────────────────

let sessionCounter = 0;

function nextSessionId(): string {
  sessionCounter++;
  return `comp-session-${String(sessionCounter).padStart(4, '0')}`;
}

/** Reset the counter (for testing). */
export function resetSessionCounter(): void {
  sessionCounter = 0;
}

// ── Interaction Constructors ─────────────────────────────────────────────

/**
 * Build a refined DetectedInteraction for a completed dropdown/autocomplete session.
 */
function buildSelectInteraction(
  session: ComponentSession,
  completion: DetectedInteraction,
): DetectedInteraction {
  const { value, metadata } = extractCompletionValue(completion, session.componentType);

  const refinedType: InteractionType =
    session.componentType === 'autocomplete' ? 'Autocomplete' : 'NativeDropdown';

  // Use the trigger's target for locator purposes, but enrich with the
  // selected value metadata
  const target = session.triggerInteraction.target ?? completion.target;

  const mergedMetadata: InteractionMetadata = {
    ...session.triggerInteraction.metadata,
    ...metadata,
    accessibleName: target?.accessibleName ?? session.triggerInteraction.metadata.accessibleName,
    selectedValue: value ?? undefined,
  };

  return {
    interactionId: session.triggerInteraction.interactionId,
    type: refinedType,
    eventIds: [...session.triggerInteraction.eventIds, ...completion.eventIds],
    rawEventTypes: [...session.triggerInteraction.rawEventTypes, ...completion.rawEventTypes],
    target,
    metadata: mergedMetadata,
    confidence: Math.max(session.triggerInteraction.confidence, completion.confidence),
    engine: 'semantic-reasoner',
  };
}

/**
 * Build a refined DetectedInteraction for a completed date picker session.
 */
function buildDatePickerInteraction(
  session: ComponentSession,
  completion: DetectedInteraction,
): DetectedInteraction {
  const { value, metadata } = extractCompletionValue(completion, session.componentType);

  // Use the trigger's target for locator purposes
  const target = session.triggerInteraction.target ?? completion.target;

  const mergedMetadata: InteractionMetadata = {
    ...session.triggerInteraction.metadata,
    ...metadata,
    accessibleName: target?.accessibleName ?? session.triggerInteraction.metadata.accessibleName,
    dateValue: value ?? undefined,
    displayValue: (metadata.displayValue as string) ?? value ?? undefined,
  };

  return {
    interactionId: session.triggerInteraction.interactionId,
    type: 'DatePicker',
    eventIds: [...session.triggerInteraction.eventIds, ...completion.eventIds],
    rawEventTypes: [...session.triggerInteraction.rawEventTypes, ...completion.rawEventTypes],
    target,
    metadata: mergedMetadata,
    confidence: Math.max(session.triggerInteraction.confidence, completion.confidence),
    engine: 'semantic-reasoner',
  };
}

/**
 * Build a refined DetectedInteraction for a completed MultiConfig session.
 *
 * Collapses all field adjustments inside a panel into one interaction
 * with a configuredFields dictionary and semanticAction='configure'.
 */
function buildMultiConfigInteraction(
  session: ComponentSession,
  completion: DetectedInteraction,
): DetectedInteraction {
  const target = session.triggerInteraction.target ?? completion.target;
  const panelLabel = session.panelLabel ??
    target?.accessibleName ??
    session.triggerInteraction.metadata.accessibleName ??
    'Options';

  const mergedMetadata: InteractionMetadata = {
    ...session.triggerInteraction.metadata,
    semanticAction: 'configure',
    configuredFields: session.configuredFields,
    panelLabel,
    accessibleName: panelLabel,
  };

  return {
    interactionId: session.triggerInteraction.interactionId,
    type: 'Click',
    eventIds: [
      ...session.triggerInteraction.eventIds,
      ...session.absorbed.flatMap(a => a.eventIds),
      ...completion.eventIds,
    ],
    rawEventTypes: [
      ...session.triggerInteraction.rawEventTypes,
      ...session.absorbed.flatMap(a => a.rawEventTypes),
      ...completion.rawEventTypes,
    ],
    target,
    metadata: mergedMetadata,
    confidence: Math.max(session.triggerInteraction.confidence, completion.confidence),
    engine: 'semantic-reasoner',
  };
}

/**
 * Build a refined DetectedInteraction for a completed FormSubmit session.
 *
 * The FormSubmit doesn't collapse form fields — it enriches the submit
 * click with the form submission context and marks it as an authenticate
 * action if it involves login.
 */
function buildFormSubmitInteraction(
  session: ComponentSession,
  completion: DetectedInteraction,
): DetectedInteraction {
  const submitAction = completion.target?.accessibleName ??
    completion.metadata.accessibleName ?? 'Submit';

  const mergedMetadata: InteractionMetadata = {
    ...completion.metadata,
    semanticAction: 'authenticate',
    formSubmitAction: submitAction,
    formFields: session.formFieldIds,
  };

  return {
    interactionId: completion.interactionId,
    type: completion.type,
    eventIds: [...completion.eventIds],
    rawEventTypes: [...completion.rawEventTypes],
    target: completion.target,
    metadata: mergedMetadata,
    confidence: completion.confidence,
    engine: 'semantic-reasoner',
  };
}

/**
 * Build a refined DetectedInteraction for a completed navigation session.
 *
 * Merges the trigger click with the navigation result into a single
 * PageNavigation interaction that carries both the click context and
 * the destination URL.
 */
// ── Semantic Reasoner ────────────────────────────────────────────────────

/**
 * Stream-based semantic reasoning engine.
 *
 * Processes DetectedInteractions in order, maintaining component sessions
 * for composite UI controls. Each session absorbs internal events and
 * emits a single semantic interaction on completion.
 *
 * Navigation uses a retroactive merge: when a PageNavigation arrives,
 * the reasoner checks if the last emitted interaction was a click on a
 * navigable element within NAVIGATION_LOOKBACK_MS. If so, they are merged
 * into a single PageNavigation interaction.
 */
export class SemanticReasoner {
  private activeSessions: ComponentSession[] = [];
  private output: DetectedInteraction[] = [];
  private eventLookup: Map<string, SessionEvent>;
  private interactions: DetectedInteraction[];
  private stats = {
    sessionsActivated: 0,
    sessionsCompleted: 0,
    sessionsCancelled: 0,
    interactionsAbsorbed: 0,
    interactionsPassedThrough: 0,
  };

  constructor(interactions: DetectedInteraction[], events: SessionEvent[]) {
    this.interactions = interactions;
    this.eventLookup = buildEventLookup(events);
  }

  /**
   * Process the full interaction stream and return refined interactions.
   */
  process(): SemanticReasoningResult {
    for (const interaction of this.interactions) {
      this.processInteraction(interaction);
    }
    this.flushRemaining();
    return this.buildResult();
  }

  // ── Core Processing ────────────────────────────────────────────────────

  private processInteraction(interaction: DetectedInteraction): void {
    const timestamp = getInteractionTimestamp(interaction, this.eventLookup);

    // 0. Navigation lookback merge: if this is a PageNavigation, try to
    //    merge with the last emitted click (submit button, link, etc.)
    if (interaction.type === 'PageNavigation') {
      const merged = this.tryNavigationMerge(interaction, timestamp);
      if (merged) return;
    }

    // 1. Clean up stale sessions
    this.cleanupStale(timestamp);

    // 2. Check if this interaction cancels any active sessions
    if (this.checkCancellation(interaction, timestamp)) {
      return;
    }

    // 3. Check if any active session can be completed by this interaction
    const completed = this.checkCompletion(interaction);
    if (completed !== null) {
      this.output.push(completed);
      return;
    }

    // 4. Check if any active session absorbs this interaction
    if (this.checkAbsorption(interaction, timestamp)) {
      return;
    }

    // 4b. MultiConfig outside-click cancellation: if a MultiConfig session is
    //     active and this Click was not absorbed (not inside the panel) and
    //     not a completion, the user clicked outside the panel — cancel it.
    if (interaction.type === 'Click' && this.cancelMultiConfigOnOutsideClick()) {
      // The outside click itself passes through
      this.output.push(interaction);
      this.stats.interactionsPassedThrough++;
      return;
    }

    // 5. Check if this interaction activates a new session
    const newSession = this.checkActivation(interaction, timestamp);
    if (newSession) {
      return; // Session started — interaction is held as trigger
    }

    // 6. Nothing matched → pass through
    this.output.push(interaction);
    this.stats.interactionsPassedThrough++;
  }

  // ── Navigation Lookback Merge ──────────────────────────────────────────

  /**
   * Try to merge a PageNavigation with the last emitted interaction.
   *
   * If the last emitted interaction is a click on a navigable element
   * (submit button, link) within NAVIGATION_LOOKBACK_MS, they are merged
   * into a single PageNavigation interaction.
   *
   * Returns true if merged (the merged interaction replaces the last
   * emitted one), false otherwise (navigation passes through).
   */
  private tryNavigationMerge(
    navInteraction: DetectedInteraction,
    navTimestamp: number,
  ): boolean {
    if (this.output.length === 0) return false;

    const lastIdx = this.output.length - 1;
    const last = this.output[lastIdx]!;

    // Check if the last interaction is a click-like interaction
    // (Click, Link, Tab, Menu, Breadcrumb — any navigation-capable click)
    const CLICK_LIKE = new Set(['Click', 'Link', 'Tab', 'Menu', 'Breadcrumb']);
    if (!CLICK_LIKE.has(last.type)) return false;

    // Don't merge if the click already has a different type (e.g., Checkbox)
    // Only merge plain clicks and links
    if (!CLICK_LIKE.has(last.type)) return false;

    // Check time window
    const lastTs = getInteractionTimestamp(last, this.eventLookup);
    if (navTimestamp - lastTs > NAVIGATION_LOOKBACK_MS) return false;

    // Merge: replace the last output with a merged PageNavigation
    const target = last.target ?? navInteraction.target;

    // Preserve semantic context from the click (FormSubmit enrichment, etc.)
    const mergedMetadata: InteractionMetadata = {
      ...last.metadata,       // carry semanticAction, formSubmitAction, etc.
      ...navInteraction.metadata, // url, title from the navigation
      accessibleName: target?.accessibleName ?? last.metadata.accessibleName,
    };

    this.output[lastIdx] = {
      interactionId: last.interactionId,
      type: 'PageNavigation',
      eventIds: [...last.eventIds, ...navInteraction.eventIds],
      rawEventTypes: [...last.rawEventTypes, ...navInteraction.rawEventTypes],
      target,
      metadata: mergedMetadata,
      confidence: Math.max(last.confidence, navInteraction.confidence),
      engine: 'semantic-reasoner',
    };

    return true;
  }

  // ── Activation ─────────────────────────────────────────────────────────

  private checkActivation(
    interaction: DetectedInteraction,
    timestamp: number,
  ): boolean {
    // Don't activate if there's already a session of the same type
    // (prevents nested sessions of the same component)

    let componentType: ComponentType | null = null;

    // Activation priority: autocomplete > datePicker > dropdown > multiConfig > formSubmit
    // Navigation is handled by lookback merge, not session activation.
    if (isAutocompleteActivation(interaction) && !this.hasActiveSession('autocomplete')) {
      componentType = 'autocomplete';
    } else if (isDatePickerActivation(interaction) && !this.hasActiveSession('datePicker')) {
      componentType = 'datePicker';
    } else if (isDropdownActivation(interaction) && !this.hasActiveSession('dropdown')) {
      componentType = 'dropdown';
    } else if (isMultiConfigActivation(interaction) && !this.hasActiveSession('multiConfig')) {
      componentType = 'multiConfig';
    } else if (isFormSubmitActivation(interaction) && !this.hasActiveSession('formSubmit')) {
      componentType = 'formSubmit';
    }

    if (!componentType) return false;

    // For dropdown/datePicker/autocomplete, the activation interaction is the trigger.
    // For multiConfig, the activation click is the trigger (opens the panel).
    // For formSubmit, the password TextEntry activates the tracking context.
    const panelLabel = componentType === 'multiConfig'
      ? (interaction.target?.accessibleName ?? interaction.metadata.accessibleName ?? null)
      : null;

    const session: ComponentSession = {
      id: nextSessionId(),
      componentType,
      phase: 'pending',
      triggerInteraction: interaction,
      absorbed: [],
      completionInteraction: null,
      startedAt: timestamp,
      lastEventAt: timestamp,
      maxDurationMs: DEFAULT_SESSION_TIMEOUT_MS,
      resultValue: null,
      resultMetadata: {},
      configuredFields: {},
      panelLabel,
      formFieldIds: [],
    };

    this.activeSessions.push(session);
    this.stats.sessionsActivated++;
    return true;
  }

  // ── Completion ─────────────────────────────────────────────────────────

  private checkCompletion(
    interaction: DetectedInteraction,
  ): DetectedInteraction | null {
    if (this.activeSessions.length === 0) return null;

    for (let i = this.activeSessions.length - 1; i >= 0; i--) {
      const session = this.activeSessions[i]!;
      let isCompletion = false;

      switch (session.componentType) {
        case 'dropdown':
          isCompletion = isDropdownCompletion(interaction, session);
          break;
        case 'datePicker':
          isCompletion = isDatePickerCompletion(interaction, session);
          break;
        case 'autocomplete':
          isCompletion = isAutocompleteCompletion(interaction, session);
          break;
        case 'multiConfig':
          isCompletion = isMultiConfigCompletion(interaction, session);
          break;
        case 'formSubmit':
          isCompletion = isFormSubmitCompletion(interaction, session);
          break;
      }

      if (isCompletion) {
        // Complete the session
        session.phase = 'completed';
        session.completionInteraction = interaction;
        this.activeSessions.splice(i, 1);
        this.stats.sessionsCompleted++;

        const result = this.buildSemanticInteraction(session, interaction);
        return result;
      }
    }

    return null;
  }

  // ── Absorption ─────────────────────────────────────────────────────────

  private checkAbsorption(
    interaction: DetectedInteraction,
    timestamp: number,
  ): boolean {
    let absorbed = false;

    for (const session of this.activeSessions) {
      // MultiConfig: absorb interactions inside the panel and accumulate fields
      if (session.componentType === 'multiConfig' && shouldAbsorbMultiConfig(interaction, session)) {
        const field = extractConfigField(interaction);
        if (field) {
          session.configuredFields[field.field] = field.value;
        }
        session.absorbed.push(interaction);
        session.lastEventAt = timestamp;
        absorbed = true;
        this.stats.interactionsAbsorbed++;
        break;
      }

      // FormSubmit: don't absorb, but enrich TextEntry with form context
      if (session.componentType === 'formSubmit' && interaction.type === 'TextEntry') {
        session.formFieldIds.push(interaction.interactionId);
        session.lastEventAt = timestamp;
        // Enrich the interaction with form context and pass through (don't absorb)
        const ctx = buildFormContext(
          session.triggerInteraction.target?.accessibleName ?? 'Submit',
        );
        Object.assign(interaction.metadata, ctx);
        break;
      }

      // Existing types (dropdown, datePicker, autocomplete)
      if (shouldAbsorb(interaction, session)) {
        session.absorbed.push(interaction);
        session.lastEventAt = timestamp;
        absorbed = true;
        this.stats.interactionsAbsorbed++;
        break;
      }
    }

    return absorbed;
  }

  // ── Cancellation ───────────────────────────────────────────────────────

  private checkCancellation(
    interaction: DetectedInteraction,
    _timestamp: number,
  ): boolean {
    if (!isSessionCancellation(interaction)) return false;

    // Cancel ALL active sessions, then pass through the cancellation event
    for (let i = this.activeSessions.length - 1; i >= 0; i--) {
      const session = this.activeSessions[i]!;
      // Cancel non-navigation sessions (navigation is handled by lookback)
      session.phase = 'cancelled';
      this.activeSessions.splice(i, 1);
      this.stats.sessionsCancelled++;
      // Pass through the trigger on cancel
      this.output.push(session.triggerInteraction);
      this.stats.interactionsPassedThrough++;
    }

    return false;
  }

  // ── MultiConfig Outside-Click Cancellation ─────────────────────────────

  /**
   * Cancel any active MultiConfig session whose panel was implicitly closed
   * by a click outside the panel boundary.
   *
   * When a Click arrives that is not absorbed by the MultiConfig session
   * (meaning it's outside the panel) and is not a completion button, the
   * panel has been dismissed. If the session accumulated any configured
   * fields, commit them; otherwise cancel and pass through the trigger.
   *
   * Returns true if a session was cancelled (the click should pass through).
   */
  private cancelMultiConfigOnOutsideClick(): boolean {
    let cancelled = false;
    for (let i = this.activeSessions.length - 1; i >= 0; i--) {
      const session = this.activeSessions[i]!;
      if (session.componentType !== 'multiConfig') continue;

      this.activeSessions.splice(i, 1);
      cancelled = true;

      if (Object.keys(session.configuredFields).length > 0) {
        // Had configured fields — commit what we have
        session.phase = 'completed';
        this.stats.sessionsCompleted++;
        this.output.push(
          this.buildSemanticInteraction(session, session.completionInteraction ?? session.triggerInteraction),
        );
      } else {
        // No fields — cancel and pass through trigger
        session.phase = 'cancelled';
        this.stats.sessionsCancelled++;
        this.output.push(session.triggerInteraction);
        this.stats.interactionsPassedThrough++;
      }
    }
    return cancelled;
  }

  // ── Stale Cleanup ──────────────────────────────────────────────────────

  private cleanupStale(nowMs: number): void {
    for (let i = this.activeSessions.length - 1; i >= 0; i--) {
      const session = this.activeSessions[i]!;
      const age = nowMs - session.lastEventAt;
      if (age > session.maxDurationMs) {
        // Expired — commit if it has any absorbed data, otherwise cancel
        this.expireSession(session, i);
      }
    }
  }

  private expireSession(session: ComponentSession, index: number): void {
    this.activeSessions.splice(index, 1);

    if (session.componentType === 'multiConfig' && Object.keys(session.configuredFields).length > 0) {
      // MultiConfig with fields — commit even without explicit Done click
      session.phase = 'completed';
      this.stats.sessionsCompleted++;
      this.output.push(this.buildSemanticInteraction(session, session.completionInteraction ?? session.triggerInteraction));
      return;
    }

    if (session.absorbed.length > 0) {
      // Had activity — commit with whatever we know
      session.phase = 'completed';
      this.stats.sessionsCompleted++;

      // For autocomplete sessions with absorbed TextEntry but no suggestion click,
      // emit a TextEntry with the typed value rather than a bare Autocomplete select.
      if (session.componentType === 'autocomplete') {
        const typedText = this.extractTypedValueFromAbsorbed(session);
        if (typedText) {
          this.output.push(this.buildTextEntryFallback(session, typedText));
          return;
        }
      }

      this.output.push(this.buildSemanticInteraction(session, session.completionInteraction ?? session.triggerInteraction));
    } else {
      // No activity — cancel and pass through trigger
      session.phase = 'cancelled';
      this.stats.sessionsCancelled++;
      this.output.push(session.triggerInteraction);
      this.stats.interactionsPassedThrough++;
    }
  }

  /**
   * Extract the most recent typed text value from a session's absorbed events.
   */
  private extractTypedValueFromAbsorbed(session: ComponentSession): string | null {
    for (let i = session.absorbed.length - 1; i >= 0; i--) {
      const a = session.absorbed[i]!;
      if (a.type === 'TextEntry' && a.metadata.textValue) {
        return a.metadata.textValue;
      }
    }
    return null;
  }

  /**
   * Build a TextEntry interaction from a session trigger + typed value.
   * Used when an autocomplete session expires with typed text but no selection.
   */
  private buildTextEntryFallback(
    session: ComponentSession,
    typedValue: string,
  ): DetectedInteraction {
    const trigger = session.triggerInteraction;
    const target = trigger.target;
    const allEventIds = [
      ...trigger.eventIds,
      ...session.absorbed.flatMap(a => a.eventIds),
    ];
    return {
      interactionId: trigger.interactionId,
      type: 'TextEntry',
      eventIds: allEventIds,
      rawEventTypes: [...trigger.rawEventTypes, ...session.absorbed.flatMap(a => a.rawEventTypes)],
      target,
      metadata: {
        ...trigger.metadata,
        textValue: typedValue,
        accessibleName: target?.accessibleName ?? trigger.metadata.accessibleName,
      },
      confidence: trigger.confidence,
      engine: 'semantic-reasoner',
    };
  }

  // ── End-of-Stream Flush ────────────────────────────────────────────────

  private flushRemaining(): void {
    for (let i = this.activeSessions.length - 1; i >= 0; i--) {
      const session = this.activeSessions[i]!;
      this.expireSession(session, i);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private hasActiveSession(type: ComponentType): boolean {
    return this.activeSessions.some(s => s.componentType === type);
  }

  private buildSemanticInteraction(
    session: ComponentSession,
    completion: DetectedInteraction,
  ): DetectedInteraction {
    switch (session.componentType) {
      case 'dropdown':
      case 'autocomplete':
        return buildSelectInteraction(session, completion);
      case 'datePicker':
        return buildDatePickerInteraction(session, completion);
      case 'multiConfig':
        return buildMultiConfigInteraction(session, completion);
      case 'formSubmit':
        return buildFormSubmitInteraction(session, completion);
      default:
        return completion;
    }
  }

  private buildResult(): SemanticReasoningResult {
    return {
      interactions: this.output,
      sessionsActivated: this.stats.sessionsActivated,
      sessionsCompleted: this.stats.sessionsCompleted,
      sessionsCancelled: this.stats.sessionsCancelled,
      interactionsAbsorbed: this.stats.interactionsAbsorbed,
      interactionsPassedThrough: this.stats.interactionsPassedThrough,
    };
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Run semantic reasoning over a stream of interactions.
 *
 * This is the main entry point called from the service worker between
 * the merge layer and the IR bridge.
 *
 * @param interactions - Merged DetectedInteractions from V1/V2/Control engine
 * @param events - Raw session events for timestamp lookup and context
 * @returns Refined interactions + reasoning stats
 */
export function reasonAboutInteractions(
  interactions: DetectedInteraction[],
  events: SessionEvent[],
): SemanticReasoningResult {
  // Guard against null/undefined (defensive)
  if (!interactions || interactions.length === 0) {
    return {
      interactions: [],
      sessionsActivated: 0,
      sessionsCompleted: 0,
      sessionsCancelled: 0,
      interactionsAbsorbed: 0,
      interactionsPassedThrough: 0,
    };
  }

  const reasoner = new SemanticReasoner(interactions, events ?? []);
  return reasoner.process();
}
