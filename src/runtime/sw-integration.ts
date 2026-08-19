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
import type { BehavioralEvidence, NetworkActivity } from '../shared/behavioral-evidence-types';
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

/**
 * M8.3: Storage key for pending evidence that arrived before its interaction
 * was emitted. Without this, MV3 SW restart permanently loses all pending evidence.
 */
export const PENDING_EVIDENCE_KEY = 'cmdrunner_pending_evidence';

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

// ── Evidence Persistence Dedup Guard (M8.5) ───────────────────────────
//
// Defense-in-depth: prevents redundant DB writes when persistBehavioralEvidence
// is called more than once within a recording cycle (e.g., double-stopRecording,
// SW restart recovery re-persisting recovered evidence).
//
// The DB layer (Dexie put by windowId) already guarantees exactly-once storage;
// this guard avoids the unnecessary write entirely, and provides a clean test
// surface for exactly-once behavior.

const persistedEvidenceWindowIds = new Set<string>();

/**
 * M8.5: Mark a set of windowIds as persisted. Called after evidence persistence
 * completes successfully.
 */
export function markEvidencePersisted(windowIds: string[]): void {
  for (const wid of windowIds) {
    persistedEvidenceWindowIds.add(wid);
  }
}

/**
 * M8.5: Filter interactions to only those whose evidence has not yet been
 * persisted in this recording cycle. Returns the subset safe to persist.
 * Interactions without behavioralEvidence are always excluded.
 */
export function filterUnpersistedEvidence(
  interactions: ComponentInteraction[],
): ComponentInteraction[] {
  return interactions.filter(
    (i) =>
      i.behavioralEvidence &&
      !persistedEvidenceWindowIds.has(i.behavioralEvidence.windowId),
  );
}

/**
 * M8.5: Clear the dedup guard. Called on initRecording and resetState.
 */
export function clearPersistedEvidenceGuard(): void {
  persistedEvidenceWindowIds.clear();
}

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
 *
 * M8.3: Also persists to chrome.storage.local (debounced) so pending evidence
 * survives MV3 SW restart. Without this, evidence in the pending map is
 * permanently lost when the SW is suspended.
 */
