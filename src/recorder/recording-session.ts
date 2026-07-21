/**
 * Recording Session — Phase 1 Deterministic Recorder
 *
 * Manages the recording lifecycle and stores RecordedEvent[].
 * Produces ReplayJson — the deterministic replay artifact.
 *
 * Responsibilities:
 *   - Start/stop recording with context capture
 *   - Append RecordedEvents with sequential IDs
 *   - Persist events to chrome.storage.local (MV3 recovery)
 *   - Produce ReplayJson on demand
 *
 * Persistence Strategy:
 *   Storage writes are debounced (batched) to avoid O(N²) write
 *   amplification. During recording, persist() schedules a deferred
 *   write that fires either:
 *     - 5 seconds after the last event, OR
 *     - immediately when 10 unsaved events accumulate,
 *   whichever comes first. On stop()/clear(), a final flush writes
 *   synchronously.
 *
 *   The in-memory events[] array and STATE_UPDATE message broadcasts
 *   remain immediate — only the chrome.storage.local.set() call is
 *   debounced. This ensures real-time UI updates (side panel, future
 *   floating panel) while reducing storage I/O to O(N).
 */

import type { RecordingContext, ElementIdentity } from '../shared/types';
import type {
  RecordedEvent,
  ElementRecordedEvent,
  ReplayJson,
  DomContext,
} from './recorded-event';
import { ActionIdGenerator } from './action-id';
import { StorageKeys } from '../shared/types';

/** Debounce: max milliseconds between batched writes. */
const PERSIST_DEBOUNCE_MS = 5_000;

/** Debounce: max events accumulated before an immediate flush. */
const PERSIST_BATCH_THRESHOLD = 10;

export class RecordingSession {
  private events: RecordedEvent[] = [];
  private recording = false;
  private recordingContext: RecordingContext | null = null;
  private eventIdGenerator = new ActionIdGenerator('evt', 0);

  // ── Debounced persistence state ──────────────────────────────────────
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private unsavedCount = 0;

  // ── Lifecycle ────────────────────────────────────────────────────────

  start(startUrl: string, startTitle: string): void {
    this.events = [];
    this.eventIdGenerator.reset();
    this.recordingContext = {
      startUrl,
      startTitle,
      capturedAt: new Date().toISOString(),
    };
    this.recording = true;
    this.persistImmediate();
  }

  stop(): void {
    this.recording = false;
    this.persistImmediate();
  }

  get isRecording(): boolean {
    return this.recording;
  }

  getRecordingContext(): RecordingContext | null {
    return this.recordingContext;
  }

  // ── Event Storage ────────────────────────────────────────────────────

  /**
   * Add a navigation event. Deduplicates consecutive same-URL navigations.
   */
  addNavigation(url: string, title: string, transitionType?: string): void {
    // Dedupe: skip if same URL as the last navigation event
    const lastEvent = this.events[this.events.length - 1];
    if (lastEvent && lastEvent.eventType === 'navigation' && lastEvent.url === url) {
      return;
    }

    const navEvent: RecordedEvent = {
      eventId: this.eventIdGenerator.next(),
      eventType: 'navigation',
      timestamp: new Date().toISOString(),
      url,
      title,
      ...(transitionType ? { transitionType } : {}),
    };

    this.events.push(navEvent);
    this.schedulePersist();
  }

  /**
   * Add an element event from the content script.
   *
   * The content script sends the raw event data without an eventId;
   * this method assigns the sequential eventId.
   */
  addElementEvent(
    eventType: ElementRecordedEvent['eventType'],
    timestamp: string,
    target: ElementIdentity,
    valueBefore: string | null,
    valueAfter: string | null,
    checkedBefore: boolean | null,
    checkedAfter: boolean | null,
    domContext?: DomContext,
  ): void {
    const event: ElementRecordedEvent = {
      eventId: this.eventIdGenerator.next(),
      eventType,
      timestamp,
      target,
      valueBefore,
      valueAfter,
      checkedBefore,
      checkedAfter,
      ...(domContext ? { domContext } : {}),
    };

    this.events.push(event);
    this.schedulePersist();
  }

  /**
   * Get all recorded events (ordered).
   */
  getEvents(): RecordedEvent[] {
    return [...this.events];
  }

  /**
   * Get the number of recorded events.
   */
  get eventCount(): number {
    return this.events.length;
  }

  // ── Replay JSON ──────────────────────────────────────────────────────

  /**
   * Produce the deterministic replay artifact.
   */
  toReplayJson(): ReplayJson {
    return {
      schemaVersion: 1,
      recordingContext: this.recordingContext ?? {
        startUrl: '',
        startTitle: '',
        capturedAt: new Date().toISOString(),
      },
      events: this.getEvents(),
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────

  clear(): void {
    this.events = [];
    this.recordingContext = null;
    this.eventIdGenerator.reset();
    this.persistImmediate();
  }

  /**
   * Schedule a debounced persist. Writes to storage at most once per
   * PERSIST_DEBOUNCE_MS, unless PERSIST_BATCH_THRESHOLD unsaved events
   * accumulate, in which case it flushes immediately.
   *
   * This is safe for crash recovery because:
   *   - The maximum data loss window is PERSIST_DEBOUNCE_MS (5s).
   *   - Navigation events are low-frequency and batch quickly.
   *   - stop() calls persistImmediate() for a final flush.
   */
  private schedulePersist(): void {
    this.unsavedCount++;

    // If we've accumulated enough events, flush immediately.
    if (this.unsavedCount >= PERSIST_BATCH_THRESHOLD) {
      this.persistImmediate();
      return;
    }

    // Otherwise, debounce: schedule a write if one isn't already pending.
    if (this.persistTimer === null) {
      this.persistTimer = setTimeout(() => {
        this.persistImmediate();
      }, PERSIST_DEBOUNCE_MS);
    }
  }

  /**
   * Persist immediately, cancelling any pending debounced write.
   * Used for start(), stop(), clear(), and batch-threshold flushes.
   */
  private persistImmediate(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.unsavedCount = 0;

    try {
      chrome.storage.local.set({
        [StorageKeys.SESSION_EVENTS]: [...this.events],
        [StorageKeys.SESSION_CONTEXT]: this.recordingContext,
      });
    } catch {
      // Storage may not be available — events are in memory for this session
    }
  }

  /**
   * Restore the session from chrome.storage.local.
   *
   * Called on service worker startup to recover from MV3 lifecycle.
   */
  async restoreFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([
        StorageKeys.SESSION_EVENTS,
        StorageKeys.SESSION_CONTEXT,
      ]);

      if (result[StorageKeys.SESSION_EVENTS]) {
        this.events = result[StorageKeys.SESSION_EVENTS] as RecordedEvent[];
        // Advance the ID generator past all restored events
        for (const event of this.events) {
          const match = event.eventId.match(/(\d+)$/);
          if (match) {
            this.eventIdGenerator.advanceTo(parseInt(match[1], 10));
          }
        }
      }

      if (result[StorageKeys.SESSION_CONTEXT]) {
        this.recordingContext = result[StorageKeys.SESSION_CONTEXT] as RecordingContext;
      }
    } catch {
      // Storage not available — start fresh
    }
  }
}
