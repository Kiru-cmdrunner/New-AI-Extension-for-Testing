/**
 * Architecture C Pipeline
 *
 * Phase 5 — Pipeline Integration
 * Blueprint: .drytis/architecture-c-production.md §4–§6
 *
 * Orchestrates the Architecture C recording pipeline:
 *
 *   RawEvidence → SnapshotCoalescer → classifySnapshot → SessionEvent
 *
 * This class lives in the service worker. It receives raw evidence from
 * the Universal Interaction Observer (content script), groups it via the
 * coalescer, classifies each snapshot, and converts the result into a
 * SessionEvent compatible with the existing Timeline + generation pipeline.
 *
 * Feature flag: active only when ARCHITECTURE_C_ENABLED is true.
 */

import type { RawEvidence, InteractionSnapshot } from '../../shared/evidence-types';
import type { CanonicalType, ClassifiedInteraction, SessionContext, ClassificationEvidence } from '../../shared/architecture-types';
import type { SessionEvent, ElementIdentity, AIUnderstanding } from '../../shared/types';
import { SnapshotCoalescer } from '../coalescer/snapshot-coalescer';
import { classifySnapshot } from '../../generation/engine/multi-tier-classifier';
import { DEFAULT_COALESCING_CONFIG } from '../../shared/classifier-constants';
import { AIObserver, toSnapshotForAI } from '../../ai/ai-observer';
import { InteractionAssembler } from './interaction-assembler';

// ── Canonical → SessionEvent type mapping ──────────────────────────────

/**
 * Map a CanonicalType to the existing SessionEvent type string.
 *
 * The existing type system has 8 types (navigation, click, text, hover,
 * checkbox, radio, select, dateSelect). Architecture C's 10 canonical types
 * are mapped to these existing types so the generation pipeline works
 * unchanged. Types without a direct mapping (pressKey, upload, drag) map
 * to click, which is the default action type.
 */
function canonicalToEventType(
  canonical: CanonicalType,
  snapshot: InteractionSnapshot,
): string {
  switch (canonical) {
    case 'navigate':
      return 'navigation';
    case 'click':
    case 'pressKey':
    case 'upload':
    case 'drag':
      return 'click';
    case 'fill':
      return 'text';
    case 'select':
      return 'select';
    case 'selectDate':
      return 'dateSelect';
    case 'toggle':
      // Distinguish checkbox vs radio by ARIA role or input type
      if (snapshot.identity.ariaRole === 'radio') return 'radio';
      return 'checkbox';
    case 'hover':
      return 'hover';
    default:
      return 'click';
  }
}

/**
 * Get the ID prefix for an event type.
 */
function eventTypeToIdPrefix(eventType: string): string {
  switch (eventType) {
    case 'navigation': return 'nav';
    case 'click': return 'click';
    case 'text': return 'text';
    case 'hover': return 'hover';
    case 'checkbox': return 'checkbox';
    case 'radio': return 'radio';
    case 'select': return 'select';
    case 'dateSelect': return 'dateSelect';
    default: return 'action';
  }
}

// ── Pipeline class ─────────────────────────────────────────────────────

/**
 * Architecture C recording pipeline.
 *
 * Usage in service worker:
 *   const pipeline = new ArchitectureCPipeline(sessionEvents, sessionContext);
 *   pipeline.onEvent((event) => addToTimeline(event));
 *   // When RAW_EVIDENCE message arrives:
 *   pipeline.ingestEvidence(evidence);
 */
export class ArchitectureCPipeline {
  private coalescer: SnapshotCoalescer;
  private sessionContext: SessionContext | null = null;
  // The emit callback is wired to the assembler. The pipeline itself doesn't
  // call it directly — the assembler decides when to emit.

  /**
   * Callback invoked when a previously-emitted event is updated by Phase 2
   * AI reclassification or enrichment.
   *
   * In production, the service worker uses this to update the recording
   * session's stored events so the timeline reflects AI refinements.
   */
  private eventUpdateCallback: ((actionId: string, updates: Partial<SessionEvent>) => void) | null = null;

  /** The AI Observer — advisory classifier + Mental Model maintainer. */
  private aiObserver: AIObserver;

  /** The Interaction Assembler — collapses composite interactions into business actions. */
  private assembler: InteractionAssembler;

  /** Track emitted events by actionId for Phase 2 reclassification. */
  private emittedEvents: Map<string, { event: SessionEvent; snapshot: InteractionSnapshot }> = new Map();

  /** The current Timeline (kept in sync for the Workflow Analyzer). */
  private timeline: SessionEvent[] = [];

  // ID counters (mirrors RecordingSession's generators)
  private idCounters: Map<string, number> = new Map();