export function storePendingEvidence(evidence: BehavioralEvidence): void {
  if (pendingEvidence.size >= MAX_PENDING_EVIDENCE) {
    const oldestKey = pendingEvidence.keys().next().value;
    if (oldestKey) {
      pendingEvidence.delete(oldestKey);
    }
  }
  pendingEvidence.set(evidence.sourceEventId, evidence);
  persistPendingEvidence();
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
/**
 * G5-E (INV-F3): requestId-first network dedup. A Chrome requestId is
 * globally unique per request; two capture paths (content-script bridge
 * window evidence vs SW recovery rows) can deliver representations of
 * the SAME request. Duplicate rows are dropped by requestId when either
 * side carries one, falling back to method:url only when NEITHER does.
 */
export function mergeNetworkActivity(
  existing: NetworkActivity[],
  incoming: NetworkActivity[],
): NetworkActivity[] {
  const existingIds = new Set(
    existing.map((n) => n.requestId).filter((id): id is string => !!id),
  );
  const existingUrls = new Set(
    existing.map((n) => `${n.method}:${n.url}`),
  );
  const newEntries = incoming.filter((n) => {
    if (n.requestId && existingIds.has(n.requestId)) return false;
    if (!n.requestId && existingUrls.has(`${n.method}:${n.url}`)) return false;
    return true;
  });
  return [...existing, ...newEntries];
}

export function attachEvidenceToInteraction(
  sourceEventId: string,
  evidence: BehavioralEvidence,
): string | null {
  // Helper: check if incoming evidence is a network-only supplement.
  //
  // Structural classification (RCA 2026-08-18, network-supplement shape
  // guard): a supplement is evidence whose ONLY content is network rows —
  // no targetEvidence and every other application array empty. The previous
  // score-based check (`scoreEvidenceRichness(incoming) <= 2`) held only
  // while a supplement carried ≤1 network row (rows score ×2 each); a
  // request burst (iPhone add-to-cart: 34 late XHR/fetch completions →
  // score 68) escaped classification, fell into the richness-REPLACE
  // branch, and destroyed the real click evidence (supplements hardcode
  // targetEvidence: null — G3 scheduleLateNetworkReCollect). Shape does not
  // lie: a supplement is a supplement at 1 row or 120.
  const isNetworkSupplement = (incoming: BehavioralEvidence): boolean => {
    const app = incoming.applicationEvidence;
    return incoming.targetEvidence == null &&
      app != null &&
      app.networkActivity != null &&
      app.networkActivity.length > 0 &&
      (app.domChanges?.length ?? 0) === 0 &&
      (app.newSurfaces?.length ?? 0) === 0 &&
      (app.removedSurfaces?.length ?? 0) === 0 &&
      (app.visibilityChanges?.length ?? 0) === 0 &&
      (app.navigation?.length ?? 0) === 0 &&
      (app.resultingState?.items?.length ?? 0) === 0;
  };

  // Helper: merge network entries into existing evidence (G5-E dedup)
  const mergeNetworkEvidence = (
    existing: BehavioralEvidence,
    incoming: BehavioralEvidence,
  ): BehavioralEvidence => {
    const merged = mergeNetworkActivity(
      existing.applicationEvidence?.networkActivity ?? [],
      incoming.applicationEvidence?.networkActivity ?? [],
    );
    if (merged.length === (existing.applicationEvidence?.networkActivity ?? []).length) {
      return existing; // nothing new to merge
    }
    return {
      ...existing,
      applicationEvidence: {
        ...existing.applicationEvidence,
        networkActivity: merged,
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
    // Phase 3 Fix B2 — resulting-state replace: a full-shape evidence
    // carrying a resulting application state may replace a synthetic/
    // placeholder evidence that has none. This is how the destination
    // page's scan lands on the Navigation interaction: the placeholder
    // (page-reload-synthetic, no resultingState) is strictly less
    // informative than the real destination scan. Scoped tightly:
    //   - incoming MUST carry resultingState with ≥1 item AND a real
    //     targetEvidence (full-shape evidence only);
    //   - existing MUST carry none;
    //   - the 2026-08-18 shape-guard below is untouched and still holds
    //     absolutely — a null-target evidence never replaces a real
    //     target, in this clause or any other.
    const incomingRS = evidence.applicationEvidence?.resultingState;
    const existingRS = interaction.behavioralEvidence.applicationEvidence?.resultingState;
    if (
      !existingRS &&
      incomingRS != null &&
      (incomingRS.items?.length ?? 0) > 0 &&
      evidence.targetEvidence != null
    ) {
      interaction.behavioralEvidence = {
        ...evidence,
        applicationEvidence: {
          ...evidence.applicationEvidence,
          // G5-E: carry over any network rows the placeholder had
          networkActivity: mergeNetworkActivity(
            interaction.behavioralEvidence.applicationEvidence?.networkActivity ?? [],
            evidence.applicationEvidence?.networkActivity ?? [],
          ),
        },
      };
      persistLiveInteractions();
      return true;
    }
    // Fix Round 5: Replace if the new evidence is richer
    // Shape-guard (2026-08-18 RCA): an incoming evidence with NO target
    // evidence must never replace an existing evidence that HAS one — no
    // matter its raw richness score. Synthetic/derived producers (G3
    // network supplements, network-only drains) legitimately carry
    // targetEvidence: null; letting them win on score destroys the captured
    // element identity, before/after state, and the real window shape.
    if (
      evidence.targetEvidence == null &&
      interaction.behavioralEvidence.targetEvidence != null
    ) {
      return false;
    }
    const existingScore = scoreEvidenceRichness(interaction.behavioralEvidence);
    const newScore = scoreEvidenceRichness(evidence);
    if (newScore > existingScore) {
      // But preserve any network activity from the existing evidence
      // (G5-E: requestId-first dedup across both capture paths)
      const merged = mergeNetworkActivity(
        interaction.behavioralEvidence.applicationEvidence?.networkActivity ?? [],
        evidence.applicationEvidence?.networkActivity ?? [],
      );
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

  // Phase 3 Fix B1 — destination-evidence navigation routing.
  //
  // Real-Chrome S2 RCA: the destination page's post-nav window delivers
  // evidence whose sourceEventId is the PRE-NAVIGATION trigger (the
  // submit/click that caused the navigation — the destination content
  // script receives the capture record keyed to the source event). Tier-1
  // routing therefore targets the CLICK interaction, where the evidence
  // loses (shape-guard correctly protects the click's real evidence) and
  // the Navigation interaction strands with the thin synthetic
  // placeholder — the resulting application state of the destination page
  // is recorded but never consumed.
  //
  // Routing rule (generic, INV-CS1-safe): when the incoming evidence
  // carries a navigation entry (the post-nav producer re-seeds it from
  // the capture record) AND a Navigation-type interaction is among the
  // tier-1/2 candidates, attach there instead. The click keeps its own
  // evidence and its own window — Click and Navigation stay separate.
  const isDestinationEvidence =
    (evidence.applicationEvidence?.navigation?.length ?? 0) > 0;
  const isNavigationInteraction = (i: ComponentInteraction): boolean =>
    i.type === 'Navigation';

  // Tier 1: trigger match
  const tier1 = liveInteractions.filter(
    (i) => i.triggerEvent?.eventId === sourceEventId,
  );
  if (tier1.length > 0) {
    // Destination-evidence nav preference: try the Navigation candidate
    // first, but keep the original return contract — the first tier match's
    // interactionId is returned regardless of tryAttach's outcome (callers
    // treat null as "no matching interaction → store pending").
    if (isDestinationEvidence) {
      const nav = tier1.find(isNavigationInteraction);
      if (nav) {
        tryAttach(nav);
        return nav.interactionId;
      }
    }
    tryAttach(tier1[0]);
    return tier1[0].interactionId;
  }

  // Tier 2: member event match
  const tier2 = liveInteractions.filter((i) =>
    i.memberEvents?.some((e) => e.eventId === sourceEventId),
  );
  if (tier2.length > 0) {
    if (isDestinationEvidence) {
      const nav = tier2.find(isNavigationInteraction);
      if (nav) {
        tryAttach(nav);
        return nav.interactionId;
      }
    }
    tryAttach(tier2[0]);
    return tier2[0].interactionId;
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
function drainPendingEvidence(interaction: ComponentInteraction): void {  if (interaction.behavioralEvidence) return;

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

  // M8.3: Clear any stale pending evidence from a previous session.
  // This covers the edge case where a new recording starts before
  // resetState was called (e.g., immediate re-record after stop).
  pendingEvidence.clear();
  if (pendingEvidenceFlushTimer) {
    clearTimeout(pendingEvidenceFlushTimer);
    pendingEvidenceFlushTimer = null;
  }
  // M8.5: Clear the evidence persistence dedup guard for the new cycle.
  clearPersistedEvidenceGuard();
  // Clear stale persisted pending evidence from storage
  chrome.storage.local.remove(PENDING_EVIDENCE_KEY).catch(() => {});

  const config: RuntimeConfig = {
    onEmit: (interaction: ComponentInteraction) => {
      // Store IMMEDIATELY — no debounce, no timer
      // Bug 1 fix: debounce timer was killed by MV3 SW termination
      // before the Login button form-submit navigation
      enrichInteraction(interaction);
      // G4-B: propagate the capture origin (tab/frame) from the trigger
      // event onto the interaction metadata so every downstream join
      // (ledger, drain, panel) can use the triple key.
      const origin = interaction.triggerEvent?.captureOrigin;
      if (origin) {
        interaction.metadata.captureOrigin = { ...origin };
      }
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
 *
 * M8.3: Also clears persisted pending evidence and the debounce timer.
 */
export function resetState(): void {
  liveInteractions = [];
  runtime = null;
  isRecording = false;
  evidenceLedger = null;
  lastVerificationResult = null;
  // M8.5: Clear the evidence persistence dedup guard.
  clearPersistedEvidenceGuard();
  pendingEvidence.clear();
  if (pendingEvidenceFlushTimer) {
    clearTimeout(pendingEvidenceFlushTimer);
    pendingEvidenceFlushTimer = null;
  }
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
    PENDING_EVIDENCE_KEY,
    'cmdrunner_verification_result',
  ]).catch(() => {});
}

// ── MV3 Recovery ─────────────────────────────────────────────────────

/**
 * Restore state after MV3 service worker restart.
 * Reads live interactions, runtime snapshot, evidence ledger, and pending
 * evidence from chrome.storage.local.
 *
 * M8.3: Now also restores:
 *   - Pending evidence (previously lost permanently on SW restart)
 *   - Evidence timeout timers for interactions lacking evidence
 *   - Lifecycle bridge callbacks (onLifecycleStart + sendFinalizeEvidence
 *     were missing from the restored config — a latent bug)
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
      PENDING_EVIDENCE_KEY,
    ]);

    const wasRecording = result[RECORDING_ACTIVE_KEY] === true;
    if (!wasRecording) return false;

    // Restore live interactions
    liveInteractions = result[LIVE_INTERACTIONS_KEY] ?? [];

    // M8.3: Restore pending evidence (previously lost on SW restart)
    const persistedPending = result[PENDING_EVIDENCE_KEY];
    if (Array.isArray(persistedPending)) {
      for (const [key, evidence] of persistedPending) {
        if (pendingEvidence.size < MAX_PENDING_EVIDENCE) {
          pendingEvidence.set(key, evidence);
        }
      }
    }

    // Restore Evidence Ledger (triggers resetAbsorbedToUnclaimed)
    evidenceLedger = new EvidenceLedger();
    const ledgerEntries = result[EVIDENCE_LEDGER_KEY];
    if (ledgerEntries && Array.isArray(ledgerEntries)) {
      evidenceLedger.restore(ledgerEntries);
    }

    // Recreate runtime with restored ledger.
    //
    // M8.3: The restored config now matches initRecording() exactly —
    // includes onLifecycleStart (for LIFECYCLE_BOUND) and sendFinalizeEvidence
    // in onEmit (for FINALIZE_EVIDENCE). Previously these were missing,
    // breaking the lifecycle bridge after SW restart.
    const config: RuntimeConfig = {
      onEmit: (interaction: ComponentInteraction) => {
        enrichInteraction(interaction);
        // G4-B: capture-origin propagation (same as initRecording config).
        const origin = interaction.triggerEvent?.captureOrigin;
        if (origin) {
          interaction.metadata.captureOrigin = { ...origin };
        }
        drainPendingEvidence(interaction);
        liveInteractions.push(interaction);
        persistLiveInteractions();

        // Lifecycle-Driven Evidence: tell the content script to finalize
        sendFinalizeEvidence(interaction);

        if (!interaction.behavioralEvidence) {
          startEvidenceTimeout(interaction);
        }
      },
      onLifecycleStart: (ctx) => {
        sendLifecycleBound(ctx);
      },
      evidenceLedger,
    };
    runtime = createRuntime(ALL_DEFINITIONS, config);

    // Restore snapshot (interaction counter, seen events, dedup state)
    const snapshot = result[RUNTIME_SNAPSHOT_KEY];
    if (snapshot) {
      runtime.restore(snapshot);
    }

    // M8.3: Reconstruct evidence timeout timers for interactions that
    // still lack behavioralEvidence. Without this, restored interactions
    // that lost their SW between emit and evidence delivery will NEVER
    // receive their emergency timeout evidence.
    for (const interaction of liveInteractions) {
      if (!interaction.behavioralEvidence) {
        startEvidenceTimeout(interaction);
      }
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
 * Exported for the SW's attach paths (persist-before-ack contract).
 *
 * Returns the persist promise resolving to true when the write landed:
 * delete-after-persist call sites MUST chain `ledger.acknowledgePersisted()`
 * onto a TRUE result — never call ack synchronously on the next line (the
 * durable delete could beat the LIVE_INTERACTIONS write) and never ack on a
 * failed persist (the durable entry must survive for boot reconciliation).
 * A failed persist resolves to false, never rejects.
 */
export function persistLiveInteractions(): Promise<boolean> {
  return chrome.storage.local
    .set({ [LIVE_INTERACTIONS_KEY]: liveInteractions })
    .then(
      () => true,
      () => {
        // Storage may be full or SW terminating — non-fatal, but ack callers
        // must NOT delete the durable ledger on this path.
        return false;
      },
    );
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
 * M8.3: Write pending evidence to chrome.storage.local.
 * Debounced (PENDING_EVIDENCE_FLUSH_MS) to avoid excessive writes on
 * high-churn apps. The Map is capped at MAX_PENDING_EVIDENCE (100),
 * so worst case is 100 entries per session.
 */
const PENDING_EVIDENCE_FLUSH_MS = 500;
let pendingEvidenceFlushTimer: ReturnType<typeof setTimeout> | null = null;

function persistPendingEvidence(): void {
  if (pendingEvidenceFlushTimer) clearTimeout(pendingEvidenceFlushTimer);
  pendingEvidenceFlushTimer = setTimeout(() => {
    pendingEvidenceFlushTimer = null;
    const entries = Array.from(pendingEvidence.entries());
    chrome.storage.local.set({
      [PENDING_EVIDENCE_KEY]: entries,
    }).catch(() => {
      // Non-fatal
    });
  }, PENDING_EVIDENCE_FLUSH_MS);
}

/**
 * Get the last verification result (for testing / side-panel access).
 */
export function getVerificationResult(): VerificationResult | null {
  return lastVerificationResult;
}
