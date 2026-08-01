/**
 * Service Worker Integration — Component Runtime Bridge
 *
 * This module bridges the content script's observed events to the
 * Component Runtime, manages live interaction storage, and provides
 * MV3 recovery.
 *
 * Key design decisions:
 * - Live interactions are stored IMMEDIATELY (no debounce) — Bug 1 fix
 * - Runtime state is snapshotted for MV3 recovery
 * - On STOP, flush() + trigger generation
 *
 * R3.4: Annotation deferral for Click interactions. When a Click is emitted,
 * the annotation (annotateWithEvidence) is deferred until the matching
 * attribute-change event arrives from the EventTap's post-handler re-snapshot.
 * This ensures the evidence engine sees behavioral changes produced by the
 * page's own click handler. If no attribute-change event arrives (test mode,
 * extension invalidated), the Click is annotated with pre-handler data on
 * the next event or on stopRecording.
 *
 * Architecture: `.drytis/specs/r3-behavioral-semantic-reasoning.md` §5.4
 */

import { createRuntime, type ComponentRuntime } from './component-runtime';
import { ALL_DEFINITIONS } from '../definitions';
import { enrichInteraction } from '../enrichment';
import { enrichConfigurationSession } from '../enrichment/structural-enrichment';
import { annotateWithEvidence } from '../classifier/evidence/annotation-layer';
import type {
  ObservedEvent,
  ComponentInteraction,
  RuntimeConfig,
  AttributeChange,
} from '../shared/component-types';

// ── Storage Keys ─────────────────────────────────────────────────────

export const LIVE_INTERACTIONS_KEY = 'cmdrunner_live_interactions';
export const RUNTIME_SNAPSHOT_KEY = 'cmdrunner_runtime_snapshot';
export const RECORDING_ACTIVE_KEY = 'cmdrunner_recording_active';

// ── R3.4: Pending Annotation State ───────────────────────────────────
//
// When a Click interaction is emitted, its semantic annotation is deferred
// until the corresponding attribute-change event arrives (from the EventTap's
// setTimeout(0) re-snapshot). The pending entry maps stableId → interaction
// so the attribute-change event can find and annotate the right Click.
//
// If no attribute-change arrives, the next processObservedEvent call or
// stopRecording() finalizes all pending annotations with pre-handler data.

interface PendingAnnotation {
  interaction: ComponentInteraction;
  stableId: string;
}

let pendingAnnotations: PendingAnnotation[] = [];

/**
 * Finalize a pending annotation: run annotateWithEvidence and push to
 * liveInteractions. Called either when the attribute-change event arrives
 * or as a fallback when no attribute-change is expected.
 */
function finalizeAnnotation(
  entry: PendingAnnotation,
  attributeChanges?: AttributeChange[],
): void {
  const { interaction } = entry;

  // R3.4: Attach attribute changes to metadata before annotation
  if (attributeChanges && attributeChanges.length > 0) {
    interaction.metadata.attributeChanges = attributeChanges;
  }

  enrichInteraction(interaction);
  annotateWithEvidence(interaction);
  liveInteractions.push(interaction);
  persistLiveInteractions();
}

/**
 * Finalize ALL pending annotations. Used as a fallback when the
 * attribute-change event doesn't arrive (test mode, extension issue).
 */
function finalizeAllPendingAnnotations(): void {
  for (const entry of pendingAnnotations) {
    finalizeAnnotation(entry);
  }
  pendingAnnotations = [];
}

// ── Singleton State ──────────────────────────────────────────────────

let runtime: ComponentRuntime | null = null;
let liveInteractions: ComponentInteraction[] = [];
let isRecording = false;

// ── Initialization ───────────────────────────────────────────────────

/**
 * Create or reset the runtime for a new recording session.
 */
export function initRecording(): void {
  liveInteractions = [];
  pendingAnnotations = [];
  isRecording = true;

  const config: RuntimeConfig = {
    onEmit: (interaction: ComponentInteraction) => {
      // R3.4: For Click interactions, defer annotation until attribute-change event.
      // For all other types, annotate immediately (they don't need post-handler data).
      if (interaction.type === 'Click' && !interaction.interactionSubtype) {
        // Defer annotation — wait for attribute-change event from EventTap
        pendingAnnotations.push({
          interaction,
          stableId: interaction.trigger.stableId ?? '',
        });
        // Don't push to liveInteractions yet — it will be added when annotation completes.
        // But we DO persist immediately so MV3 recovery works.
        persistLiveInteractions();
      } else {
        // Non-Click or already-subtyped Click: annotate immediately
        enrichInteraction(interaction);
        annotateWithEvidence(interaction);
        liveInteractions.push(interaction);
        persistLiveInteractions();
      }
    },
  };

  runtime = createRuntime(ALL_DEFINITIONS, config);

  // Persist recording state for MV3 recovery
  chrome.storage.local.set({ [RECORDING_ACTIVE_KEY]: true }).catch(() => {});
  persistLiveInteractions();
}

/**
 * Stop recording: flush runtime, finalize interactions.
 */
