/**
 * RACE FIX — Stop-Recording Network Evidence Drain
 *
 * The commit-time recovery (recoverNetworkForNavigationById) covers the
 * common ordering. Two residual loss windows remain when neither the
 * content-script delivery nor the commit-time consumer captured a request:
 *
 *   1. A main-frame POST whose pending record was consumed by a DIFFERENT
 *      commit on the same tab (e.g. quick back-to-back navigations), or
 *      whose commit arrived before the SW finished restoring state.
 *   2. Any completed request stamped with a trusted-action sourceEventId
 *      whose interaction-level evidence delivery was destroyed by the
 *      page reload (the classic Amazon add-to-cart shape).
 *
 * The ring buffer retains these entries (originalUrl, method, status,
 * requestBody, sourceEventId) — this module is the promised second pass
 * that joins them back onto the correct interaction at stop-recording
 * time, BEFORE the understanding pipeline consumes the interactions.
 *
 * Pure functions: no chrome.* access — fully unit-testable.
 */

import type { NetworkActivity } from '../shared/behavioral-evidence-types';
import type { ComponentInteraction } from '../shared/component-types';
import {
  resolveInteractionForEventId,
  synthesizeMinimalEvidence,
} from './evidence-attribution';

/** Ring entry shape exposed by network-observation (CompletedWebRequest). */
export interface DrainEntry {
  url: string;
  method: string;
  status: number;
  requestId: string;
  sourceEventId?: string;
  requestBody?: Record<string, string>;
  documentRequest?: boolean;
  /** G4-B triple key: the tab/frame the request was captured in (optional). */
  captureOrigin?: { tabId: number; frameId: number };
}

/** Result of a drain pass. */
export interface DrainResult {
  /** Interactions with recovered evidence merged in (same references, mutated). */
  updatedInteractions: ComponentInteraction[];
  /** requestIds actually merged, for logging/diagnostics. */
  mergedRequestIds: string[];
}

/** Analytics/noise URL filter — mirrors the commit-time recovery filter. */
const NOISE_URL_RE =
  /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff2?|ttf)(\?|$)/i;

const TELEMETRY_URL_RE =
  /\/unagi|\/events\/|\/beacon|\/pixel|\/csm|\/aax2|\/impression|fls-|\/1\/batch\/|uedata/i;

/** Max recovered entries per interaction — matches commit-time cap shape. */
const MAX_PER_INTERACTION = 20;

/**
 * Drain completed ring entries onto the interactions that triggered them.
 *
 * Join: IDENTITY-based (INV-1). The authoritative keys are
 * interaction.triggerEvent.eventId and memberEvents[].eventId — the exact
 * trusted action active when the request STARTED (CER-2 stamp).
 * behavioralEvidence.sourceEventId is retained as a legacy fallback so
 * previously-collected evidence still joins.
 *
 * Synthesize-on-missing (INV-4): when the owning interaction has no
 * behavioralEvidence (fast form-submit destroyed at pagehide), thin
 * evidence is synthesized rather than dropping the entry.
 *
 * Exactly-once guarantee:
 *  - entries already present in the interaction's networkActivity (by
 *    requestId) are skipped — direct content-script capture wins;
 *  - merged requestIds are tracked across interactions, so an entry is
 *    merged onto at most one interaction even if two interactions share
 *    a sourceEventId (defensive; should not occur).
 *
 * Synthetic-navigation interactions are EXCLUDED as merge targets — the
 * commit-time recovery already attached evidence to them, and the causal
 * owner is the trusted action (the click), not the navigation.
 *
 * @returns the set of mutated interactions and merged requestIds
 */
