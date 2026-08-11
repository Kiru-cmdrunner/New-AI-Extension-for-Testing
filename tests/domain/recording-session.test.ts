/**
 * Tests for the RecordingSession domain entity.
 *
 * Validates:
 * - Factory function invariant validation
 * - Immutable fields (understandingResult, rawEvents, rawInteractions)
 * - Mutable forward links (testCaseIds)
 * - addTestCaseAssociation() idempotency and immutability
 */

import { describe, it, expect } from 'vitest';
import {
  createRecordingSession,
  addTestCaseAssociation,
  type CreateRecordingSessionInput,
} from '../../src/domain/entities/recording-session';
import type { UnderstandingResult } from '../../src/domain/entities/understanding-result';
import type { SessionEvent } from '../../src/shared/types';

// ── Helpers ────────────────────────────────────────────────

function makeUnderstandingResult(overrides: Partial<UnderstandingResult> = {}): UnderstandingResult {
  return {
    sessionId: 'session-001',
    generatedAt: '2026-07-22T00:00:00Z',
    schemaVersion: 1,
    ...overrides,
  };
}

function makeSessionEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  const base: SessionEvent = {
    actionId: 'evt-001',
    type: 'navigation',
    url: 'https://example.com',
    title: 'Example',
    timestamp: '2026-07-22T00:00:00Z',
  };
  return { ...base, ...overrides } as SessionEvent;
}

function makeCreateInput(overrides: Partial<CreateRecordingSessionInput> = {}): CreateRecordingSessionInput {
  return {
    projectId: 'proj-001',
    understandingResult: makeUnderstandingResult(),
    rawEvents: [makeSessionEvent()],
    rawInteractions: [],
    url: 'https://example.com/customers/new',
    ...overrides,
  };
}

// ── createRecordingSession() ───────────────────────────────

describe('createRecordingSession', () => {
  it('creates a session with all fields populated', () => {
    const input = makeCreateInput();
    const session = createRecordingSession(input);

    expect(session.id).toBeDefined();
    expect(session.projectId).toBe('proj-001');
    expect(session.understandingResult).toBe(input.understandingResult);
    expect(session.rawEvents).toHaveLength(1);
    expect(session.rawInteractions).toEqual([]);
    expect(session.url).toBe('https://example.com/customers/new');
    expect(session.recordedAt).toBe(input.understandingResult.generatedAt);
    expect(session.duration).toBeNull();
    expect(session.testCaseIds).toEqual([]);
  });

  it('accepts a duration when provided', () => {
    const session = createRecordingSession(makeCreateInput({ duration: 45000 }));
    expect(session.duration).toBe(45000);
  });

  it('throws MissingFieldError if projectId is empty', () => {
    expect(() => createRecordingSession(makeCreateInput({ projectId: '' }))).toThrow();
    expect(() => createRecordingSession(makeCreateInput({ projectId: '  ' }))).toThrow();
  });

  it('throws MissingFieldError if understandingResult is null', () => {
    expect(() =>
      createRecordingSession(makeCreateInput({ understandingResult: null as unknown as UnderstandingResult })),
    ).toThrow();
  });

  it('trims whitespace on projectId and url', () => {
    const session = createRecordingSession(
      makeCreateInput({
        projectId: '  proj-001  ',
        url: '  https://example.com  ',
      }),
    );

    expect(session.projectId).toBe('proj-001');
    expect(session.url).toBe('https://example.com');
  });

  it('defaults url to empty string if not provided', () => {
    const session = createRecordingSession(makeCreateInput({ url: '' }));
    expect(session.url).toBe('');
  });

  it('copies rawEvents and rawInteractions (defensive copy)', () => {
    const events = [makeSessionEvent(), makeSessionEvent({ actionId: 'evt-002' })];
    const session = createRecordingSession(makeCreateInput({ rawEvents: events }));

    expect(session.rawEvents).toHaveLength(2);
    // Mutating the original array should not affect the session
    events.push(makeSessionEvent({ actionId: 'evt-003' }));
    expect(session.rawEvents).toHaveLength(2);
  });

  it('generates a unique ID for each session', () => {
    const input = makeCreateInput();
    const session1 = createRecordingSession(input);
    const session2 = createRecordingSession(input);

    expect(session1.id).not.toBe(session2.id);
  });
});

// ── addTestCaseAssociation() ───────────────────────────────

describe('addTestCaseAssociation', () => {
  it('adds a test case ID to the session', () => {
    const session = createRecordingSession(makeCreateInput());

    const updated = addTestCaseAssociation(session, 'tc-001');

    expect(updated.testCaseIds).toEqual(['tc-001']);
  });

  it('is idempotent — does not add duplicate test case IDs', () => {
    const session = createRecordingSession(makeCreateInput());
    const updated = addTestCaseAssociation(session, 'tc-001');
    const updated2 = addTestCaseAssociation(updated, 'tc-001');

    expect(updated2.testCaseIds).toEqual(['tc-001']);
    expect(updated2).toBe(updated); // same reference — no change needed
  });

  it('does not modify the original session (pure function)', () => {
    const session = createRecordingSession(makeCreateInput());

    addTestCaseAssociation(session, 'tc-001');

    expect(session.testCaseIds).toEqual([]);
  });

  it('throws MissingFieldError if testCaseId is empty', () => {
    const session = createRecordingSession(makeCreateInput());

    expect(() => addTestCaseAssociation(session, '')).toThrow();
    expect(() => addTestCaseAssociation(session, '  ')).toThrow();
  });

  it('can add multiple test case IDs', () => {
    const session = createRecordingSession(makeCreateInput());

    const updated1 = addTestCaseAssociation(session, 'tc-001');
    const updated2 = addTestCaseAssociation(updated1, 'tc-002');
    const updated3 = addTestCaseAssociation(updated2, 'tc-003');

    expect(updated3.testCaseIds).toEqual(['tc-001', 'tc-002', 'tc-003']);
  });
});

// ── Type-level tests ────────────────────────────────────────

describe('RecordingSession type properties', () => {
  it('recordedAt matches understandingResult.generatedAt', () => {
    const ur = makeUnderstandingResult({ generatedAt: '2026-01-15T10:30:00Z' });
    const session = createRecordingSession(makeCreateInput({ understandingResult: ur }));

    expect(session.recordedAt).toBe('2026-01-15T10:30:00Z');
  });
});
