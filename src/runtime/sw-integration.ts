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
import { enrichConfigurationSession } from '../enrichment/structural-enrichment';
import type {
  ObservedEvent,
  ComponentInteraction,
  RuntimeConfig,
} from '../shared/component-types';

// ── Storage Keys ─────────────────────────────────────────────────────

export const LIVE_INTERACTIONS_KEY = 'cmdrunner_live_interactions';
export const RUNTIME_SNAPSHOT_KEY = 'cmdrunner_runtime_snapshot';
export const RECORDING_ACTIVE_KEY = 'cmdrunner_recording_active';

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
  isRecording = true;

  const config: RuntimeConfig = {
    onEmit: (interaction: ComponentInteraction) => {
      // Store IMMEDIATELY — no debounce, no timer
      // Bug 1 fix: debounce timer was killed by MV3 SW termination
      // before the Login button form-submit navigation
      enrichInteraction(interaction);
      liveInteractions.push(interaction);
      persistLiveInteractions();
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
    // flush() emits remaining interactions via the onEmit callback,
    // which pushes them to liveInteractions already. Do NOT push the
    // return value again — that would duplicate every flushed interaction.
    runtime.flush();

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
        liveInteractions.push(interaction);
        persistLiveInteractions();
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
