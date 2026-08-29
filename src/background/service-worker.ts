/**
 * Background Service Worker — Component Runtime Architecture
 *
 * Responsibilities:
 *   1. Extension lifecycle (side panel action)
 *   2. Message routing: START_RECORDING, STOP_RECORDING, OBSERVED_EVENT
 *   3. Navigation capture via webNavigation API
 *   4. Session management via Component Runtime
 *
 * Active classification: Component Runtime with lifecycle-based definitions.
 * Events from the content script are processed through the Component Runtime
 * engine which produces ComponentInteractions. These are filtered and mapped
 * to IR actions by the presentation layer, then passed to the generation
 * pipeline (IR Bridge → Playwright code generator → Repository V2).
 *
 * Architecture: .drytis/specs/m0a-architecture-validation.md
 */

import { StorageService } from '../storage/storage-service';
import {
  RecordingState,
  StorageKeys,
  type UIState,
  type AppMessage,
} from '../shared/types';
import type { ObservedEvent } from '../shared/component-types';
import {
  initRecording,
  stopRecording,
  processObservedEvent,
  getLiveInteractions,
  getRuntimeLiveLifecycles,
  restoreFromStorage,
  resetState,
  storePendingEvidence,
  attachEvidenceToInteraction,
  persistLiveInteractions,
  handleTriggerRemovedNotification,
} from '../runtime/sw-integration';
import {
  filterProductionInteractions,
} from '../presentation/output-adapter';
import { normalizeWorkflow } from '../presentation/workflow-normalizer';
import {
  startNetworkObservation,
  stopNetworkObservation,
  stampClass,
  setLastTrustedAction,
  setLastTrustedActionIfAbsent,
  resolveBackfillStamp,
  noteRecordingScopeTab,
  consumeMainFrameCorrelation,
  snapshotInFlightForTab,
  getNetworkEvidenceForNavigation,
  getAttributionLedger,
} from '../background/network-observation';
import {
  recordPendingNavCapture,
  consumePendingNavCapture,
} from '../background/post-nav-capture';
import {
  normalizeWebOrigin,
  resolveRecordingOrigin,
} from '../understanding/persistence/recording-origin';
import { isRecordingScopeTab } from '../background/network-observation';
import { isInteractiveElement } from '../definitions/patterns';
import type { NavigationEvidence, NetworkActivity } from '../shared/behavioral-evidence-types';

// ── Singletons ──────────────────────────────────────────────────────────

let sessionRestored = false;
let recordingStartUrl = '';
let recordingStartTitle = '';
/**
 * 7.0-KR: web origin (scheme+host+port) the session's KR writes key on.
 * Resolved at START from the raw start URL (normalized); null when the
 * start tab is not a web origin (panel-active start) — then the
 * onCommitted fallback (lastCommittedWebUrl) may fill it during the
 * session. IR generation keeps consuming the RAW recordingStartUrl (AC-9).
 */
let recordingOrigin: string | null = null;
/**
 * 7.0-KR fallback input: last main-frame webNavigation.onCommitted URL for
 * a recording-scope tab. Panel-active starts (every E2E harness + real user
 * edge) stamp the extension URL, so the recovery path re-keys KR writes to
 * the app actually being recorded. Only http(s) URLs enter this slot
 * (normalizeWebOrigin gate) — an extension/about URL never leaks in (AC-4).
 */
let lastCommittedWebUrl: string | null = null;
/** D9: content viewport of the tab at recording start (tab.width/height). */
let recordingViewport: { width: number; height: number } | undefined;

// M9.12: Prior-knowledge seed loaded at startRecording, passed to
// the understanding pipeline at stopRecording.  Null = preload failed
// or first session on this app.
let understandingSeed: import('../understanding/consolidation/application-knowledge').StateBuilderSeed | null = null;

// CP5 / R1: Session-scoped retention of consumed post-nav records.
//
// The pending store (post-nav-capture.ts) is consume-on-pull (exactly-once
// per navigation per document) and in-memory only — after the destination
// content script pulls, the record is gone, and with it the T2 lineage
// evidence (navEventId, committedAt, fromUrl/toUrl) the behavior model
// needs. Retention copies the record AT the consume call site (before the
// store's internal delete) so store semantics are untouched.
//
// Session isolation (INV session scoping, same rationale as the ledger
// clearAll below): cleared in handleStartRecording alongside the attribution
// ledger, so a stale record from session N can never reach session N+1's
// model. Tab isolation is structural: T2 matching is exact-navEventId
// (CER-2), never tab-based. navEventIds are unique per navigation
// (`nav-<Date.now()>-<rand6>`, and the early write + re-confirm write use
// the SAME id), so retention cannot duplicate a navigation. Bounded FIFO —
// cap mirrors the extension's other bounded stores.
const SESSION_NAV_RECORDS_CAP = 200;
const sessionNavRecords: import('../shared/post-nav-types').PostNavCaptureRecord[] = [];

function retainNavRecord(record: import('../shared/post-nav-types').PostNavCaptureRecord): void {
  sessionNavRecords.push(record);
  if (sessionNavRecords.length > SESSION_NAV_RECORDS_CAP) {
    sessionNavRecords.shift();
  }
}

// ── MV3 Recovery: restore session on SW startup ─────────────────────────

async function ensureSessionRestored(): Promise<void> {
  if (sessionRestored) return;
  sessionRestored = true;
  // G4-D (INV-G5): every consumer of stamps / pending nav docs must be
  // ordered AFTER the module's boot restore (observing set + frame stamps +
  // pending docs) — an await graph, not a timer. Capture writers are
  // unaffected (they never blocked and in-memory state wins).
  try {
    const { getBootRestorePromise } = await import('./network-observation');
    await getBootRestorePromise();
  } catch {
    // boot restore unavailable (tests) — continue with in-memory state
  }
  await restoreFromStorage();

  // ── Boot reconciliation (form-submit recovery, event-driven) ──
  // Rehydrate the durable attribution ledger and attach any stamped
  // requests whose owning interactions now exist. Covers crash-point B
  // (stored, never attached) and crash-point A cleanup (attached, not
  // acked). Unresolved entries stay durable — retried on the next
  // BEHAVIORAL_EVIDENCE / onCommitted / STOP event.
  try {
    const live = getLiveInteractions();
    const ledger = getAttributionLedger();
    const result = await ledger.rehydrate(live);
    if (result.attached.length > 0) {
      // delete-after-persist: ack only after LIVE_INTERACTIONS lands
      ledger.acknowledgeAfterPersist(persistLiveInteractions());
      console.info(
        `[AttributionLedger] boot reconciliation attached ${result.attached.length} request(s)`,
      );
    }
    if (result.unresolved.length > 0) {
      console.info(
        `[AttributionLedger] ${result.unresolved.length} stored request(s) awaiting owning interaction`,
      );
    }
  } catch (e) {
    console.warn('[AttributionLedger] boot reconciliation failed:', (e as Error).message);
  }
}

ensureSessionRestored();

// ── Content Script Health Check & Injection ─────────────────────────────

/**
 * Ping result returned by pingTabContentScript.
 */
interface PingResult {
  /** Content script is injected and responding. */
  alive: boolean;
  /** Content script's local recording flag. False if not recording or not alive. */
  recording: boolean;
}

/**
 * Ping a tab's content script to check if it's alive AND recording.
 *
 * Returns both the alive flag (script injected and responding) and the
 * recording flag (EventTap installed and listening). A tab can be alive
 * but not recording — this happens when navigation clears sessionStorage,
 * preventing auto-resume of recording state.
 *
 * The caller (ensureContentScriptInjected) uses the recording flag to
 * decide whether a START_RECORDING re-sync is needed.
 */
async function pingTabContentScript(tabId: number): Promise<PingResult> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (response && response.type === 'PONG') {
      return { alive: true, recording: !!response.recording };
    }
    return { alive: false, recording: false };
  } catch {
    return { alive: false, recording: false };
  }
}

/**
 * Programmatically inject the content script into a tab.
 * Used when the declarative content script is missing (e.g., the tab was
 * already open when the extension was reloaded/updated).
 *
 * The content script filename includes a Vite content hash that changes
 * on every build (e.g. assets/recorder-entry.ts-CP_NOlxs.js). We cannot
 * hardcode the path — we must read it from the manifest at runtime.
 */
async function injectContentScript(tabId: number): Promise<boolean> {
  try {
    // Read the content script path from the manifest (handles Vite hashing)
    const manifest = chrome.runtime.getManifest();
    const csEntry = manifest.content_scripts?.[0]?.js?.[0];
    if (!csEntry) return false;

    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [csEntry],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the content script is alive AND recording in the active tab.
 *
 * Three scenarios:
 * 1. Alive and recording → done.
 * 2. Alive but NOT recording → re-sync by sending START_RECORDING.
 *    This is the primary fix for intermittent click loss: navigation to a
 *    new page can clear sessionStorage, preventing auto-resume. The content
 *    script is injected and responds to PING, but the EventTap is never
 *    installed. Without this re-sync, all clicks on that page are silently
 *    lost.
 * 3. Not alive → inject programmatically, then re-sync recording state.
 *
 * Returns true if the content script is confirmed alive after this call.
 */
async function ensureContentScriptInjected(tabId: number): Promise<boolean> {
  const ping = await pingTabContentScript(tabId);

  // Scenario 1: alive and recording → healthy
  if (ping.alive && ping.recording) {
    return true;
  }

  // Scenario 2: alive but NOT recording → re-sync without re-injecting
  if (ping.alive && !ping.recording) {
    if (await isRecordingActive()) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
      } catch { /* ignore — will retry on next health check */ }
    }
    return true;
  }

  // Scenario 3: not alive — inject programmatically
  const injected = await injectContentScript(tabId);
  if (!injected) {
    return false;
  }

  // Give it a moment to initialize
  await new Promise((r) => setTimeout(r, 100));

  // Re-sync recording state if currently recording
  if (await isRecordingActive()) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
    } catch { /* ignore */ }
  }

  // Verify it's now alive
  const rePing = await pingTabContentScript(tabId);
  return rePing.alive;
}

