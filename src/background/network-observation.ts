/**
 * Network Observation — SW-side webRequest listener management (M6)
 *
 * Manages chrome.webRequest listeners in the service worker for parallel
 * network capture. Also orchestrates MAIN-world injection of network-inject.js
 * via chrome.scripting.executeScript({ world: 'MAIN' }).
 *
 * webRequest listeners are registered IMMEDIATELY when recording starts —
 * BEFORE the dynamic injection call. They run in parallel with the MAIN-world
 * interceptor for the entire recording session, covering the race window
 * (spec §6.3).
 *
 * Captured request metadata is forwarded to the content script's NetworkBridge
 * via chrome.tabs.sendMessage with type 'NETWORK_REQUEST'.
 *
 * Architecture: behavioral-evidence-model.md §6.2, §6.3, §6.4
 */

// ── Types ────────────────────────────────────────────────────────────

import { StorageKeys } from '../shared/types';

/**
 * Persisted FORWARDING hint (MV3 lifecycle fix + G4-A demotion).
 *
 * chrome.storage.local key holding the array of tabIds whose pages hold a
 * live NetworkBridge. Written at startNetworkObservation, grown by
 * noteRecordingScopeTab (recording-scope messages), cleared at
 * stopNetworkObservation. On service-worker restart the module re-seeds the
 * set from this key. INV-G4: membership influences whether captured
 * requests are FORWARDED to the page — never whether they are captured or
 * attributed (that is `recordingActiveFlag`).
 */
export const OBSERVING_TABS_KEY = 'cmdrunner_net_observing_tabs';

/**
 * Persisted last trusted action per recording (MV3 lifecycle fix).
 * Survives SW restarts so requests waking a fresh SW can still be stamped
 * with the click that triggered them (exact sourceEventId join).
 */
export const LAST_ACTION_KEY = 'cmdrunner_net_last_action';

/** Max age of a persisted last-action stamp before it is ignored (ms). */
export const LAST_ACTION_TTL_MS = 30_000;

/** In-flight webRequest tracking for matching start → complete. */
interface InFlightWebRequest {
  url: string;
  /** Original URL captured at onBeforeRequest — never rewritten by redirects. */
  originalUrl: string;
  method: string;
  startTime: number;
  requestId: string;
  /** G4-A: owning tab — required now that capture spans multiple tabs. */
  tabId: number;
  frameId: number;
  /** Chrome resource type: main_frame, sub_frame, xmlhttprequest, ... */
  resourceKind: string;
  requestBody?: Record<string, string>;
  /** CER-2: navEvent tag set at webNavigation.onCommitted (destroyed-document membership). */
  navEventId?: string;
  /** CER-2: last trusted user-action event id at request start (exact click join). */
  sourceEventId?: string;
}

/**
 * Completed request record for the ring buffer.
 * Used by synthetic nav evidence to recover form-submit POSTs.
 */
export interface CompletedWebRequest {
  /** ORIGINAL request URL (pre-redirect) — classification runs on this. */
  url: string;
  /** Final URL after redirects (diagnostic). */
  finalUrl?: string;
  /** Full redirect chain (original → hops → final), when observed. */
  redirectChain?: string[];
  method: string;
  status: number;
  startWallClock: number;
  endWallClock: number;
  requestId: string;
  /** G4-B triple key: owning tab (multi-tab capture). */
  tabId?: number;
  frameId?: number;
  /** True when this request IS the navigation document (CER-2). */
  documentRequest?: boolean;
  /** navEvent of the commit that superseded this request's document (CER-2). */
  navEventId?: string;
  /** Trusted user-action event id at request start (CER-2). */
  sourceEventId?: string;
  requestBody?: Record<string, string>;
}

/** Pending main-frame request captured at onBeforeRequest (CER-2). */
export interface PendingMainFrameRequest {
  requestId: string;
  tabId: number;
  frameId: number;
  originalUrl: string;
  method: string;
  requestBody?: Record<string, string>;
  sourceEventId?: string;
  /**
   * RACE FIX: completion status recorded by onCompleted/onErrorOccurred.
   *
   * Chrome dispatches webRequest.onCompleted (full body received) BEFORE
   * webNavigation.onCommitted reaches the extension for fast document
   * responses (Amazon add-to-cart: POST → 200 HTML directly). The old code
   * DELETED the pending record at onCompleted, so the commit-time recovery
   * read null and the POST was lost. Now completion only STAMPS status —
   * the record stays alive until the onCommitted path consumes it
   * (consumeMainFrameCorrelation).
   *
   * undefined        → still in flight
   * number >= 0      → completed with this HTTP status
   * number < 0       → errored (network error, cancel; -1 by convention)
   */
  completionStatus?: number;
}

// ── Constants ────────────────────────────────────────────────────────

/** URL filter for webRequest listeners. */
const URL_FILTER = ['http://*/*', 'https://*/*'];

/** How long to retain completed requests in the ring buffer (ms). */
// Exported for the INV-6 regression pin (tests assert the production values
// are unchanged — stamped recovery never depends on ring eviction).
export const COMPLETED_BUFFER_TTL_MS = 10_000;

/** Maximum completed requests to retain. */
// Exported for the INV-6 regression pin (same rationale as TTL above).
export const MAX_COMPLETED_ENTRIES = 100;

// ── Module state ─────────────────────────────────────────────────────

/**
 * G4-A: the tab recording STARTED in. Retained for diagnostics only —
 * capture is gated by `recordingActiveFlag` (recording-scoped), never by
 * tab identity (INV-G1). Read via __testGetGateState().startTab in tests.
 */
let activeTabId: number | null = null;

/** In-flight requests keyed by requestId. */
const inFlightRequests = new Map<string, InFlightWebRequest>();

/**
 * Ring buffer of recently completed requests.
 * Used to bridge network evidence into synthetic navigation interactions
 * for full-page-reload apps (e.g., Amazon Add to Cart).
 */
const completedRequests: CompletedWebRequest[] = [];

/**
 * CER-2: Pending main-frame request per tab, captured at onBeforeRequest —
 * BEFORE redirects and BEFORE completion. This is the authoritative record
 * of the form-submit POST (original URL + method + body).
 */
const pendingMainFrameByTab = new Map<number, PendingMainFrameRequest>();

