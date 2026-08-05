/**
 * Integration tests for the Phase 1 deterministic recorder event sequences.
 *
 * These test complete user interaction flows through the RecordingSession:
 *   1. Click on a button
 *   2. Type in a text field (focus → input → blur)
 *   3. Toggle a checkbox
 *   4. Change a select dropdown
 *
 * They verify that the event sequence is correct, value transitions are
 * captured, and ReplayJson is complete and valid.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { RecordingSession } from '../src/recorder/recording-session';
import type { ElementIdentity } from '../src/shared/types';
import type { ReplayJson, ElementRecordedEvent } from '../src/recorder/recorded-event';

// ── Helpers ─────────────────────────────────────────────────────────────

function identity(tag: string, name: string, extras: Partial<ElementIdentity> = {}): ElementIdentity {
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
    ...extras,
  };
}

beforeEach(() => {
  setupChromeMock();
});

// ── Click on a Button ───────────────────────────────────────────────────

describe('Event Sequence — Click on a Button', () => {
  it('records a single click event with correct identity', () => {
    const session = new RecordingSession();
    session.start('https://app.example.com', 'App');

    const btnIdentity = identity('BUTTON', 'Submit', {
      stableId: 'submit-btn',
      testId: 'submit',
      ariaRole: 'button',
    });

    session.addElementEvent('click', '2026-07-18T08:00:00Z', btnIdentity, null, null, null, null);

    const events = session.getEvents();
    expect(events).toHaveLength(1);

    const clickEvent = events[0] as ElementRecordedEvent;
    expect(clickEvent.eventType).toBe('click');
    expect(clickEvent.target.accessibleName).toBe('Submit');
    expect(clickEvent.target.stableId).toBe('submit-btn');
    expect(clickEvent.target.testId).toBe('submit');
    expect(clickEvent.valueBefore).toBeNull();
    expect(clickEvent.valueAfter).toBeNull();
    expect(clickEvent.checkedBefore).toBeNull();
    expect(clickEvent.checkedAfter).toBeNull();
  });
});

// ── Text Entry Flow ─────────────────────────────────────────────────────

describe('Event Sequence — Text Entry (focus → input → blur)', () => {
  it('records complete text entry with value transitions', () => {
    const session = new RecordingSession();
    session.start('https://app.example.com', 'App');

    const fieldIdentity = identity('INPUT', 'Email Address', {
      stableId: 'email',
      name: 'email',
      placeholder: 'Enter email',
      ariaRole: 'textbox',
    });

    // 1. Focus: valueBefore = null, valueAfter = '' (empty field)
    session.addElementEvent('focus', '2026-07-18T08:00:00Z', fieldIdentity, null, '', null, null);

    // 2. Input "hello": valueBefore = '', valueAfter = 'hello'
    session.addElementEvent('input', '2026-07-18T08:00:01Z', fieldIdentity, '', 'hello', null, null);

    // 3. Input "hello@world.com": valueBefore = 'hello', valueAfter = 'hello@world.com'
    session.addElementEvent('input', '2026-07-18T08:00:02Z', fieldIdentity, 'hello', 'hello@world.com', null, null);

    // 4. Blur: valueBefore = 'hello@world.com', valueAfter = 'hello@world.com'
    session.addElementEvent('blur', '2026-07-18T08:00:03Z', fieldIdentity, 'hello@world.com', 'hello@world.com', null, null);

    const events = session.getEvents();
    expect(events).toHaveLength(4);

    // Verify event sequence
    expect(events.map((e) => (e as ElementRecordedEvent).eventType)).toEqual([
      'focus', 'input', 'input', 'blur',
    ]);

    // Verify value transitions
    const focusEvent = events[0] as ElementRecordedEvent;
    expect(focusEvent.valueBefore).toBeNull();
    expect(focusEvent.valueAfter).toBe('');

    const firstInput = events[1] as ElementRecordedEvent;
    expect(firstInput.valueBefore).toBe('');
    expect(firstInput.valueAfter).toBe('hello');

    const secondInput = events[2] as ElementRecordedEvent;
    expect(secondInput.valueBefore).toBe('hello');
    expect(secondInput.valueAfter).toBe('hello@world.com');

    const blurEvent = events[3] as ElementRecordedEvent;
    expect(blurEvent.valueBefore).toBe('hello@world.com');
    expect(blurEvent.valueAfter).toBe('hello@world.com');
  });

  it('records text entry into a pre-filled field', () => {
    const session = new RecordingSession();
    session.start('https://app.example.com', 'App');

    const field = identity('INPUT', 'Name', { stableId: 'name' });

    // Focus on field that already has "John"
    session.addElementEvent('focus', '2026-07-18T08:00:00Z', field, null, 'John', null, null);
    // Clear and type "Jane"
    session.addElementEvent('input', '2026-07-18T08:00:01Z', field, 'John', 'Jane', null, null);
    // Blur
    session.addElementEvent('blur', '2026-07-18T08:00:02Z', field, 'Jane', 'Jane', null, null);

    const events = session.getEvents();
    const inputEvent = events[1] as ElementRecordedEvent;
    expect(inputEvent.valueBefore).toBe('John');
    expect(inputEvent.valueAfter).toBe('Jane');
  });
});

// ── Checkbox Toggle ─────────────────────────────────────────────────────

describe('Event Sequence — Checkbox Toggle', () => {
  it('records checkbox state transition from unchecked to checked', () => {
    const session = new RecordingSession();
    session.start('https://app.example.com', 'App');

    const cb = identity('INPUT', 'I agree to terms', {
      stableId: 'agree',
      ariaRole: 'checkbox',
    });

    // Mousedown snapshot: checkedBefore = false
    // Click: checkedAfter = true (deferred read)
    session.addElementEvent('click', '2026-07-18T08:00:00Z', cb, null, null, false, true);

    const events = session.getEvents();
    expect(events).toHaveLength(1);

    const clickEvent = events[0] as ElementRecordedEvent;
    expect(clickEvent.eventType).toBe('click');
    expect(clickEvent.checkedBefore).toBe(false);
    expect(clickEvent.checkedAfter).toBe(true);
    expect(clickEvent.valueBefore).toBeNull();
    expect(clickEvent.valueAfter).toBeNull();
  });

  it('records checkbox unchecking', () => {
    const session = new RecordingSession();
    session.start('https://app.example.com', 'App');

    const cb = identity('INPUT', 'Subscribe', { stableId: 'sub', ariaRole: 'checkbox' });

    session.addElementEvent('click', '2026-07-18T08:00:00Z', cb, null, null, true, false);

    const events = session.getEvents();
    const clickEvent = events[0] as ElementRecordedEvent;
    expect(clickEvent.checkedBefore).toBe(true);
    expect(clickEvent.checkedAfter).toBe(false);
  });
});

// ── Select Dropdown ─────────────────────────────────────────────────────

describe('Event Sequence — Select Dropdown Change', () => {
  it('records select value transition', () => {
    const session = new RecordingSession();
    session.start('https://app.example.com', 'App');

    const sel = identity('SELECT', 'Country', {
      stableId: 'country',
      name: 'country',
      ariaRole: 'listbox',
    });

    // Focus on select
    session.addElementEvent('focus', '2026-07-18T08:00:00Z', sel, null, 'United States', null, null);
    // Change to different country
    session.addElementEvent('change', '2026-07-18T08:00:01Z', sel, 'United States', 'Canada', null, null);
    // Blur
    session.addElementEvent('blur', '2026-07-18T08:00:02Z', sel, 'Canada', 'Canada', null, null);

    const events = session.getEvents();
    expect(events).toHaveLength(3);

    const changeEvent = events[1] as ElementRecordedEvent;
    expect(changeEvent.eventType).toBe('change');
    expect(changeEvent.valueBefore).toBe('United States');
    expect(changeEvent.valueAfter).toBe('Canada');
  });
});

// ── Complete Recording Session ──────────────────────────────────────────

describe('Complete Recording Session', () => {
  it('records a full multi-step interaction flow', () => {
    const session = new RecordingSession();
    session.start('https://shop.example.com', 'Shop');

    // Navigation to start page
    session.addNavigation('https://shop.example.com', 'Shop');

    // Click "Login" button
    session.addElementEvent('click', '2026-07-18T08:00:00Z',
      identity('A', 'Login', { stableId: 'login-link', ariaRole: 'link' }),
      null, null, null, null);

    // Navigate to login page
    session.addNavigation('https://shop.example.com/login', 'Login');

    // Focus email field
    session.addElementEvent('focus', '2026-07-18T08:00:02Z',
      identity('INPUT', 'Email', { stableId: 'email', ariaRole: 'textbox' }),
      null, '', null, null);

    // Type email
    session.addElementEvent('input', '2026-07-18T08:00:03Z',
      identity('INPUT', 'Email', { stableId: 'email', ariaRole: 'textbox' }),
      '', 'user@test.com', null, null);

    // Blur email field
    session.addElementEvent('blur', '2026-07-18T08:00:04Z',
      identity('INPUT', 'Email', { stableId: 'email', ariaRole: 'textbox' }),
      'user@test.com', 'user@test.com', null, null);

    // Click "Submit" button
    session.addElementEvent('click', '2026-07-18T08:00:05Z',
      identity('BUTTON', 'Sign In', { stableId: 'signin-btn', ariaRole: 'button' }),
      null, null, null, null);

    // Stop and produce replay
    session.stop();
    const replay = session.toReplayJson();

    // Verify structure
    expect(replay.schemaVersion).toBe(1);
    expect(replay.recordingContext.startUrl).toBe('https://shop.example.com');
    expect(replay.recordingContext.startTitle).toBe('Shop');
    expect(replay.events).toHaveLength(7);

    // Verify event types in order
    const types = replay.events.map((e) => e.eventType);
    expect(types).toEqual([
      'navigation',    // Shop
      'click',         // Login link
      'navigation',    // Login page
      'focus',         // Email field
      'input',         // Type email
      'blur',          // Leave email
      'click',         // Submit
    ]);

    // Verify sequential IDs
    const ids = replay.events.map((e) => e.eventId);
    expect(ids).toEqual([
      'evt-0001', 'evt-0002', 'evt-0003', 'evt-0004', 'evt-0005', 'evt-0006', 'evt-0007',
    ]);

    // Verify navigation URLs
    const navEvents = replay.events.filter((e) => e.eventType === 'navigation');
    expect(navEvents[0].url).toBe('https://shop.example.com');
    expect(navEvents[1].url).toBe('https://shop.example.com/login');
  });

  it('produces deterministic replay JSON', () => {
    const session = new RecordingSession();
    session.start('https://app.com', 'App');

    session.addElementEvent('click', '2026-07-18T08:00:00Z',
      identity('BUTTON', 'OK', { stableId: 'ok' }), null, null, null, null);

    const replay1 = session.toReplayJson();
    const replay2 = session.toReplayJson();

    // Same events → same JSON output
    expect(JSON.stringify(replay1)).toBe(JSON.stringify(replay2));
  });
});

// ── Replay JSON Serialization ───────────────────────────────────────────

describe('Replay JSON Serialization', () => {
  it('serializes to valid JSON with all fields', () => {
    const session = new RecordingSession();
    session.start('https://app.com', 'App');
    session.addNavigation('https://app.com', 'App');
    session.addElementEvent('click', '2026-07-18T08:00:00Z',
      identity('BUTTON', 'Test', { stableId: 'test-btn' }),
      null, null, null, null);

    const replay = session.toReplayJson();
    const json = JSON.stringify(replay, null, 2);

    expect(json).toContain('"schemaVersion": 1');
    expect(json).toContain('"startUrl": "https://app.com"');
    expect(json).toContain('"eventType": "navigation"');
    expect(json).toContain('"eventType": "click"');
    expect(json).toContain('"accessibleName": "Test"');
    expect(json).toContain('"stableId": "test-btn"');
  });

  it('round-trips through JSON.parse without loss', () => {
    const session = new RecordingSession();
    session.start('https://app.com', 'App');
    session.addElementEvent('input', '2026-07-18T08:00:00Z',
      identity('INPUT', 'Field', { stableId: 'field' }),
      'old', 'new', null, null);

    const replay = session.toReplayJson();
    const json = JSON.stringify(replay);
    const parsed: ReplayJson = JSON.parse(json);

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.events).toHaveLength(1);
    const el = parsed.events[0] as ElementRecordedEvent;
    expect(el.valueBefore).toBe('old');
    expect(el.valueAfter).toBe('new');
  });
});