/** Consecutive health check failures before reporting "not responding". */
const HEALTH_MAX_FAILURES = 3;
let consecutiveHealthFailures = 0;

/**
 * Check content script health on the active tab and report status.
 * Called when recording starts and periodically while recording.
 *
 * Debounce: a single transient ping failure does NOT trigger "Tab not
 * responding". Only after HEALTH_MAX_FAILURES consecutive failures.
 */
async function checkActiveTabHealth(): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  const alive = await ensureContentScriptInjected(tab.id);

  if (alive) {
    consecutiveHealthFailures = 0;
  } else {
    consecutiveHealthFailures++;
  }

  // Only broadcast "not responding" after sustained failures
  if (alive || consecutiveHealthFailures >= HEALTH_MAX_FAILURES) {
    broadcastToPanel({
      type: 'CONTENT_SCRIPT_STATUS',
      tabId: tab.id,
      alive,
      recording: await isRecordingActive(),
      url: tab.url ?? '',
    });
  }
}

// ── Tab helpers ─────────────────────────────────────────────────────────

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ?? null;
  } catch {
    return null;
  }
}

// ── Lifecycle: Start / Stop Recording ───────────────────────────────────

async function handleStartRecording(): Promise<void> {
  await ensureSessionRestored();

  const tab = await getActiveTab();
  const startUrl = tab?.url ?? '';
  const startTitle = tab?.title ?? '';
  recordingStartUrl = startUrl;
  recordingStartTitle = startTitle;
  // 7.0-KR: resolve the KR identity key from the start stamp (normalized,
  // never the raw full URL). Null when the panel is the active surface —
  // the onCommitted fallback may fill it once recording-scope traffic lands.
  recordingOrigin = resolveRecordingOrigin({ startUrl, lastCommittedWebUrl: null });
  lastCommittedWebUrl = null;
  // D9: chrome.tabs.Tab width/height are the tab's content box (the actual
  // viewport the user recorded at). Absent on some platforms → undefined,
  // and the IR bridge falls back to the documented 1280×720 default.
  recordingViewport = (tab?.width && tab?.height)
    ? { width: tab.width, height: tab.height }
    : undefined;

  // Reset Component Runtime for a fresh recording session
  resetState();
  initRecording();

  // 7.4-B6.1 tier C: wire the STOP-time network-row collector — the
  // completed-request ring rows that carry a trusted-action stamp. The
  // reconcile pass joins them to terminal-Enter eventIds exactly.
  {
    const { getRecentRequests } = await import('./network-observation');
    const { setTierCNetworkRowCollector } = await import('../runtime/sw-integration');
    setTierCNetworkRowCollector(() =>
      getRecentRequests(0).filter((r) => typeof r.sourceEventId === 'string'),
    );
  }

  // Session-end cleanup for the durable attribution ledger (INV session
  // scoping): stale entries from a prior session never join this session's
  // interactions.
  await getAttributionLedger().clearAll().catch(() => {});

  // CP5/R1: same INV session-scoping for retained post-nav records — a
  // stale navigation record from a prior session must never enter this
  // session's Behavior Model.
  sessionNavRecords.length = 0;

  // Persist recording context (start URL + title) so the side panel
  // can display the current page URL immediately.
  try {
    await chrome.storage.local.set({
      [StorageKeys.SESSION_CONTEXT]: {
        startUrl,
        startTitle,
        capturedAt: new Date().toISOString(),
        // D9: content viewport for honest IR environment + config output
        ...(recordingViewport ? { viewport: recordingViewport } : {}),
      },
    });
  } catch { /* non-fatal */ }

  // M9.12: Preload prior application knowledge for this origin so the
  // understanding pipeline can recognize cross-session entities/views.
  // Non-fatal — a preload failure never blocks recording start.
  // 7.0-KR: key on the NORMALIZED origin (null ⇒ skip — no web app to
  // preload for; read-side and write-side now share one key domain).
  understandingSeed = null;
  try {
    if (recordingOrigin) {
      const { preloadPriorKnowledge } = await import('../understanding/pipeline/understanding-pipeline');
      understandingSeed = await preloadPriorKnowledge(recordingOrigin);
    }
  } catch (e) {
    console.warn('[M9] prior-knowledge preload failed:', e);
    understandingSeed = null;
  }

  // Ensure content script is injected in the active tab
  // (Critical: if the extension was reloaded, the content script may be
  // missing from already-open tabs.)
  if (tab?.id) {
    await ensureContentScriptInjected(tab.id);

    // M6: Start network observation (webRequest + MAIN-world injection).
    // webRequest listeners are registered IMMEDIATELY for race coverage,
    // then MAIN-world injection follows. Both run in parallel.
    startNetworkObservation(tab.id);
  }

  // Update UI state
  const uiState: UIState = {
    recordingState: RecordingState.Recording,
    lastChanged: new Date().toISOString(),
  };
  await StorageService.setUIState(uiState);

  // Notify all tabs (content scripts listen for START_RECORDING to sync state)
  broadcastToTabs({ type: 'START_RECORDING' });

  // Report content script health to side panel
  await checkActiveTabHealth();
}

/**
 * B7-P2: is a Hover lifecycle live right now? The runtime's live stack
 * carries each lifecycle's interaction type (additive field) — a live
 * 'Hover' is the only case where the drain round-trip is worth its cost;
 * sessions without one skip it entirely (byte-identical STOP).
 */
function hasLiveHoverLifecycle(): boolean {
  try {
    const live = getRuntimeLiveLifecycles();
    return live.some((lc) => lc.type === 'Hover');
  } catch {
    return false;
  }
}

/**
 * B7-P2: force-close open provisional hover evidence windows in every
 * recording tab BEFORE the stop pipeline runs, and settle for the
 * delivered evidence. Delivery mechanics only — no semantics, no clock
 * deciding meaning (the settle window is a bounded transport wait, the
 * same class as FLUSH_EVENTS round-trips; the drain evidence joins via
 * the normal pendingEvidence/onEmit paths either way).
 *
 * Settle signal: the hover's behavioral evidence attaching to its
 * interaction (or landing in pendingEvidence). We poll the interactions'
 * evidence presence with a short cap; anything slower than the cap still
 * arrives and joins later via the standard recovery passes — the drain
 * is an ordering optimization for the recording-end terminal, not a
 * correctness gate on delivery.
 */
