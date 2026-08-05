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
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.2 Stage 5
 */

import { createRuntime, type ComponentRuntime } from './component-runtime';
import { ALL_DEFINITIONS } from '../definitions';
import { enrichInteraction } from '../enrichment';
import { interpretBehavioralObservations } from '../semantics/sw-bridge';
import type {
  ObservedEvent,
  ComponentInteraction,
  RuntimeConfig,
} from '../shared/component-types';
import type { ObservationResult } from '../shared/observation-types';

// ── Storage Keys ─────────────────────────────────────────────────────

export const LIVE_INTERACTIONS_KEY = 'cmdrunner_live_interactions';
export const RUNTIME_SNAPSHOT_KEY = 'cmdrunner_runtime_snapshot';
export const RECORDING_ACTIVE_KEY = 'cmdrunner_recording_active';

/**
 * Storage key prefix for durably persisted individual observations.
 * Each completed observation is stored under cmdrunner_obs_<sourceEventId>
 * by the service worker BEFORE acking the content script.
 *
 * Keys are deleted ONLY at safe points — after the observation is
 * confirmed in persisted interaction state (Safe Point 1 & 2), or
 * at session-end after successful reconciliation (Safe Point 3).
 */
export const OBS_KEY_PREFIX = 'cmdrunner_obs_';

// ── Singleton State ──────────────────────────────────────────────────

let runtime: ComponentRuntime | null = null;
let liveInteractions: ComponentInteraction[] = [];
let isRecording = false;

// ── Pending Behavioral Effects (Phase D) ──────────────────────────────
//
// Behavioral observations that arrived before (or without) a matching
// interaction emission. Keyed by sourceEventId. Checked at every
// interaction emission point via attachPendingBehavioralObservations().

let pendingBehavioralEffects: Map<string, ObservationResult[]> = new Map();

/**
 * Store a behavioral result that couldn't be correlated with a live interaction.
 * Called when handleBehavioralEffects finds no matching eventId.
 */
export function addPendingBehavioralEffect(result: ObservationResult): void {
  const existing = pendingBehavioralEffects.get(result.sourceEventId) ?? [];
  existing.push(result);
  pendingBehavioralEffects.set(result.sourceEventId, existing);
}

/**
 * Attach any pending behavioral observations to a newly emitted interaction.
 * Called at every interaction emission point (initRecording onEmit,
 * restoreFromStorage onEmit, stopRecording flush).
 *
 * Returns the sourceEventIds of observations that were attached.
 * Callers delete the corresponding durable keys AFTER persistLiveInteractions().
 */
export function attachPendingBehavioralObservations(
  interaction: ComponentInteraction,
): string[] {
  const eventIds = [
    interaction.triggerEvent.eventId,
    ...interaction.memberEvents.map((e) => e.eventId),
  ];

  const attachedIds: string[] = [];

  for (const eventId of eventIds) {
    const pending = pendingBehavioralEffects.get(eventId);
    if (pending && pending.length > 0) {
      if (!interaction.behavioralObservations) {
        interaction.behavioralObservations = [];
      }
      interaction.behavioralObservations.push(...pending);
      attachedIds.push(...pending.map((p) => p.sourceEventId));
      pendingBehavioralEffects.delete(eventId);
    }
  }

  // ── Semantic Interpretation (Sub-phase 2) ─────────────────────
  // Interpret newly attached observations. Fail-safe: if interpretation
  // throws, the observation's semanticEffects is left unset and the
  // exception is swallowed inside interpretBehavioralObservations.
  if (attachedIds.length > 0) {
    interpretBehavioralObservations(interaction);
  }

  return attachedIds;
}

// ── Initialization ───────────────────────────────────────────────────

/**
 * Create or reset the runtime for a new recording session.
 */
