import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import {
  audit,
  getAuditTrail,
  clearAuditTrail,
  getAuditStats,
  _resetCache,
} from '../src/infrastructure/audit-manager';

describe('Audit Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupChromeMock();
    _resetCache();
  });

  describe('audit()', () => {
    it('records an audit event', async () => {
      await audit('test-event', 'entity-001', { foo: 'bar' });

      const trail = await getAuditTrail();
      expect(trail).toHaveLength(1);
      expect(trail[0].type).toBe('test-event');
      expect(trail[0].entityId).toBe('entity-001');
      expect(trail[0].details.foo).toBe('bar');
    });

    it('records without details', async () => {
      await audit('simple-event', 'entity-002');

      const trail = await getAuditTrail();
      expect(trail).toHaveLength(1);
      expect(trail[0].details).toEqual({});
    });

    it('records multiple events in order', async () => {
      await audit('event-1', 'e1');
      await audit('event-2', 'e2');
      await audit('event-3', 'e3');

      const trail = await getAuditTrail();
      expect(trail).toHaveLength(3);
      expect(trail[0].entityId).toBe('e1');
      expect(trail[1].entityId).toBe('e2');
      expect(trail[2].entityId).toBe('e3');
    });

    it('includes ISO timestamp', async () => {
      await audit('timestamped', 'e1');
      const trail = await getAuditTrail();
      expect(trail[0].timestamp).toBeTruthy();
      // Should be ISO format
      expect(trail[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('getAuditTrail() with filter', () => {
    it('filters by type', async () => {
      await audit('login', 'user-1');
      await audit('logout', 'user-1');
      await audit('login', 'user-2');

      const loginEvents = await getAuditTrail({ type: 'login' });
      expect(loginEvents).toHaveLength(2);
      expect(loginEvents.every((e) => e.type === 'login')).toBe(true);
    });

    it('filters by entityId', async () => {
      await audit('event', 'entity-A');
      await audit('event', 'entity-B');
      await audit('event', 'entity-A');

      const filtered = await getAuditTrail({ entityId: 'entity-A' });
      expect(filtered).toHaveLength(2);
    });

    it('filters by since timestamp', async () => {
      await audit('old', 'e1');
      // All events have timestamps very close together, so filter by "since now + 1s"
      const future = new Date(Date.now() + 10000).toISOString();
      const filtered = await getAuditTrail({ since: future });
      expect(filtered).toHaveLength(0);
    });

    it('returns all events with no filter', async () => {
      await audit('a', '1');
      await audit('b', '2');
      const all = await getAuditTrail();
      expect(all).toHaveLength(2);
    });
  });

  describe('clearAuditTrail()', () => {
    it('removes all audit events', async () => {
      await audit('event-1', 'e1');
      await audit('event-2', 'e2');
      expect((await getAuditTrail()).length).toBe(2);

      await clearAuditTrail();
      expect((await getAuditTrail()).length).toBe(0);
    });
  });

  describe('getAuditStats()', () => {
    it('returns correct statistics', async () => {
      await audit('login', 'user-1');
      await audit('login', 'user-2');
      await audit('logout', 'user-1');

      const stats = await getAuditStats();
      expect(stats.total).toBe(3);
      expect(stats.byType.login).toBe(2);
      expect(stats.byType.logout).toBe(1);
      expect(stats.oldestTimestamp).toBeTruthy();
      expect(stats.newestTimestamp).toBeTruthy();
    });

    it('returns empty stats for empty trail', async () => {
      const stats = await getAuditStats();
      expect(stats.total).toBe(0);
      expect(stats.oldestTimestamp).toBeNull();
      expect(stats.newestTimestamp).toBeNull();
    });
  });

  describe('Non-throwing', () => {
    it('does not throw when storage fails', async () => {
      // Mock chrome.storage.local.set to throw
      const original = chrome.storage.local.set;
      chrome.storage.local.set = vi.fn(async () => {
        throw new Error('storage broken');
      });

      await expect(audit('test', 'e1')).resolves.not.toThrow();

      chrome.storage.local.set = original;
    });
  });
});
