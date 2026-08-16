/**
 * Post-Navigation Capture Types — shared between SW and content script.
 *
 * Part of the NAV pull model (.drytis/specs/post-nav-evidence-capture.md):
 * the SW records, per tab, the last full-page navigation it committed, and
 * the destination page's content script pulls that record after auto-resume
 * to open a post-navigation evidence window attributed to the navEventId.
 *
 * This module is intentionally dependency-free (types + constants only) so
 * both the SW bundle and the recorder entry can import it without pulling
 * in capture machinery.
 */

/**
 * A pending post-navigation capture record, written by the SW at
 * webNavigation.onCommitted (full-reload branch) and consumed by the
 * destination document's content script.
 */
export interface PostNavCaptureRecord {
  /** The synthetic navigation event's eventId — the correlation key. */
  navEventId: string;
  /** Previously committed URL for the tab (DDC-2 semantics). */
  fromUrl: string;
  /** Destination URL for the tab. */
  toUrl: string;
  /** webNavigation transition type (e.g. 'form_submit', 'link', 'reload'). */
  navType: string;
  /** performance.now()-independent wall-clock ms at commit time. */
  committedAt: number;
}

/** Bounded per-tab store: at most this many tabs have pending records. */
export const MAX_NAV_CAPTURE_ENTRIES = 16;

/**
 * How long a pending record survives without being pulled, in ms.
 * After this the record is stale (the destination CS never arrived —
 * chrome:// page, extension reload, fast next navigation) and is discarded
 * so the map cannot grow unboundedly.
 */
export const POST_NAV_CAPTURE_TTL_MS = 30_000;
