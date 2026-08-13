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
  ComponentContext,
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

// ── Evidence Timeout Tracking (Lifecycle-Driven Evidence v3.1) ───────
//
// Emergency safety net: if no behavioral evidence arrives for an interaction
// within EMERGENCY_TIMEOUT_MS, a synthetic minimal evidence is attached.
// This fires ONLY for genuinely broken states (content script crash, lost
// messages). In normal operation, FINALIZE_EVIDENCE drives evidence delivery
// within ~150ms of lifecycle completion, and this timeout never fires.
//
// It is NOT a user-facing timing limit — the user can take unlimited time
// to complete an interaction.

const EMERGENCY_TIMEOUT_MS = 300_000;

/** Map of interactionId → timeout handle for evidence timeouts. */
const evidenceTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Start the evidence timeout timer for a newly emitted interaction.
 * If no evidence arrives within EMERGENCY_TIMEOUT_MS, attaches synthetic
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
  }, EMERGENCY_TIMEOUT_MS);

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

// ── Lifecycle-Driven Evidence Messages (SW → CS) ────────────────────

/**
 * Send a LIFECYCLE_BOUND message to the content script when a new lifecycle
 * starts. The EvidenceCollector uses this to mark evidence windows as
 * lifecycle-bound (holdOpen), preventing premature closure.
 *
 * Sent via chrome.tabs.sendMessage to target the active tab's content script.
 */
function sendLifecycleBound(ctx: ComponentContext): void {
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      if (tabs.length === 0 || !tabs[0].id) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'LIFECYCLE_BOUND',
        payload: {
          lifecycleId: ctx.lifecycleId,
          triggerEventId: ctx.triggerEvent.eventId,
          interactionType: ctx.type,
        },
      }).catch(() => {
        // Content script may not be injected yet — non-fatal
      });
    })
    .catch(() => {
      // Tab query failed — non-fatal
    });
}

/**
 * Send a FINALIZE_EVIDENCE message to the content script when an interaction
 * lifecycle completes. The EvidenceCollector immediately finalizes evidence
 * for the matching window(s). This replaces the 5s timeout as the primary
 * evidence delivery mechanism.
 */
function sendFinalizeEvidence(interaction: ComponentInteraction): void {
  const eventIds: string[] = [];
  if (interaction.triggerEvent?.eventId) {
    eventIds.push(interaction.triggerEvent.eventId);
  }
  for (const ev of interaction.memberEvents ?? []) {
    if (ev.eventId && !eventIds.includes(ev.eventId)) {
      eventIds.push(ev.eventId);
    }
  }

  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      if (tabs.length === 0 || !tabs[0].id) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'FINALIZE_EVIDENCE',
        payload: {
          lifecycleId: interaction.lifecycleId,
          interactionId: interaction.interactionId,
          interactionType: interaction.type,
          eventIds,
          metadata: interaction.metadata ?? {},
          endState: interaction.endState,
          triggerIdentity: interaction.trigger ?? undefined,
        },
      }).catch(() => {
        // Content script may have been destroyed (navigation) — non-fatal
      });
    })
    .catch(() => {
      // Tab query failed — non-fatal
    });
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
 * Fix Round 5: Instead of first-write-only, now uses a richness-based
 * replacement policy. When the interaction already has evidence, the
 * incoming evidence REPLACES it if it has a higher richness score.
 * Network-only supplements still merge into the existing evidence.
 *
 * @returns interactionId if matched, null if no match.
 */