  constructor() {
    this.coalescer = new SnapshotCoalescer(
      (snapshot) => this.onSnapshot(snapshot),
      DEFAULT_COALESCING_CONFIG,
    );
    this.aiObserver = new AIObserver();

    // Initialize the Interaction Assembler
    // The assembler's emit/update callbacks are wired in onEvent/onEventUpdate.
    this.assembler = new InteractionAssembler();
  }

  /**
   * Set the callback invoked when a new SessionEvent is produced.
   * In production, this appends the event to the recording session.
   */
  onEvent(callback: (event: SessionEvent) => void): void {
    // Wire the assembler's emit callback to the pipeline consumer
    this.assembler.onEmit(callback);
    // Give the assembler the event builder function
    this.assembler.setEventBuilder((classification, snapshot) => {
      return this.toSessionEvent(classification.classified, snapshot);
    });
  }

  /**
   * Set the callback invoked when a previously-emitted event is updated by
   * Phase 2 AI reclassification or enrichment.
   *
   * The callback receives the actionId and the fields that changed.
   * The service worker uses this to update the recording session.
   */
  onEventUpdate(callback: (actionId: string, updates: Partial<SessionEvent>) => void): void {
    this.eventUpdateCallback = callback;
    // Wire the assembler's update callback, but also sync the pipeline's
    // internal tracking (emittedEvents/timeline) so Phase 2 AI and the
    // Workflow Analyzer see the updated event type.
    this.assembler.onUpdate((actionId, fields) => {
      // Sync internal tracking
      const tracked = this.emittedEvents.get(actionId);
      if (tracked) {
        Object.assign(tracked.event, fields);
      }
      // Also update the timeline copy
      const timelineEvent = this.timeline.find((e) => e.actionId === actionId);
      if (timelineEvent) {
        Object.assign(timelineEvent, fields);
      }
      // Forward to the consumer
      callback(actionId, fields);
    });
  }

  /**
   * Set the session context (L1 deterministic state from StateTracker).
   * Also notifies the assembler of potential surface transitions.
   */
  setSessionContext(ctx: SessionContext | null): void {
    this.sessionContext = ctx;
    // Notify the assembler of potential surface open/close transitions
    this.assembler.onSessionContextUpdate(ctx?.layer1 ?? null);
  }

  /**
   * Ingest raw evidence from the Universal Interaction Observer.
   */
  ingestEvidence(evidence: RawEvidence): void {
    this.coalescer.ingest(evidence);
  }

  /**
   * Ingest a navigation event (called by the SW navigation listener).
   */
  ingestNavigation(url: string, timestamp: string): void {
    this.coalescer.ingestNavigation(url, timestamp);
  }

  /**
   * Flush any pending coalescing windows (e.g. on STOP_RECORDING).
   */
  flush(): void {
    this.coalescer.flush();
    // Also flush any pending assembler transactions
    this.assembler.flush();
  }

  // ── Internal ──────────────────────────────────────────────────────────

  /**
   * Called when the coalescer produces a snapshot.
   *
   * Phase 1: deterministic classification (immediate, synchronous).
   *   Before classification, the snapshot's ancestor context is enhanced
   *   using DeterministicState — if openDropdowns/openDialogs are present,
   *   the snapshot's hasListboxAncestor/hasDialogAncestor flags are set.
   *   This enables R9 (ariaOptionInListbox) to correctly classify option
   *   clicks as 'select' instead of 'click' fallback.
   *
   * Interaction Assembler: the classified snapshot is routed through the
   *   assembler. Simple interactions pass through unchanged. Composite
   *   interactions (dropdowns, date pickers, dialogs) are buffered and
   *   collapsed into a single business action when the surface closes.
   *
   * Phase 2: AI refinement (async, only if aiEligible=true and not buffered).
   */
  private onSnapshot(snapshot: InteractionSnapshot): void {
    // ── Ancestor Context Enhancement ──
    // Use DeterministicState to set surface-aware flags that the coalescer
    // can't detect from the element alone.
    if (this.sessionContext?.layer1) {
      const state = this.sessionContext.layer1;
      if (state.openDropdowns.length > 0) {
        snapshot.ancestorContext.hasListboxAncestor = true;
        // Calendar surfaces are now detected by the state tracker via
        // CSS class patterns and included in openDropdowns. Set the
        // calendar flag when the surface class name matches patterns.
        const hasCalendar = state.openDropdowns.some(
          (d) => {
            const cls = (d.className ?? '').toLowerCase();
            return cls.includes('calendar') ||
              cls.includes('datepicker') ||
              cls.includes('date-picker') ||
              cls.includes('date_picker') ||
              cls.includes('pikaday') ||
              cls.includes('flatpickr') ||
              cls.includes('air-datepicker');
          },
        );
        if (hasCalendar) {
          snapshot.ancestorContext.hasCalendarAncestor = true;
        }
      }
      if (state.openDialogs.length > 0) {
        snapshot.ancestorContext.hasDialogAncestor = true;
      }
    }

    // Phase 1: deterministic classification (immediate)
    const result = classifySnapshot({
      snapshot,
      aiResult: null,
      sessionContext: this.sessionContext,
    });

    // Route through the Interaction Assembler.
    // The assembler decides whether to emit immediately (simple interaction),
    // buffer (composite interaction surface open), or collapse (surface closed).
    const deterministicState = this.sessionContext?.layer1 ?? null;
    const assemblerResult = this.assembler.process(
      result,
      snapshot,
      deterministicState,
    );

    // Track emitted events for Phase 2 reclassification.
    // Only track events that were actually emitted (not buffered).
    const allEmitted = [
      ...assemblerResult.eventsToEmit,
      ...this.assembler.getEmittedViaCallback(),
    ];
    for (const event of allEmitted) {
      this.emittedEvents.set(event.actionId, { event, snapshot });
      this.timeline.push(event);
      this.aiObserver.setTimeline(this.timeline);
    }

    // Phase 2: AI refinement — only for events that were emitted
    // (not buffered by the assembler).
    if (result.aiEligible && !assemblerResult.transactionStarted) {
      // Simple interaction that was emitted immediately
      const emitted = assemblerResult.eventsToEmit[0];
      if (emitted) {
        void this.requestAIRefinement(snapshot, emitted.actionId);
      }
    }
  }

