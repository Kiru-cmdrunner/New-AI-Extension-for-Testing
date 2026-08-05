/**
 * Unit tests for the Phase 1 RecordingSession.
 *
 * Tests the new RecordedEvent-based session: lifecycle, event storage,
 * sequential IDs, navigation deduplication, and ReplayJson production.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { RecordingSession } from '../src/recorder/recording-session';
import type { ElementIdentity } from '../src/shared/types';

// ── Test Helpers ────────────────────────────────────────────────────────

function makeIdentity(tag: string, name: string): ElementIdentity {
  return {
    accessibleName: name,
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag,
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: tag.toLowerCase(),
    xPath: `//${tag.toLowerCase()}`,
    inIframe: false,
    shadowDom: false,
    href: null,
    elementId: '',
  };
}

beforeEach(() => {
  setupChromeMock();
});

// ── Lifecycle ───────────────────────────────────────────────────────────

describe('RecordingSession — Lifecycle', () => {
  it('starts in a not-recording state', () => {
    const session = new RecordingSession();
    expect(session.isRecording).toBe(false);
  });

  it('isRecording is true after start()', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');
    expect(session.isRecording).toBe(true);
  });

  it('isRecording is false after stop()', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');
    session.stop();
    expect(session.isRecording).toBe(false);
  });

  it('getRecordingContext returns the start context', () => {
    const session = new RecordingSession();
    session.start('https://test.com', 'Test Page');
    const ctx = session.getRecordingContext();
    expect(ctx).not.toBeNull();
    expect(ctx!.startUrl).toBe('https://test.com');
    expect(ctx!.startTitle).toBe('Test Page');
    expect(ctx!.capturedAt).toBeTruthy();
  });

  it('clear() resets events and context', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');
    session.addNavigation('https://example.com', 'Example');
    session.addElementEvent('click', new Date().toISOString(), makeIdentity('BUTTON', 'Click'), null, null, null, null);
    session.clear();

    expect(session.eventCount).toBe(0);
    expect(session.getRecordingContext()).toBeNull();
  });
});

// ── Event Storage ───────────────────────────────────────────────────────

describe('RecordingSession — Event Storage', () => {
  it('addNavigation creates a navigation event with sequential ID', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');
    session.addNavigation('https://example.com', 'Example');

    const events = session.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('navigation');
    expect(events[0].eventId).toBe('evt-0001');
  });

  it('deduplicates consecutive same-URL navigations', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');
    session.addNavigation('https://example.com', 'Example');
    session.addNavigation('https://example.com', 'Example'); // same URL — skipped

    expect(session.eventCount).toBe(1);
  });

  it('allows different-URL navigations', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');
    session.addNavigation('https://example.com', 'Example');
    session.addNavigation('https://other.com', 'Other'); // different — kept

    const events = session.getEvents();
    expect(events).toHaveLength(2);
    expect(events[1].eventId).toBe('evt-0002');
  });

  it('addElementEvent stores element events with sequential IDs', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');

    session.addElementEvent('click', '2026-07-18T08:00:00Z', makeIdentity('BUTTON', 'Submit'), null, null, null, null);
    session.addElementEvent('focus', '2026-07-18T08:00:01Z', makeIdentity('INPUT', 'Email'), null, null, null, null);
    session.addElementEvent('input', '2026-07-18T08:00:02Z', makeIdentity('INPUT', 'Email'), null, 'test@test.com', null, null);

    const events = session.getEvents();
    expect(events).toHaveLength(3);
    expect(events[0].eventId).toBe('evt-0001');
    expect(events[1].eventId).toBe('evt-0002');
    expect(events[2].eventId).toBe('evt-0003');
  });

  it('stores value transitions correctly', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');

    session.addElementEvent('input', '2026-07-18T08:00:00Z', makeIdentity('INPUT', 'Name'), '', 'hello', null, null);

    const events = session.getEvents();
    expect(events[0].eventType).toBe('input');
    const elEvent = events[0] as Extract<typeof events[0], { eventType: 'input' }>;
    expect(elEvent.valueBefore).toBe('');
    expect(elEvent.valueAfter).toBe('hello');
  });

  it('stores checked transitions correctly', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');

    session.addElementEvent('click', '2026-07-18T08:00:00Z', makeIdentity('INPUT', 'Agree'), null, null, false, true);

    const events = session.getEvents();
    const elEvent = events[0] as Extract<typeof events[0], { eventType: 'click' }>;
    expect(elEvent.checkedBefore).toBe(false);
    expect(elEvent.checkedAfter).toBe(true);
  });

  it('preserves element identity fields', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');

    const identity = makeIdentity('SELECT', 'Country');
    identity.stableId = 'country-select';
    identity.testId = 'country';
    identity.ariaRole = 'listbox';

    session.addElementEvent('change', '2026-07-18T08:00:00Z', identity, 'USA', 'UK', null, null);

    const events = session.getEvents();
    const elEvent = events[0] as Extract<typeof events[0], { eventType: 'change' }>;
    expect(elEvent.target.tag).toBe('SELECT');
    expect(elEvent.target.accessibleName).toBe('Country');
    expect(elEvent.target.stableId).toBe('country-select');
    expect(elEvent.target.testId).toBe('country');
    expect(elEvent.target.ariaRole).toBe('listbox');
  });
});

// ── Replay JSON ─────────────────────────────────────────────────────────

describe('RecordingSession — ReplayJson', () => {
  it('produces valid ReplayJson with schemaVersion 1', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');

    const replay = session.toReplayJson();
    expect(replay.schemaVersion).toBe(1);
    expect(replay.recordingContext.startUrl).toBe('https://example.com');
    expect(replay.events).toEqual([]);
  });

  it('includes all events in ReplayJson', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');
    session.addNavigation('https://example.com', 'Example');
    session.addElementEvent('click', '2026-07-18T08:00:00Z', makeIdentity('BUTTON', 'Submit'), null, null, null, null);
    session.addElementEvent('input', '2026-07-18T08:00:01Z', makeIdentity('INPUT', 'Email'), '', 'test@test.com', null, null);

    const replay = session.toReplayJson();
    expect(replay.events).toHaveLength(3);
    expect(replay.events[0].eventType).toBe('navigation');
    expect(replay.events[1].eventType).toBe('click');
    expect(replay.events[2].eventType).toBe('input');
  });

  it('preserves event ordering in ReplayJson', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');

    for (let i = 0; i < 5; i++) {
      session.addElementEvent('click', `2026-07-18T08:00:0${i}Z`, makeIdentity('BUTTON', `Btn ${i}`), null, null, null, null);
    }

    const replay = session.toReplayJson();
    const ids = replay.events.map((e) => e.eventId);
    expect(ids).toEqual(['evt-0001', 'evt-0002', 'evt-0003', 'evt-0004', 'evt-0005']);
  });
});

// ── MV3 Recovery ────────────────────────────────────────────────────────

describe('RecordingSession — MV3 Recovery', () => {
  it('restoreFromStorage recovers events from storage', async () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');
    session.addNavigation('https://example.com', 'Example');
    session.addElementEvent('click', '2026-07-18T08:00:00Z', makeIdentity('BUTTON', 'Submit'), null, null, null, null);
    session.stop(); // flush debounced writes to storage

    // Simulate SW restart: create new session and restore
    const restored = new RecordingSession();
    await restored.restoreFromStorage();

    const events = restored.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe('navigation');
    expect(events[1].eventType).toBe('click');
  });

  it('restoreFromStorage advances ID generator past restored events', async () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');
    session.addElementEvent('click', '2026-07-18T08:00:00Z', makeIdentity('BUTTON', 'A'), null, null, null, null);
    session.addElementEvent('click', '2026-07-18T08:00:01Z', makeIdentity('BUTTON', 'B'), null, null, null, null);
    session.stop(); // flush debounced writes to storage

    const restored = new RecordingSession();
    await restored.restoreFromStorage();

    // New event after restore should not collide with existing IDs
    restored.addElementEvent('click', '2026-07-18T08:00:02Z', makeIdentity('BUTTON', 'C'), null, null, null, null);
    const events = restored.getEvents();
    expect(events[2].eventId).toBe('evt-0003');
  });
});

// ── Debounced Persistence ──────────────────────────────────────────────

describe('RecordingSession — Debounced Persistence', () => {
  it('stop() flushes all pending events to storage', async () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');
    session.addNavigation('https://example.com', 'Example');
    session.addElementEvent('click', '2026-07-18T08:00:00Z', makeIdentity('BUTTON', 'A'), null, null, null, null);
    session.stop();

    const restored = new RecordingSession();
    await restored.restoreFromStorage();
    expect(restored.getEvents()).toHaveLength(2);
  });

  it('in-memory events array is immediate regardless of debounce', () => {
    const session = new RecordingSession();
    session.start('https://example.com', 'Example');
    session.addElementEvent('click', '2026-07-18T08:00:00Z', makeIdentity('BUTTON', 'A'), null, null, null, null);
    session.addElementEvent('click', '2026-07-18T08:00:01Z', makeIdentity('BUTTON', 'B'), null, null, null, null);

    // getEvents() reflects in-memory state immediately — not debounced
    expect(session.getEvents()).toHaveLength(2);
    expect(session.eventCount).toBe(2);
  });
});
