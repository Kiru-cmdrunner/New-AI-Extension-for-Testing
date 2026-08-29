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
import { elementKey } from '../definitions/patterns';
// 7.4-B6.1 tier C: the ONE canonical terminal-Enter derivation shared with
// the TextEntry definition (audit m-1) — tier N (nav-flush hook) and tier C
// (STOP rescue) must recognize the Enter through the same pure function.
import { terminalEnterMemberOf } from '../definitions/text-entry';
import type { ElementIdentity } from '../shared/types';
import type { DomContext } from '../shared/component-types';
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

/**
 * RCA2 (2026-08-20): true between stopRecording() and the next
 * initRecording()/resetState(). While stopped, late evidence deliveries
 * (form-submit recovery, destination windows) may still attach to
 * interactions — but persistLiveInteractions must NOT overwrite
 * StorageKeys.LIVE_INTERACTIONS, which handleStopRecording has replaced
 * with the authoritative PROJECTED production list. Before this guard, a
 * post-stop BEHAVIORAL_EVIDENCE delivery re-persisted the RAW array and
 * silently erased the projected Unclassified cards (Round Trip /
 * Premium Economy vanishing from the panel). Attach still mutates the
 * interaction objects in place (same object identity as the production
 * list when possible); only the storage overwrite is suppressed.
 */
let recordingStopped = false;
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

// ── 7.4-B3 S3: typed-text episode tracker ───────────────────────────
//
// F3 channel: input events claimed by NO lifecycle (extension loaded after
// focus, recording started mid-focus, content-script race). The runtime
// sees the input events but no TextEntry lifecycle exists → the episode
// is invisible: no interaction, no ledger entry, no Unclassified card.
//
// The tracker accumulates such episodes per element and, when the SAME
// element blurs, mints exactly ONE synthetic ledger entry (eventType
// 'change', terminal valueAfter) via ledger.appendSynthetic. Projection
// then surfaces it as an Unclassified card (physicalEventType 'change')
// — the honest artifact: the user typed 'hotel' here and we never
// classified it. Raw input events stay un-stored (R1); only this
// curated terminal sample crosses the boundary.
//
// Episodic, bounded state (cleared in resetState; deliberately NOT
// persisted — an MV3 death mid-episode drops at most one episode's
// trace, same class of accepted cost as the S2 post-restart fold
// degradation).

interface TypedTextEpisode {
  elementKey: string;
  target: ElementIdentity;
  domContext: DomContext;
  pageId: string;
  lastValueAfter: string;
  lastInputEventId: string;
  lastInputCaptureSeq: number;
  lastTimestamp: number;
}
const typedTextEpisodes = new Map<string, TypedTextEpisode>();
/** Synthetic entryIds minted so far this session (dedup + id stability). */
const syntheticMinted = new Set<string>();
/**
 * Monotonic counter for synthetic entryIds. MUST stay far above any real
 * captureSeq-derived eventId counter on the same page so synthetic ids
 * never collide with raw event ids (page ids are per-tab-session).
 */
let syntheticCounter = 1_000_000_000;

function typedTextKey(target: ElementIdentity): string {
  return elementKey(target);
}

/**
 * S3: observe every post-classification emission. An input event with NO
 * emitted interaction is an unclaimed typing episode data point; a blur on
 * a tracked element closes the episode and mints the synthetic sample.
 */
function trackTypedTextEpisode(
  event: ObservedEvent,
  emitted: ComponentInteraction[],
  runtime: ComponentRuntime,
): void {
  if (event.eventType === 'input' && event.valueAfter != null) {
    // A tracked episode is only unclaimed if no lifecycle absorbed/emitted
    // for it. `emitted.length === 0` is the SW-visible signal; a lifecycle
    // mid-flight that has not emitted yet must NOT be tracked either, so
    // we additionally require that no live lifecycle owns this element.
    const claimed = hasLiveLifecycleOnElement(runtime, event.target);
    if (!claimed && emitted.length === 0) {
      typedTextEpisodes.set(typedTextKey(event.target), {
        elementKey: typedTextKey(event.target),
        target: event.target,
        domContext: event.domContext,
        pageId: extractPageIdSafe(event.eventId),
        lastValueAfter: event.valueAfter,
        lastInputEventId: event.eventId,
        lastInputCaptureSeq: event.captureSeq,
        lastTimestamp: event.timestamp,
      });
    } else {
      // A lifecycle claimed THIS input → the element is being tracked by a
      // definition; drop any stale unclaimed-episode record for it.
      typedTextEpisodes.delete(typedTextKey(event.target));
    }
    return;
  }

  if (event.eventType === 'blur') {
    const key = typedTextKey(event.target);
    const episode = typedTextEpisodes.get(key);
    if (!episode) return;
    typedTextEpisodes.delete(key);
    mintTypedTextSample(episode, event);
  }
}