  /**
   * Convert a ClassifiedInteraction + snapshot to a Timeline SessionEvent.
   *
   * The event carries classificationEvidence so the timeline renderer can
   * display which rule classified the interaction and which tier was used.
   */
  private toSessionEvent(
    classified: ClassifiedInteraction,
    snapshot: InteractionSnapshot,
  ): SessionEvent | null {
    const eventType = canonicalToEventType(classified.canonicalType, snapshot);
    const idPrefix = eventTypeToIdPrefix(eventType);
    const actionId = this.generateId(idPrefix);
    const elementId = this.generateId('elem');
    const timestamp = snapshot.primaryEvent.timestamp;

    // Build element identity from snapshot
    const elementIdentity: ElementIdentity = {
      ...snapshot.identity,
      elementId,
    };

    // Classification evidence to attach to all Architecture C events
    const evidence: ClassificationEvidence = classified.evidence;

    // Construct type-specific event
    switch (eventType) {
      case 'navigation':
        return {
          actionId,
          type: 'navigation',
          url: snapshot.identity.accessibleName || '',
          title: '',
          timestamp,
          classificationEvidence: evidence,
        } as SessionEvent;

      case 'text': {
        const value = snapshot.valueChange?.after ?? '';
        return {
          actionId,
          type: 'text',
          elementIdentity,
          timestamp,
          value,
          classificationEvidence: evidence,
        } as SessionEvent;
      }

      case 'select': {
        // Radio buttons are classified as canonicalType='select' by rule R6,
        // but need a different SessionEvent type.
        if (snapshot.identity.ariaRole === 'radio') {
          return {
            actionId,
            type: 'radio',
            elementIdentity,
            timestamp,
            classificationEvidence: evidence,
          } as SessionEvent;
        }
        const value = snapshot.valueChange?.after ?? '';
        return {
          actionId,
          type: 'select',
          elementIdentity,
          timestamp,
          value,
          classificationEvidence: evidence,
        } as SessionEvent;
      }

      case 'dateSelect': {
        const value = snapshot.valueChange?.after ?? '';
        return {
          actionId,
          type: 'dateSelect',
          elementIdentity,
          timestamp,
          dateType: 'date',
          displayValue: value,
          isoValue: value,
          classificationEvidence: evidence,
        } as SessionEvent;
      }

      case 'checkbox': {
        const checked = snapshot.stateChange?.after === 'true';
        return {
          actionId,
          type: 'checkbox',
          elementIdentity,
          timestamp,
          checked,
          classificationEvidence: evidence,
        } as SessionEvent;
      }

      case 'radio':
        return {
          actionId,
          type: 'radio',
          elementIdentity,
          timestamp,
          classificationEvidence: evidence,
        } as SessionEvent;

      case 'hover':
        return {
          actionId,
          type: 'hover',
          elementIdentity,
          timestamp,
          classificationEvidence: evidence,
        } as SessionEvent;

      case 'click':
      default:
        return {
          actionId,
          type: 'click',
          elementIdentity,
          timestamp,
          classificationEvidence: evidence,
        } as SessionEvent;
    }
  }

  /**
   * Generate a sequential ID with prefix (e.g. click-0001, elem-0001).
   */
  private generateId(prefix: string): string {
    const current = this.idCounters.get(prefix) ?? 0;
    const next = current + 1;
    this.idCounters.set(prefix, next);
    return `${prefix}-${String(next).padStart(4, '0')}`;
  }

