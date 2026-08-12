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
import type {
  ObservedEvent,
  ComponentInteraction,
  RuntimeConfig,
} from '../shared/component-types';
import type { BehavioralEvidence } from '../shared/behavioral-evidence-types';
import {
  EvidenceLedger,
  EVIDENCE_LEDGER_KEY,
} from './evidence-ledger';
import { projectInteractions } from './projection-engine';
import {
  formatVerificationReport,
  type VerificationResult,
} from './verification-mode';

// ── Storage Keys ─────────────────────────────────────────────────────

export const LIVE_INTERACTIONS_KEY = 'cmdrunner_live_interactions';
export const RUNTIME_SNAPSHOT_KEY = 'cmdrunner_runtime_snapshot';
export const RECORDING_ACTIVE_KEY = 'cmdrunner_recording_active';

// ── Singleton State ──────────────────────────────────────────────────

let runtime: ComponentRuntime | null = null;
let liveInteractions: ComponentInteraction[] = [];
let isRecording = false;
let evidenceLedger: EvidenceLedger | null = null;
let lastVerificationResult: VerificationResult | null = null;

// ── Pending Evidence (M7-fix-001) ────────────────────────────────────
//
// Evidence that arrives before its interaction has been emitted.
// Keyed by sourceEventId. Capped at 100 entries (LRU eviction).
// When an interaction is emitted, drainPendingEvidence checks this map.

const pendingEvidence = new Map<string, BehavioralEvidence>();
const MAX_PENDING_EVIDENCE = 100;

// ── Evidence Timeout Tracking (P1-3 Fix) ─────────────────────────────
//
// Bounded timeout: if no behavioral evidence arrives for an interaction
// within EVIDENCE_TIMEOUT_MS, the interaction is marked as "evidence timeout"
// and a synthetic minimal evidence is attached so the side panel can display
// "No evidence (timeout)" instead of "Collecting…" forever.
//
// This handles scenarios like full-page reloads (content script destroyed),
// SPA navigations where the evidence window never closes, and any other
// case where evidence delivery fails.

const EVIDENCE_TIMEOUT_MS = 5000;

/** Map of interactionId → timeout handle for evidence timeouts. */
const evidenceTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Start the evidence timeout timer for a newly emitted interaction.
 * If no evidence arrives within EVIDENCE_TIMEOUT_MS, attaches synthetic
 * timeout evidence and broadcasts the update.
 */
function startEvidenceTimeout(interaction: ComponentInteraction): void {
  // Skip if interaction already has evidence
  if (interaction.behavioralEvidence) return;

  const interactionId = interaction.interactionId;
  const triggerEventId = interaction.triggerEvent?.eventId;

  // Clear any existing timeout for this interaction
  const existing = evidenceTimeouts.get(interactionId);
  if (existing) clearTimeout(existing);

  const handle = setTimeout(() => {
    evidenceTimeouts.delete(interactionId);

    // Check if evidence arrived in the meantime
    const current = liveInteractions.find((i) => i.interactionId === interactionId);
    if (!current || current.behavioralEvidence) return;

    // Build synthetic timeout evidence
    const timeoutEvidence: BehavioralEvidence = {
      sourceEventId: triggerEventId ?? interactionId,
      sourceEventType: current.triggerEvent?.eventType ?? 'unknown',
      windowId: `timeout-${interactionId}`,
      frameId: 'main',
      window: {
        openedAt: 0,
        closedAt: 0,
        durationMs: 0,
        endReason: 'evidence-timeout',
        stabilityTrace: [],
      },
      targetEvidence: {
        identity: null,
        identityCapturedAt: 0,
        before: null,
        after: null,
        focusMovement: null,
      },
      applicationEvidence: {
        domChanges: [],
        domChangeOverflow: 0,
        coarseMode: false,
        newSurfaces: [],
        removedSurfaces: [],
        visibilityChanges: [],
        navigation: [],
        networkActivity: [],
        performanceCondition: {
          mainThreadBlocked: false,
          highChurnMode: false,
          longestBatchMs: 0,
          totalBatches: 0,
        },
      },
    };

    current.behavioralEvidence = timeoutEvidence;
    persistLiveInteractions();

    // Broadcast the timeout evidence
    chrome.runtime.sendMessage({
      type: 'INTERACTION_EVIDENCE_UPDATE',
      payload: { interactionId, evidence: timeoutEvidence },
    }).catch(() => {
      // Side panel may not be open — ignore
    });
  }, EVIDENCE_TIMEOUT_MS);

  evidenceTimeouts.set(interactionId, handle);
}