async function drainHoverEvidenceBeforeStop(): Promise<void> {
  if (!hasLiveHoverLifecycle()) return;

  const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
  const sendAll: Array<Promise<unknown>> = [];
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      sendAll.push(
        chrome.tabs.sendMessage(tab.id, { type: 'STOP_EVIDENCE_DRAIN' }).catch(() => undefined),
      );
    }
  }
  await Promise.all(sendAll);

  // Bounded settle: poll until every hover lifecycle's evidence has
  // landed (attached or pending), or the cap elapses. Structural inputs
  // only — no clock participates in any semantic decision.
  const HOVER_EVIDENCE_SETTLE_MS = 1500;
  const POLL_MS = 100;
  const deadline = Date.now() + HOVER_EVIDENCE_SETTLE_MS;
  while (Date.now() < deadline) {
    const hoverLive = getLiveInteractions().filter((i) => i.type === 'Hover');
    const allEvidenced =
      hoverLive.length > 0 &&
      hoverLive.every((i) => i.behavioralEvidence != null);
    if (hoverLive.length === 0) {
      // The hover lifecycle has not emitted yet (it emits at flush) —
      // evidence sits in pendingEvidence; nothing to wait on.
      break;
    }
    if (allEvidenced) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function handleStopRecording(): Promise<void> {
  await ensureSessionRestored();

  // ── B7-P2: pre-pipeline hover evidence drain ──────────────────────
  // A no-leave hover completes via completesAtRecordingEnd at the flush
  // below — but its provisional evidence window is still OPEN in the
  // content script until STOP_RECORDING reaches it, which this function
  // sends only AFTER the whole pipeline ran. That ordering stranded the
  // S5 hover evidence: delivered after admission decided → not admitted.
  // Fix: when a Hover lifecycle is live, ask every tab to force-close
  // open provisional hover windows FIRST (delivery mechanics only), then
  // settle for the delivered evidence before running the stop pipeline.
  // Sessions without a live Hover lifecycle skip the round-trip entirely
  // (no message, no wait) — byte-identical STOP for everything else.
  await drainHoverEvidenceBeforeStop();

  // Flush runtime and get all interactions
  const allInteractions = stopRecording();

  // Normalize: remove Unclassified interactions subsumed by recognized
  // interactions on the same element (e.g., mousedown→click gesture pairs).
  // This is a view filter — subsumed interactions remain in liveInteractions
  // and the Evidence Ledger. M4 verification already ran on raw output.
  const normalizedInteractions = normalizeWorkflow(allInteractions);

  // Filter to production interactions — removes incidental Hovers, Scrolls,
  // abandoned/discarded interactions, and no-op selections.
  const productionInteractions = filterProductionInteractions(normalizedInteractions);

  // Store production interactions for UI display
  await StorageService.setRaw(StorageKeys.LIVE_INTERACTIONS, productionInteractions);

  // ── RACE FIX: stop-recording network evidence drain ──
  // Second recovery pass for requests whose evidence delivery was
  // destroyed by a full-page reload and whose commit-time consumer missed
  // them (onBeforeRequest → onCompleted → onCommitted ordering race).
  // Joins ring entries to interactions by exact sourceEventId BEFORE the
  // understanding pipeline consumes them. Exactly-once: requestIds already
  // captured directly are skipped; telemetry/noise filtered here too.
  // CP5: the ledger snapshot for Stage 3.5 is captured in this block,
  // before the session-end clearAll() below.
  let sessionStampedRequests: import('./evidence-attribution').StampedRequest[] = [];
  try {
    const { getCompletedBySourceEventId } = await import('./network-observation');
    const { drainNetworkEvidence } = await import('./network-drain');
    const stamped: import('./network-drain').DrainEntry[] = [];
    for (const i of productionInteractions) {
      const evId = i.behavioralEvidence?.sourceEventId;
      if (!evId) continue;
      // G4-B: pass the interaction's capture origin so the ring join is
      // triple-keyed (an eventId alone may collide across tabs).
      const origin = i.metadata?.captureOrigin as
        | { tabId: number; frameId: number }
        | undefined;
      for (const r of getCompletedBySourceEventId(evId, origin)) {
        stamped.push({
          url: r.url,
          method: r.method,
          status: r.status,
          requestId: r.requestId,
          sourceEventId: r.sourceEventId,
          requestBody: r.requestBody,
          documentRequest: r.documentRequest,
          captureOrigin: typeof r.tabId === 'number'
            ? { tabId: r.tabId, frameId: r.frameId ?? 0 }
            : undefined,
        });
      }
    }
    const { updatedInteractions, mergedRequestIds } =
      drainNetworkEvidence(productionInteractions, stamped);
    if (mergedRequestIds.length > 0) {
      console.info(
        `[NetworkDrain] recovered ${mergedRequestIds.length} request(s) onto ` +
        `${updatedInteractions.length} interaction(s) by sourceEventId`,
      );
      await StorageService.setRaw(StorageKeys.LIVE_INTERACTIONS, productionInteractions);
    }

    // ── Durable ledger drain (form-submit recovery, T11–T16 path) ──
    // Third pass: entries the ring lost (TTL/capacity) or that only exist
    // in the durable store (captured pre-completion / SW restart survivors).
    // Identity join, synthesize-on-missing — exactly-once via ownership.
    const ledger = getAttributionLedger();
    const attachedCount = ledger.attachToInteractions(productionInteractions);
    if (attachedCount > 0) {
      console.info(
        `[AttributionLedger] stop drain attached ${attachedCount} request(s)`,
      );
      await StorageService.setRaw(StorageKeys.LIVE_INTERACTIONS, productionInteractions);
      ledger.acknowledgePersisted(); // durable delete — persist landed above
    }

    // ── Stop-time status enrichment (first-delivery freeze fix) ──
    // Rows captured at onBeforeRequest carry status null (start phase);
    // the completion record survives in the durable ledger (merge-enriched
    // at onCompleted) and/or the completed-requests ring. Upgrade the
    // STATUS FIELD ONLY of existing null-status rows, keyed by requestId —
    // no row is added, removed, or reordered; no attribution changes.
    // Runs AFTER the attach passes (their rows are enrichable too) and
    // BEFORE ledger.clearAll() (the ledger is a source) and the M9 pipeline.
    try {
      const { enrichNetworkRowStatuses } = await import('./network-drain');
      const nullIds = new Set<string>();
      for (const i of productionInteractions) {
        for (const r of i.behavioralEvidence?.applicationEvidence?.networkActivity ?? []) {
          const rid = (r as { requestId?: string; status?: number | null }).requestId;
          if (rid && (r as { status?: number | null }).status == null) nullIds.add(rid);
        }
      }
      if (nullIds.size > 0) {
        const { getCompletedByRequestIds } = await import('./network-observation');
        const { enriched } = enrichNetworkRowStatuses(productionInteractions, {
          ledger: ledger.snapshotStamped(),
          ring: getCompletedByRequestIds(nullIds) as unknown as
            import('./network-drain').DrainEntry[],
        });
        if (enriched.length > 0) {
          console.info(
            `[NetworkDrain] status-enriched ${enriched.length} row(s): ` +
            enriched.map((e) => `${e.requestId}→${e.to}`).join(', '),
          );
          await StorageService.setRaw(StorageKeys.LIVE_INTERACTIONS, productionInteractions);
        }
      }
    } catch (e) {
      // Non-fatal — pipeline runs on whatever statuses already exist.
      console.warn('[NetworkDrain] status enrichment failed:', (e as Error).message);
    }

    // Session-end cleanup (INV session scoping): the ledger never outlives
    // its recording session.
    // CP5: snapshot BEFORE clearing — the behavior model (Stage 3.5) reads
    // this snapshot as its T1 evidence source. clearAll() below destroys
    // the ledger; snapshotting after it would always yield [].
    sessionStampedRequests = ledger.snapshotStamped();
    await ledger.clearAll().catch(() => {});
  } catch (e) {
    // Non-fatal — pipeline runs on whatever evidence already exists
    console.warn('[NetworkDrain] drain failed:', (e as Error).message);
  }

  // ── M9.12: Application Understanding Pipeline ──
  // Runs the full deterministic understanding chain (M9.1→M9.7) over
  // the session's interactions.  Non-fatal: if M9 throws, recording
  // still completes with a minimal understanding stub.
  let understandingResult: import('../domain/entities/understanding-result').UnderstandingResult = {
    sessionId: `session-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };

  // D3: harvest output hoisted so both the generation and persistence
  // blocks below can consume it (steps need session element ids; the
  // healing wiring needs the fresh UiElements).
  let harvestedFreshElements: readonly import('../domain/entities/ui-element').UiElement[] = [];
  let harvestedIdByKey = new Map<string, string>();
  let recordedStartUrl = 'about:blank';

  try {
    if (productionInteractions.length > 0) {
      const { runUnderstandingPipeline } = await import('../understanding/pipeline/understanding-pipeline');
      const { serializeStateTransitions } = await import('../understanding/state-builder/serialize');
      // 7.0-KR: KR persistence keys on the NORMALIZED web origin. The raw
      // full URL is NEVER hashed into an appId anymore (panel-origin apps +
      // per-path fragmentation proven by the 6E-M2 / 6F-M2b Dexie dumps).
      // Unresolvable (null) ⇒ skip KR persistence honestly — IR generation
      // below is unaffected (it consumes recordedStartUrl, the raw form).
      const krOrigin = resolveRecordingOrigin({
        startUrl: recordingStartUrl,
        lastCommittedWebUrl,
      }) ?? recordingOrigin;
      const origin = krOrigin ?? '';
      if (!origin) {
        console.warn('[7.0-KR] no web origin resolvable for this session — KR persistence skipped');
      }
      const sessionId = `session-${Date.now()}`;

      const pipelineOutcome = await runUnderstandingPipeline({
        interactions: productionInteractions,
        origin,
        sessionId,
        // 7.0-KR AC-6: honest skip — pipeline must not mint app rows under a
        // garbage key when no web origin is resolvable.
        skipKnowledgePersistence: !origin,
        seed: understandingSeed,
        // CP5: composition-root clock + session capture artifacts for the
        // behavior model (Stage 3.5). stampedRequests were snapshotted
        // BEFORE the ledger's session-end clearAll (see RACE FIX block);
        // postNavRecords are the session-retained consumed records (R1).
        generatedAtMs: Date.now(),
        captureArtifacts: {
          stampedRequests: sessionStampedRequests,
          postNavRecords: [...sessionNavRecords],
        },
      });

      understandingResult = {
        sessionId,
        generatedAt: new Date().toISOString(),
        schemaVersion: 2,
        semanticKnowledge: pipelineOutcome.semanticKnowledge ?? undefined,
        applicationKnowledge: pipelineOutcome.applicationKnowledge ?? undefined,
        knowledgeWarnings: pipelineOutcome.warnings.length > 0 ? pipelineOutcome.warnings : undefined,
        // D12: carry pipeline artifacts that were previously dropped.
        // Serialize transitions to JSON-safe form (Maps → Records) so
        // chrome.storage, side-panel, export, and API consumers all work.
        outcomes: [...pipelineOutcome.outcomes.values()],
        transitions: serializeStateTransitions(pipelineOutcome.transitions),
        appId: pipelineOutcome.appId,
        // CP5: application behavior model (optional field; whole + untransformed).
        behaviorModel: pipelineOutcome.behaviorModel ?? undefined,
      };

      // Store for side-panel display (best-effort)
      await StorageService.setRaw(StorageKeys.UNDERSTANDING_RESULT, understandingResult);
    }
  } catch (e) {
    console.warn('[M9] understanding pipeline failed:', e);
  } finally {
    understandingSeed = null; // clear for next session
  }

  // ── Generation Layer: compile interactions → ExecutionIRPlan ──
  try {
    const { build: buildIRPlan } = await import('../generation/ir-bridge');
    const { buildResultingStateEnrichment } = await import(
      '../generation/assertion-derivation'
    );
    const { PlaywrightCodeGenerator } = await import('../adapters/playwright/project-generator');
    const { harvestSessionElements } = await import('../repository/services/session-element-harvest');

    const tab = await getActiveTab();

    // D3: harvest session-scoped element IDs so steps reference real
    // elements (repository linkage, runtime healing, correct OR-1 merge).
    const startUrl = recordingStartUrl || tab?.url || 'about:blank';
    recordedStartUrl = startUrl;
    const harvest = harvestSessionElements(productionInteractions, startUrl);
    harvestedFreshElements = harvest.freshElements;
    harvestedIdByKey = harvest.idByKey as Map<string, string>;

    const irPlan = buildIRPlan({
      interactions: productionInteractions,
      recordingContext: {
        startUrl,
        title: recordingStartTitle || tab?.title || null,
        // D9: honest viewport from the tab's content box at recording start
        ...(recordingViewport ? { viewport: recordingViewport } : {}),
      },
      testCaseName: (await StorageService.getTestCaseDraft())?.name ?? 'Recorded Test',
      ...(harvestedIdByKey.size > 0 ? { elementIdByKey: harvestedIdByKey } : {}),
      // Track 3 (INV-GEN-9: the service worker is the sole adapter site):
      // step-scoped SOFT assertions derived from each interaction's OWN
      // resulting-state evidence (Phase 4c-i, Option A — on by default).
      enrichment: buildResultingStateEnrichment(productionInteractions),
    });

    await StorageService.setRaw(StorageKeys.EXECUTION_IR_PLAN, irPlan);
    // D2: truthful generation timestamp, written at generation time (was
    // only written inside `if (irWasStale)` — circular dead logic).
    await chrome.storage.local.set({
      [StorageKeys.EXECUTION_IR_PLAN + '_generated_at']: new Date().toISOString(),
    });

    // Render the plan to Playwright code files
    const codeGen = new PlaywrightCodeGenerator();
    const result = await codeGen.generate(irPlan, {
      language: 'typescript',
      pattern: 'flat',
      assertions: 'expect',
    });
    await StorageService.setRaw(StorageKeys.GENERATED_FILES, result);
  } catch (e) {
    console.warn('[IR Bridge] error during unified generation:', e);
  }

  // ── Repository V2 Persistence ──
  try {
    const { DexieUnitOfWorkFactory } = await import('../repository/v2/dexie/dexie-unit-of-work-factory');
    const { persistSession } = await import('../repository/services/session-persistence-service');

    const irPlanResult = await chrome.storage.local.get(StorageKeys.EXECUTION_IR_PLAN);
    const irPlan = irPlanResult[StorageKeys.EXECUTION_IR_PLAN];
    const draft = await StorageService.getTestCaseDraft();

    if (irPlan) {
      const uowFactory = new DexieUnitOfWorkFactory();
      const persistenceResult = await persistSession(uowFactory, {
        understanding: understandingResult,
        events: [],
        interactions: productionInteractions,
        url: (await getActiveTab())?.url ?? '',
        irPlan,
        projectId: draft?.projectId ?? null,
        testCaseName: draft?.name ?? 'Recorded Test',
      });

      await StorageService.setRaw(StorageKeys.REPOSITORY_SESSION_ID, persistenceResult.sessionId);

      // ── D3: healing wiring — populate/update Repository Elements ──
      // healFromRecording() is the single writer of the elements table; it
      // had NO production caller, so the table stayed empty forever. Runs
      // AFTER persistSession (needs projectId + sessionId). Non-fatal:
      // healing failure must never break the recording session.
      try {
        const { healFromRecording } = await import('../repository/services/healing-service');
        const { elementIdentityKey } = await import('../repository/services/session-element-harvest');

        const healing = await healFromRecording(
          persistenceResult.projectId,
          harvestedFreshElements,
          persistenceResult.sessionId,
          uowFactory,
        );

        // Map identity-key → repository element id so the stored IR plan's
        // steps reference the DURABLE repository ids (the session elem-NNNN
        // ids are only labels; details come back one per fresh element in
        // harvest order — matched by logicalName fallback is unreliable, so
        // we re-read the project's elements and join via locator values).
        if (healing.details.length > 0) {
          const mapUow = uowFactory.create();
          const storedElements = await mapUow.execute(async (repos) =>
            repos.elements.getByProject(persistenceResult.projectId),
          );
          const repoIdByKey = new Map<string, string>();
          for (const fresh of harvestedFreshElements) {
            const key = elementIdentityKey(fresh.identity);
            // Join: stored element whose locator set contains the fresh
            // cssSelector (category-5 structural locator, always written
            // from the identity by resolveFreshLocators via healing).
            const match = storedElements.find((el) =>
              el.locatorStrategies.some((ls) => ls.value === fresh.identity.cssSelector),
            );
            if (match) repoIdByKey.set(key, match.id);
          }
          if (repoIdByKey.size > 0) {
            // Rewrite the plan with repository ids and refresh generated_at.
    const { build: buildIRPlan } = await import('../generation/ir-bridge');
    const { buildResultingStateEnrichment } = await import(
      '../generation/assertion-derivation'
    );
    const mappedPlan = buildIRPlan({
      interactions: productionInteractions,
      recordingContext: {
        // Same fallback tier as the first build above.
        startUrl: recordedStartUrl,
        title: recordingStartTitle || null,
        ...(recordingViewport ? { viewport: recordingViewport } : {}),
      },
      testCaseName: (await StorageService.getTestCaseDraft())?.name ?? 'Recorded Test',
      elementIdByKey: repoIdByKey,
      // Track 3 rebuild parity: the SAME enrichment derivation as the first
      // build, so repository-id mapping never drops derived assertions.
      enrichment: buildResultingStateEnrichment(productionInteractions),
    });
            await StorageService.setRaw(StorageKeys.EXECUTION_IR_PLAN, mappedPlan);
            await chrome.storage.local.set({
              [StorageKeys.EXECUTION_IR_PLAN + '_generated_at']: new Date().toISOString(),
            });
          }
        }

        console.info(
          '[D3] session element healing:', JSON.stringify({
            examined: healing.examined, healed: healing.healed, created: healing.created,
          }),
        );
      } catch (healErr) {
        console.warn('[D3] element healing failed (non-fatal):', healErr);
      }

      // M8.2: Persist behavioral evidence to the dedicated table.
      // Runs after persistSession returns sessionId. Non-fatal — wrapped in
      // the outer try/catch. Idempotent via windowId primary key (put).
      //
      // M8.5: Use dedup guard to skip evidence already persisted in this
      // recording cycle (e.g., from SW restart recovery re-persist).
      try {
        const {
          persistBehavioralEvidence,
        } = await import('../repository/services/session-persistence-service');
        const {
          filterUnpersistedEvidence,
          markEvidencePersisted,
        } = await import('../runtime/sw-integration');

        const unpersisted = filterUnpersistedEvidence(productionInteractions);
        if (unpersisted.length > 0) {
          await persistBehavioralEvidence(
            uowFactory,
            persistenceResult.sessionId,
            unpersisted,
          );
          markEvidencePersisted(
            unpersisted
              .filter((i) => i.behavioralEvidence)
              .map((i) => i.behavioralEvidence!.windowId),
          );
        }
      } catch (evErr) {
        console.warn('[Repository V2] error during evidence persistence:', evErr);
      }
    }
  } catch (e) {
    console.warn('[Repository V2] error during session persistence:', e);
  }

  // Update UI state
  const uiState: UIState = {
    recordingState: RecordingState.Stopped,
    lastChanged: new Date().toISOString(),
  };
  await StorageService.setUIState(uiState);

  // Notify all tabs (content scripts listen for STOP_RECORDING to sync state)
  broadcastToTabs({ type: 'STOP_RECORDING' });

  // M6: Stop network observation — wholesale, UNCONDITIONAL session cleanup
  // (G4-E / INV-G6). The getActiveTab lookup below is display-only and must
  // never gate the cleanup: if tabs.query failed, the capture gate must
  // still close (a failed lookup must not leave the gate open forever).
  stopNetworkObservation(-1);
  const stopTab = await getActiveTab().catch(() => null);
  void stopTab;

  // 7.0-KR: session-scoped origin state — a stale committed URL from this
  // session must never key the NEXT session's KR writes (INV session
  // scoping, mirrors sessionNavRecords cleanup above).
  lastCommittedWebUrl = null;
}

// ── OBSERVED_EVENT handler (Component Runtime) ──────────────────────────

async function handleObservedEvent(payload: ObservedEvent): Promise<void> {
  await ensureSessionRestored();

  // CER-2 / G1-A: the trusted-action stamp moved to the onMessage
  // dispatcher — synchronous, keyed by sender.tab.id, before any await, so
  // it is strictly ordered before a native form submit's onBeforeRequest.
  // By the time this async handler runs, the stamp is already authoritative;
  // re-stamping here via getActiveTab() would only add a race back.

  // Process through the Component Runtime
  const emitted = processObservedEvent(payload);

  // Broadcast new interactions to the side panel for live display
  for (const interaction of emitted) {
    chrome.runtime.sendMessage({
      type: 'INTERACTION_CAPTURED',
      interaction,
    }).catch(() => {
      // Side panel may not be open — ignore
    });
  }
}

// ── BEHAVIORAL_EVIDENCE handler (M7-fix-001 — Correlation Contract) ───

/**
 * Handle incoming BehavioralEvidence from the content script.
 *
 * Two-tier matching using existing triggerEvent.eventId:
 *   Tier 1: interaction.triggerEvent.eventId === sourceEventId (preferred)
 *   Tier 2: interaction.memberEvents[].eventId === sourceEventId (fallback)
 *
 * If matched: attaches evidence to interaction.behavioralEvidence,
 * re-persists liveInteractions, and broadcasts INTERACTION_EVIDENCE_UPDATE
 * with the real interactionId.
 *
 * If unmatched: stores in pendingEvidence for later drain on onEmit.
 *
 * Architecture: .drytis/notes/event-interaction-evidence-correlation-contract.md
 */
function handleBehavioralEvidence(
  evidence: import('../shared/behavioral-evidence-types').BehavioralEvidence,
): void {
  // Try to match to a live interaction
  const interactionId = attachEvidenceToInteraction(
    evidence.sourceEventId,
    evidence,
  );

  if (interactionId) {
    // Match found — broadcast update with interactionId
    chrome.runtime.sendMessage({
      type: 'INTERACTION_EVIDENCE_UPDATE',
      payload: { interactionId, evidence },
    }).catch(() => {
      // Side panel may not be open — ignore
    });

    // Event-driven ledger retry (form-submit recovery): the interaction the
    // evidence just attached to may be the owner of unresolved stamped
    // requests (crash-point-B leftovers / pre-completion captures). Attach
    // them now rather than waiting for STOP.
    try {
      const ledger = getAttributionLedger();
      const live = getLiveInteractions();
      if (ledger.attachToInteractions(live) > 0) {
        // delete-after-persist: ack only after LIVE_INTERACTIONS lands
        ledger.acknowledgeAfterPersist(persistLiveInteractions());
      }
    } catch {
      // Non-fatal — STOP drain is the backstop
    }
  } else {
    // No match — store for later drain when interaction is emitted
    storePendingEvidence(evidence);
  }
}

// ── RUN_TEST handler (Phase 12.5) ──────────────────────────────────────

/**
 * Execute the most recently generated ExecutionIRPlan.
 *
 * Flow:
 *   1. Read EXECUTION_IR_PLAN from chrome.storage.local
 *   2. Create IRExecutorImpl with Chrome API bindings
 *   3. Execute the plan against a live browser tab
 *   4. Persist the result as an ExecutionRun to Repository V2
 *   5. Store the result in chrome.storage.local for the side panel
 *   6. Broadcast EXECUTION_RESULT message to the side panel
 *
 * Non-fatal — if any step fails, an error EXECUTION_RESULT is broadcast.
 */
async function handleRunTest(): Promise<void> {
  const startTime = performance.now();

  // 1. Read the IR plan from storage
  // D2: fetch the plan AND its `_generated_at` companion in one get —
  // a single-key get leaves the companion undefined and staleness
  // degenerates to always-true (epoch fallback).
  const irPlanResult = await chrome.storage.local.get([
    StorageKeys.EXECUTION_IR_PLAN,
    StorageKeys.EXECUTION_IR_PLAN + '_generated_at',
  ]);
  const irPlan = irPlanResult[StorageKeys.EXECUTION_IR_PLAN];

  if (!irPlan) {
    broadcastExecutionResult('error', 0, 0, 0, 0);
    return;
  }

  // 1b. Pre-execution staleness check
  // If Repository Elements have been updated since the IR was generated
  // (e.g., via cross-session healing), the cached IR is stale and should
  // be regenerated. For now, we log the staleness report and proceed —
  // full regeneration requires the IR Bridge which needs the original
  // recording events. The staleness check ensures we're aware of drift.
  let irWasStale = false;
  try {
    const { checkStaleness } = await import('../domain/execution-ir/staleness');
    const { DexieUnitOfWorkFactory } = await import('../repository/v2/dexie/dexie-unit-of-work-factory');

    const uowFactory = new DexieUnitOfWorkFactory();
    const uow = uowFactory.create();

    // Collect all element IDs referenced by the IR plan
    const elementIds = new Set<string>();
    for (const step of irPlan.steps) {
      if (step.target.kind === 'element') {
        elementIds.add(step.target.elementId);
      }
    }

    // Load referenced elements from the Repository within a transaction
    const referencedElements: import('../domain/entities/element').Element[] = [];
    if (elementIds.size > 0) {
      const elements = await uow.execute(async (repos) => {
        const result: import('../domain/entities/element').Element[] = [];
        for (const elementId of elementIds) {
          const el = await repos.elements.getById(elementId);
          if (el) result.push(el);
        }
        return result;
      });
      referencedElements.push(...elements);
    }

    // D2: the `_generated_at` companion is written at generation time
    // (handleStopRecording). Pre-D2 plans have no companion — epoch fallback
    // keeps the conservative "older than every element" semantics.
    const irGeneratedAt = irPlanResult[StorageKeys.EXECUTION_IR_PLAN + '_generated_at'] as string
      ?? new Date(0).toISOString(); // epoch if unknown

    const stalenessReport = checkStaleness(
      { id: 'cached', testCaseVersionId: irPlan.testCaseVersionId, plan: irPlan, generatedAt: irGeneratedAt, generatorVersion: 'ir-bridge-1.0', renderings: {} } as import('../domain/execution-ir/types').ExecutionIRArtifact,
      referencedElements,
      'ir-bridge-1.0',
    );

    if (stalenessReport.status === 'stale') {
      irWasStale = true;
      console.warn('[Execution] IR is stale:', stalenessReport.reasons);
      // Proceed with the stale IR — runtime healing in the executor
      // compensates by healing locators during execution. D2 makes this
      // honest: the EXECUTION_RESULT broadcast carries irStale so the side
      // panel can say so instead of implying a fresh verified run.
    }
  } catch (stalenessErr) {
    // Non-fatal — staleness check is an optimization, not a requirement
    console.warn('[Execution] Staleness check failed:', stalenessErr);
  }

  // 2. Create executor and execute the plan
  const { IRExecutorImpl } = await import('../execution/ir-executor-impl');

  // Option D: inter-step causal network drain session for this run. The
  // executor registers its replay tab(s) and paces steps on the tab's
  // causal in-flight requests (webRequest hooks in network-observation.ts —
  // captured before the recorder gate, so RUN_TEST works with recording
  // stopped). Disposed in the finally below — never leaks across runs.
  const { createExecutionDrain } = await import('./network-observation');
  const networkDrain = createExecutionDrain();

  const executor = new IRExecutorImpl({ networkDrain });

  // Track healed elements via a counter (the override map is internal to the executor)
  let healedCount = 0;
  // Option D: dispose the drain session however the run ends (result,
  // rejection, or exception) — its webRequest hooks stop firing immediately.
  const result = await executor
    .execute(irPlan, {
      onStepComplete: (step, stepResult) => {
        // Track healed elements for post-execution invalidation
        if (step.target.kind === 'element' && stepResult.status === 'passed') {
          // The executor's healing is internal — we detect healed elements
          // by checking if the step that initially failed now passes
        }
      },
    })
    .finally(() => networkDrain.dispose());

  // 2b. D2: the _generated_at companion is now written at GENERATION time
  // (handleStopRecording + post-healing rewrite). The old write-here-only-
  // when-stale logic was circular dead code (it could never fire first).
  // Post-run bump REMOVED: rewriting the timestamp after execution would
  // falsely mark a stale plan as fresh — staleness must compare against the
  // plan's true generation time.

  // 3. Persist the result as an ExecutionRun to Repository V2
  let executionRunId: string | null = null;
  try {
    const { createExecutionRun } = await import('../domain/entities/execution-run');
    const { DexieUnitOfWorkFactory } = await import('../repository/v2/dexie/dexie-unit-of-work-factory');

    const draft = await StorageService.getTestCaseDraft();
    const run = createExecutionRun({
      testCaseId: irPlan.testCaseId,
      testCaseVersionId: irPlan.testCaseVersionId,
      projectId: draft?.projectId ?? 'default',
      result,
      environment: {
        baseUrl: irPlan.environment.baseUrl,
        browser: irPlan.environment.browser,
        viewport: irPlan.environment.viewport,
      },
      healedElementIds: [],
    });

    const uowFactory = new DexieUnitOfWorkFactory();
    const uow = uowFactory.create();
    await uow.execute(async (repos) => {
      await repos.executionRuns.save(run);
    });
    executionRunId = run.id;

    console.info('[Execution] ExecutionRun persisted:', executionRunId);
  } catch (e) {
    console.warn('[Execution] Failed to persist ExecutionRun:', e);
    // Non-fatal — the result is still in memory and can be stored in chrome.storage
  }

  // 4. Store the result in chrome.storage.local for the side panel
  const executionSummary = {
    status: result.status,
    stepCount: result.stepResults.length,
    passedSteps: result.stepResults.filter((s: { status: string }) => s.status === 'passed').length,
    failedSteps: result.stepResults.filter((s: { status: string }) => s.status === 'failed').length,
    errorSteps: result.stepResults.filter((s: { status: string }) => s.status === 'error').length,
    skippedSteps: result.stepResults.filter((s: { status: string }) => s.status === 'skipped').length,
    durationMs: result.durationMs,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    stepResults: result.stepResults,
    executionRunId,
    // D2: honest staleness flag — the plan was stale when this run started
    // (an element changed after generation; runtime healing compensated).
    irStale: irWasStale,
  };

  await StorageService.setRaw(StorageKeys.EXECUTION_RESULT, executionSummary);

  // 5. Broadcast result to the side panel
  const durationMs = performance.now() - startTime;
  broadcastExecutionResult(
    result.status,
    result.stepResults.length,
    result.stepResults.filter((s: { status: string }) => s.status === 'passed').length,
    durationMs,
    healedCount,
    irWasStale,
  );
}

/**
 * Broadcast an EXECUTION_RESULT message to the side panel.
 */
function broadcastExecutionResult(
  status: 'passed' | 'failed' | 'error',
  stepCount: number,
  passedSteps: number,
  durationMs: number,
  healedElements: number,
  irStale = false,
): void {
  const message: AppMessage = {
    type: 'EXECUTION_RESULT',
    status,
    stepCount,
    passedSteps,
    durationMs,
    healedElements,
    ...(irStale ? { irStale: true } : {}),
  };
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel may not be open — ignore
  });
}

// ── Navigation capture ──────────────────────────────────────────────────

/**
 * DDC-2: Last committed main-frame URL per tab. Written on every
 * webNavigation.onCommitted BEFORE synthetic evidence is created, so
 * synthetic navigation evidence can carry a real `fromUrl` (the PREVIOUS
 * committed URL) instead of ''. Without it, the view-transition graph has
 * no edges for full-page-reload apps (traditional form submits).
 * Memory-bounded: MAX_TRACKED_TABS entries, shift-evict.
 */
const lastCommittedUrls = new Map<number, string>();
const MAX_TRACKED_TABS = 50;

// NAV pull model: transition types that replace the document (content
// script destroyed). Must match the fullReloadTypes list used below for
// synthetic evidence — hoisted so the pre-await pendingNavCapture write can
// use the same guard without duplicating the literal list.
const FULL_RELOAD_TRANSITION_TYPES = ['reload', 'form_submit', 'auto_toplevel', 'auto_subframe', 'link', 'typed'];

chrome.webNavigation.onCommitted.addListener(async (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
  // Only capture main frame navigations
  if (details.frameId !== 0) return;

  // NAV pull model — record SYNCHRONOUSLY, before ANY await
  // (.drytis/specs/post-nav-evidence-capture.md, AC2-race): the destination
  // page's content script is injected at document_start and pulls
  // (NAV_PENDING_REQUEST) in the same tick as the commit it belongs to. If
  // this record is written after even one await (session restore, tabs.get),
  // the CS pull can arrive first, read null, and never retry — the
  // placeholder would silently stand forever. Recording-active check is
  // deferred to the async tail below; a stale record for a non-recording
  // tab is harmless (bounded map + 30s TTL + consume-on-pull), and the CS
  // only pulls when its sessionStorage recording flag says recording.
  const navPullEventId = `nav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const isFullReload = FULL_RELOAD_TRANSITION_TYPES.includes(details.transitionType);
  if (isFullReload) {
    recordPendingNavCapture(details.tabId, {
      navEventId: navPullEventId,
      fromUrl: lastCommittedUrls.get(details.tabId) ?? '',
      toUrl: details.url,
      navType: details.transitionType,
      committedAt: Date.now(),
    });
  }

  // 7.0-KR (synchronous, pre-await like the NAV pull above): record the
  // last main-frame WEB URL committed by a RECORDING-SCOPE tab as the
  // recording-origin fallback input. The scope gate is deterministic G4-A
  // membership (isRecordingScopeTab — the tab sent the SW a recording-scope
  // message): an unrelated tab's commit can never key this session's KR
  // writes (AC-4). Only http(s) URLs enter the slot (normalizeWebOrigin
  // gate) — an extension or about: URL can never leak in. A non-web or
  // out-of-scope commit does not clear a previously recorded web URL.
  if (isRecordingScopeTab(details.tabId) && normalizeWebOrigin(details.url)) {
    lastCommittedWebUrl = details.url;
    // Panel-active start recovery: the start stamp was the extension URL,
    // so the first recording-scope web commit fills the KR identity key.
    if (recordingOrigin === null) {
      recordingOrigin = normalizeWebOrigin(details.url);
    }
  }

  await ensureSessionRestored();

  // Check if recording is active by checking if we have a runtime
  const liveInts = getLiveInteractions();
  if (liveInts.length === 0 && !await isRecordingActive()) return;

  // DDC-2: capture the PREVIOUS committed URL for this tab before
  // overwriting the map — this is the synthetic nav's fromUrl.
  const previousCommittedUrl = lastCommittedUrls.get(details.tabId) ?? '';

  // Update the per-tab committed-URL map (bounded)
  lastCommittedUrls.set(details.tabId, details.url);
  if (lastCommittedUrls.size > MAX_TRACKED_TABS) {
    const oldestKey = lastCommittedUrls.keys().next().value;
    if (oldestKey !== undefined) lastCommittedUrls.delete(oldestKey);
  }

  // Get the page title (may be empty at commit time)
  let title = '';
  try {
    const tab = await chrome.tabs.get(details.tabId);
    title = tab.title ?? '';
  } catch {}

  // Create a navigation ObservedEvent and process it
  const navEvent: ObservedEvent = {
    eventId: navPullEventId,
    eventType: 'navigation' as any,
    timestamp: Date.now(),
    captureSeq: performance.now(),
    isTrusted: true,
    target: {
      accessibleName: details.url,
      ariaRole: 'document',
      ariaLabel: `Navigation to ${details.url}`,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'HTML',
      className: null,
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: 'html',
      xPath: '/html',
      inIframe: false,
      shadowDom: false,
      href: details.url,
      inputType: null,
      elementId: '',
    },
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      disabled: false,
      readOnly: false,
      required: false,
      ancestorRoles: [],
      ancestorClasses: [],
      tabIndex: null,
    },
    valueBefore: null,
    valueAfter: null,
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
    pageUrl: details.url,
    pageTitle: title,
    // D1: stamp the synthetic navigation event with its capture origin so
    // downstream tab-scoping (episode builder, workflow subsumption) never
    // degrades to 'unknown-tab-resolution' for full-page navigations.
    captureOrigin: { tabId: details.tabId, frameId: 0 },
  };

  processObservedEvent(navEvent);

  // P1-3 Fix: For full-page reloads, the content script is destroyed
  // before the EvidenceCollector can close its window and deliver evidence.
  // The SW should create synthetic navigation evidence so the interaction
  // card shows navigation details instead of "Collecting…" forever.
  //
  // transitionType 'reload', 'auto_subframe', 'form_submit' indicate the
  // page is being replaced — content script destroyed.
  if (FULL_RELOAD_TRANSITION_TYPES.includes(details.transitionType)) {
    // CER-2: Tag in-flight requests from the destroyed document with this
    // navEvent — lifecycle membership (started, not finished), not timestamps.
    snapshotInFlightForTab(details.tabId, navEvent.eventId);

    // CER-2: attach evidence IMMEDIATELY (event-driven) — the interaction
    // may not be emitted yet, but pendingEvidence drain (sw-integration)
    // attaches by sourceEventId when it arrives. The old 200ms timer raced
    // the document download and is removed. Exact-ID recovery happens at
    // stop-recording time via getNetworkEvidenceForNavigation(navEventId),
    // which reads the ring buffer THEN (by then onCompleted has fired) —
    // so late completions are not lost.
    attachSyntheticNavEvidence(navEvent.eventId, details, previousCommittedUrl);

    // NAV pull model (.drytis/specs/post-nav-evidence-capture.md): the
    // destination page's content script pulls the commit record
    // (NAV_PENDING_REQUEST) after auto-resume and opens a post-navigation
    // evidence window attributed to navEventId — capturing the destination
    // DOM/surface/visibility churn that the full reload previously
    // destroyed. If never pulled, the record simply expires and the
    // placeholder above stands. The record was already written
    // synchronously at the top of this listener (pre-await) with the same
    // navPullEventId — this branch just re-confirms it with the canonical
    // navEvent once title/URL bookkeeping is complete (idempotent overwrite,
    // same shape; the CS may already have pulled the early record — both
    // carry the identical navEventId so attachment is exactly-once).
    if (navPullEventId === navEvent.eventId) {
      recordPendingNavCapture(details.tabId, {
        navEventId: navEvent.eventId,
        fromUrl: previousCommittedUrl,
        toUrl: details.url,
        navType: details.transitionType,
        committedAt: Date.now(),
      });
    }
  }
});

