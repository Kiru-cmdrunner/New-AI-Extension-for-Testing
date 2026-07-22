/**
 * RecordingSession Entity — purpose-built provenance storage for a single
 * recording session and its UnderstandingResult.
 *
 * Replaces the generic SourceArtifact (InteractionTimelineContent) with a
 * purpose-built entity that stores the canonical UnderstandingResult alongside
 * the raw recording data.
 *
 * Data lifecycle (see architecture discussion, Phase 10):
 *   Tier 1 (Canonical): UnderstandingResult — permanent, queryable, indexed.
 *   Tier 2 (Operational): TestCaseIds — forward links to derived test cases.
 *   Tier 3 (Archival): rawEvents, rawInteractions — retained but not indexed.
 *     Used for debug/replay/re-derivation only. Not for general queries.
 *
 * Invariants:
 *   INV-RS1: A RecordingSession is immutable after creation except for the
 *            testCaseIds array (forward links added when test cases are
 *            derived from this session).
 *   INV-RS2: understandingResult is the immutable output of the Understanding
 *            Layer — it is never modified after being stored.
 *   INV-RS3: rawEvents and rawInteractions are the raw recording data — they
 *            are never queried by downstream consumers directly. All semantic
 *            queries go through understandingResult.
 *   INV-RS4: testCaseIds only grows — test case associations are never removed.
 */

import { MissingFieldError } from '../errors/invariant-errors';
import type { UnderstandingResult } from './understanding-result';
import type { SessionEvent } from '../../shared/types';
import type { DetectedInteraction } from '../../classifier/interaction-types';

/** A single recording session and its derived understanding. */
export interface RecordingSession {
  readonly id: string;
  readonly projectId: string;

  // ── Canonical (Tier 1) ──
  readonly understandingResult: UnderstandingResult;

  // ── Archival (Tier 3) ──
  readonly rawEvents: readonly SessionEvent[];
  readonly rawInteractions: readonly DetectedInteraction[];

  // ── Metadata ──
  readonly url: string;
  readonly recordedAt: string;
  readonly duration: number | null;

  // ── Forward links (Tier 2) ──
  readonly testCaseIds: string[];
}

/** Input for creating a new RecordingSession. */
export interface CreateRecordingSessionInput {
  projectId: string;
  understandingResult: UnderstandingResult;
  rawEvents: SessionEvent[];
  rawInteractions: DetectedInteraction[];
  url: string;
  duration?: number;
}

/**
 * Create a RecordingSession entity with invariant validation.
 *
 * @throws MissingFieldError if projectId or understandingResult is null
 */
export function createRecordingSession(input: CreateRecordingSessionInput): RecordingSession {
  if (!input.projectId?.trim()) {
    throw new MissingFieldError('RecordingSession', 'projectId');
  }

  if (!input.understandingResult) {
    throw new MissingFieldError('RecordingSession', 'understandingResult');
  }

  return {
    id: crypto.randomUUID(),
    projectId: input.projectId.trim(),
    understandingResult: input.understandingResult,
    rawEvents: [...input.rawEvents],
    rawInteractions: [...input.rawInteractions],
    url: input.url?.trim() ?? '',
    recordedAt: input.understandingResult.generatedAt,
    duration: input.duration ?? null,
    testCaseIds: [],
  };
}

/**
 * Add a test case association to a RecordingSession.
 * Returns a new object — never mutates the existing one.
 *
 * INV-RS4: testCaseIds only grows.
 */
export function addTestCaseAssociation(
  existing: RecordingSession,
  testCaseId: string,
): RecordingSession {
  if (!testCaseId?.trim()) {
    throw new MissingFieldError('RecordingSession', 'testCaseId');
  }

  // Idempotent — don't add duplicates
  if (existing.testCaseIds.includes(testCaseId)) {
    return existing;
  }

  return {
    ...existing,
    testCaseIds: [...existing.testCaseIds, testCaseId],
  };
}
