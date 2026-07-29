/**
 * Evidence Channel Interface — Phase 2
 *
 * Defines the contract that all five evidence channels (A-E) implement.
 *
 * An evidence channel is a modular collector responsible for one category
 * of evidence about a DOM interaction. When an event occurs, the EventTap
 * (Phase 3) calls each channel's `collect()` method with the raw DOM event
 * and a shared collection context. Each channel returns EvidenceRecord[]
 * — structured observations that will be assembled into an EvidenceBatch.
 *
 * Design principles:
 * - Channels are stateless collectors (they don't accumulate state across events).
 * - Each channel reads only what it needs from the element/event.
 * - Channels produce typed EvidenceRecord[] — the EventTap assembles them.
 * - Channels are independent: a failure in one channel does not affect others.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { ChannelId, EvidenceRecord } from '../../types/foundation';
import type { SurfaceInfo } from '../../types/element';

/**
 * Shared input passed to every channel's `collect()` method.
 *
 * This object is constructed once per event by the EventTap and contains
 * everything the channels need. Individual channels read only the fields
 * relevant to their category.
 */
export interface ChannelCollectInput {
  /** The resolved target element (after composedPath + interactive-selector walk). */
  target: Element;
  /** The raw DOM event (click, focus, input, change, etc.). */
  event: Event;
  /** Browser event type (e.g. 'click', 'focus', 'input'). */
  eventType: string;
  /** ISO timestamp of the event. */
  timestamp: string;
  /** Current URL of the page. */
  pageUrl: string;
  /** Whether the element is inside a Shadow DOM. */
  inShadowDom: boolean;
  /** Whether the element is inside an iframe. */
  inIframe: boolean;

  // ── Behavioural context (pre-computed by EventTap) ──
  /** Value before the event, if tracked (null if not applicable). */
  valueBefore: string | null;
  /** Value after the event, if applicable (null if not applicable). */
  valueAfter: string | null;
  /** Checked state before the event (null if not applicable). */
  checkedBefore: boolean | null;
  /** Checked state after the event (null if not applicable). */
  checkedAfter: boolean | null;

  // ── Mutation context (populated by Channel D, shared) ──
  /** Surfaces detected after this interaction (set by Channel D or EventTap). */
  surfaces?: SurfaceInfo[];
}

/**
 * Evidence Channel contract.
 *
 * Each channel implements this interface. The EventTap calls `collect()`
 * on all registered channels for every event.
 */
export interface EvidenceChannel {
  /** The channel's unique ID (A, B, C, D, or E). */
  readonly channelId: ChannelId;

  /** Human-readable name for debugging. */
  readonly name: string;

  /**
   * Collect evidence from the DOM element and event.
   *
   * Returns an array of EvidenceRecord[] — structured observations.
   * May return an empty array if the channel has nothing to report for
   * this event (e.g., Channel A for a <div> with no ARIA attributes).
   *
   * MUST NOT throw. If an error occurs, return an empty array and log.
   * Non-fatal: a failing channel should not break evidence collection.
   */
  collect(input: ChannelCollectInput): EvidenceRecord[];
}

/**
 * Map of all evidence channels, keyed by ChannelId.
 */
export type ChannelMap = Record<ChannelId, EvidenceChannel>;