/**
 * Cancel the evidence timeout for an interaction (evidence arrived).
 */
function cancelEvidenceTimeout(interactionId: string): void {
  const handle = evidenceTimeouts.get(interactionId);
  if (handle) {
    clearTimeout(handle);
    evidenceTimeouts.delete(interactionId);
  }
}

/**
 * Store incoming evidence in the pending map.
 * Called when evidence arrives but no matching interaction exists yet.
 */
export function storePendingEvidence(evidence: BehavioralEvidence): void {
  if (pendingEvidence.size >= MAX_PENDING_EVIDENCE) {
    const oldestKey = pendingEvidence.keys().next().value;
    if (oldestKey) {
      pendingEvidence.delete(oldestKey);
    }
  }
  pendingEvidence.set(evidence.sourceEventId, evidence);
}

/**
 * Attach evidence to a live interaction using two-tier matching.
 *
 * Tier 1: interaction.triggerEvent.eventId === sourceEventId (preferred)
 * Tier 2: interaction.memberEvents[].eventId === sourceEventId (fallback)
 *
 * First-write-only for full evidence: if interaction already has
 * behavioralEvidence, skip — UNLESS the incoming evidence only adds
 * networkActivity entries (late network re-check). In that case, merge
 * the new network entries into the existing evidence's networkActivity
 * array instead of dropping them.
 *
 * @returns interactionId if matched, null if no match.
 */
export function attachEvidenceToInteraction(
  sourceEventId: string,
  evidence: BehavioralEvidence,
): string | null {
  // Helper: check if incoming evidence is a network-only supplement
  const isNetworkSupplement = (incoming: BehavioralEvidence): boolean => {
    // A network supplement has minimal/no target evidence and carries
    // networkActivity entries. We detect it by checking if the window
    // endReason is 'stabilized' (normal) AND it has networkActivity entries
    // AND its targetEvidence has no real before/after state changes.
    return incoming.applicationEvidence?.networkActivity?.length > 0;
  };

  // Helper: merge network entries into existing evidence
  const mergeNetworkEvidence = (
    existing: BehavioralEvidence,
    incoming: BehavioralEvidence,
  ): BehavioralEvidence => {
    const existingUrls = new Set(
      (existing.applicationEvidence?.networkActivity ?? []).map((n) => `${n.method}:${n.url}`),
    );
    const newEntries = (incoming.applicationEvidence?.networkActivity ?? []).filter(
      (n) => !existingUrls.has(`${n.method}:${n.url}`),
    );
    if (newEntries.length === 0) return existing; // nothing new to merge

    return {
      ...existing,
      applicationEvidence: {
        ...existing.applicationEvidence,
        networkActivity: [
          ...(existing.applicationEvidence?.networkActivity ?? []),
          ...newEntries,
        ],
      },
    };
  };

  // Tier 1: trigger match
  for (const interaction of liveInteractions) {
    if (interaction.triggerEvent?.eventId === sourceEventId) {
      if (!interaction.behavioralEvidence) {
        interaction.behavioralEvidence = evidence;
        persistLiveInteractions();
        cancelEvidenceTimeout(interaction.interactionId);
      } else if (isNetworkSupplement(evidence)) {
        // P0-1 fix: merge late network evidence instead of dropping
        interaction.behavioralEvidence = mergeNetworkEvidence(
          interaction.behavioralEvidence,
          evidence,
        );
        persistLiveInteractions();
      }
      return interaction.interactionId;
    }
  }

  // Tier 2: member event match
  for (const interaction of liveInteractions) {
    if (interaction.memberEvents?.some((e) => e.eventId === sourceEventId)) {
      if (!interaction.behavioralEvidence) {
        interaction.behavioralEvidence = evidence;
        persistLiveInteractions();
        cancelEvidenceTimeout(interaction.interactionId);
      } else if (isNetworkSupplement(evidence)) {
        // P0-1 fix: merge late network evidence instead of dropping
        interaction.behavioralEvidence = mergeNetworkEvidence(
          interaction.behavioralEvidence,
          evidence,
        );
        persistLiveInteractions();
      }
      return interaction.interactionId;
    }
  }

  return null;
}