/**
 * S3: mint the synthetic 'change' ledger entry for a closed episode.
 * The entry persists → projects → surfaces as an Unclassified card.
 */
function mintTypedTextSample(episode: TypedTextEpisode, blurEvent: ObservedEvent): void {
  // blurEvent supplies only the pageUrl/pageTitle of the blur context; the
  // sample's timestamp/captureSeq come from the episode's last input (see
  // the captureSeq comment below).
  if (!evidenceLedger) return;
  // S3 RCA (reviewer Critical #1): the synthetic entry's eventId must keep
  // the ledger's pageId extraction and ordering intact. An intermediate
  // `-syn-` broke extractPageId's `^evt-(.+)-\d+$` greedy match (pageId
  // came out as `{pageId}-syn-…`, sorting the entry AFTER every real entry
  // of that page), which made the S2 twin scan break on it before reaching
  // the real pending mousedown twin — resurrecting the half-card the fold
  // is supposed to suppress. Keep the canonical `evt-{pageId}-{counter}`
  // shape: pageId parses correctly, captureSeq keeps blur order, and
  // appendSynthetic still marks synthetic=true for M5 self-consistency.
  const entryId = `evt-${episode.pageId}-${syntheticCounter++}`;
  if (syntheticMinted.has(entryId)) return;
  syntheticMinted.add(entryId);

  evidenceLedger.appendSynthetic({
    eventId: entryId,
    eventType: 'change' as any,
    // Position at the LAST INPUT of the episode, not the blur. The blur can
    // fire between another element's mousedown and its click (mousedown
    // moves focus → blur → click); positioning on the blur wedges the
    // sample between that gesture's halves and breaks pairPhysicalPress
    // adjacency (two BODY cards instead of one). The value belongs to the
    // typing, so it sorts at the episode's own end.
    timestamp: episode.lastTimestamp,
    captureSeq: episode.lastInputCaptureSeq,
    isTrusted: true, // minted from trusted input events; the sample is curated, not synthetic user input
    target: episode.target,
    domContext: episode.domContext,
    valueBefore: null,
    valueAfter: episode.lastValueAfter,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: blurEvent.pageUrl,
    pageTitle: blurEvent.pageTitle,
  });
  persistEvidenceLedger();
}

/** S3 helper: pageId from an eventId, '' when malformed. */
function extractPageIdSafe(eventId: string): string {
  const m = /^evt-(.+?)-\d+$/.exec(eventId);
  return m ? m[1] : '';
}

/**
 * S3 helper: does any live lifecycle own THIS element right now?
 * A mid-flight TextEntry (or any definition tracking this element) makes
 * the typing episode claimed — no synthetic sample may be minted.
 */
function hasLiveLifecycleOnElement(
  runtime: ComponentRuntime,
  target: ElementIdentity,
): boolean {
  const live = runtime.getLiveLifecycles();
  const key = elementKey(target);
  return live.some(
    (lc: { trigger?: unknown }) => elementKey(lc.trigger as ElementIdentity) === key,
  );
}

/**
 * 7.4-B3 S5: compute the actionabilityEvidence presentation flag on a
 * projected Unclassified card, post evidence join.
 *
 * Deterministic shape check over recorded facts — the badge may claim
 * "app responded — DOM change in click window", never causation.
 */
