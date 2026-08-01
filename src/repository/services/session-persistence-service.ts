/**
 * Session Persistence Service — persists recording session artifacts to
 * Repository V2 (Dexie/IndexedDB).
 *
 * This service is the integration point between the runtime recording
 * pipeline and the Repository. It:
 *   1. Creates a RecordingSession from UnderstandingResult + raw data
 *   2. Matches the CapabilityCandidate against existing capabilities
 *   3. Creates a CapabilityReview (pending) deferring capability creation
 *      to the human review workflow (P1 change)
 *   4. Stores the ExecutionIRPlan as an ExecutionIRArtifact
 *
 * All operations are wrapped in a UnitOfWork transaction for atomicity.
 * If any step fails, the entire transaction is rolled back.
 *
 * Design principles:
 *   - Non-fatal — if persistence fails, the recording still completes
 *     (the UnderstandingResult and IR plan are already in chrome.storage.local)
 *   - Idempotent — re-running with the same session data is safe (Dexie put)
 *   - Project-scoped — requires a projectId; if none exists, creates one
 *
 * Reference: Phase 10 architecture — Recording → Understanding → Generation → Repository
 */

import type { UnitOfWorkFactory } from '../v2/interfaces/unit-of-work';
import type { UnderstandingResult } from '../../domain/entities/understanding-result';
import type { SessionEvent } from '../../shared/types';
import type { ComponentInteraction } from '../../shared/component-types';
import type { ExecutionIRPlan } from '../../domain/execution-ir/types';
import {
  createRecordingSession,
} from '../../domain/entities/recording-session';
import {
  matchCapability,
} from './capability-matching-service';
import { createReview } from '../../domain/services/capability-review-service';

export interface SessionPersistenceInput {
  /** The UnderstandingResult from the Understanding Layer. */
  readonly understanding: UnderstandingResult;
  /** Raw session events (archival tier). */
  readonly events: SessionEvent[] | ReadonlyArray<Record<string, unknown>>;
  /** Raw classified interactions (archival tier). */
  readonly interactions: ComponentInteraction[];
  /** The URL where the recording started. */
  readonly url: string;
  /** The ExecutionIRPlan from the Generation Layer. */
  readonly irPlan: ExecutionIRPlan;
  /** Project ID to persist under. If null, a default project is created. */
  readonly projectId: string | null;
  /** Test case name (for future test case creation). */
  readonly testCaseName: string;
}

export interface SessionPersistenceResult {
  /** The created RecordingSession ID. */
  readonly sessionId: string;
  /** The CapabilityReview ID if a review was created, null otherwise. */
  readonly reviewId: string | null;
  /** The matching decision for the candidate. */
  readonly capabilityDecision: 'new' | 'auto-merge' | 'ambiguous' | 'none';
  /** The ExecutionIRArtifact ID. */
  readonly irArtifactId: string;
  /** The project ID used. */
  readonly projectId: string;
}

/**
 * Persist recording session artifacts to Repository V2.
 *
 * Wraps everything in a single UnitOfWork transaction. If any step fails,
 * the transaction is rolled back and the error is thrown.
 */
export async function persistSession(
  uowFactory: UnitOfWorkFactory,
  input: SessionPersistenceInput,
): Promise<SessionPersistenceResult> {
  const uow = uowFactory.create();

  return uow.execute(async (repos) => {
    // ── 1. Ensure project exists ──
    let projectId = input.projectId;
    if (!projectId) {
      // Create a default project
      const project = await repos.projects.create({
        name: 'Default Project',
        createdBy: 'recorder',
      });
      projectId = project.id;
    }

    // ── 2. Create RecordingSession ──
    const session = createRecordingSession({
      projectId,
      understandingResult: input.understanding,
      rawEvents: [...(input.events as SessionEvent[])],
      rawInteractions: [...input.interactions],
      url: input.url,
    });
    await repos.recordingSessions.create(session);

    // ── 3. Match candidate and create CapabilityReview (P1) ──
    //
    // P1 BEHAVIORAL CHANGE: Previously this step auto-created or auto-merged
    // capabilities. Now it defers ALL capability creation/enrichment to the
    // review workflow. A CapabilityReview (state='pending') is created
    // regardless of the match score. The reviewer decides what to do.
    //
    // The candidate is already safely persisted inside the RecordingSession's
    // UnderstandingResult — the review just gates whether a Capability entity
    // is materialized.
    let reviewId: string | null = null;
    let capabilityDecision: 'new' | 'auto-merge' | 'ambiguous' | 'none' = 'none';

    const candidate = input.understanding.capability;
    if (candidate) {
      const existingCapabilities = await repos.capabilities.getByProject(projectId);
      const matchResult = matchCapability(candidate, existingCapabilities);

      // Map to the return type
      capabilityDecision = matchResult.decision === 'new-capability'
        ? 'new'
        : matchResult.decision;

      // Create a review regardless of match score — human gates the decision
      const review = createReview(candidate, matchResult, session.id);
      await repos.capabilityReviews.create(review);
      reviewId = review.reviewId;
    }

    // ── 4. Store ExecutionIRPlan as ExecutionIRArtifact ──
    // The IR artifact wraps the plan with provenance metadata.
    // testCaseVersionId is a placeholder — the test case hasn't been
    // created yet. We use the session ID as a temporary reference.
    const irArtifact = {
      id: crypto.randomUUID(),
      testCaseVersionId: session.id, // Temporary — linked to session for now
      plan: input.irPlan,
      generatedAt: new Date().toISOString(),
      generatorVersion: 'ir-bridge-1.0',
      renderings: {},
    };
    await repos.executionIRs.save(irArtifact);

    return {
      sessionId: session.id,
      reviewId,
      capabilityDecision,
      irArtifactId: irArtifact.id,
      projectId,
    };
  });
}