/**
 * Drain pending evidence for a newly emitted interaction.
 * Called from onEmit after the interaction is pushed to liveInteractions.
 *
 * Checks trigger and member events against pendingEvidence.
 * First-write-only: does not overwrite existing behavioralEvidence.
 */
function drainPendingEvidence(interaction: ComponentInteraction): void {
  if (interaction.behavioralEvidence) return;

  // Check trigger event
  const triggerId = interaction.triggerEvent?.eventId;
  if (triggerId && pendingEvidence.has(triggerId)) {
    interaction.behavioralEvidence = pendingEvidence.get(triggerId)!;
    pendingEvidence.delete(triggerId);
    return;
  }

  // Check member events
  for (const ev of interaction.memberEvents ?? []) {
    if (pendingEvidence.has(ev.eventId)) {
      interaction.behavioralEvidence = pendingEvidence.get(ev.eventId)!;
      pendingEvidence.delete(ev.eventId);
      return;
    }
  }
}

// ── Initialization ───────────────────────────────────────────────────

/**
 * Create or reset the runtime for a new recording session.
 */
export function initRecording(): void {
  liveInteractions = [];
  isRecording = true;
  evidenceLedger = new EvidenceLedger();
  lastVerificationResult = null;

  const config: RuntimeConfig = {
    onEmit: (interaction: ComponentInteraction) => {
      // Store IMMEDIATELY — no debounce, no timer
      // Bug 1 fix: debounce timer was killed by MV3 SW termination
      // before the Login button form-submit navigation
      enrichInteraction(interaction);
      drainPendingEvidence(interaction);
      liveInteractions.push(interaction);
      persistLiveInteractions();
      // P1-3: Start evidence timeout — if no evidence arrives within 5s,
      // the interaction gets synthetic timeout evidence so the side panel
      // shows "No evidence (timeout)" instead of "Collecting…" forever.
      if (!interaction.behavioralEvidence) {
        startEvidenceTimeout(interaction);
      }
    },
    evidenceLedger,
  };

  runtime = createRuntime(ALL_DEFINITIONS, config);

  // Persist recording state for MV3 recovery
  chrome.storage.local.set({ [RECORDING_ACTIVE_KEY]: true }).catch(() => {});
  persistLiveInteractions();
  persistEvidenceLedger();
}

/**
 * Stop recording: flush runtime, finalize interactions.
 *
 * M5: Returns the PROJECTED output — the Projection Engine merges completed
 * interactions with Unclassified interactions for unclaimed/pending ledger
 * entries. The runtime no longer emits Unclassified interactions directly.
 */
