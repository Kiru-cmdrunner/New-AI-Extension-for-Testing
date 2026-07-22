/**
 * Session Persistence Service — persists recording session artifacts to
 * Repository V2 (Dexie/IndexedDB).
 *
 * This service is the integration point between the runtime recording
 * pipeline and the Repository. It:
 *   1. Creates a RecordingSession from UnderstandingResult + raw data
 *   2. Matches the CapabilityCandidate against existing capabilities
 *   3. Creates a new Capability or enriches an existing one
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

import type { UnitOfWorkFactory, UnitOfWork } from '../v2/interfaces/unit-of-work';
import type { UnderstandingResult } from '../../domain/entities/understanding-result';
import type { SessionEvent } from '../../shared/types';
import type { DetectedInteraction } from '../../classifier/interaction-types';
import type { ExecutionIRPlan } from '../../domain/execution-ir/types';
import type { CapabilityCandidate } from '../../domain/entities/capability-candidate';
import {
  createRecordingSession,
} from '../../domain/entities/recording-session';
import {
  createCapability,
  enrichCapability,
} from '../../domain/entities/capability';
import {
  matchCapability,
  candidateToCreateInput,
  candidateToEnrichInput,
} from './capability-matching-service';

export interface SessionPersistenceInput {
  /** The UnderstandingResult from the Understanding Layer. */
  readonly understanding: UnderstandingResult;
  /** Raw session events (archival tier). */
  readonly events: SessionEvent[];
  /** Raw classified interactions (archival tier). */
  readonly interactions: DetectedInteraction[];
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
  /** The Capability ID (new or existing). */
  readonly capabilityId: string | null;
  /** Whether the capability was newly created or merged. */
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
      rawEvents: [...input.events],
      rawInteractions: [...input.interactions],
      url: input.url,
    });
    await repos.recordingSessions.create(session);

    // ── 3. Match and create/enrich Capability ──
    let capabilityId: string | null = null;
    let capabilityDecision: 'new' | 'auto-merge' | 'ambiguous' | 'none' = 'none';

    const candidate = input.understanding.capability;
    if (candidate) {
      const existingCapabilities = await repos.capabilities.getByProject(projectId);
      const matchResult = matchCapability(candidate, existingCapabilities);

      if (matchResult.decision === 'auto-merge' && matchResult.mergeTargetId) {
        // Enrich existing capability
        const existing = await repos.capabilities.getById(matchResult.mergeTargetId);
        if (existing) {
          const enrichInput = candidateToEnrichInput(candidate);
          const enriched = enrichCapability(existing, enrichInput);
          await repos.capabilities.update(enriched);
          capabilityId = enriched.id;
          capabilityDecision = 'auto-merge';
        }
      } else if (matchResult.decision === 'new-capability' || existingCapabilities.length === 0) {
        // Create new capability
        const createInput = candidateToCreateInput(candidate, projectId);
        const capability = createCapability(createInput);
        await repos.capabilities.create(capability);
        capabilityId = capability.id;
        capabilityDecision = 'new';
      } else {
        // Ambiguous — don't create a Capability. The candidate is already
        // safely persisted inside the RecordingSession's UnderstandingResult.
        // The human can later:
        //   - Merge: call enrichCapability(existing, candidate) — one atomic op
        //   - New: call createCapability(candidate) — one atomic op
        // No provisional Capability is created to avoid cleanup complexity
        // (re-linking test cases, merging enrichment data, deleting duplicates).
        capabilityId = null;
        capabilityDecision = 'ambiguous';
      }
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
      capabilityId,
      capabilityDecision,
      irArtifactId: irArtifact.id,
      projectId,
    };
  });
}
