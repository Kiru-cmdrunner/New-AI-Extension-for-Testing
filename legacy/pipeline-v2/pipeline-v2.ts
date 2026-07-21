/**
 * Pipeline V2 Orchestrator — Service Worker Side
 *
 * Wires all pipeline layers together:
 *   PipelineEvent → BoundaryDetector → StateDiffEngine → PatternRegistry
 *     → InteractionAssembler → IntentResolver → toSessionEvent → SessionEvent
 *
 * This is the service-worker-side orchestrator. It:
 *   1. Receives PipelineEvents (via chrome.runtime messages from the content script)
 *   2. Feeds them to the BoundaryDetector
 *   3. When a unit closes, takes before/after state snapshots
 *   4. Computes the state diff
 *   5. Matches against the pattern registry
 *   6. Assembles the interaction
 *   7. Resolves the intent
 *   8. Converts to a SessionEvent
 *   9. Emits via the onEvent callback (same pattern as ArchitectureCPipeline)
 *
 * INTERFACE COMPATIBILITY: Same interface as ArchitectureCPipeline:
 *   - onEvent(callback)
 *   - ingestEvidence(event) — receives PipelineEvents
 *   - ingestNavigation(url, timestamp)
 *   - flush()
 *   - reset()
 *   - setSessionContext() — no-op for V2 (state diff is taken at unit close)
 */

import { BoundaryDetector } from './boundary-detector';
import { computeDiff } from './state-diff-engine';
import { matchPattern } from './pattern-registry';
import { assembleInteraction } from './interaction-assembler';
import { resolveIntent } from './intent-resolver';
import { getTracer } from './pipeline-tracer';
import type {
  PipelineEvent,
  InteractionUnit,
  StateSnapshot,
  StateDiff,
  PatternMatch,
  ResolvedAction,
  ElementDescriptor,
} from './canonical-event-schema';
import type { SessionEvent } from '../../shared/types';
import type { ElementIdentity } from '../../shared/types';

// ── Callbacks ───────────────────────────────────────────────────────────

export type OnSessionEvent = (event: SessionEvent) => void;

// ── ID Generator ────────────────────────────────────────────────────────

let idCounter = 0;

function generateId(prefix: string): string {
  return `${prefix}-${String(++idCounter).padStart(4, '0')}`;
}

// ── Pipeline V2 ─────────────────────────────────────────────────────────

export class PipelineV2 {
  private boundaryDetector: BoundaryDetector;
  private eventCallback: OnSessionEvent | null = null;
  private tracer = getTracer();

  constructor() {
    this.boundaryDetector = new BoundaryDetector({ useTimer: false });

    this.boundaryDetector.onClosed((unit) => {
      this.processUnit(unit);
    });
  }

  /**
   * Set the callback for when the pipeline produces a SessionEvent.
   */
  onEvent(callback: OnSessionEvent): void {
    this.eventCallback = callback;
  }

  /**
   * Ingest a PipelineEvent from the content script.
   *
   * Each event carries a stateSnapshot captured by the content script's DOM.
   * The orchestrator (running in the service worker) uses the first event in
   * a unit as the "before" snapshot and the last event's snapshot as "after".
   */
  ingestEvidence(event: PipelineEvent): void {
    console.log(
      `[CmdRunner V2] EVENT CAPTURE: ${event.type} on ${event.targetTag || 'N/A'} ` +
      `element=${event.element?.accessibleName || 'N/A'} ` +
      `trusted=${event.isTrusted} eventId=${event.eventId}`,
    );

    this.tracer.trace(
      'event-capture',
      'ingest',
      `${event.type} on ${event.targetTag || 'N/A'}`,
      'routed to boundary detector',
      0,
      undefined,
      event.eventId,
    );

    this.boundaryDetector.ingest(event);
  }

  /**
   * Ingest a navigation event (from webNavigation API).
   */
  ingestNavigation(url: string, timestamp: string): void {
    const navEvent: PipelineEvent = {
      eventId: generateId('nav'),
      type: 'navigation',
      timestamp,
      element: null,
      targetTag: null,
      payload: { url },
      isTrusted: true,
    };
    this.ingestEvidence(navEvent);
  }