export function stopRecording(): ComponentInteraction[] {
  if (runtime) {
    const flushed = runtime.flush();
    liveInteractions.push(...flushed);
    persistLiveInteractions();

    // ── M5: Projection Engine is now authoritative ──────────────────
    // The Projection Engine merges completed interactions (from the runtime)
    // with Unclassified interactions for unclaimed/pending ledger entries.
    // This replaces the runtime's createUnclassifiedInteraction fallback.
      if (evidenceLedger) {
        const ledger = evidenceLedger;
        const projection = projectInteractions(ledger, liveInteractions);

      // M5 self-consistency check: every discrete event in the ledger
      // must be represented in the projected output (either by a completed
      // interaction or an Unclassified projection). This replaces the M4
      // runtime-vs-projection comparison, which is no longer meaningful
      // since the projection is authoritative (non-completed interactions
      // are intentionally excluded from the output).
      const ledgerEntries = ledger.getEntries();
      const representedIds = new Set<string>();
      for (const interaction of projection.interactions) {
        if (interaction.triggerEvent?.eventId) {
          representedIds.add(interaction.triggerEvent.eventId);
        }
        for (const ev of interaction.memberEvents ?? []) {
          representedIds.add(ev.eventId);
        }
        if (interaction.type === 'Unclassified' && interaction.metadata.eventId) {
          representedIds.add(interaction.metadata.eventId as string);
        }
      }
      const unrepresented = ledgerEntries
        .filter((e) => !representedIds.has(e.eventId))
        .map((e) => ({ eventId: e.eventId, eventType: e.eventType }));

      const verificationResult = {
        match: unrepresented.length === 0,
        differences: unrepresented.map((u) => ({
          kind: 'missing' as const,
          eventId: u.eventId,
          description: `Discrete ${u.eventType} event not represented in projection`,
          ledgerEntries: ledger.get(u.eventId) ? [ledger.get(u.eventId)!] : [],
        })),
        runtimeOutput: liveInteractions,
        projectedOutput: projection.interactions,
        ledgerSnapshot: ledger.snapshot(),
      };
      lastVerificationResult = verificationResult;

      if (!verificationResult.match) {
        console.error(formatVerificationReport(verificationResult));
      }

      chrome.storage.local.set({
        cmdrunner_verification_result: verificationResult,
      }).catch(() => {});

      isRecording = false;
      chrome.storage.local.set({ [RECORDING_ACTIVE_KEY]: false }).catch(() => {});

      // Return the projected output (authoritative)
      return projection.interactions;
    }
  }

  isRecording = false;
  chrome.storage.local.set({ [RECORDING_ACTIVE_KEY]: false }).catch(() => {});

  // Fallback: no ledger (shouldn't happen in production)
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

  // ── M4: Evidence Ledger — append BEFORE classification ────────
  // Capture guarantee: every discrete event enters the ledger before
  // the runtime classifies it. The ledger records the disposition.
  evidenceLedger?.append(event);

  const emitted = runtime.process(event);

  // Persist ledger on every event (INV-5: persisted on every disposition change).
  // Even if no interaction is emitted (e.g., absorbed by a lifecycle), the
  // ledger entry's disposition has changed from 'pending' to 'absorbed'.
  if (evidenceLedger) {
    persistEvidenceLedger();
  }

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
  evidenceLedger = null;
  lastVerificationResult = null;
  pendingEvidence.clear();
  // P1-3: Clear all evidence timeouts
  for (const handle of evidenceTimeouts.values()) {
    clearTimeout(handle);
  }
  evidenceTimeouts.clear();
  chrome.storage.local.remove([
    LIVE_INTERACTIONS_KEY,
    RUNTIME_SNAPSHOT_KEY,
    RECORDING_ACTIVE_KEY,
    EVIDENCE_LEDGER_KEY,
    'cmdrunner_verification_result',
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
      EVIDENCE_LEDGER_KEY,
    ]);

    const wasRecording = result[RECORDING_ACTIVE_KEY] === true;
    if (!wasRecording) return false;

    // Restore live interactions
    liveInteractions = result[LIVE_INTERACTIONS_KEY] ?? [];

    // Restore Evidence Ledger (triggers resetAbsorbedToUnclaimed)
    evidenceLedger = new EvidenceLedger();
    const ledgerEntries = result[EVIDENCE_LEDGER_KEY];
    if (ledgerEntries && Array.isArray(ledgerEntries)) {
      evidenceLedger.restore(ledgerEntries);
    }

    // Recreate runtime with restored ledger
    const config: RuntimeConfig = {
      onEmit: (interaction: ComponentInteraction) => {
        enrichInteraction(interaction);
        drainPendingEvidence(interaction);
        liveInteractions.push(interaction);
        persistLiveInteractions();
        if (!interaction.behavioralEvidence) {
          startEvidenceTimeout(interaction);
        }
      },
      evidenceLedger,
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

/**
 * Write Evidence Ledger to chrome.storage.local.
 * Called after disposition changes to survive MV3 SW restarts.
 */
function persistEvidenceLedger(): void {
  if (!evidenceLedger) return;
  const entries = evidenceLedger.snapshot();
  chrome.storage.local.set({
    [EVIDENCE_LEDGER_KEY]: entries,
  }).catch(() => {
    // Non-fatal
  });
}

/**
 * Get the last verification result (for testing / side-panel access).
 */
export function getVerificationResult(): VerificationResult | null {
  return lastVerificationResult;
}