export function attachEvidenceToInteraction(
  sourceEventId: string,
  evidence: BehavioralEvidence,
): string | null {
  // Helper: check if incoming evidence is a network-only supplement
  const isNetworkSupplement = (incoming: BehavioralEvidence): boolean => {
    return incoming.applicationEvidence?.networkActivity?.length > 0 &&
      scoreEvidenceRichness(incoming) <= 2; // only network entries, no state changes
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

  // Helper: try to attach evidence to a specific interaction
  const tryAttach = (interaction: ComponentInteraction): boolean => {
    if (!interaction.behavioralEvidence) {
      // No existing evidence — attach directly
      interaction.behavioralEvidence = evidence;
      persistLiveInteractions();
      cancelEvidenceTimeout(interaction.interactionId);
      return true;
    }
    // Existing evidence — check if we should replace
    if (isNetworkSupplement(evidence)) {
      // Network-only supplement: merge into existing
      interaction.behavioralEvidence = mergeNetworkEvidence(
        interaction.behavioralEvidence,
        evidence,
      );
      persistLiveInteractions();
      return true;
    }
    // Fix Round 5: Replace if the new evidence is richer
    const existingScore = scoreEvidenceRichness(interaction.behavioralEvidence);
    const newScore = scoreEvidenceRichness(evidence);
    if (newScore > existingScore) {
      // But preserve any network activity from the existing evidence
      const preservedNetwork = interaction.behavioralEvidence.applicationEvidence?.networkActivity ?? [];
      const newNetwork = evidence.applicationEvidence?.networkActivity ?? [];
      const allUrls = new Set(preservedNetwork.map((n) => `${n.method}:${n.url}`));
      const merged = [
        ...preservedNetwork,
        ...newNetwork.filter((n) => !allUrls.has(`${n.method}:${n.url}`)),
      ];
      interaction.behavioralEvidence = {
        ...evidence,
        applicationEvidence: {
          ...evidence.applicationEvidence,
          networkActivity: merged,
        },
      };
      persistLiveInteractions();
      return true;
    }
    return false;
  };

  // Tier 1: trigger match
  for (const interaction of liveInteractions) {
    if (interaction.triggerEvent?.eventId === sourceEventId) {
      tryAttach(interaction);
      return interaction.interactionId;
    }
  }

  // Tier 2: member event match
  for (const interaction of liveInteractions) {
    if (interaction.memberEvents?.some((e) => e.eventId === sourceEventId)) {
      tryAttach(interaction);
      return interaction.interactionId;
    }
  }

  return null;
}

/**
 * Drain pending evidence for a newly emitted interaction.
 * Called from onEmit after the interaction is pushed to liveInteractions.
 *
 * Fix Round 5: Instead of returning the first match (which was always the
 * trigger event — typically a focus/click with an empty diff), now scans
 * ALL pending evidence for this interaction's events and picks the one
 * with the most behavioral state changes (richest diff).
 *
 * Evidence richness is measured by counting TargetEvidence diffs +
 * ApplicationEvidence entries. This ensures the typing/input evidence
 * (with real value changes) wins over the focus evidence (empty diff).
 */
function drainPendingEvidence(interaction: ComponentInteraction): void {
  if (interaction.behavioralEvidence) return;

  // Collect ALL pending evidence for this interaction's events
  const candidates: BehavioralEvidence[] = [];
  const matchedKeys: string[] = [];

  const triggerId = interaction.triggerEvent?.eventId;
  if (triggerId && pendingEvidence.has(triggerId)) {
    candidates.push(pendingEvidence.get(triggerId)!);
    matchedKeys.push(triggerId);
  }

  for (const ev of interaction.memberEvents ?? []) {
    if (pendingEvidence.has(ev.eventId)) {
      candidates.push(pendingEvidence.get(ev.eventId)!);
      matchedKeys.push(ev.eventId);
    }
  }

  if (candidates.length === 0) return;

  // Pick the richest evidence (most state changes)
  let best = candidates[0];
  let bestScore = scoreEvidenceRichness(best);
  for (let i = 1; i < candidates.length; i++) {
    const score = scoreEvidenceRichness(candidates[i]);
    if (score > bestScore) {
      best = candidates[i];
      bestScore = score;
    }
  }

  interaction.behavioralEvidence = best;

  // Clean up all matched pending entries
  for (const key of matchedKeys) {
    pendingEvidence.delete(key);
  }
}

/**
 * Score how much behavioral state change an evidence object captures.
 * Higher score = more meaningful evidence.
 *
 * Fix Round 5: Ensures evidence with real value/state diffs wins over
 * empty-diff evidence from focus/click/mousedown events.
 */
function scoreEvidenceRichness(evidence: BehavioralEvidence): number {
  let score = 0;
  const { targetEvidence: target, applicationEvidence: app } = evidence;

  // Target evidence diffs (most important — 10 pts each)
  if (target?.before && target?.after) {
    const b = target.before;
    const a = target.after;
    if (b.value !== a.value && (b.value !== null || a.value !== null)) score += 10;
    if (b.checked !== a.checked) score += 10;
    if (b.disabled !== a.disabled) score += 5;
    if (b.ariaExpanded !== a.ariaExpanded) score += 5;
    if (b.ariaChecked !== a.ariaChecked) score += 5;
    if (b.ariaPressed !== a.ariaPressed) score += 5;
    if (b.textContent !== a.textContent && (b.textContent || a.textContent)) score += 8;
    if (b.childCount !== a.childCount) score += 3;
    if (b.controlledValue !== a.controlledValue && (b.controlledValue !== null || a.controlledValue !== null)) score += 8;
    if (b.scrollTop !== a.scrollTop && (b.scrollTop !== null || a.scrollTop !== null)) score += 5;
    // Array comparisons
    if (b.selectedValues || a.selectedValues) {
      if (JSON.stringify(b.selectedValues) !== JSON.stringify(a.selectedValues)) score += 10;
    }
  }

  // Application evidence (1 pt each)
  if (app?.domChanges?.length) score += app.domChanges.length;
  if (app?.newSurfaces?.length) score += app.newSurfaces.length * 2;
  if (app?.removedSurfaces?.length) score += app.removedSurfaces.length * 2;
  if (app?.visibilityChanges?.length) score += app.visibilityChanges.length * 2;
  if (app?.navigation?.length) score += app.navigation.length * 3;
  if (app?.networkActivity?.length) score += app.networkActivity.length * 2;

  return score;
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

      // Lifecycle-Driven Evidence: tell the content script to finalize
      // evidence for this interaction NOW. This replaces the 5s timeout
      // as the primary evidence delivery mechanism.
      sendFinalizeEvidence(interaction);

      // Emergency safety net: if no evidence arrives within EMERGENCY_TIMEOUT_MS
      // (300s), attach synthetic evidence. This fires ONLY for broken states
      // (content script crash, lost messages) — NOT for slow user interactions.
      if (!interaction.behavioralEvidence) {
        startEvidenceTimeout(interaction);
      }
    },
    onLifecycleStart: (ctx) => {
      // Tell the content script that a new lifecycle has started so it can
      // bind evidence windows to this lifecycle.
      sendLifecycleBound(ctx);
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
