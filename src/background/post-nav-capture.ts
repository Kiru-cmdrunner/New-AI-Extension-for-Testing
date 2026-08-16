/**
 * Post-Navigation Capture Store — SW side of the NAV pull model
 * (.drytis/specs/post-nav-evidence-capture.md).
 *
 * The SW records, per tab, the most recent full-page navigation commit.
 * The destination page's content script pulls the record (NAV_PENDING_REQUEST)
 * after its auto-resume, so the collector can open a post-navigation evidence
 * window attributed to the navEventId — capturing the destination page's
 * DOM/surface/visibility churn that a full reload previously destroyed.
 *
 * Semantics:
 *  - One record per tab, latest-wins on a new commit for the same tab.
 *  - Consumed on pull: the first pull in a document gets the record, any
 *    later pull gets null (exactly-once per navigation per document).
 *  - Bounded: at most MAX_NAV_CAPTURE_ENTRIES tabs; oldest committedAt is
 *    shift-evicted when exceeded.
 *  - TTL: records older than POST_NAV_CAPTURE_TTL_MS are treated as absent
 *    (destination CS never pulled) — the placeholder fallback stands.
 *
 * In-memory only, by design: the record is valid only while the recording
 * session is live, and an SW restart simply means the pull returns null and
 * the placeholder remains. No persistence, no storage churn.
 */

import {
  type PostNavCaptureRecord,
  MAX_NAV_CAPTURE_ENTRIES,
  POST_NAV_CAPTURE_TTL_MS,
} from '../shared/post-nav-types';

const pendingNavCapture = new Map<number, PostNavCaptureRecord>();

/** Record a full-reload commit for a tab (latest-wins per tab). */
export function recordPendingNavCapture(tabId: number, record: PostNavCaptureRecord): void {
  pendingNavCapture.set(tabId, record);
  if (pendingNavCapture.size > MAX_NAV_CAPTURE_ENTRIES) {
    // Evict the record with the oldest committedAt (not insertion order —
    // a later commit for an existing tab refreshes committedAt).
    let oldestKey: number | null = null;
    let oldestAt = Infinity;
    for (const [tab, rec] of pendingNavCapture) {
      if (rec.committedAt < oldestAt) {
        oldestAt = rec.committedAt;
        oldestKey = tab;
      }
    }
    if (oldestKey !== null) pendingNavCapture.delete(oldestKey);
  }
}

function freshOrNull(rec: PostNavCaptureRecord | undefined): PostNavCaptureRecord | null {
  if (!rec) return null;
  if (Date.now() - rec.committedAt > POST_NAV_CAPTURE_TTL_MS) return null;
  return rec;
}

/** Read (without consuming) the pending record for a tab. */
export function peekPendingNavCapture(tabId: number): PostNavCaptureRecord | null {
  return freshOrNull(pendingNavCapture.get(tabId));
}

/** Consume the pending record for a tab (exactly-once per pull). */
export function consumePendingNavCapture(tabId: number): PostNavCaptureRecord | null {
  const rec = freshOrNull(pendingNavCapture.get(tabId));
  if (rec) pendingNavCapture.delete(tabId);
  return rec;
}

/** Test seam: clear the store between tests. */
export function __clearPendingNavCaptureForTests(): void {
  pendingNavCapture.clear();
}