/**
 * CER-2: Recover network evidence for a synthetic navigation by EXACT ID.
 *
 * Replaces the timing-based design (onCommitted+200ms + 10s lookback),
 * which could never see the main-frame POST: ring entries were written at
 * onCompleted — strictly after onCommitted — and the ring entry's URL was
 * the post-redirect final URL.
 *
 * New flow:
 *  - At onBeforeRequest, main-frame POSTs are registered per-tab with their
 *    ORIGINAL url/method/body (pendingMainFrame).
 *  - At onCommitted, all in-flight requests from the destroyed document are
 *    tagged with the navEventId (lifecycle membership, no timestamps).
 *  - Here (called from attachSyntheticNavEvidence, which the SW calls at
 *    stop-recording and at commit for display), we join by navEventId and
 *    by the pending main-frame POST — IDs only, no time math.
 *
 * Document-request handling: an unstamped document request is EXCLUDED
 * (the navigation evidence records it) — UNLESS the navigation itself is
 * form-induced: `transitionType === 'form_submit'` is the browser's own
 * causal classification (GET and POST alike). For those, the pending
 * record's missing sourceEventId is back-filled from the tab's current
 * trusted action (G1-C — belt-and-braces with the synchronous G1-A stamp)
 * and the entry participates in recovery by IDENTITY, not by shape.
 */
