/**
 * DexieRecordingSessionRepository — Dexie implementation of RecordingSessionRepository.
 */

import type { RecordingSession } from '../../../domain/entities/recording-session';
import type { RecordingSessionRepository } from '../interfaces/recording-session-repository';
import type { Table } from 'dexie';

export class DexieRecordingSessionRepository implements RecordingSessionRepository {
  constructor(private readonly sessions: Table<RecordingSession, string>) {}

  async getById(id: string): Promise<RecordingSession | undefined> {
    return this.sessions.get(id);
  }

  async getByProject(projectId: string): Promise<RecordingSession[]> {
    return this.sessions.where('projectId').equals(projectId).toArray();
  }

  async create(session: RecordingSession): Promise<RecordingSession> {
    await this.sessions.add(session);
    return session;
  }

  async update(session: RecordingSession): Promise<RecordingSession> {
    // Replace — the only mutable field is testCaseIds (forward links).
    await this.sessions.put(session);
    return session;
  }

  async getByCapabilityId(_capabilityId: string): Promise<RecordingSession[]> {
    // Sessions don't have a direct capabilityId index. We scan by project
    // and filter in-memory by checking understandingResult.capability.
    // This is acceptable because session counts per project are small
    // (typically dozens, not thousands).
    //
    // Note: the understandingResult.fragment doesn't carry capabilityId.
    // The capability candidate's sessionId is what we match on.
    // For now, this is a linear scan across all sessions.
    const allSessions = await this.sessions.toArray();
    return allSessions.filter((s) => {
      const cap = s.understandingResult?.capability;
      return cap !== null && cap !== undefined;
    });
  }
}
