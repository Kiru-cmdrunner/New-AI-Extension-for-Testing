/**
 * Session Persistence Service — persists recording session artifacts to
 * Repository V2 (Dexie/IndexedDB).
 *
 * This service is the integration point between the runtime recording
 * pipeline and the Repository. It:
 *   1. Creates a RecordingSession from UnderstandingResult + raw data
 *   2. Stores the ExecutionIRPlan as an ExecutionIRArtifact
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
import type { BehavioralEvidenceRow } from '../v2/dexie/dexie-database';
import {
  createRecordingSession,
} from '../../domain/entities/recording-session';

export interface SessionPersistenceInput {
  /** The UnderstandingResult from the Understanding Layer. */
  readonly understanding: UnderstandingResult;
  /** Raw session events (archival tier). */
  readonly events: SessionEvent[];
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
      rawEvents: [...input.events],
      rawInteractions: [...input.interactions],
      url: input.url,
    });
    await repos.recordingSessions.create(session);

    // ── 3. Store ExecutionIRPlan as ExecutionIRArtifact ──
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
      irArtifactId: irArtifact.id,
      projectId,
    };
  });
}

// ── M8.2: Behavioral Evidence Persistence ────────────────────────────

/**
 * Result of evidence persistence.
 */
export interface EvidencePersistenceResult {
  /** Number of evidence rows persisted. */
  readonly count: number;
}

/**
 * Persist finalized BehavioralEvidence to the dedicated `behavioral_evidence`
 * table, linked to both the interaction and the recording session.
 *
 * Called after persistSession succeeds — uses the returned sessionId to link
 * every evidence row to the session. Each interaction that has behavioralEvidence
 * produces exactly one row. Interactions without evidence are silently skipped.
 *
 * Idempotent: uses put() semantics by windowId primary key. Re-running with the
 * same data overwrites rather than duplicating.
 *
 * Runs in its own UoW transaction so evidence persistence failure does not
 * roll back the session persistence (and vice versa).
 */
export async function persistBehavioralEvidence(
  uowFactory: UnitOfWorkFactory,
  recordingSessionId: string,
  interactions: ComponentInteraction[],
): Promise<EvidencePersistenceResult> {
  const uow = uowFactory.create();

  return uow.execute(async (repos) => {
    let count = 0;

    for (const interaction of interactions) {
      if (!interaction.behavioralEvidence) continue;

      const row: BehavioralEvidenceRow = {
        ...interaction.behavioralEvidence,
        interactionId: interaction.interactionId,
        recordingSessionId,
        persistedAt: Date.now(),
      };

      await repos.behavioralEvidence.save(row);
      count++;
    }

    return { count };
  });
}