function recoverNetworkForNavigationById(
  navEventId: string,
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): NetworkActivity[] {
  try {
    // Exact-ID evidence: ring entries + in-flight entries tagged with this navEvent
    const byId = getNetworkEvidenceForNavigation(navEventId);

    // RACE FIX: CONSUME the pending main-frame record here — onCommitted is
    // the single owner allowed to delete it. If onCompleted already fired
    // (losing race order: onBeforeRequest → onCompleted → onCommitted), the
    // record survives with completionStatus stamped; otherwise it carries
    // undefined (= still in flight at commit → honest status null).
    const pendingDoc = consumeMainFrameCorrelation(details.tabId);

    // G1-C: browser-declared causality. A form_submit-typed navigation is
    // caused by the page's form, and the form was triggered by the tab's
    // trusted action. Back-fill the stamp when the G1-A race was
    // lost (or the form was submitted programmatically — no submit event).
    // Idempotent with G1-A: same eventId, no conflict.
    // G4-B: resolution is the deterministic 3-rule precedence (frame 0 →
    // tab-unique → null). Never a time comparison; null leaves the entry
    // unstamped → it renders on the synthetic nav (INV-G10).
    const navIsFormSubmit = details.transitionType === 'form_submit';
    if (pendingDoc && navIsFormSubmit && !pendingDoc.sourceEventId) {
      const stampId = resolveBackfillStamp(details.tabId);
      if (stampId) {
        pendingDoc.sourceEventId = stampId;
      }
    }

    const activities: NetworkActivity[] = [];
    const seenRequestIds = new Set<string>();

    // 1. The form-submit document request itself (Amazon case) —
    // authoritative record. G2 identity-not-shape: participation requires
    // identity (stamp or form_submit type); method and body presence are
    // display metadata, never gates.
    if (pendingDoc && (pendingDoc.sourceEventId || navIsFormSubmit)) {
      seenRequestIds.add(pendingDoc.requestId);
      activities.push({
        url: pendingDoc.originalUrl,
        method: pendingDoc.method,
        // RACE FIX: use the stamped completion status when the race was
        // lost (onCompleted arrived first). undefined = still in flight.
        status: pendingDoc.completionStatus ?? null,
        startRelativeToEvent: 0,
        endRelativeToEvent: null,
        durationMs: null,
        resourceType: 'unknown',
        source: 'webrequest',
        // G2: honest display — body rendered when Chrome parsed one, null
        // otherwise (GET submits / non-urlencoded encodings).
        requestBody: pendingDoc.requestBody ?? undefined,
        // CER-4: exact-event join key for pipeline attribution
        sourceEventId: pendingDoc.sourceEventId ?? undefined,
        // G5-D (INV-F6): carry the REAL Chrome requestId so every consumer
        // (ownership ledger, mergeNetworkActivity dedup, ring join) can
        // identify this exact request across capture paths.
        requestId: pendingDoc.requestId,
      });
    }

    // 2. ID-tagged entries (in-flight at commit or completed since).
    for (const req of byId) {
      if (seenRequestIds.has(req.requestId)) continue;
      seenRequestIds.add(req.requestId);

      // G2 identity-not-shape: an unstamped, non-form-submit document
      // request (address bar, reload) is the navigation itself — the
      // navigation evidence already records it. Skip (no double-count).
      // Identity (stamp) or form_submit type participates regardless of
      // method/body shape.
      if (req.documentRequest && !req.sourceEventId && !navIsFormSubmit) continue;

      // Skip static resources and analytics — they add noise and can
      // fabricate outcome votes for attributed clicks.
      if (/\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff2?|ttf)(\?|$)/i.test(req.url)) continue;
      if (/\/unagi|\/events\/|\/beacon|\/pixel|\/csm|\/aax2|\/impression|fls-|\/1\/batch\/|uedata/i.test(req.url)) continue;

      // status -1 = still in flight → null (honest unknown)
      const status = req.status === -1 ? null : req.status;

      activities.push({
        url: req.url,
        method: req.method,
        status,
        startRelativeToEvent: 0,
        endRelativeToEvent: null,
        durationMs: null,
        resourceType: 'unknown',
        source: 'webrequest',
        requestBody: req.requestBody,
        sourceEventId: req.sourceEventId ?? undefined,
        // G5-D (INV-F6): real requestId — one owning interaction per
        // requestId across all capture paths.
        requestId: req.requestId,
      });
    }

    // Cap at 20 to avoid flooding synthetic evidence
    return activities.slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Create and attach synthetic navigation evidence for full-page-reload
 * navigations where the content script is destroyed before evidence delivery.
 *
 * P1-3 Fix: This ensures navigation interactions always show evidence with
 * the actual URL and navigation type, rather than staying in "Collecting…"
 * state forever.
 */
function attachSyntheticNavEvidence(navEventId: string, details: chrome.webNavigation.WebNavigationTransitionCallbackDetails, previousCommittedUrl: string = ''): void {
  // ── Commit-time causal routing (INV-5, form-submit recovery) ──
  // Entries recovered for this navigation that carry a trusted-action stamp
  // belong to the CLICK that caused the navigation — route them to that
  // interaction via the durable attribution ledger (identity join,
  // synthesize-on-missing), not to the synthetic nav. Only unstamped /
  // unresolved entries remain for the synthetic nav's own network evidence.
  const recovered = recoverNetworkForNavigationById(navEventId, details);
  const forSyntheticNav: NetworkActivity[] = [];
  {
    // Commit-time causal routing (INV-5). Synchronous decision, async-free
    // determinism: resolve each stamped entry's owner NOW; if the owner
    // exists, the ledger attaches (persist-before-ack happens in the same
    // tick); if not, the entry falls back to the synthetic nav (unchanged
    // legacy behavior — the nav owns it when the click never existed).
    const live = getLiveInteractions();
    const ledger = getAttributionLedger();
    for (const activity of recovered) {
      const stamped = activity.sourceEventId;
      if (!stamped) {
        forSyntheticNav.push(activity);
        continue;
      }
      // Parity with resolveInteractionForEventId: synthetic navigations are
      // never join OWNERS (the causal owner is the trusted action), so they
      // must not satisfy ownerExists either.
      // G4-B: origin-aware owner check (INV-G2) — eventId match plus, when
      // both sides carry origins, tab/frame match. Owner candidates are
      // non-synthetic interactions; the ledger join enforces the same rule
      // again at attach time (defense in depth).
      const stampedOrigin = { tabId: details.tabId, frameId: 0 };
      const ownerExists = live.some(
        (i) =>
          i.behavioralEvidence?.window?.endReason !== 'page-reload-synthetic' &&
          (i.triggerEvent?.eventId === stamped ||
            i.memberEvents?.some((e) => e.eventId === stamped)) &&
          (() => {
            const io = i.metadata?.captureOrigin as { tabId: number; frameId: number } | undefined;
            if (!io) return true; // interaction lacks origin — eventId decides
            return io.tabId === stampedOrigin.tabId && io.frameId === stampedOrigin.frameId;
          })(),
      );
      if (ownerExists) {
        // Route to the causal CLICK — attachStampedActivity is idempotent
        // (dedup by requestId inside the ledger).
        void ledger.attachStampedActivity({
          url: activity.url,
          method: activity.method,
          status: activity.status ?? 0,
          requestId: (activity as NetworkActivity & { requestId?: string }).requestId
            ?? `${activity.method}:${activity.url}:${stamped}`,
          sourceEventId: stamped,
          requestBody: activity.requestBody,
          documentRequest: true,
          // G4-B triple key: carry the commit's (tab, frame 0) origin so
          // the ledger join disambiguates cross-tab eventId collisions.
          captureOrigin: { tabId: details.tabId, frameId: 0 },
          // WARN-2 fix: every activity on this path IS a document request
          // (pendingDoc or ring document entry) — the flag must not depend
          // on resourceType ('unknown' here) or method, or a back-filled
          // GET form submit would enter the ledger as a non-mainFrame
          // entry and fall through the telemetry filter (INV-N4 breach).
          mainFrame: true,
        }, live).then((routed) => {
          if (routed) {
            // delete-after-persist: ack only after LIVE_INTERACTIONS lands
            ledger.acknowledgeAfterPersist(persistLiveInteractions());
          }
        });
      } else {
        // G5-D (INV-F5): a STAMPED doc request is NEVER admitted to the
        // synthetic nav's networkActivity. The stamp proves a causal owner
        // exists (or will be emitted); the ledger already holds the entry
        // durably from capture time (durability gate). Hold it — the STOP
        // drain, BEHAVIORAL_EVIDENCE retry, and boot rehydrate are the
        // designed recovery paths. Rendering it on the nav duplicates the
        // request across two interactions (the int-18/int-19 defect).
        // holdStampedActivity is idempotent (dedup by requestId).
        void ledger.holdStampedActivity({
          url: activity.url,
          method: activity.method,
          status: activity.status ?? 0,
          requestId: (activity as NetworkActivity & { requestId?: string }).requestId
            ?? `${activity.method}:${activity.url}:${stamped}`,
          sourceEventId: stamped,
          requestBody: activity.requestBody,
          documentRequest: true,
          mainFrame: true,
          captureOrigin: { tabId: details.tabId, frameId: 0 },
        });
      }
    }
  }

  // Map webNavigation transitionType to NavigationEvidence.type
  const navTypeMap: Record<string, NavigationEvidence['type']> = {
    'link': 'full-reload',
    'typed': 'full-reload',
    'reload': 'full-reload',
    'form_submit': 'full-reload',
    'auto_toplevel': 'full-reload',
    'auto_subframe': 'full-reload',
  };
  const navType: NavigationEvidence['type'] = navTypeMap[details.transitionType] ?? 'full-reload';

  const navEvidenceEntry: NavigationEvidence = {
    type: navType,
    // DDC-2: real previous committed URL (was '' — broke the view graph)
    fromUrl: previousCommittedUrl,
    toUrl: details.url,
    relativeTime: 0,
    batchIndex: null,
  };

  const interactionId = attachEvidenceToInteraction(navEventId, {
    sourceEventId: navEventId,
    sourceEventType: 'navigation',
    windowId: `synthetic-nav-${navEventId}`,
    frameId: 'main',
    window: {
      openedAt: 0,
      closedAt: 0,
      durationMs: 0,
      endReason: 'page-reload-synthetic',
      stabilityTrace: [],
    },
    targetEvidence: {
      identity: {
        accessibleName: details.url,
        ariaRole: 'document',
        ariaLabel: `Navigation to ${details.url}`,
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'HTML',
        className: null,
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        cssSelector: 'html',
        xPath: '/html',
        inIframe: false,
        shadowDom: false,
        href: details.url,
        inputType: null,
        elementId: '',
      },
      identityCapturedAt: performance.now(),
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
      navigation: [navEvidenceEntry],
      // INV-5: only unstamped/unresolved entries — stamped form-submit POSTs
      // were routed to their causal owner above; the nav records the link
      // via causedByInteractionId (stamped by the ledger on attach).
      networkActivity: forSyntheticNav,
      performanceCondition: {
        mainThreadBlocked: false,
        highChurnMode: false,
        longestBatchMs: 0,
        totalBatches: 0,
      },
    },
  });

  if (interactionId) {
    // Successfully attached — broadcast the evidence update
    const evidence = getLiveInteractions().find(i => i.interactionId === interactionId)?.behavioralEvidence;
    if (evidence) {
      chrome.runtime.sendMessage({
        type: 'INTERACTION_EVIDENCE_UPDATE',
        payload: { interactionId, evidence },
      }).catch(() => {});
    }
  }
  // If no match (interaction not yet emitted), the evidence will be stored
  // in pendingEvidence and drained when the interaction is emitted.
  // The 5s timeout is still the fallback.
}

/**
 * Check if recording is currently active.
 */
async function isRecordingActive(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get('cmdrunner_recording_active');
    return result['cmdrunner_recording_active'] === true;
  } catch {
    return false;
  }
}

