/**
 * Evidence Pipeline Types — Phase 1
 *
 * Types for the evidence collection and batching layer of the target pipeline.
 *
 * The evidence layer sits between the DOM Event (raw browser event) and the
 * Recognition Pipeline (pattern matching). Its job is to transform raw
 * observations into structured evidence that can be matched against patterns.
 *
 * Data flow:
 *
 *   DOM Event
 *     → Evidence Channels (A-E) collect EvidenceRecord[]
 *     → EventTap assembles them into an EvidenceBatch (one per interaction)
 *     → DeliveryCoordinator sends EvidenceBatch[] to the Service Worker
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceRecord } from './foundation';
import type { TargetElementIdentity, TargetDomContext } from './element';

// ── Evidence Batch ───────────────────────────────────────────────────────

/**
 * A unique identifier for an evidence batch.
 *
 * Sequential within a recording session, e.g. "batch-001", "batch-002".
 */
export type BatchId = string;

/**
 * The status of an evidence batch in the pipeline.
 *
 * Batches start as 'pending', transition through recognition stages, and
 * end as either 'recognised' or 'unrecognised'. This allows the pipeline
 * to track progress and implement non-fatal error handling.
 */
export type BatchStatus = 'pending' | 'grouped' | 'recognised' | 'unrecognised' | 'merged';

/**
 * A collection of evidence records for a single DOM interaction.
 *
 * The EvidenceBatch is the **atomic unit of the pipeline**. It represents
 * one user interaction — a click, a focus→input→blur sequence, a hover, etc.
 *
 * Unlike the current architecture where each raw DOM event is sent
 * individually and grouped later, the EvidenceBatch is assembled at
 * capture time (by EventTap) into interaction-sized units.
 *
 * Key design decisions:
 * - Batch IDs are sequential and unique within a session.
 * - Batches are immutable once delivered to the SW.
 * - The `correlationGroup` field allows the EventGrouper to merge related
 *   batches into interaction candidates without re-processing evidence.
 */
export interface EvidenceBatch {
  /** Unique sequential batch ID within the session. */
  id: BatchId;
  /** ISO timestamp of the first event in this batch. */
  startedAt: string;
  /** ISO timestamp of the last event in this batch. */
  endedAt: string;
  /** The resolved target element identity at capture time. */
  target: TargetElementIdentity;
  /** DOM context captured at event time. */
  domContext: TargetDomContext;
  /** All evidence records collected for this interaction. */
  evidence: EvidenceRecord[];
  /** Browser event types captured in this batch, in order. */
  eventSequence: string[];
  /** Current pipeline status. */
  status: BatchStatus;
  /**
   * Optional correlation group — set by EventGrouper to link related batches.
   * Batches with the same correlationGroup are candidates for merging.
   */
  correlationGroup: string | null;
  /** The URL of the page when this batch was captured. */
  pageUrl: string;
}