function computeActionabilityEvidence(interaction: ComponentInteraction): void {
  const evidence = interaction.behavioralEvidence ?? undefined;
  if (!evidence) {
    interaction.metadata.actionabilityEvidence = false;
    return;
  }
  const app = evidence.applicationEvidence;
  const cardEventId = interaction.triggerEvent?.eventId
    ?? (interaction.metadata?.eventId as string | undefined)
    ?? null;
  const networkMatch = app.networkActivity.some(
    (n) => cardEventId !== null && n.sourceEventId === cardEventId,
  );
  interaction.metadata.actionabilityEvidence = Boolean(
    app.domChanges.length > 0 ||
    app.newSurfaces.length + app.removedSurfaces.length > 0 ||
    app.visibilityChanges.length > 0 ||
    app.navigation.length > 0 ||
    networkMatch,
  );
}

/**
 * 7.4-B3 S1: key-set snapshot taken after each STOP-time drain so the
 * drain block can detect whether any keys were actually removed and
 * persist exactly once per STOP (R9: no write storm, no double persist).
 */
let drainGuardRef: Set<string> | null = null;

/** 7.4-B3 S1: set equality for the drain persist guard. */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

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
  // B7-P2: route to the lifecycle's OWN capture-origin tab. The active-tab
  // query missed whenever the recording tab was not focused (sidepanel in
  // another tab/window, multi-tab recording) — the binding then never
  // arrived and the window lived until STOP (R-2 held-open), delivering
  // evidence too late for the interaction's evidence attach.
  const origin = ctx.triggerEvent?.captureOrigin as { tabId?: number } | undefined;
  const send = (tabId: number) => {
    chrome.tabs.sendMessage(tabId, {
      type: 'LIFECYCLE_BOUND',
      payload: {
        lifecycleId: ctx.lifecycleId,
        triggerEventId: ctx.triggerEvent.eventId,
        interactionType: ctx.type,
      },
    }).catch(() => {
      // Content script may not be injected yet — non-fatal
    });
  };
  if (typeof origin?.tabId === 'number') {
    send(origin.tabId);
  } else {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        if (tabs.length === 0 || !tabs[0].id) return;
        send(tabs[0].id);
      })
      .catch(() => {
        // Tab query failed — non-fatal
      });
  }
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

  // B7-P2: route to the interaction's OWN capture-origin tab (same fix as
  // sendLifecycleBound). captureOrigin was stamped on the trigger event by
  // the SW dispatcher (G4-B) and propagated onto metadata (onEmit) — the
  // metadata copy is the durable form; the triggerEvent is the source.
  const origin = (interaction.metadata?.captureOrigin ??
    interaction.triggerEvent?.captureOrigin) as { tabId?: number } | undefined;
  const send = (tabId: number) => {
    chrome.tabs.sendMessage(tabId, {
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
  };
  if (typeof origin?.tabId === 'number') {
    send(origin.tabId);
  } else {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        if (tabs.length === 0 || !tabs[0].id) return;
        send(tabs[0].id);
      })
      .catch(() => {
        // Tab query failed — non-fatal
      });
  }
}

/**
 * RCA fix (stale-lifecycleBindings leak, 2026-08-25):
 * A dedup-folded lifecycle never emits, so the FINALIZE_EVIDENCE that would
 * release its EvidenceCollector binding never fires. A stale binding then
 * holds every LATER window open (openWindow checks
 * lifecycleBindings.size > 0), deferring its evidence to STOP force-close —
 * after the S1 drain — which silently stranded dismissal-click evidence
 * (E2E check C3 in harness-74b3.mjs).
 *
 * This helper sends FINALIZE_EVIDENCE for the suppressed lifecycle itself:
 * the collector releases the binding keyed by the suppressed lifecycleId,
 * and the eventIds (suppressed lifecycle's own events) attribute the
 * windows to the PRIOR interaction — the fold owner. Same payload shape
 * as sendFinalizeEvidence.
 */