export function stopRecording(): ComponentInteraction[] {
  if (runtime) {
    // R3.4: Finalize any pending annotations before flush
    finalizeAllPendingAnnotations();

    // flush() emits remaining interactions via the onEmit callback,
    // which pushes them to liveInteractions already. Do NOT push the
    // return value again — that would duplicate every flushed interaction.
    runtime.flush();

    // R3.4: Finalize any pending annotations from flush
    finalizeAllPendingAnnotations();

    // Phase 0e: Structural Semantic Enrichment
    // Transform subActions into ConfigurationSession for all qualifying
    // interactions. Pure transform — adds configurationSession to metadata.
    liveInteractions = liveInteractions.map(enrichConfigurationSession);

    persistLiveInteractions();
  }

  isRecording = false;
  chrome.storage.local.set({ [RECORDING_ACTIVE_KEY]: false }).catch(() => {});

  return [...liveInteractions];
}

/**
 * Process an observed event from the content script.
 * Returns the interactions emitted by this event.
 */
export function processObservedEvent(
  event: ObservedEvent,
): ComponentInteraction[] {
  if (!runtime || !isRecording) return [];

  // R3.4: Handle attribute-change events — match to pending Click annotations
  if (event.eventType === 'attribute-change') {
    const stableId = event.target.stableId;
    const changes = event.domContext?.attributeChanges ?? [];

    // Find pending annotation for this element
    const idx = pendingAnnotations.findIndex(p => p.stableId === stableId);
    if (idx >= 0) {
      const entry = pendingAnnotations.splice(idx, 1)[0];
      finalizeAnnotation(entry, changes);
    }

    // Also finalize any OTHER pending annotations that are older — they've
    // waited long enough. This handles rapid clicks where attribute-change
    // events arrive out of order or for the wrong element.
    if (pendingAnnotations.length > 0) {
      finalizeAllPendingAnnotations();
    }

    // Attribute-change events don't go through the runtime
    persistRuntimeSnapshot();
    return [];
  }

  // R3.4: Before processing a new event, finalize pending annotations.
  // The new event means the attribute-change for the previous Click
  // either already arrived (and was handled above) or isn't coming.
  finalizeAllPendingAnnotations();

  const emitted = runtime.process(event);

  // Persist runtime snapshot for MV3 recovery
  if (emitted.length > 0) {
    persistRuntimeSnapshot();
  }

  return emitted;
}

/**
 * Get all live interactions accumulated so far.
 */
export function getLiveInteractions(): ComponentInteraction[] {
  return [...liveInteractions];
}

/**
 * Clear all state (for testing or hard reset).
 */
export function resetState(): void {
  liveInteractions = [];
  pendingAnnotations = [];
  runtime = null;
  isRecording = false;
  chrome.storage.local.remove([
    LIVE_INTERACTIONS_KEY,
    RUNTIME_SNAPSHOT_KEY,
    RECORDING_ACTIVE_KEY,
  ]).catch(() => {});
}

// ── MV3 Recovery ─────────────────────────────────────────────────────

/**
 * Restore state after MV3 service worker restart.
 * Reads live interactions and runtime snapshot from chrome.storage.local.
 *
 * Returns true if a recording was active and successfully restored.
 */
export async function restoreFromStorage(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get([
      RECORDING_ACTIVE_KEY,
      LIVE_INTERACTIONS_KEY,
      RUNTIME_SNAPSHOT_KEY,
    ]);

    const wasRecording = result[RECORDING_ACTIVE_KEY] === true;
    if (!wasRecording) return false;

    // Restore live interactions
    liveInteractions = result[LIVE_INTERACTIONS_KEY] ?? [];
    pendingAnnotations = [];

    // Recreate runtime with restored snapshot
    const config: RuntimeConfig = {
      onEmit: (interaction: ComponentInteraction) => {
        // R3.4: Same deferred annotation logic as initRecording
        if (interaction.type === 'Click' && !interaction.interactionSubtype) {
          pendingAnnotations.push({
            interaction,
            stableId: interaction.trigger.stableId ?? '',
          });
          persistLiveInteractions();
        } else {
          enrichInteraction(interaction);
          annotateWithEvidence(interaction);
          liveInteractions.push(interaction);
          persistLiveInteractions();
        }
      },
    };
    runtime = createRuntime(ALL_DEFINITIONS, config);

    // Restore snapshot (interaction counter, seen events, dedup state)
    const snapshot = result[RUNTIME_SNAPSHOT_KEY];
    if (snapshot) {
      runtime.restore(snapshot);
    }

    isRecording = true;
    return true;
  } catch {
    return false;
  }
}

// ── Persistence ──────────────────────────────────────────────────────

/**
 * Write live interactions to chrome.storage.local immediately.
 */
function persistLiveInteractions(): void {
  chrome.storage.local.set({
    [LIVE_INTERACTIONS_KEY]: liveInteractions,
  }).catch(() => {
    // Storage may be full or SW terminating — non-fatal
  });
}

/**
 * Write runtime snapshot to chrome.storage.local.
 */
function persistRuntimeSnapshot(): void {
  if (!runtime) return;
  const snap = runtime.snapshot();
  chrome.storage.local.set({
    [RUNTIME_SNAPSHOT_KEY]: snap,
  }).catch(() => {
    // Non-fatal
  });
}