  // ── Phase 2: AI Refinement ────────────────────────────────────────────

  /**
   * Async AI refinement — the core of Phase 6.
   *
   * Called when Phase 1 classification marks a snapshot as `aiEligible`.
   * This method:
   *   1. Converts the snapshot to SnapshotForAI (semantic only, no selectors).
   *   2. Calls the AI Observer to get an advisory AIIntentResult.
   *   3. Re-classifies the snapshot WITH the AI advisory.
   *   4. If the canonical type changed, fires onEventUpdate to update the Timeline.
   *   5. Always attaches AI enrichment (businessName, userIntent, confidence).
   *
   * Graceful degradation: if AI is unavailable, returns low-confidence, or
   * fails hallucination rejection, the original deterministic classification
   * is preserved unchanged.
   */
  private async requestAIRefinement(
    snapshot: InteractionSnapshot,
    actionId: string,
  ): Promise<void> {
    try {
      // 1. Build semantic snapshot for AI (strips selectors, XPath, framework IDs)
      const snapshotForAI = toSnapshotForAI(snapshot, this.sessionContext);

      // 2. Call AI Observer (may throw if provider is unavailable or chrome is not defined)
      const aiResult = await this.aiObserver.understand(snapshotForAI, this.sessionContext);

      // Graceful degradation: AI unavailable or rejected
      if (!aiResult) return;

    // 3. Re-classify with AI advisory
    const reclassified = classifySnapshot({
      snapshot,
      aiResult,
      sessionContext: this.sessionContext,
    });

    // 4. Check if the canonical type changed
    const tracked = this.emittedEvents.get(actionId);
    if (!tracked) return; // event was already removed (e.g. session ended)

    const originalType = tracked.event.type;
    const newEventType = canonicalToEventType(reclassified.classified.canonicalType, snapshot);

    // Build the updates object
    const updates: Partial<SessionEvent> = {};

    // Phase 2 reclassification: update type if changed
    if (newEventType !== originalType) {
      (updates as Record<string, unknown>).type = newEventType;

      // Re-derive type-specific fields from the reclassified result
      // (e.g., if type changed from 'click' to 'text', add 'value' field)
      this.mergeTypeSpecificFields(updates, reclassified.classified.canonicalType, snapshot);

      // Update classification evidence to reflect the AI-assisted reclassification
      if (reclassified.classified.evidence) {
        (updates as Record<string, unknown>).classificationEvidence =
          reclassified.classified.evidence;
      }
    }

    // 5. Always attach AI enrichment data (businessName, userIntent, confidence)
    const enrichment: AIUnderstanding = {
      businessName: aiResult.businessName,
      controlType: aiResult.suggestedType,
      userIntent: aiResult.userIntent,
      confidenceScore: aiResult.confidence,
    };
    (updates as Record<string, unknown>).aiUnderstanding = enrichment;

    // Fire the update callback
    if (this.eventUpdateCallback) {
      this.eventUpdateCallback(actionId, updates);
    }

    // Update tracked event
    Object.assign(tracked.event, updates);
    } catch {
      // Graceful degradation: if AI refinement fails for any reason
      // (provider unavailable, chrome storage not initialized, network error),
      // the original deterministic classification is preserved.
      // This is intentional — AI is advisory, not critical.
    }
  }

  /**
   * Merge type-specific fields into the update based on the new canonical type.
   *
   * When the canonical type changes (e.g., click → text), the SessionEvent
   * needs type-specific fields populated (value for text, checked for checkbox, etc.).
   */
  private mergeTypeSpecificFields(
    updates: Partial<SessionEvent>,
    canonical: CanonicalType,
    snapshot: InteractionSnapshot,
  ): void {
    switch (canonical) {
      case 'fill':
        if (snapshot.valueChange) {
          (updates as Record<string, unknown>).value = snapshot.valueChange.after;
        }
        break;
      case 'selectDate':
        if (snapshot.valueChange) {
          (updates as Record<string, unknown>).isoValue = snapshot.valueChange.after;
          (updates as Record<string, unknown>).displayValue = snapshot.valueChange.after;
          (updates as Record<string, unknown>).dateType = 'date';
        }
        break;
      case 'select':
        if (snapshot.valueChange) {
          (updates as Record<string, unknown>).value = snapshot.valueChange.after;
        }
        break;
      case 'toggle':
        if (snapshot.stateChange) {
          (updates as Record<string, unknown>).checked =
            snapshot.stateChange.after === 'true';
        }
        break;
    }
  }

  /**
   * Reset the pipeline state (called on START_RECORDING).
   */
  reset(): void {
    this.emittedEvents.clear();
    this.timeline = [];
    this.idCounters.clear();
    this.sessionContext = null;
    this.aiObserver.reset();
    this.assembler.reset();
  }
}
