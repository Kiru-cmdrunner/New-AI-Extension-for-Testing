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
}
