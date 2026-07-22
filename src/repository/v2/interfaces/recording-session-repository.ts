/**
 * RecordingSessionRepository Interface — contract for persisting
 * RecordingSession entities.
 *
 * RecordingSessions are immutable after creation except for the testCaseIds
 * forward links (INV-RS1). Delete is absent — sessions are never deleted
 * (they are the provenance chain for derived test cases).
 */

import type { RecordingSession } from '../../../domain/entities/recording-session';

export interface RecordingSessionRepository {
  /** Get a recording session by ID. Returns undefined if not found. */
  getById(id: string): Promise<RecordingSession | undefined>;

  /** Get all recording sessions in a project. */
  getByProject(projectId: string): Promise<RecordingSession[]>;

  /** Create a new recording session. INV-RS1: immutable after creation. */
  create(session: RecordingSession): Promise<RecordingSession>;

  /**
   * Update the testCaseIds forward links.
   * This is the only mutable field — the rest of the session is immutable.
   * The caller should pass the updated session (with addTestCaseAssociation applied).
   */
  update(session: RecordingSession): Promise<RecordingSession>;

  /**
   * Get sessions that contributed to a specific capability.
   * Queries the understandingResult.capability.sessionId field.
   */
  getByCapabilityId(capabilityId: string): Promise<RecordingSession[]>;
}