// ── Message routing ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  const msg = message as AppMessage;

  switch (msg.type) {
    case 'START_RECORDING':
      handleStartRecording();
      break;

    case 'STOP_RECORDING':
      handleStopRecording();
      break;

    case 'OPEN_SETTINGS':
      chrome.runtime.openOptionsPage();
      break;

    case 'OPEN_REPOSITORY': {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/repository/index.html') });
      break;
    }

    case 'RUN_TEST': {
      handleRunTest().catch((e) => {
        console.warn('[Execution] error:', e);
        chrome.runtime.sendMessage({
          type: 'EXECUTION_RESULT',
          status: 'error',
          stepCount: 0,
          passedSteps: 0,
          durationMs: 0,
          healedElements: 0,
        }).catch(() => {});
      });
      break;
    }

    case 'PING':
      // Side panel pinging the service worker — respond with recording state
      isRecordingActive().then((recording) => {
        sendResponse({ type: 'PONG', recording });
      });
      return true;

    case 'OBSERVED_EVENT': {
      const msg = message as { type: string; payload: ObservedEvent };
      // G1-A (native form-submit attribution): stamp the trusted action
      // SYNCHRONOUSLY at message dispatch, before any await. The tap sends
      // OBSERVED_EVENT during the click's own dispatch; the default action
      // (a native form submit's main_frame request) cannot start until that
      // dispatch completes — so this write is strictly ordered before
      // onBeforeRequest can observe the request. sender.tab.id is the
      // request's true tab (getActiveTab() both raced the stamp and could
      // resolve to a different focused tab).
      //
      // G4-B: the stamp key is (tabId, sender.frameId) — the exact frame
      // the event came from. G4-C (INV-G3): only interaction-creating
      // event types stamp; mousemove/focus/blur/input never overwrite a
      // click's stamp between the click and a JS-delayed form.submit().
      // Enter-key keydown stamps; other keys do not.
      //
      // G5-B (INV-F1/F2): `submit` is demoted to a SECONDARY (create-only)
      // stamp — the native submit DOM event is a consequence of the
      // initiating click/Enter, never a new trusted action. Primary events
      // overwrite as before; secondary events stamp only when the frame
      // has no stamp (the programmatic form.submit() case).
      if (
        msg.payload?.isTrusted &&
        _sender?.tab?.id != null
      ) {
        // B7-P2 §5.2.3 (R-4): the discovery gate for mouseenters is
        // computed HERE — from the payload's own target fields via the
        // shared isInteractiveElement predicate (patterns.ts, scalar
        // 4-arg form; no vocabulary). Only a gated trusted mouseenter is
        // classified secondary (create-only); all other mouseenters stay
        // ineligible. The classifier itself cannot compute this (no
        // identity) — the dispatcher owns the gate.
        const gatedEnter =
          msg.payload.eventType === 'mouseenter' &&
          isInteractiveElement(
            msg.payload.target?.tag,
            msg.payload.target?.ariaRole,
            msg.payload.target?.className,
            msg.payload.domContext?.tabIndex ?? null,
          );
        const cls = stampClass(msg.payload.eventType, msg.payload.key, gatedEnter);
        if (cls === 'primary') {
          setLastTrustedAction(_sender.tab.id, _sender.frameId ?? 0, {
            eventId: msg.payload.eventId,
            interactionId: '',
          });
        } else if (cls === 'secondary') {
          setLastTrustedActionIfAbsent(_sender.tab.id, _sender.frameId ?? 0, {
            eventId: msg.payload.eventId,
            interactionId: '',
          });
        }
      }
      // G4-B: record the capture origin (tab/frame) on the payload so the
      // interaction/evidence join can use the triple key downstream.
      if (_sender?.tab?.id != null && !msg.payload.captureOrigin) {
        msg.payload.captureOrigin = { tabId: _sender.tab.id, frameId: _sender.frameId ?? 0 };
      }
      // G4-A (INV-G4): the sender's tab joins the FORWARDING set —
      // recording-scope traffic proves the tab is recording. Deterministic
      // membership growth; forwarding-only (never gates capture).
      if (_sender?.tab?.id != null) noteRecordingScopeTab(_sender.tab.id);
      // 7.0-KR recovery backfill: this tab JUST proved recording scope by
      // sending an observed event — ask Chrome for ITS OWN URL and adopt it
      // as the KR identity key when still unresolved (panel-active start).
      // Covers SPAs whose last commit predates START (no in-session
      // onCommitted would ever fire): the 6E fixture family. Deterministic
      // event-order, no timing rule; first scope-proving web tab wins (same
      // "start-tab wins" semantics as the START stamp).
      if (_sender?.tab?.id != null && recordingOrigin === null) {
        const tabId = _sender.tab.id;
        void chrome.tabs.get(tabId).then((t) => {
          const o = t?.url ? normalizeWebOrigin(t.url) : null;
          if (o && recordingOrigin === null) recordingOrigin = o;
        }).catch(() => {});
      }
      handleObservedEvent(msg.payload);
      sendResponse({ ok: true });
      return true;
    }

    case 'BEHAVIORAL_EVIDENCE': {
      const msg = message as { type: string; payload: import('../shared/behavioral-evidence-types').BehavioralEvidence };
      // G4-A (INV-G4): evidence traffic proves the sender's tab is
      // recording — forward-eligibility grows deterministically.
      if (_sender?.tab?.id != null) noteRecordingScopeTab(_sender.tab.id);
      handleBehavioralEvidence(msg.payload);
      sendResponse({ ok: true });
      return true;
    }

    case 'NAV_PENDING_REQUEST': {
      // NAV pull model: the destination page's content script asks for the
      // pending full-reload navigation record for ITS tab. Consume-on-pull
      // (exactly-once per navigation). No record → null (SPA nav, already
      // pulled, expired TTL, or no full-reload commit) — the caller keeps
      // the placeholder. Async response.
      if (_sender?.tab?.id == null) {
        sendResponse({ type: 'NAV_PENDING_RESPONSE', payload: null });
        return false;
      }
      const record = consumePendingNavCapture(_sender.tab.id);
      // CP5/R1: retain the consumed record for this session's behavior
      // model (copy-in-hand; the store's delete already happened inside
      // consume). No-op when null.
      if (record) retainNavRecord(record);
      sendResponse({ type: 'NAV_PENDING_RESPONSE', payload: record });
      return false;
    }

    case 'TRIGGER_REMOVED': {
      // B7-P2 §5.2.2 T4: a hover's trigger element was removed from the
      // DOM mid-gesture. Complete the lifecycle (terminal 'target-removed')
      // through the runtime's structural terminal. Fire-and-forget — the
      // runtime no-ops safely on unknown/already-completed ids, and the
      // CS-side window close already ran. The seam broadcasts
      // INTERACTION_CAPTURED itself (handleObservedEvent parity).
      const msg = message as {
        type: 'TRIGGER_REMOVED';
        payload: { lifecycleId: string | null; triggerEventId: string };
      };
      try {
        handleTriggerRemovedNotification(msg.payload ?? { lifecycleId: null, triggerEventId: '' });
      } catch (err) {
        console.warn('[CmdRunner] TRIGGER_REMOVED handling failed:', err);
      }
      return false;
    }

    default:
      // Unknown message type — ignore
      break;
  }

  return false; // synchronous response
});