/**
 * G1-B (native form-submit attribution): pending main-frame records are
 * DURABLE for every main_frame request, stamped or not. Write-through:
 * the in-memory map remains the synchronous source of truth for same-turn
 * readers; this persist makes the record survive SW termination between
 * capture (onBeforeRequest) and its sole consumer (onCommitted). Shape:
 * { [tabId]: PendingMainFrameRequest } under StorageKeys.PENDING_NAV_DOCS.
 * No TTL — eviction is state-based (consume at commit) or session-scoped
 * cleanup (STOP / startNetworkObservation).
 */
const PENDING_NAV_DOCS_KEY = 'cmdrunner_pending_nav_docs';
void PENDING_NAV_DOCS_KEY; // single-sourced via StorageKeys.PENDING_NAV_DOCS above

/** Serialize + persist the current pending-doc map (single key, atomic). */
function persistPendingNavDocs(): Promise<void> {
  try {
    const snapshot: Record<string, PendingMainFrameRequest> = {};
    for (const [tabId, rec] of pendingMainFrameByTab) {
      snapshot[String(tabId)] = rec;
    }
    return (chrome?.storage?.local?.set
      ? chrome.storage.local.set({ [StorageKeys.PENDING_NAV_DOCS]: snapshot })
      : Promise.resolve()
    ).then(
      () => undefined,
      () => undefined, // storage failure — memory remains source of truth
    );
  } catch {
    // Storage unavailable — in-memory only (pre-fix behavior)
    return Promise.resolve();
  }
}

/**
 * G1-B boot path: restore durable pending-doc records after SW restart so
 * the commit consumer still finds its record (MV3 lifecycle continuity).
 * In-memory entries win (they are newer or equal).
 */
export function restorePendingNavDocsFromStorage(): Promise<void> {
  const p: Promise<Record<string, unknown>> = chrome?.storage?.local?.get
    ? chrome.storage.local.get(StorageKeys.PENDING_NAV_DOCS)
    : Promise.resolve({});
  return p.then(
    (raw) => {
      const stored = (raw?.[StorageKeys.PENDING_NAV_DOCS] ?? {}) as Record<
        string,
        PendingMainFrameRequest
      >;
      for (const [tabIdStr, rec] of Object.entries(stored)) {
        const tabId = Number(tabIdStr);
        if (Number.isFinite(tabId) && rec && !pendingMainFrameByTab.has(tabId)) {
          pendingMainFrameByTab.set(tabId, rec);
        }
      }
    },
    () => {
      // Storage read failure — in-memory only
    },
  );
}

/**
 * CER-2: redirect chains keyed by requestId. requestId is reused across
 * redirect hops by Chrome; onBeforeRedirect records each hop.
 */
const redirectChains = new Map<string, string[]>();

/**
 * CER-2: last trusted user action per TAB+FRAME, keyed `tabId:frameId`
 * (G4-B triple-key attribution). Set by the service worker dispatcher on
 * every stamp-ELIGIBLE trusted event (INV-G3); read at onBeforeRequest via
 * the EXACT frame key — no cross-frame fallback (INV-G2/G10).
 */
const lastTrustedActionByFrame = new Map<
  string,
  { tabId: number; frameId: number; eventId: string; interactionId: string; wallClock: number }
>();