export function drainNetworkEvidence(
  interactions: ComponentInteraction[],
  ringEntries: DrainEntry[],
): DrainResult {
  const updatedInteractions: ComponentInteraction[] = [];
  const mergedRequestIds: string[] = [];

  // Pre-compute existing requestIds per interaction (exactly-once guard A).
  const existingIds = new Map<string, Set<string>>();
  for (const i of interactions) {
    const ids = new Set<string>();
    for (const entry of i.behavioralEvidence?.applicationEvidence?.networkActivity ?? []) {
      const rid = (entry as NetworkActivity & { requestId?: string }).requestId;
      if (rid) ids.add(rid);
    }
    existingIds.set(i.interactionId, ids);
  }

  // Index trusted actions by their event id — first (and only) occurrence.
  // INV-1 (identity join): triggerEvent.eventId / memberEvents[].eventId are
  // the authoritative join keys; behavioralEvidence.sourceEventId is a
  // legacy fallback so previously-collected evidence still joins.
  const byEventId = new Map<string, ComponentInteraction>();
  for (const i of interactions) {
    // Synthetic navigations are not merge targets (see docblock).
    const endReason = i.behavioralEvidence?.window?.endReason;
    if (endReason === 'page-reload-synthetic') continue;
    const triggerId = i.triggerEvent?.eventId;
    if (triggerId) {
      if (!byEventId.has(triggerId)) byEventId.set(triggerId, i);
    }
    for (const e of i.memberEvents ?? []) {
      if (!byEventId.has(e.eventId)) byEventId.set(e.eventId, i);
    }
    const evId = i.behavioralEvidence?.sourceEventId;
    if (evId && !byEventId.has(evId)) byEventId.set(evId, i);
  }

  // requestIds merged anywhere in this pass (exactly-once guard B).
  const mergedIds = new Set<string>();

  for (const entry of ringEntries) {
    if (!entry.sourceEventId) continue; // unstamped → not attributable
    if (mergedIds.has(entry.requestId)) continue; // already drained
    // Telemetry/noise filters — with the form-submit exemption (G2): a
    // STAMPED DOCUMENT request (main_frame) is user-caused navigation by
    // causal proof of the stamp, never background telemetry — GET form
    // submits and body-less POSTs included (identity, not shape).
    const isStampedDoc = entry.documentRequest;
    if (!isStampedDoc && NOISE_URL_RE.test(entry.url)) continue;
    if (!isStampedDoc && TELEMETRY_URL_RE.test(entry.url)) continue;

    // G4-B triple key: prefer the index hit, but VERIFY origin compatibility
    // when both sides carry one (INV-G2 everywhere); fall through to the
    // origin-aware resolver otherwise. eventId remains the primary key.
    const idxHit = byEventId.get(entry.sourceEventId);
    const idxOrigin = idxHit?.metadata?.captureOrigin as
      | { tabId: number; frameId: number }
      | undefined;
    const idxOk =
      !idxHit ||
      !entry.captureOrigin ||
      !idxOrigin ||
      (idxOrigin.tabId === entry.captureOrigin.tabId &&
        idxOrigin.frameId === entry.captureOrigin.frameId);
    const target = idxOk && idxHit
      ? idxHit
      : resolveInteractionForEventId(entry.sourceEventId, interactions, entry.captureOrigin);
    if (!target) continue; // no trusted action owns it — never guess

    // Guard A: direct capture already delivered this request.
    if (existingIds.get(target.interactionId)?.has(entry.requestId)) continue;

    const appEv =
      target.behavioralEvidence?.applicationEvidence ??
      // Fast form-submit case: click evidence lost at pagehide — synthesize
      // thin evidence anchored to the exact sourceEventId (INV-4).
      synthesizeMinimalEvidence(target, entry.sourceEventId).applicationEvidence;
    if ((appEv.networkActivity?.length ?? 0) >= MAX_PER_INTERACTION) continue;

    const activity: NetworkActivity & { requestId?: string } = {
      url: entry.url,
      method: entry.method,
      status: entry.status,
      startRelativeToEvent: 0,
      endRelativeToEvent: null,
      durationMs: null,
      resourceType: 'unknown',
      source: 'webrequest',
      requestBody: entry.requestBody,
      sourceEventId: entry.sourceEventId,
      requestId: entry.requestId,
    };

    appEv.networkActivity = [...(appEv.networkActivity ?? []), activity];
    mergedIds.add(entry.requestId);
    mergedRequestIds.push(entry.requestId);
    if (!updatedInteractions.includes(target)) updatedInteractions.push(target);
  }

  return { updatedInteractions, mergedRequestIds };
}