// ── Broadcast helper ────────────────────────────────────────────────────

async function broadcastToTabs(message: { type: string }): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Content script may not be injected on this tab — ignore
        });
      }
    }
  } catch {
    // Tabs API may not be available — ignore
  }
}

/**
 * Broadcast a message to the side panel (if open).
 * The side panel receives CONTENT_SCRIPT_STATUS messages to update its
 * health indicator.
 */
function broadcastToPanel(message: AppMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel may not be open — ignore
  });
}

// ── Side Panel action ───────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Set the side panel to open when the extension icon is clicked
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// ── Periodic content script health check during recording ───────────────

/**
 * Periodically check that the active tab's content script is alive while
 * recording. Uses chrome.alarms (MV3-compatible — survives SW restarts).
 *
 * Every ~5 seconds while recording:
 *   1. Pings the active tab's content script
 *   2. If no response, programmatically injects it
 *   3. Broadcasts health status to the side panel
 */
const HEALTH_CHECK_ALARM = 'cs-health-check';

chrome.alarms.create(HEALTH_CHECK_ALARM, { periodInMinutes: 0.08 }); // ~5s

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEALTH_CHECK_ALARM) {
    isRecordingActive().then((active) => {
      if (active) checkActiveTabHealth().catch(() => {});
    });
  }
});