function sendFinalizeForSuppressedLifecycle(
  ctx: ComponentContext,
  prior: ComponentInteraction,
): void {
  const eventIds: string[] = [];
  if (ctx.triggerEvent?.eventId) {
    eventIds.push(ctx.triggerEvent.eventId);
  }
  for (const ev of ctx.memberEvents ?? []) {
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
          lifecycleId: ctx.lifecycleId,
          interactionId: prior.interactionId,
          interactionType: prior.type,
          eventIds,
          metadata: prior.metadata ?? {},
          endState: prior.endState,
          triggerIdentity: prior.trigger ?? undefined,
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
    /**
     * B7-P4 provenance-regression amendment (C-2, 2026-08-29): replacement
     * must never strip a delivered `window.openedBatch`. The ordinal is the
     * ownership boundary rule (b) consumes in the shared ownership pass; a
     * richer-but-ordinal-less incoming window (late network display
     * supplement, synthetic re-delivery, any future thinner shape) carrying
     * over the existing boundary preserves the fact-granularity guard for
     * exactly the interactions that need it. Carried forward ONLY when the
     * incoming window lacks the field — an incoming window WITH its own
     * ordinal is authoritative for its own facts (it was stamped at its own
     * open/click instant).
     */
    const carryOrdinal = (incoming: BehavioralEvidence): BehavioralEvidence =>
      interaction.behavioralEvidence?.window?.openedBatch !== undefined &&
      incoming.window?.openedBatch === undefined
        ? {
            ...incoming,
            window: {
              ...incoming.window,
              openedBatch: interaction.behavioralEvidence.window.openedBatch,
            },
          }
        : incoming;

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
        ...carryOrdinal(evidence),
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
      // (G5-E: requestId-first dedup across both capture paths) — and the
      // ownership boundary (C-2), per carryOrdinal above.
      const merged = mergeNetworkActivity(
        interaction.behavioralEvidence.applicationEvidence?.networkActivity ?? [],
        evidence.applicationEvidence?.networkActivity ?? [],
      );
      const replacement = carryOrdinal(evidence);
      interaction.behavioralEvidence = {
        ...replacement,
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
  // RCA2: a new recording session re-arms raw-list persistence.
  recordingStopped = false;
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
  // 7.4-B3 S1: reset the STOP-drain persist guard.
  drainGuardRef = null;
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
    onDedupFold: (prior, suppressedCtx) => {
      // 7.4-B3 S2: the fold mutated the PRIOR interaction (memberEvents +
      // repeatCount). Persist so the fold survives MV3 death (INV-5 parity:
      // disposition changes already persist per-event via the ledger).
      // persistLiveInteractions is guarded (returns false once stopped) —
      // no clobber of the projected production list at STOP.
      void persistLiveInteractions();
      // RCA (stale-lifecyclebindings leak, 2026-08-25): a folded lifecycle
      // never emits, so the FINALIZE_EVIDENCE that would release its
      // EvidenceCollector binding never fires. A stale binding then holds
      // every LATER window open (openWindow checks
      // lifecycleBindings.size > 0), deferring its evidence to STOP
      // force-close — after the S1 drain — which silently stranded
      // dismissal-click evidence (E2E C3). Send the finalize for the
      // SUPPRESSED lifecycle so the binding is released immediately.
      sendFinalizeForSuppressedLifecycle(suppressedCtx, prior);
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
  // RCA2: mark stopped FIRST — the flush below emits through onEmit, and any
  // persistLiveInteractions call from that path (or from late evidence
  // deliveries afterwards) must not clobber the projected production list
  // that handleStopRecording writes to storage.
  recordingStopped = true;
  if (runtime) {
    // Flush active lifecycles. NOTE (S1'/RCA2 2026-08-20): flush() emits each
    // interaction through config.onEmit, and onEmit already pushes into
    // liveInteractions — the previous `liveInteractions.push(...flushed)`
    // here was a second push of the SAME objects (exact-once violation)
    // that duplicated interrupted lifecycles in the persisted raw list.
    // flush()'s return value remains the authoritative emitted list for
    // callers that want it; we deliberately do NOT push it again.
    runtime.flush();
    persistLiveInteractions();

    // ── 7.4-B6.1 tier C: form-less Enter commit reconciliation ──────
    // Rescue STOP-interrupted form-less Enter TextEntries whose commit is
    // proven by recorded application effects (exact network join + one
    // corroboration class). Runs AFTER flush (the interruptions exist) and
    // BEFORE projection (rescued interactions suppress their Unclassified
    // twins via the normal coveredEventIds path — C-1, no ledger rewrite).
    liveInteractions = reconcileFormlessEnterCommits(
      liveInteractions,
      collectStopNetworkRows(),
    );
    persistLiveInteractions();

    // ── M5: Projection Engine is now authoritative ──────────────────
    // The Projection Engine merges completed interactions (from the runtime)
    // with Unclassified interactions for unclaimed/pending ledger entries.
    // This replaces the runtime's createUnclassifiedInteraction fallback.
      if (evidenceLedger) {
        const ledger = evidenceLedger;
        const projection = projectInteractions(ledger, liveInteractions);

        // ── LP2 (S6): enrich projected Unclassified cards ─────────────
        // Runtime-emitted interactions are enriched in onEmit (above), but
        // the projection path never called enrichInteraction — projected
        // cards entered storage without Layer-2 componentType / Layer-3
        // businessMeaning even when their persisted ancestor context (LP3)
        // could support it. Enrich ONLY the projected Unclassified cards:
        //   - recognized runtime interactions are already enriched there;
        //   - re-running enrichment on them could overwrite computed fields.
        // This changes presentation metadata only — type stays
        // 'Unclassified', so NOISE_TYPES keeps excluding these cards from
        // the IR (no fabricated steps; the honesty invariant holds).
        // Legacy ledger rows restore ancestor context to null → [] via LP3,
        // so detectComponent degrades to its no-ancestry behaviour.
        //
        // ── 7.4-B3 S1: projection evidence join ─────────────────────────
        // Projected Unclassified cards are minted AFTER all emission, so
        // the onEmit-time drainPendingEvidence never ran for them — even
        // when pendingEvidence holds a consequence-bearing window keyed to
        // their exact triggerEvent.eventId (F2: verified 0-for-N across
        // every dump with Unclassified cards). Drain here, with the same
        // semantics (richest wins, guard on existing evidence, delete
        // drained keys, persist once).
        for (const interaction of projection.interactions) {
          if (interaction.type === 'Unclassified') {
            drainPendingEvidence(interaction);
          }
        }
        // Persist exactly once when the drain removed keys. Compare the
        // post-drain key set against the pre-STOP snapshot.
        const postDrainKeys = new Set(pendingEvidence.keys());
        if (drainGuardRef === null || !setsEqual(drainGuardRef, postDrainKeys)) {
          void persistPendingEvidence();
        }
        drainGuardRef = postDrainKeys;
        for (const interaction of projection.interactions) {
          if (interaction.type === 'Unclassified') {
            enrichInteraction(interaction);
            // ── 7.4-B3 S5: actionabilityEvidence flag ──────────────────
            // Pure shape check over the (now-joined) evidence: did the
            // application demonstrably respond in this event's window?
            // Presentation metadata ONLY — no type change, no IR change,
            // no KR signature change (metadata is not hashed into
            // signatureKey). INV-APP-1 preserved: the flag asserts a
            // change OCCURRED IN THE WINDOW, never causality.
            computeActionabilityEvidence(interaction);
          }
        }

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
 * 7.4-B6.1 tier C — STOP-time reconciliation of form-less Enter commits.
 *
 * Spec: .drytis/specs/phase-7-4-b6-1-formless-spa-enter-commit.md §4.3, §5.2.
 *
 * A TextEntry interrupted by the STOP flush is rescued to 'completed' ONLY
 * when BOTH recorded effects exist:
 *   E-C1 — a network row stamped exactly to the terminal Enter's eventId
 *          (the Enter keydown is the only primary-class keydown, so an
 *          app-initiated fetch rides this stamp);
 *   E-C2 — one corroboration class from the interaction's own evidence:
 *          viewConfirmation | notificationSurfaceChange | fieldRemoval.
 *
 * Purity: reads only recorded data (memberEvents, metadata, behavioral
 * evidence, the injected network rows). Never re-runs detection, never
 * touches the ledger (C-1: rescued interactions suppress their Unclassified
 * twins through the projection's coveredEventIds path), never reorders.
 *
 * Returns a NEW array; input interactions are never mutated in place.
 */

/** Minimal network-row shape tier C needs (satisfied by CompletedWebRequest). */
export interface TierCNetworkRow {
  requestId: string;
  sourceEventId?: string;
}

/** STOP-time collector: completed requests that carry a stamp. Overridden in tests. */
let collectStopNetworkRows: () => TierCNetworkRow[] = () => [];

/** Test seam: inject a row collector (default: none — SW wires the real one). */
export function setTierCNetworkRowCollector(fn: () => TierCNetworkRow[]): void {
  collectStopNetworkRows = fn;
}

export function reconcileFormlessEnterCommits(
  interactions: ComponentInteraction[],
  networkRows: TierCNetworkRow[],
): ComponentInteraction[] {
  // Index rows by their exact stamp — one lookup per candidate.
  const rowsByStamp = new Map<string, TierCNetworkRow[]>();
  for (const row of networkRows) {
    if (!row.sourceEventId) continue;
    const list = rowsByStamp.get(row.sourceEventId);
    if (list) list.push(row);
    else rowsByStamp.set(row.sourceEventId, [row]);
  }

  return interactions.map((interaction) => {
    if (interaction.type !== 'TextEntry') return interaction;
    if (interaction.endState !== 'interrupted') return interaction;
    // Already committed (tier N at nav flush; B6 submit) — untouchable.
    if (interaction.metadata?.['commitSignal']) return interaction;

    // P1 — form-less (owner-form join on the trigger's own capture context).
    const triggerDom = interaction.triggerEvent?.domContext as DomContext | undefined;
    if (triggerDom?.formElementKey != null && triggerDom.formElementKey !== '') return interaction;

    // P2 — user typed a non-empty value.
    if (interaction.metadata?.['userTyped'] !== true) return interaction;
    const typed = interaction.metadata['typedValue'] ?? interaction.metadata['textValue'];
    if (typeof typed !== 'string' || typed === '') return interaction;

    // P3/P4 — the ONE canonical terminal-Enter derivation (audit m-1:
    // both tiers must recognize the Enter through the same pure recorded-
    // data function). Includes the real-Chrome exemption for the browser's
    // implicit `change` after Enter (Chrome fires change on the same
    // element between the Enter keydown and the effect — carries the same
    // value, never new typing; pinned by tests/definitions/…7-4-b6-1 AC1e2).
    const enter = terminalEnterMemberOf(interaction.memberEvents ?? [], interaction.trigger);
    if (!enter) return interaction;

    // E-C1 — exact network join on the Enter's eventId.
    const stamped = rowsByStamp.get(enter.eventId);
    if (!stamped || stamped.length === 0) return interaction;

    // E-C2 — one corroboration class from the interaction's own evidence.
    const corroboration = corroborationClassOf(interaction);
    if (!corroboration) return interaction;

    // Rescue — a new object; the original stays untouched (input purity).
    return {
      ...interaction,
      endState: 'completed',
      metadata: {
        ...interaction.metadata,
        commitSignal: 'network',
        committedValue: typed,
        enterCause: true,
        corroboration,
        networkCommitRequestIds: stamped.slice(0, 5).map((r) => r.requestId),
      },
    };
  });
}

/**
 * E-C2 corroboration classes, checked in spec order. Each is a recorded
 * evidence class on the interaction's own behavioral evidence — no DOM, no
 * wall-clock, no interpretation beyond the class definitions in the spec.
 */
function corroborationClassOf(
  interaction: ComponentInteraction,
): 'viewConfirmation' | 'notificationSurfaceChange' | 'fieldRemoval' | null {
  const app = interaction.behavioralEvidence?.applicationEvidence;
  if (!app) return null;

  // viewConfirmation — a recorded SPA navigation in the window (the
  // NavigationSignalExtractor view-change evidence class).
  if (app.navigation && app.navigation.length > 0) return 'viewConfirmation';

  // notificationSurfaceChange — an alert/status/log surface appeared or
  // disappeared in the window (NotificationSignalExtractor's class).
  const notificationRole = (r: string | null | undefined) =>
    r === 'alert' || r === 'status' || r === 'log';
  if (
    (app.newSurfaces ?? []).some((s) => notificationRole(s.ariaRole)) ||
    (app.removedSurfaces ?? []).some((s) => notificationRole(s.ariaRole))
  ) {
    return 'notificationSurfaceChange';
  }

  // fieldRemoval — the field (or a container holding it) was removed from
  // the DOM in the window (childList removal whose recorded target path
  // mentions the field's id/class — DOM paths don't carry `#` selectors).
  const css = interaction.trigger.cssSelector ?? '';
  const idOrClass = css.replace(/^[#.]/, '').toLowerCase();
  if (idOrClass && (app.domChanges ?? []).some(
    (d) => d.types.includes('childList') && d.removedNodesCount > 0 &&
      d.targetPath.toLowerCase().includes(idOrClass),
  )) {
    return 'fieldRemoval';
  }

  return null;
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

  // ── 7.4-B3 S3: typed-text episode tracking ──────────────────────
  // input events claimed by no lifecycle are tracked per element; the
  // episode closes on blur of the same element → one synthetic 'change'
  // entry with the terminal value (see mintTypedTextSample). Fires
  // AFTER runtime.process so lifecycle claims from THIS event are
  // already visible.
  trackTypedTextEpisode(event, emitted, runtime);

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
/**
 * B7-P2: live lifecycle stack (trigger-first) for the active runtime —
 * read-only view used by the SW's pre-STOP hover evidence drain gate.
 * Empty when no runtime exists (not recording / already stopped).
 */
export function getRuntimeLiveLifecycles(): Array<{ id: string; trigger?: unknown; type?: string }> {
  return runtime?.getLiveLifecycles() ?? [];
}

/**
 * B7-P2 §5.2.2 T4 (target-removed): SW-side consumer of the CS
 * TRIGGER_REMOVED notification. Resolves the join (lifecycleId exact,
 * triggerEventId fallback for the R-2 unbound-window race) and completes
 * the lifecycle through the runtime's structural terminal — endState
 * 'completed', metadata.terminal 'target-removed' — when the definition
 * declares completesOnTriggerRemoved (Hover).
 *
 * The emitted interaction flows through config.onEmit (enrich → push to
 * liveInteractions → persist → FINALIZE_EVIDENCE to the CS) exactly like
 * any other terminal, so evidence delivery and panel broadcast are the
 * standard path. Returns the number of interactions completed (0 or 1).
 */
export function handleTriggerRemovedNotification(payload: {
  lifecycleId?: string | null;
  triggerEventId?: string;
}): number {
  if (!runtime || !isRecording) return 0;
  const resolved = runtime.resolveTriggerRemovedLifecycle({
    lifecycleId: payload.lifecycleId ?? undefined,
    triggerEventId: payload.triggerEventId ?? undefined,
  });
  if (!resolved) return 0;
  const emitted = runtime.completeTriggerRemoved(resolved);
  // Panel broadcast mirrors handleObservedEvent's emitted loop — onEmit
  // already persisted/finalized; the live display update is the seam's
  // responsibility so the SW switch case stays one line.
  for (const interaction of emitted) {
    chrome.runtime.sendMessage({
      type: 'INTERACTION_CAPTURED',
      interaction,
    }).catch(() => {
      // Side panel may not be open — ignore
    });
  }
  return emitted.length;
}

export function getLiveInteractions(): ComponentInteraction[] {
  return [...liveInteractions];
}

/**
 * Clear all state (for testing or hard reset).
 *
 * M8.3: Also clears persisted pending evidence and the debounce timer.
 */
export function getEvidenceLedger(): EvidenceLedger | null {
  return evidenceLedger;
}

export function resetState(): void {
  liveInteractions = [];
  runtime = null;
  isRecording = false;
  // RCA2: cleared state is the same as stopped state — raw persistence
  // stays suppressed until the next initRecording().
  recordingStopped = true;
  evidenceLedger = null;
  lastVerificationResult = null;
  // 7.4-B3 S3: clear typed-text episode state (episodic by design — a
  // reset must never resurrect a stale episode across sessions).
  typedTextEpisodes.clear();
  syntheticMinted.clear();
  syntheticCounter = 1_000_000_000;
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

    // RCA2: a restored ACTIVE recording means we are mid-recording again —
    // re-arm raw-list persistence.
    recordingStopped = false;

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
      onDedupFold: (prior, suppressedCtx) => {
        // 7.4-B3 S2 (restore path): same persist + binding-release hooks
        // as initRecording. The fold target (prior) may be a pre-restart
        // interaction from the restored liveInteractions list — in-memory
        // mutation + persist. The suppressed lifecycle's collector binding
        // must also be released (same RCA as the init path).
        void persistLiveInteractions();
        sendFinalizeForSuppressedLifecycle(suppressedCtx, prior);
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
  // RCA2: after stop, LIVE_INTERACTIONS in storage is the projected
  // production list owned by handleStopRecording — never clobber it with
  // the raw recording array. (No-throw: callers treat false as "not
  // persisted", which is the honest outcome here.)
  if (recordingStopped) return Promise.resolve(false);
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