  /**
   * Flush any pending interaction units.
   */
  flush(): void {
    this.boundaryDetector.flush();
  }

  /**
   * Reset the pipeline to its initial state.
   */
  reset(): void {
    this.boundaryDetector.reset();
    idCounter = 0;
    this.tracer.clear();
  }

  // ── Internal: Process a Closed Interaction Unit ────────────────────

  private processUnit(unit: InteractionUnit): void {
    const t0 = Date.now();

    console.log(
      `[CmdRunner V2] BOUNDARY DETECTOR: unit ${unit.unitId} closed — ` +
      `${unit.events.length} events, reason=${unit.boundaryReason}. ` +
      `Events: ${unit.events.map(e => `${e.type}(${e.element?.accessibleName || e.targetTag || '?'})`).join(' → ')}`,
    );

    // Trace: boundary detection complete
    this.tracer.trace(
      'boundary-detection',
      'unit-closed',
      `${unit.events.length} events`,
      `InteractionUnit ${unit.unitId} (${unit.boundaryReason})`,
      0,
      unit.boundaryReason,
      undefined,
      unit.unitId,
    );

    // 1. Extract state snapshots from the events.
    // The content script captures a snapshot with each event. We use the
    // first event's snapshot as "before" and the last event's snapshot as
    // "after". This is the fix for the architectural gap: the service worker
    // cannot access the DOM, so snapshots are captured in the content script.
    const beforeSnapshot = this.extractSnapshot(unit.events[0]);
    const afterSnapshot = this.extractSnapshot(unit.events[unit.events.length - 1]);
    const diff = computeDiff(beforeSnapshot, afterSnapshot);

    // RC-2 FIX: Augment the diff with event-level value changes.
    // The snapshot-based diff may miss state changes when the before/after
    // snapshots are identical (browser updates DOM before dispatching events).
    // The observer now tracks pre-state and emits previousValue in event
    // payloads. We extract these to create synthetic ValueChanges and
    // ToggleChanges that the snapshot diff missed.
    this.augmentDiffFromEvents(diff, unit);

    console.log(
      `[CmdRunner V2] STATE DIFF: ${diff.valueChanges.length} value, ` +
      `${diff.toggleChanges.length} toggle, ${diff.radioChanges.length} radio, ` +
      `${diff.surfaceChanges.length} surface, ${diff.rangeChanges.length} range, ` +
      `focus=${diff.focusChange ? 'changed' : 'none'}, url=${diff.urlChange ? 'changed' : 'same'}`,
    );

    const t1 = Date.now();
    this.tracer.trace(
      'state-diff',
      'compute-diff',
      `before: ${beforeSnapshot.url}, after: ${afterSnapshot.url}`,
      `${diff.valueChanges.length} value, ${diff.toggleChanges.length} toggle, ${diff.radioChanges.length} radio, ${diff.surfaceChanges.length} surface changes`,
      t1 - t0,
      diff.urlChange ? 'URL changed' : undefined,
      undefined,
      unit.unitId,
    );

    // 3. Match against pattern registry
    const patternMatch = matchPattern(unit, diff);

    console.log(
      `[CmdRunner V2] PATTERN REGISTRY: match=${patternMatch?.behavior || 'generic-fallback'} ` +
      `confidence=${patternMatch?.confidence.toFixed(2) || 'N/A'}`,
    );

    const t2 = Date.now();
    this.tracer.trace(
      'pattern-registry',
      'match',
      `${unit.events.length} events + diff`,
      patternMatch ? `${patternMatch.behavior} (${patternMatch.confidence.toFixed(2)})` : 'no match (generic-fallback)',
      t2 - t1,
      patternMatch?.behavior || 'generic-fallback',
      undefined,
      unit.unitId,
    );

    // 4. Assemble the interaction
    const assembled = assembleInteraction(unit, diff, patternMatch);

    console.log(
      `[CmdRunner V2] INTERACTION ASSEMBLER: behavior=${assembled.behavior} ` +
      `description="${assembled.description}" source=${assembled.resolutionSource}`,
    );

    const t3 = Date.now();
    this.tracer.trace(
      'interaction-assembler',
      'assemble',
      `behavior: ${assembled.behavior}`,
      assembled.description,
      t3 - t2,
      assembled.resolutionSource,
      undefined,
      unit.unitId,
    );

    // 5. Resolve intent
    const resolved = resolveIntent(assembled, diff);

    console.log(
      `[CmdRunner V2] INTENT RESOLVER: ${assembled.behavior} → ${resolved.sessionEventType} ` +
      `confidence=${resolved.confidence.toFixed(2)} (${resolved.confidenceLevel}) ` +
      `description="${resolved.description}"`,
    );

    const t4 = Date.now();
    this.tracer.trace(
      'intent-resolver',
      'resolve',
      `${assembled.behavior} → ${resolved.sessionEventType}`,
      `${resolved.description} (confidence: ${resolved.confidence.toFixed(2)})`,
      t4 - t3,
      resolved.rationale,
      undefined,
      unit.unitId,
    );

    // 6. Convert to SessionEvent
    const sessionEvent = this.toSessionEvent(resolved);

    console.log(
      `[CmdRunner V2] PIPELINE OUTPUT: emitted ${sessionEvent.type} ` +
      `actionId=${sessionEvent.actionId} ` +
      `element=${('elementIdentity' in sessionEvent ? sessionEvent.elementIdentity?.accessibleName : 'N/A')}`,
    );

    // 7. Emit
    if (this.eventCallback) {
      this.eventCallback(sessionEvent);
    }

    const t5 = Date.now();
    this.tracer.trace(
      'pipeline-output',
      'emit',
      resolved.sessionEventType,
      sessionEvent.actionId,
      t5 - t4,
      undefined,
      undefined,
      unit.unitId,
    );

    // 8. Emit (done above)
  }