export function initRecording(): void {
  liveInteractions = [];
  isRecording = true;

  const config: RuntimeConfig = {
    onEmit: (interaction: ComponentInteraction) => {
      // Store IMMEDIATELY — no debounce, no timer
      // Bug 1 fix: debounce timer was killed by MV3 SW termination
      // before the Login button form-submit navigation
      enrichInteraction(interaction);
      const attachedIds = attachPendingBehavioralObservations(interaction);
      liveInteractions.push(interaction);
      persistLiveInteractions();
      // ── SAFE POINT 1: delete durable keys after persist ──────────
      deleteObsKeys(attachedIds);
      // ── End Safe Point 1 ──────────────────────────────────────────
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
    const flushed = runtime.flush();
    for (const interaction of flushed) {
      attachPendingBehavioralObservations(interaction);
    }
    liveInteractions.push(...flushed);
    persistLiveInteractions();
  }

  // ── SAFE POINT 3: session-end sweep ──────────────────────────────
  // All pending observations should now be in persisted interactions.
  // Clean up any remaining durable observation keys.
  cleanupAllObsKeys();
  // ── End Safe Point 3 ──────────────────────────────────────────────

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
  runtime = null;
  isRecording = false;
  pendingBehavioralEffects = new Map();
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

    // Recreate runtime with restored snapshot
    const config: RuntimeConfig = {
      onEmit: (interaction: ComponentInteraction) => {
        enrichInteraction(interaction);
        const attachedIds = attachPendingBehavioralObservations(interaction);
        liveInteractions.push(interaction);
        persistLiveInteractions();
        // ── SAFE POINT 1: delete durable keys after persist ──────────
        deleteObsKeys(attachedIds);
        // ── End Safe Point 1 ──────────────────────────────────────────
      },
    };
    runtime = createRuntime(ALL_DEFINITIONS, config);

    // Restore snapshot (interaction counter, seen events, dedup state)
    const snapshot = result[RUNTIME_SNAPSHOT_KEY];
    if (snapshot) {
      runtime.restore(snapshot);
    }

    isRecording = true;

    // ── SAFE POINT 2: Recover durable observation keys ───────────────
    // After restoring liveInteractions, scan for orphaned observations
    // that were durably stored but never persisted onto their interaction
    // before SW died.
    await recoverDurableObservations();
    // ── End Safe Point 2 ─────────────────────────────────────────────

    return true;
  } catch {
    return false;
  }
}

/**
 * Recover orphaned observations from durable per-observation keys.
 *
 * For each cmdrunner_obs_* key found in storage:
 * - If the interaction exists in restored liveInteractions:
 *   Attach (dedup), interpret if needed, persist, then delete the key.
 * - If the interaction is NOT yet restored/emitted:
 *   Re-pend into the in-memory pendingBehavioralEffects map, but
 *   DO NOT delete the key — it survives for the next SW restart.
 */
async function recoverDurableObservations(): Promise<void> {
  let all: Record<string, unknown>;
  try {
    all = await chrome.storage.local.get(null);
  } catch {
    return;
  }

  const obsKeys = Object.keys(all).filter((k) => k.startsWith(OBS_KEY_PREFIX));
  if (obsKeys.length === 0) return;

  const attachedIds: string[] = [];

  for (const key of obsKeys) {
    const obsResult = all[key] as ObservationResult;
    let attached = false;

    for (const interaction of liveInteractions) {
      const eventIds = [
        interaction.triggerEvent.eventId,
        ...interaction.memberEvents.map((e) => e.eventId),
      ];
      if (eventIds.includes(obsResult.sourceEventId)) {
        // Dedup: skip if already attached (persisted interaction already has it)
        if (
          !interaction.behavioralObservations?.some(
            (o) => o.sourceEventId === obsResult.sourceEventId,
          )
        ) {
          if (!interaction.behavioralObservations) {
            interaction.behavioralObservations = [];
          }
          interaction.behavioralObservations.push(obsResult);
          // Interpret if not already done
          if (!obsResult.semanticEffects) {
            interpretBehavioralObservations(interaction);
          }
        }
        attached = true;
        attachedIds.push(obsResult.sourceEventId);
        break;
      }
    }

    if (!attached) {
      // ── RE-PENDING: interaction not yet restored/emitted ──────────
      // DO NOT delete the key. It survives for the next SW restart.
      // The observation is added to the in-memory pending map AND
      // the durable key stays in storage.
      addPendingBehavioralEffect(obsResult);
    }
  }

  // Persist any newly attached observations
  if (attachedIds.length > 0) {
    persistLiveInteractions();
    // ── SAFE POINT 2: delete keys for successfully attached observations ──
    deleteObsKeys(attachedIds);
  }
}

// ── Durability Helpers ──────────────────────────────────────────────────

/**
 * Delete durable per-observation keys by sourceEventId.
 * Called AFTER persistLiveInteractions() confirms the observation
 * is in persisted interaction state.
 */
function deleteObsKeys(sourceEventIds: string[]): void {
  if (sourceEventIds.length === 0) return;
  const keys = sourceEventIds.map((id) => `${OBS_KEY_PREFIX}${id}`);
  chrome.storage.local.remove(keys).catch(() => {
    // Non-fatal — key will be cleaned up on next opportunity
  });
}

/**
 * Remove all durable observation keys (session-end sweep).
 * Called from stopRecording() after all interactions are persisted.
 */
function cleanupAllObsKeys(): void {
  chrome.storage.local.get(null).then((all) => {
    const stale = Object.keys(all).filter((k) => k.startsWith(OBS_KEY_PREFIX));
    if (stale.length > 0) {
      chrome.storage.local.remove(stale).catch(() => {
        // Non-fatal
      });
    }
  }).catch(() => {
    // Non-fatal
  });
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