/** Frame-stamp map key. */
export function frameKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`;
}

/** Whether webRequest listeners are currently registered. */
let listenersActive = false;

/**
 * MV3 lifecycle vestige (G4-A): true once module init has re-seeded the
 * observing set. Kept for diagnostics/test hooks only — the unknown-state
 * capture signal is the tri-state `recordingActiveFlag` (null = boot
 * unknown → ring-only capture, no forward), not this flag.
 */
let gateSeeded = false;

/**
 * G4-A (multi-tab capture): in-memory mirror of the recording-active flag.
 * THE capture gate — while true, webRequest traffic from EVERY tab is
 * captured (INV-G1). `observingTabIds` is demoted to a forwarding hint
 * (INV-G4) and never gates capture again.
 *   true              → capture (any tab)
 *   false             → drop
 *   null (boot-unknown, flag not yet seeded) → capture conservatively,
 *                        ring-only, never forward
 */
let recordingActiveFlag: boolean | null = null;

/** Storage key backing `recordingActiveFlag` (sw-integration owns writes). */
const RECORDING_ACTIVE_KEY = 'cmdrunner_recording_active';

/**
 * G4-D (boot-restore ordering): single awaitable promise that settles when
 * ALL durable state (observing set + frame stamps + pending nav docs) has
 * been re-read. Consumers (`ensureSessionRestored`) await this BEFORE
 * reading restored state; capture writers never block on it (in-memory
 * state wins — INV-G5).
 */
let bootRestorePromise: Promise<void> | null = null;

/**
 * TabIds known to have an active recording (mirrors the persisted set).
 * Members are recording tabs regardless of which SW instance started them.
 */
const observingTabIds = new Set<number>();

/** Callback for onBeforeRequest. */
let onBeforeRequestCallback:
  | ((details: chrome.webRequest.WebRequestBodyDetails) => void)
  | null = null;

/** Callback for onBeforeRedirect (CER). */
let onBeforeRedirectCallback:
  | ((details: chrome.webRequest.WebRedirectionResponseDetails) => void)
  | null = null;

/** Callback for onCompleted. */
let onCompletedCallback:
  | ((details: chrome.webRequest.WebResponseCacheDetails) => void)
  | null = null;

/** Callback for onErrorOccurred. */
let onErrorCallback:
  | ((details: chrome.webRequest.WebResponseErrorDetails) => void)
  | null = null;

// ── MV3 Lifecycle: persisted gate + top-level registration ───────────

/**
 * Whether captured requests from this tab should be FORWARDED to the page's
 * NetworkBridge. G4-A demotion: this is a forwarding hint, NOT the capture
 * gate — capture is gated by `recordingActiveFlag` (recording-scoped, any
 * tab). Listeners are registered at top level (every SW start).
 */
function tabIsObserving(tabId: number): boolean {
  return observingTabIds.has(tabId);
}

/**
 * Per-callback capture gate (G4-A: recording-scoped, NOT tab-scoped).
 *
 * true  → a recording is active — capture from EVERY tab (INV-G1).
 * false → recording stopped → drop.
 * boot-unknown (flag not yet seeded) → capture conservatively into the
 * ring, never forward. The stop-time drain (sourceEventId join) recovers
 * these. Conservative in the direction of capturing evidence, never
 * fabricating it.
 */
function shouldProcessRequest(tabId: number): boolean {
  void tabId; // G4-A: tab identity NEVER gates capture (INV-G1)
  if (recordingActiveFlag === true) return true;   // recording → any tab
  if (recordingActiveFlag === false) return false;  // stopped → drop
  return true; // boot-unknown → conservative ring-only capture
}

/** Exported for tests. */
export const shouldProcessRequestForTest = shouldProcessRequest;

/**
 * Whether a captured request should be forwarded to the content script's
 * NetworkBridge (live evidence window collection) or held in the SW ring
 * only (unknown-state / restarted-SW case).
 */
function shouldForwardToTab(tabId: number): boolean {
  // G4-A (INV-G4): forwarding only. The bridge lives in the page and exists
  // while this SW instance's session started it (or it auto-resumed via the
  // content script). Capture correctness NEVER depends on this answer.
  if (recordingActiveFlag !== true) return false; // unknown/stopped → never
  return tabIsObserving(tabId);
}

/** Exported for tests. */
export function __testForwardToTab(tabId: number): boolean {
  return shouldForwardToTab(tabId);
}

/**
 * Persist the observing-tabs set to chrome.storage.
 * Fire-and-forget: in-memory set is the synchronous source of truth;
 * storage is the cross-SW-restart source of truth.
 */
function persistObservingTabs(): void {
  try {
    const record: Record<string, unknown> = {
      [OBSERVING_TABS_KEY]: [...observingTabIds],
    };
    void (chrome?.storage?.local?.set
      ? chrome.storage.local.set(record)
      : Promise.resolve());
  } catch {
    // Storage unavailable — degraded to in-memory-only gate
  }
}

/**
 * Re-seed the observing-tabs gate from chrome.storage on module load.
 *
 * Runs once per SW start, async. While it is in flight (or when storage is
 * unavailable), `gateSeeded` is false and callbacks take the conservative
 * unknown-state path: buffer requests from any tab into the ring (bounded),
 * never forward to the content script. Nothing is lost; the stop-time drain
 * joins by sourceEventId as the recovery path.
 */
function seedObservingTabsFromStorage(): Promise<void> {
  return (async () => {
    try {
      const result = (await chrome.storage.local.get(OBSERVING_TABS_KEY)) as {
        [k: string]: unknown;
      };
      const stored = result?.[OBSERVING_TABS_KEY];
      if (Array.isArray(stored)) {
        for (const id of stored) {
          if (typeof id === 'number') observingTabIds.add(id);
        }
      }
    } catch {
      // storage API missing (tests) — in-memory gate only
    }
  })();
}

/**
 * G4-A (INV-G4): deterministic observing-set membership growth — a tab
 * enters the FORWARDING set when the SW receives a recording-scope message
 * from it (OBSERVED_EVENT / BEHAVIORAL_EVIDENCE). No probing, no timers.
 * Membership influences forwarding only — never capture or attribution.
 */
export function noteRecordingScopeTab(tabId: number): void {
  if (observingTabIds.has(tabId)) return;
  observingTabIds.add(tabId);
  persistObservingTabs();
}

/**
 * Start network observation for a tab.
 *
 * 1. Immediately registers webRequest listeners (covers race window)
 * 2. Injects MAIN-world network interceptor (better metadata)
 *
 * Both run in parallel for the entire recording session.
 *
 * @param tabId The tab to observe
 */
export async function startNetworkObservation(tabId: number): Promise<void> {
  // G4-A: recording-scoped capture gate — set SYNCHRONOUSLY first so the
  // very first request of the session already passes (INV-G1).
  recordingActiveFlag = true;
  try {
    void chrome?.storage?.local?.set?.({ [RECORDING_ACTIVE_KEY]: true });
  } catch { /* storage missing (tests) — in-memory gate is enough */ }
  activeTabId = tabId;
  inFlightRequests.clear();
  completedRequests.length = 0;
  pendingMainFrameByTab.clear();
  redirectChains.clear();
  lastTrustedActionByFrame.clear();
  // G1-B: new recording session — session-scoped cleanup (never outlives
  // its session), then persist the empty state.
  persistPendingNavDocs();
  persistLastTrustedActionSnapshot();

  // INV-G4: the observing set is a FORWARDING hint only. It is seeded with
  // the start tab and grows as the SW receives recording-scope messages
  // from other tabs (deterministic membership growth — no probing).
  observingTabIds.clear();
  observingTabIds.add(tabId);
  persistObservingTabs();
  gateSeeded = true;

  // 1. Register webRequest listeners IMMEDIATELY (race coverage)
  registerWebRequestListeners();

  // 2. Inject MAIN-world interceptor (idempotent; manifest content script
  //    also auto-injects on every document — this covers the start race)
  await injectNetworkInterceptor(tabId);
}

/**
 * Stop network observation.
 *
 * Removes webRequest listeners. The MAIN-world script restores itself
 * via the 'cmdrunner-net-stop' CustomEvent (dispatched by the NetworkBridge
 * in the content script).
 *
 * @param tabId The tab to stop observing
 */
export function stopNetworkObservation(_tabId: number): void {
  // G4-A: close the capture gate FIRST (synchronous) — drains have already
  // run; nothing captured after STOP belongs to this session (INV-G6).
  recordingActiveFlag = false;
  try {
    void chrome?.storage?.local?.set?.({ [RECORDING_ACTIVE_KEY]: false });
  } catch { /* storage missing (tests) */ }
  gateSeeded = true; // a stopped session is never "unknown"
  activeTabId = null;

  // G4-E: WHOLESALE cleanup — every tab, memory AND persisted. The old
  // code deleted only the stop-time active tab, so a start/stop tab
  // mismatch persisted stale ids into the next session.
  observingTabIds.clear();
  persistObservingTabs();
  inFlightRequests.clear();
  pendingMainFrameByTab.clear();
  persistPendingNavDocs();
  redirectChains.clear();
  lastTrustedActionByFrame.clear();
  persistLastTrustedActionSnapshot();
  // Keep listeners registered — top-level registration is now permanent
  // and gated per-tab by the persisted observing set (MV3 lifecycle fix).

  // Note: MAIN-world restoration is handled by the content script's
  // NetworkBridge.sendStopSignal() which dispatches 'cmdrunner-net-stop'
}

/**
 * Whether webRequest listeners are currently active.
 */
export function isObserving(): boolean {
  return listenersActive;
}

/**
 * TEST-ONLY hook: simulate the SW-wake window by directly setting the gate
 * state (seeded flag + observing set). No production caller.
 */
export function __testSetGateStateForSim(state: { seeded: boolean; tabs: number[] }): void {
  gateSeeded = state.seeded;
  observingTabIds.clear();
  for (const t of state.tabs) observingTabIds.add(t);
}

/** G4-A test hook: set the recording-active flag (tri-state — undefined = boot-unknown). */
export function __testSetRecordingActive(v: boolean | undefined): void {
  recordingActiveFlag = v === undefined ? null : v;
}

/** G4-A test hook: observe the gate state. */
export function __testGetGateState(): { seeded: boolean; recordingActive: boolean | null; tabs: number[]; startTab: number | null } {
  return {
    seeded: gateSeeded,
    recordingActive: recordingActiveFlag,
    tabs: [...observingTabIds],
    startTab: activeTabId,
  };
}

/** G4-A test hook: force listener (re-)registration under a fresh chrome stub. */
export function __testRegisterForListeners(): void {
  listenersActive = false;
  registerWebRequestListeners();
}

/** Test-only: clear all frame stamps + in-flight state (fresh-module simulation). */
export function __testResetStamps(): void {
  lastTrustedActionByFrame.clear();
  inFlightRequests.clear();
}

/** G4-D test hook: the single awaitable boot-restore promise. */
export function getBootRestorePromise(): Promise<void> {
  return bootRestorePromise ?? Promise.resolve();
}

/** G4-B helper: persist the current frame-stamp snapshot (wholesale write). */
function persistLastTrustedActionSnapshot(): void {
  try {
    const snapshot: Record<string, unknown> = {};
    for (const [k, rec] of lastTrustedActionByFrame) {
      snapshot[k] = {
        tabId: rec.tabId,
        frameId: rec.frameId,
        action: { eventId: rec.eventId, interactionId: rec.interactionId },
        wallClock: rec.wallClock,
      };
    }
    void chrome?.storage?.local?.set?.({ [LAST_ACTION_KEY]: snapshot });
  } catch {
    // storage missing (tests) — in-memory only
  }
}

/**
 * Return recently completed requests matching a time range and optional URL filter.
 *
 * Used by `attachSyntheticNavEvidence` to recover form-submit POSTs that
 * were captured by webRequest but never delivered to the content script
 * (because the page was destroyed by the reload).
 *
 * @param sinceWallClock - Date.now() threshold; only entries with
 *   `endWallClock >= sinceWallClock` are returned.
 * @param urlPattern - Optional regex string; only matching URLs returned.
 */
export function getRecentRequests(
  sinceWallClock: number,
  urlPattern?: string,
): CompletedWebRequest[] {
  const re = urlPattern ? new RegExp(urlPattern, 'i') : null;
  return completedRequests.filter(
    (r) =>
      r.endWallClock >= sinceWallClock &&
      (!re || re.test(r.url)),
  );
}

// ── CER: ID/Lifecycle-based correlation APIs ─────────────────────────

/**
 * G4-C (INV-G3): only interaction-creating events may stamp a trusted
 * action. Mirrors ACTION_WINDOW_EVENT_TYPES (evidence-collector) + `drop`
 * (M9.10 drag&drop). mousemove/focus/blur/input/… are evidence inputs but
 * never create interactions, so they can NEVER create or overwrite a stamp
 * (the R14 stamp-steal defect).
 *
 * G5-A (INV-F2) amends this: `submit` is demoted to a SECONDARY (create-
 * only) stamp. A native form submission is a *consequence* of the
 * initiating action (click on a submit button, Enter keydown); the trusted
 * `submit` DOM event must never overwrite the initiating action's stamp
 * (the int-18/int-19 duplicate attribution defect). It may create a stamp
 * only when the exact (tabId, frameId) has none — the sole case where the
 * submit IS the trusted cause (programmatic form.submit()).
 */
const STAMP_ELIGIBLE_EVENT_TYPES = new Set<string>([
  'click', 'contextmenu', 'change', 'drop',
]);

/** G5-A: stamp classes. `secondary` = create-only (never overwrites). */
export type StampClass = 'primary' | 'secondary' | 'ineligible';

/** Event types that OVERWRITE the frame stamp (trusted causes). */
const SECONDARY_STAMP_EVENT_TYPES = new Set<string>(['submit']);

/**
 * G5-A: classify an event's stamping authority.
 *  - primary:   click / contextmenu / change / drop / keydown(Enter) —
 *               interaction-creating trusted actions; overwrite.
 *  - secondary: submit — create-only (INV-F2).
 *  - ineligible: everything else (mousemove/focus/blur/input/other keys).
 */
export function stampClass(eventType: string, key?: string | null): StampClass {
  if (eventType === 'keydown') return key === 'Enter' ? 'primary' : 'ineligible';
  if (SECONDARY_STAMP_EVENT_TYPES.has(eventType)) return 'secondary';
  if (STAMP_ELIGIBLE_EVENT_TYPES.has(eventType)) return 'primary';
  return 'ineligible';
}

/**
 * G4-C: whether an observed event may stamp (keydown: Enter only).
 * G5-A back-compat: `submit` still returns true — the create-only
 * semantics are enforced by the dispatcher calling
 * `setLastTrustedActionIfAbsent` for secondary-class events.
 */
export function stampEligible(eventType: string, key?: string | null): boolean {
  return stampClass(eventType, key) !== 'ineligible';
}

/**
 * CER-2 / G4-B: Record the last trusted user action for a TAB+FRAME.
 * Called synchronously by the service worker dispatcher (G1-A ordering:
 * before any await, during the click's own message dispatch). Read at
 * onBeforeRequest via the exact `tabId:frameId` key (INV-G2).
 */
export function setLastTrustedAction(
  tabId: number,
  frameId: number,
  action: { eventId: string; interactionId: string },
): void {
  lastTrustedActionByFrame.set(frameKey(tabId, frameId), {
    tabId,
    frameId,
    ...action,
    wallClock: Date.now(),
  });
  // MV3 lifecycle fix: persist so a SW-restart instance can still stamp
  // requests with the correct trusted action (exact-event join survives
  // service-worker death between the click and the request). Per-frame
  // map shape: { [`${tabId}:${frameId}`]: { tabId, frameId, action, wallClock } }.
  try {
    const snapshot: Record<string, unknown> = {};
    for (const [k, rec] of lastTrustedActionByFrame) {
      snapshot[k] = {
        tabId: rec.tabId,
        frameId: rec.frameId,
        action: { eventId: rec.eventId, interactionId: rec.interactionId },
        wallClock: rec.wallClock,
      };
    }
    void (chrome?.storage?.local?.set
      ? chrome.storage.local.set({ [LAST_ACTION_KEY]: snapshot })
      : Promise.resolve());
  } catch {
    // Storage unavailable — in-memory only (pre-restart behavior)
  }
}

/**
 * G5-C (INV-F2): SECONDARY stamp write — create-only. Writes the frame
 * stamp iff the exact (tabId, frameId) has NO stamp yet. Used for the
 * trusted `submit` DOM event: it is a consequence of the initiating
 * action (click/Enter), so it must never overwrite an existing stamp —
 * but when it is the ONLY trusted cause (programmatic form.submit() with
 * no prior click), it IS the trusted cause and may create the stamp.
 */
export function setLastTrustedActionIfAbsent(
  tabId: number,
  frameId: number,
  action: { eventId: string; interactionId: string },
): void {
  if (lastTrustedActionByFrame.has(frameKey(tabId, frameId))) return; // create-only
  setLastTrustedAction(tabId, frameId, action);
}

/**
 * G4-B: read the trusted action for an EXACT tab+frame (null when that
 * frame has no live stamp — no cross-frame fallback, INV-G10). `frameId`
 * defaults to 0 (top document).
 */
export function getLastTrustedAction(
  tabId: number,
  frameId: number = 0,
): { eventId: string; interactionId: string } | null {
  const rec = lastTrustedActionByFrame.get(frameKey(tabId, frameId));
  return rec ? { eventId: rec.eventId, interactionId: rec.interactionId } : null;
}

/**
 * G4-B: all live stamps of a tab (frame-keyed map copy) — consumed by the
 * G1-C deterministic 3-rule back-fill resolution.
 */
export function getFrameStamp(
  tabId: number,
): Map<string, { eventId: string; interactionId: string }> {
  const out = new Map<string, { eventId: string; interactionId: string }>();
  for (const [k, rec] of lastTrustedActionByFrame) {
    if (rec.tabId === tabId) out.set(k, { eventId: rec.eventId, interactionId: rec.interactionId });
  }
  return out;
}

/**
 * G1-C / G4-B: deterministic back-fill resolution for an unstamped
 * form_submit-typed navigation. STATIC precedence — not a time comparison:
 *   1. frame 0's stamp (the top document's trusted action);
 *   2. the tab's ONLY stamp (unambiguous single frame);
 *   3. null — ambiguous (multiple frames, none is frame 0) → the entry
 *      renders on the synthetic nav (INV-G10 honest degradation).
 */
export function resolveBackfillStamp(tabId: number): string | null {
  const frame0 = lastTrustedActionByFrame.get(frameKey(tabId, 0));
  if (frame0) return frame0.eventId;
  const stamps = getFrameStamp(tabId);
  if (stamps.size === 1) {
    return stamps.values().next().value?.eventId ?? null;
  }
  return null;
}

/**
 * MV3 lifecycle fix: restore persisted frame stamps after SW restart.
 * Accepts the per-frame map shape; the LEGACY single-record shape
 * ({tabId, action, wallClock}) is intentionally NOT resurrected as a frame
 * stamp (it carries no frameId — migrating it would guess the frame and
 * risk misattribution; R22 pins the no-throw, no-resurrect behavior).
 * In-memory state wins (INV-G5).
 */
export function restoreLastTrustedActionFromStorage(): Promise<void> {
  return (async () => {
    try {
      const result = (await chrome.storage.local.get(LAST_ACTION_KEY)) as {
        [k: string]: unknown;
      };
      const stored = result?.[LAST_ACTION_KEY] as
        | Record<string, { tabId: number; frameId: number; action: { eventId: string; interactionId: string }; wallClock: number }>
        | undefined;
      if (stored && typeof stored === 'object') {
        for (const [k, rec] of Object.entries(stored)) {
          if (
            !lastTrustedActionByFrame.has(k) &&
            rec &&
            typeof rec.tabId === 'number' &&
            typeof rec.frameId === 'number' &&
            rec.action &&
            typeof rec.action.eventId === 'string' &&
            Date.now() - rec.wallClock < LAST_ACTION_TTL_MS
          ) {
            lastTrustedActionByFrame.set(k, {
              tabId: rec.tabId,
              frameId: rec.frameId,
              eventId: rec.action.eventId,
              interactionId: rec.action.interactionId,
              wallClock: rec.wallClock,
            });
          }
        }
      }
    } catch {
      // Storage API missing (tests) — no-op
    }
  })();
}

/**
 * CER-2: Get the pending main-frame request for a tab (captured at
 * onBeforeRequest — original URL/method/body, pre-redirect, pre-completion).
 * Null when no main-frame navigation is pending for the tab.
 */
export function getMainFrameCorrelation(tabId: number): PendingMainFrameRequest | null {
  return pendingMainFrameByTab.get(tabId) ?? null;
}

/**
 * RACE FIX: Consume the pending main-frame record for a tab — called from
 * the webNavigation.onCommitted path, which is the single owner that may
 * delete it. Returns the record (with completion status stamped by an
 * earlier onCompleted, if the losing race order occurred) or null.
 */
export function consumeMainFrameCorrelation(tabId: number): PendingMainFrameRequest | null {
  const rec = pendingMainFrameByTab.get(tabId) ?? null;
  if (rec) {
    pendingMainFrameByTab.delete(tabId);
    // G1-B: the commit consumer is the sole deleter — sync the durable copy.
    persistPendingNavDocs();
  }
  return rec;
}

/**
 * RACE FIX: Find completed ring entries stamped with a trusted-action
 * sourceEventId — the stop-recording drain join key. Entries whose
 * interaction-level evidence was already delivered (direct content-script
 * capture) are excluded by the caller via requestId membership.
 */
export function getCompletedBySourceEventId(
  sourceEventId: string,
  origin?: { tabId: number; frameId: number },
): CompletedWebRequest[] {
  return completedRequests.filter((r) => {
    if (r.sourceEventId !== sourceEventId) return false;
    // G4-B triple key: when an origin is given AND the ring entry carries
    // one, they must match (tab + frame). Legacy/origin-less entries join
    // on eventId alone (primary key).
    if (origin && typeof r.tabId === 'number') {
      if (r.tabId !== origin.tabId) return false;
      if (typeof r.frameId === 'number' && r.frameId !== origin.frameId) return false;
    }
    return true;
  });
}

/**
 * CER-2: Tag all in-flight requests for a tab with the navEvent that is
 * committing — "requests issued from the destroyed document". Membership
 * is by lifecycle state (started, not finished) at commit time, NOT by
 * timestamp. Returns the tagged entries.
 */
export function snapshotInFlightForTab(
  tabId: number,
  navEventId: string,
): { requestId: string; url: string; originalUrl: string; method: string; requestBody?: Record<string, string> }[] {
  const snapped: {
    requestId: string; url: string; originalUrl: string; method: string;
    requestBody?: Record<string, string>;
  }[] = [];
  for (const entry of inFlightRequests.values()) {
    // G4-A: capture spans multiple tabs — filter by the OWNING tab, then
    // frame/resource scoping keeps sub-frame noise out of the main-document
    // commit correlation.
    if (entry.tabId !== tabId) continue;
    if (entry.frameId === 0 || entry.resourceKind === 'xmlhttprequest' || entry.resourceKind === 'fetch') {
      entry.navEventId = navEventId;
      snapped.push({
        requestId: entry.requestId,
        url: entry.originalUrl,
        originalUrl: entry.originalUrl,
        method: entry.method,
        requestBody: entry.requestBody,
      });
    }
  }
  return snapped;
}

/**
 * CER-2: Exact-ID lookup of network evidence for a navigation.
 * Returns ring entries (completed) AND in-flight entries tagged with the
 * given navEventId. No time math — pure ID join. This replaces the
 * 10-second lookback window.
 */
export function getNetworkEvidenceForNavigation(navEventId: string): CompletedWebRequest[] {
  const fromRing = completedRequests.filter((r) => r.navEventId === navEventId);
  // In-flight entries that have not completed yet are exposed with
  // status null — the pipeline treats them as "issued, outcome pending".
  const fromInFlight: CompletedWebRequest[] = [];
  for (const entry of inFlightRequests.values()) {
    if (entry.navEventId === navEventId) {
      fromInFlight.push({
        url: entry.originalUrl,
        finalUrl: entry.url,
        method: entry.method,
        status: -1, // sentinel: still in flight
        startWallClock: Date.now(),
        endWallClock: Date.now(),
        requestId: entry.requestId,
        tabId: entry.tabId,
        frameId: entry.frameId,
        documentRequest: entry.resourceKind === 'main_frame',
        navEventId: entry.navEventId,
        sourceEventId: entry.sourceEventId,
        requestBody: entry.requestBody,
      });
    }
  }
  return [...fromRing, ...fromInFlight];
}

// ── webRequest Listener Management ───────────────────────────────────

/**
 * Register chrome.webRequest listeners for the active tab.
 */
function registerWebRequestListeners(): void {
  if (listenersActive) return;
  if (!chrome?.webRequest) return;
  void listenersActive; // (kept for isObserving diagnostics)

  const filter: chrome.webRequest.RequestFilter = {
    urls: URL_FILTER,
  };
  // We use a broader filter and filter by tabId in callbacks
  void filter;

  // Async: the awaited durable-ledger write inside extends SW lifetime
  // (MV3 keeps the worker alive while the handler's promise is pending).
  onBeforeRequestCallback = async (details) => {
    // MV3 lifecycle fix: membership in the persisted observing set is the
    // gate — not which SW instance is alive. Unknown-state (gate not yet
    // seeded from storage) captures conservatively into the ring.
    if (!shouldProcessRequest(details.tabId)) return;

    // Parse requestBody formData into a flat key→string map.
    // Chrome provides this when extraInfoSpec includes 'requestBody'.
    let requestBody: Record<string, string> | undefined;
    if (details.requestBody?.formData) {
      requestBody = {};
      for (const [key, values] of Object.entries(details.requestBody.formData)) {
        if (Array.isArray(values) && values.length > 0) {
          requestBody[key] = values[0];
        }
      }
    }

    // CER-2 / G4-B: stamp the trusted action active when the request
    // started — the exact-event join key for click→request attribution.
    // EXACT tabId:frameId lookup; a request from a frame with no stamp is
    // unstamped (no cross-frame guessing — INV-G10).
    const action = lastTrustedActionByFrame.get(frameKey(details.tabId, details.frameId));
    const sourceEventId = action?.eventId;

    inFlightRequests.set(details.requestId, {
      url: details.url,
      originalUrl: details.url,
      method: details.method,
      startTime: performance.now(),
      requestId: details.requestId,
      tabId: details.tabId,
      frameId: details.frameId,
      resourceKind: details.type ?? 'other',
      requestBody,
      sourceEventId,
    });

    // CER-2: capture main-frame POSTs IMMEDIATELY, before redirects can
    // rewrite the URL and before completion timing matters. This is the
    // authoritative form-submit record (Amazon #add-to-cart-button case).
    // Synchronous — readers in the same event turn must observe it.
    if (details.type === 'main_frame' && details.frameId === 0) {
      pendingMainFrameByTab.set(details.tabId, {
        requestId: details.requestId,
        tabId: details.tabId,
        frameId: details.frameId,
        originalUrl: details.url,
        method: details.method,
        requestBody,
        sourceEventId,
      });
      // G1-B: durable for EVERY main_frame request, stamped or not —
      // capture before classify. An unstamped record survives to the
      // onCommitted consumer, where the form_submit transition type can
      // back-fill identity (G1-C). AWAITED in-dispatch (same durability
      // gate as stamped entries — WARN-1 fix): an unstamped record is the
      // exact artifact G1-C needs, so its write must settle before the
      // handler is considered complete. Ordered AFTER the synchronous
      // in-memory write (same-turn readers observe capture first).
      await persistPendingNavDocs();
    }

    // DURABILITY GATE (form-submit recovery): a stamped request is durably
    // recorded at CAPTURE — the AWAIT happens inside this same listener
    // dispatch (MV3 keeps the SW alive until the storage write settles;
    // memory-only degrade on failure; never throws into the listener).
    // Ordered AFTER the synchronous in-memory records so same-turn readers
    // (race-fix consumeMainFrameCorrelation) observe capture state first.
    if (sourceEventId) {
      await recordStampedRequest({
        url: details.url,
        method: details.method,
        status: 0, // completion not yet observed
        requestId: details.requestId,
        sourceEventId,
        requestBody,
        documentRequest: details.type === 'main_frame',
        resourceKind: details.type ?? 'other',
        captureOrigin: { tabId: details.tabId, frameId: details.frameId },
      });
    }

    // P1-4 Fix: Include wallClock (Date.now()) for cross-process timestamp normalization
    // MV3 lifecycle: forward only when the live bridge should receive it;
    // unknown-state captures stay SW-side for the drain.
    if (shouldForwardToTab(details.tabId)) {
      forwardToTab(details.tabId, {
        url: details.url,
        method: details.method,
        timestamp: performance.now(),
        wallClock: Date.now(),
        phase: 'start' as const,
        status: null,
        requestId: details.requestId,
      });
    }
  };

  // CER: record redirect hops — requestId is reused across the chain.
  onBeforeRedirectCallback = (details) => {
    if (!shouldProcessRequest(details.tabId)) return;
    const chain = redirectChains.get(details.requestId) ?? [details.url];
    // details.url at onBeforeRedirect is the URL BEFORE this hop
    chain.push(details.redirectUrl);
    redirectChains.set(details.requestId, chain);
  };

  // Async: the awaited durable-ledger enrichment write inside extends SW
  // lifetime until the storage write settles.
  onCompletedCallback = async (details) => {
    if (!shouldProcessRequest(details.tabId)) return;

    const inFlight = inFlightRequests.get(details.requestId);
    inFlightRequests.delete(details.requestId);

    // RACE FIX: do NOT delete the pending main-frame record here. Chrome
    // may dispatch onCompleted before webNavigation.onCommitted; the
    // commit path must still find the POST. Stamp completion status and
    // leave ownership with the commit consumer.
    const pendingDoc = pendingMainFrameByTab.get(details.tabId);
    const isDocumentRequest = pendingDoc?.requestId === details.requestId;
    if (isDocumentRequest) {
      pendingDoc!.completionStatus = details.statusCode;
      // G1-B: enrich the durable copy (status survives SW restart pre-commit).
      persistPendingNavDocs();
    }

    // Buffer completed request for synthetic nav evidence recovery.
    // CER: url is the ORIGINAL request URL (classification target), not
    // the post-redirect final URL; redirect chain preserved when observed.
    const chain = redirectChains.get(details.requestId);
    redirectChains.delete(details.requestId);

    pushCompletedRequest({
      url: inFlight?.originalUrl ?? details.url,
      finalUrl: details.url,
      redirectChain: chain,
      method: inFlight?.method ?? details.method,
      status: details.statusCode,
      startWallClock: inFlight ? Date.now() - (performance.now() - inFlight.startTime) : Date.now(),
      endWallClock: Date.now(),
      requestId: details.requestId,
      tabId: inFlight?.tabId ?? details.tabId,
      frameId: inFlight?.frameId ?? details.frameId,
      documentRequest: isDocumentRequest,
      navEventId: inFlight?.navEventId,
      sourceEventId: inFlight?.sourceEventId,
      requestBody: inFlight?.requestBody,
    });

    // Durable ledger enrichment (completion status) — the at-capture write
    // is already durable; this refreshes status for attach-time fidelity.
    // Awaited in-dispatch (durability gate).
    if (inFlight?.sourceEventId) {
      await recordStampedRequest({
        url: inFlight.originalUrl ?? details.url,
        method: inFlight.method,
        status: details.statusCode,
        requestId: details.requestId,
        sourceEventId: inFlight.sourceEventId,
        requestBody: inFlight.requestBody,
        documentRequest: isDocumentRequest,
        resourceKind: inFlight.resourceKind,
        captureOrigin: { tabId: inFlight.tabId, frameId: inFlight.frameId },
      });
    }

    // P1-4 Fix: Include wallClock
    // MV3 lifecycle: gate live forwarding (unknown-state captures stay SW-side)
    if (shouldForwardToTab(details.tabId)) {
      forwardToTab(details.tabId, {
        url: details.url,
        method: inFlight?.method ?? details.method,
        timestamp: performance.now(),
        wallClock: Date.now(),
        phase: 'complete' as const,
        status: details.statusCode,
        requestId: details.requestId,
      });
    }
  };

  onErrorCallback = (details) => {
    if (!shouldProcessRequest(details.tabId)) return;

    const inFlight = inFlightRequests.get(details.requestId);
    inFlightRequests.delete(details.requestId);

    // RACE FIX: same handoff semantics as onCompleted — stamp, don't delete.
    const pendingDoc = pendingMainFrameByTab.get(details.tabId);
    const isDocumentRequest = pendingDoc?.requestId === details.requestId;
    if (isDocumentRequest) {
      pendingDoc!.completionStatus = -1; // network error / cancelled
      // G1-B: enrich the durable copy.
      persistPendingNavDocs();
    }

    const chain = redirectChains.get(details.requestId);
    redirectChains.delete(details.requestId);

    // Buffer errored request too (status=0 signals failure)
    pushCompletedRequest({
      url: inFlight?.originalUrl ?? details.url,
      finalUrl: details.url,
      redirectChain: chain,
      method: inFlight?.method ?? 'GET',
      status: 0,
      startWallClock: inFlight ? Date.now() - (performance.now() - inFlight.startTime) : Date.now(),
      endWallClock: Date.now(),
      requestId: details.requestId,
      tabId: inFlight?.tabId ?? details.tabId,
      frameId: inFlight?.frameId ?? details.frameId,
      documentRequest: isDocumentRequest,
      navEventId: inFlight?.navEventId,
      sourceEventId: inFlight?.sourceEventId,
      requestBody: inFlight?.requestBody,
    });

    // P1-4 Fix: Include wallClock
    // MV3 lifecycle: gate live forwarding (unknown-state captures stay SW-side)
    if (shouldForwardToTab(details.tabId)) {
      forwardToTab(details.tabId, {
        url: details.url,
        method: inFlight?.method ?? 'GET',
        timestamp: performance.now(),
        wallClock: Date.now(),
        phase: 'complete' as const,
        status: 0,
        requestId: details.requestId,
      });
    }
  };

  // Use a broad URL filter and filter by tabId in callbacks
  const broadFilter: chrome.webRequest.RequestFilter = {
    urls: URL_FILTER,
  };

  try {
    chrome.webRequest.onBeforeRequest.addListener(
      onBeforeRequestCallback,
      broadFilter,
      ['requestBody'],
    );
    if (onBeforeRedirectCallback) {
      chrome.webRequest.onBeforeRedirect.addListener(onBeforeRedirectCallback, broadFilter);
    }
    chrome.webRequest.onCompleted.addListener(
      onCompletedCallback,
      broadFilter,
    );
    chrome.webRequest.onErrorOccurred.addListener(
      onErrorCallback,
      broadFilter,
    );
    listenersActive = true;
  } catch (e) {
    console.warn('[NetworkObservation] Failed to register webRequest listeners:', e);
  }
}

/**
 * Unregister chrome.webRequest listeners.
 *
 * MV3 lifecycle fix: no longer called in production — listeners are
 * registered at top level on every SW start and permanently gated by the
 * persisted observing set. Retained as an explicit teardown for tests.
 */
export function unregisterWebRequestListeners(): void {
  if (!listenersActive) return;
  if (!chrome?.webRequest) return;

  try {
    if (onBeforeRequestCallback) {
      chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequestCallback);
    }
    if (onBeforeRedirectCallback) {
      chrome.webRequest.onBeforeRedirect.removeListener(onBeforeRedirectCallback);
    }
    if (onCompletedCallback) {
      chrome.webRequest.onCompleted.removeListener(onCompletedCallback);
    }
    if (onErrorCallback) {
      chrome.webRequest.onErrorOccurred.removeListener(onErrorCallback);
    }
  } catch {
    // Silent — listeners may already be removed
  }

  onBeforeRequestCallback = null;
  onBeforeRedirectCallback = null;
  onCompletedCallback = null;
  onErrorCallback = null;
  listenersActive = false;
}

// ── MAIN-world Injection ─────────────────────────────────────────────

/**
 * Push a completed request to the ring buffer with TTL eviction.
 */
function pushCompletedRequest(entry: CompletedWebRequest): void {
  completedRequests.push(entry);
  // Evict entries older than TTL or over capacity (unstamped/speculative
  // data only — stamped entries are ALSO durably recorded via the
  // attribution ledger, whose eviction is state-based, not time-based).
  const cutoff = Date.now() - COMPLETED_BUFFER_TTL_MS;
  while (completedRequests.length > 0 && completedRequests[0].endWallClock < cutoff) {
    completedRequests.shift();
  }
  while (completedRequests.length > MAX_COMPLETED_ENTRIES) {
    completedRequests.shift();
  }
}

// ── Durable attribution ledger write-through (form-submit recovery) ────
//
// Singleton ledger shared with the service worker's attach paths. Stamped
// requests are written through to chrome.storage.local (awaited, inside the
// webRequest dispatch) so they survive MV3 SW termination.

import { DurableAttributionLedger } from './evidence-attribution';

/** Process-wide ledger singleton (one per SW instance). */
const attributionLedger = new DurableAttributionLedger();

/** Access the shared durable ledger (service-worker attach paths). */
export function getAttributionLedger(): DurableAttributionLedger {
  return attributionLedger;
}

/**
 * DURABILITY GATE: record a stamped request durably. Called inside the
 * webRequest listener dispatch — the handler is not complete until the
 * chrome.storage.local write settles (or fails → memory-only degrade).
 */
export function recordStampedRequest(
  entry: {
    url: string;
    method: string;
    status: number;
    requestId: string;
    sourceEventId?: string;
    requestBody?: Record<string, string>;
    documentRequest?: boolean;
    resourceKind?: string;
    captureOrigin?: { tabId: number; frameId: number };
  },
): Promise<void> {
  if (!entry.sourceEventId) return Promise.resolve();
  return attributionLedger.pushStamped({
    url: entry.url,
    method: entry.method,
    status: entry.status,
    requestId: entry.requestId,
    sourceEventId: entry.sourceEventId,
    requestBody: entry.requestBody,
    documentRequest: entry.documentRequest,
    mainFrame: entry.resourceKind === 'main_frame',
    captureOrigin: entry.captureOrigin,
  });
}

/**
 * Dynamically inject the MAIN-world network interceptor.
 *
 * Uses chrome.scripting.executeScript with world: 'MAIN' to run
 * network-inject.js in the page's JS context. This patches
 * window.fetch and XMLHttpRequest to intercept page requests.
 *
 * The injected script is a standalone bundle at /assets/network-inject.js
 * (built from public/assets/network-inject.js, copied as-is by Vite).
 */
async function injectNetworkInterceptor(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      files: ['assets/network-inject.js'],
      injectImmediately: true,
    });
    return true;
  } catch (e) {
    console.warn('[NetworkObservation] MAIN-world injection failed:', e);
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Forward a webRequest event to the content script's NetworkBridge.
 *
 * P1-4 Fix: Includes wallClock (Date.now() from SW) for cross-process
 * timestamp normalization.
 */
function forwardToTab(
  tabId: number,
  detail: {
    url: string;
    method: string;
    timestamp: number;
    wallClock: number; // P1-4: Date.now() from SW
    phase: 'start' | 'complete';
    status: number | null;
    requestId: string;
  },
): void {
  try {
    chrome.tabs.sendMessage(tabId, {
      type: 'NETWORK_REQUEST',
      detail,
    }).catch(() => {
      // Content script may not be ready — silent
    });
  } catch {
    // Tab may not exist — silent
  }
}

// ── MV3 Lifecycle: top-level registration ────────────────────────────
//
// webRequest listeners are registered at EVERY service-worker start —
// before this fix they were registered only inside startNetworkObservation,
// so any SW death mid-recording silently disabled network capture for the
// rest of the session (Amazon add-to-cart: observed commit + fromUrl but
// zero network evidence). Registration is permanent; capture is gated by
// the recording-active flag (G4-A), so non-recording traffic costs
// nothing beyond the early-return filter.
//
// G4-D (boot-restore ordering): ONE awaitable promise covering all three
// restores. Consumers await it (via ensureSessionRestored) before reading
// restored state; capture writers never block on it and in-memory state
// always wins (INV-G5).
//
// Guarded so the module is importable in tests / non-extension contexts.
if (typeof chrome !== 'undefined' && chrome?.webRequest) {
  bootRestorePromise = (async () => {
    // G4-D: ALL restores awaited — the promise settles only when every
    // durable structure (observing set, recording flag, frame stamps,
    // pending docs) has been re-read. INV-G5 await graph, no fire-and-forget.
    await seedObservingTabsFromStorage();
    await seedRecordingActiveFromStorage();
    await restoreLastTrustedActionFromStorage();
    // G1-B: rehydrate durable pending-doc records so the commit consumer
    // still finds its navigation record after a mid-navigation SW restart.
    await restorePendingNavDocsFromStorage();
  })();
  registerWebRequestListeners();
}

/** G4-D: seed the recording-active mirror from storage (never overwrites a decided flag). */
function seedRecordingActiveFromStorage(): Promise<void> {
  return (async () => {
    try {
      const result = (await chrome.storage.local.get(RECORDING_ACTIVE_KEY)) as {
        [k: string]: unknown;
      };
      const v = result?.[RECORDING_ACTIVE_KEY];
      if (recordingActiveFlag === null) {
        if (v === true) recordingActiveFlag = true;
        if (v === false) recordingActiveFlag = false;
      }
    } catch {
      // storage API missing (tests) — leave unknown
    }
  })();
}
