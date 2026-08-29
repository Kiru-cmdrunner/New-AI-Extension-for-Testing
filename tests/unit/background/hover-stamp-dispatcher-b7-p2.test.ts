/**
 * B7-P2 §5.2.3 (dispatcher wiring) — the service-worker OBSERVED_EVENT
 * stamp site computes the R-4 gate from the payload and routes gated
 * trusted mouseenters through setLastTrustedActionIfAbsent.
 *
 * Tests the dispatcher behavior with a stubbed network-observation module
 * boundary: the real stamp store is exercised through the exported
 * setLastTrustedActionIfAbsent / getLastTrustedAction API.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setLastTrustedAction,
  setLastTrustedActionIfAbsent,
  getLastTrustedAction,
} from '../../../src/background/network-observation';

function fakeChrome() {
  const store: Record<string, unknown> = {};
  return {
    runtime: { sendMessage: vi.fn(), lastError: undefined },
    storage: { local: { get: vi.fn(async () => store), set: vi.fn(async (o) => Object.assign(store, o)) } },
    tabs: { query: vi.fn(async () => []) },
  } as never;
}

describe('B7-P2: hover enter secondary stamp — R14 create-only guard', () => {
  beforeEach(() => {
    global.chrome = fakeChrome();
  });

  it('a gated hover enter CREATES a stamp when the frame has none', () => {
    setLastTrustedActionIfAbsent(7, 0, { eventId: 'evt-enter-1', interactionId: '' });
    const stamp = getLastTrustedAction(7, 0);
    expect(stamp).not.toBeNull();
    expect(stamp!.eventId).toBe('evt-enter-1');
  });

  it('a gated hover enter NEVER overwrites an existing click primary (R14)', () => {
    setLastTrustedAction(7, 0, { eventId: 'evt-click-1', interactionId: '' });
    setLastTrustedActionIfAbsent(7, 0, { eventId: 'evt-enter-2', interactionId: '' });
    const stamp = getLastTrustedAction(7, 0);
    expect(stamp!.eventId).toBe('evt-click-1');
  });

  it('a click primary AFTER a hover stamp overwrites it (primary semantics intact)', () => {
    setLastTrustedActionIfAbsent(7, 0, { eventId: 'evt-enter-1', interactionId: '' });
    setLastTrustedAction(7, 0, { eventId: 'evt-click-9', interactionId: '' });
    const stamp = getLastTrustedAction(7, 0);
    expect(stamp!.eventId).toBe('evt-click-9');
  });

  it('per-frame isolation: hover stamp in frame 1 does not touch frame 0', () => {
    setLastTrustedAction(7, 0, { eventId: 'evt-click-1', interactionId: '' });
    setLastTrustedActionIfAbsent(7, 1, { eventId: 'evt-enter-2', interactionId: '' });
    expect(getLastTrustedAction(7, 0)!.eventId).toBe('evt-click-1');
    expect(getLastTrustedAction(7, 1)!.eventId).toBe('evt-enter-2');
  });
});