  // ── ResolvedAction → SessionEvent ──────────────────────────────────

  /**
   * Convert a ResolvedAction to a SessionEvent.
   *
   * The SessionEvent union has 8 variants. This method maps the resolved
   * action to the correct variant with the correct type-specific fields.
   *
   * COMPATIBILITY: The resulting SessionEvent has EXACTLY the same shape
   * as what the Architecture C pipeline produces. No downstream component
   * can tell the difference.
   */
  private toSessionEvent(resolved: ResolvedAction): SessionEvent {
    const timestamp = new Date().toISOString();
    const actionId = generateId(this.prefixForType(resolved.sessionEventType));

    switch (resolved.sessionEventType) {
      case 'navigation':
        return {
          actionId,
          type: 'navigation',
          url: resolved.fields.url || '',
          title: resolved.fields.title || '',
          timestamp,
        } as SessionEvent;

      case 'click':
        return {
          actionId,
          type: 'click',
          elementIdentity: this.ensureElementId(resolved.elementIdentity),
          timestamp,
        } as SessionEvent;

      case 'text':
        return {
          actionId,
          type: 'text',
          elementIdentity: this.ensureElementId(resolved.elementIdentity),
          timestamp,
          value: resolved.fields.value || '',
        } as SessionEvent;

      case 'hover':
        return {
          actionId,
          type: 'hover',
          elementIdentity: this.ensureElementId(resolved.elementIdentity),
          timestamp,
        } as SessionEvent;

      case 'checkbox':
        return {
          actionId,
          type: 'checkbox',
          elementIdentity: this.ensureElementId(resolved.elementIdentity),
          timestamp,
          checked: resolved.fields.checked ?? true,
        } as SessionEvent;

      case 'radio':
        return {
          actionId,
          type: 'radio',
          elementIdentity: this.ensureElementId(resolved.elementIdentity),
          timestamp,
        } as SessionEvent;

      case 'select':
        return {
          actionId,
          type: 'select',
          elementIdentity: this.ensureElementId(resolved.elementIdentity),
          timestamp,
          value: resolved.fields.value || '',
        } as SessionEvent;

      case 'dateSelect':
        return {
          actionId,
          type: 'dateSelect',
          elementIdentity: this.ensureElementId(resolved.elementIdentity),
          timestamp,
          dateType: resolved.fields.dateType || 'date',
          displayValue: resolved.fields.displayValue || '',
          isoValue: resolved.fields.isoValue || '',
        } as SessionEvent;

      default: {
        const _exhaustive: never = resolved.sessionEventType;
        // Fallback: emit as click
        return {
          actionId,
          type: 'click',
          elementIdentity: this.ensureElementId(resolved.elementIdentity),
          timestamp,
        } as SessionEvent;
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private prefixForType(type: string): string {
    const prefixes: Record<string, string> = {
      navigation: 'nav',
      click: 'click',
      text: 'text',
      hover: 'hover',
      checkbox: 'check',
      radio: 'radio',
      select: 'select',
      dateSelect: 'dateSelect',
    };
    return prefixes[type] || 'action';
  }

  /**
   * Ensure the element identity has an elementId.
   * The V2 observer sets elementId in the content script.
   */
  private ensureElementId(identity: ElementIdentity | null): ElementIdentity {
    if (!identity) {
      // Create a minimal identity for events without an element (shouldn't happen normally)
      return {
        accessibleName: '',
        ariaRole: null,
        ariaLabel: null,
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'UNKNOWN',
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
        elementId: generateId('elem'),
      };
    }
    if (!identity.elementId) {
      return { ...identity, elementId: generateId('elem') };
    }
    return identity;
  }

  /**
   * Extract a StateSnapshot from a PipelineEvent's payload.
   * The content script captures and embeds snapshots in each event.
   * Falls back to an empty snapshot if the event doesn't carry one
   * (e.g. navigation events from the webNavigation API).
   */
  private extractSnapshot(event: PipelineEvent): StateSnapshot {
    const snapshot = event?.payload?.stateSnapshot as StateSnapshot | undefined;
    if (snapshot) {
      return snapshot;
    }
    // Return empty snapshot as fallback
    return {
      timestamp: event?.timestamp || new Date().toISOString(),
      url: '',
      pageTitle: '',
      inputs: [],
      checkboxes: [],
      radios: [],
      toggles: [],
      ranges: [],
      focusedElement: null,
      openSurfaces: [],
      activeTab: null,
      expandedAccordions: [],
      interactiveElementCount: 0,
    };
  }

  /**
   * RC-2 FIX: Augment the snapshot-based StateDiff with event-level data.
   *
   * The observer now tracks pre-state at mousedown/focus time and includes
   * `previousValue` and `value` in change event payloads. We scan events for
   * these fields and create synthetic ValueChanges/ToggleChanges that the
   * snapshot diff may have missed.
   *
   * This also extracts values from change/input events where the observer
   * captured the current value directly from the element (more reliable than
   * snapshot comparison).
   */
  private augmentDiffFromEvents(diff: StateDiff, unit: InteractionUnit): void {
    const seenKeys = new Set<string>();

    // Extract value changes from change/input events with value + previousValue
    for (const event of unit.events) {
      if (event.type !== 'change' && event.type !== 'input') continue;

      const value = event.payload?.value as string | undefined;
      const prevValue = event.payload?.previousValue as string | undefined;
      if (value === undefined) continue;

      const identity = event.element;
      if (!identity) continue;

      const elementKey = identity.id || identity.cssSelector || identity.accessibleName || '';
      if (seenKeys.has(elementKey)) continue;

      // Determine element type
      const tag = (identity.tag || '').toLowerCase();
      const role = identity.ariaRole || '';

      // Checkbox/radio/toggle — create toggle change
      if (tag.includes('checkbox') || tag.includes('radio') ||
          role === 'checkbox' || role === 'switch' || role === 'radio') {
        // Parse checked state from the serialized previousValue
        const wasChecked = prevValue ? prevValue.includes('checked=true') : false;
        const isNowChecked = prevValue ? !wasChecked : true;

        const alreadyTracked = diff.toggleChanges.some(
          (tc) => tc.field === (identity.accessibleName || elementKey)
        );
        if (!alreadyTracked) {
          seenKeys.add(elementKey);
          diff.toggleChanges.push({
            descriptor: this.identityToDescriptor(identity),
            field: identity.accessibleName || elementKey || 'Toggle',
            before: wasChecked,
            after: isNowChecked,
          });
        }
        continue;
      }

      // ARIA pressed (segmented control / toggle button)
      if (role === 'button' && prevValue && prevValue.includes('aria-pressed')) {
        const wasPressed = prevValue.includes('aria-pressed=true');
        const alreadyTracked = diff.toggleChanges.some(
          (tc) => tc.field === identity.accessibleName
        );
        if (!alreadyTracked) {
          seenKeys.add(elementKey);
          diff.toggleChanges.push({
            descriptor: this.identityToDescriptor(identity),
            field: identity.accessibleName || 'Toggle',
            before: wasPressed,
            after: !wasPressed,
          });
        }
        continue;
      }

      // ARIA radio
      if (role === 'radio') {
        if (diff.radioChanges.length === 0) {
          seenKeys.add(elementKey);
          diff.radioChanges.push({
            groupName: 'radio-group',
            groupDescriptor: this.identityToDescriptor(identity),
            before: null,
            after: this.identityToDescriptor(identity),
          });
        }
        continue;
      }

      // Regular value change (select, date, text)
      if (value && (value !== prevValue || prevValue === undefined)) {
        const alreadyTracked = diff.valueChanges.some(
          (vc) => vc.field === (identity.accessibleName || elementKey)
        );
        if (!alreadyTracked) {
          seenKeys.add(elementKey);

          // Determine inputType
          let inputType = tag || 'text';
          if (tag === 'select') inputType = 'select-one';
          if (role === 'combobox' || role === 'option') inputType = 'combobox';
          // RC-5: For clicks on div/span/li inside surfaces (custom dropdowns),
          // classify as combobox selection
          if (role === 'option' || role === 'menuitem' || role === 'menuitemradio') {
            inputType = 'combobox';
          }

          // RC FIX: For <input> elements, parse the actual type from serialized
          // previousValue (e.g. "type=date value=2025-01-01" → inputType=date).
          // This ensures time pickers, date pickers etc. are correctly classified.
          if (tag === 'input' && prevValue) {
            const typeMatch = prevValue.match(/type=(\S+)/);
            if (typeMatch) {
              inputType = typeMatch[1];
            }
          }

          // RC-5: For clicks inside calendar/date pickers, mark as date
          const cls = (identity.className || '').toLowerCase();
          if (cls.includes('calendar') || cls.includes('datepicker') || cls.includes('date-picker')) {
            inputType = 'date';
          }

          diff.valueChanges.push({
            descriptor: this.identityToDescriptor(identity),
            field: identity.accessibleName || elementKey || 'Field',
            before: prevValue || '',
            after: value,
            inputType,
          });
        }
      }
    }

    // RC-5 FIX: Connect value changes to their parent field (dropdown trigger).
    // When a user clicks an option inside a dropdown, the value change event
    // has the option's identity. But the "field" name should be the dropdown
    // trigger's label, not the option's label. We try to find the trigger
    // from surface_open events in the same unit.
    if (diff.valueChanges.length > 0) {
      const surfaceOpen = unit.events.find((e) => e.type === 'surface_open');
      if (surfaceOpen && surfaceOpen.element) {
        const triggerName = surfaceOpen.element.accessibleName || '';
        if (triggerName) {
          // Update the field name of value changes to use the trigger's name
          // But only if the current field name is the option text (not already a field name)
          for (const vc of diff.valueChanges) {
            // If the value change's field matches the selected value (meaning it was
            // set from the option click), replace with the trigger name
            if (vc.field === vc.after || vc.field === vc.descriptor.accessibleName) {
              // Use Object.defineProperty since StateDiff fields are readonly in type
              // but mutable at runtime (the diff object is constructed as mutable)
              (vc as any).field = triggerName;
            }
          }
        }
      }
    }
  }

  /**
   * Convert an ElementIdentity to an ElementDescriptor for use in StateDiff fields.
   */
  private identityToDescriptor(identity: ElementIdentity): ElementDescriptor {
    return {
      accessibleName: identity.accessibleName || '',
      ariaRole: identity.ariaRole || null,
      tag: identity.tag || '',
      id: identity.id || null,
      cssSelector: identity.cssSelector || '',
      xPath: identity.xPath || '',
      testId: identity.testId || null,
      className: identity.className || null,
    } as ElementDescriptor;
  }
}
