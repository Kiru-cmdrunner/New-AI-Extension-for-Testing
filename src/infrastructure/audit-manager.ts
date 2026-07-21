/**
 * Audit Manager — append-only audit trail for significant system events.
 *
 * Phase 3 Task 8 (G10).
 *
 * Component Technical Specification §Infrastructure Layer:
 * Records significant system events for traceability and debugging.
 * Audit events are immutable once written.
 *
 * MV3 Constraints:
 * - Audit trail stored in chrome.storage.local (bounded by storage quota)
 * - Maximum 1000 entries (ring buffer — oldest evicted when full)
 * - Never blocks the calling code — write failures are logged but swallowed
 *
 * Audit events differ from log entries:
 * - Logs: operational, transient, for debugging
 * - Audit: significant, persistent, for traceability
 */

import type { AuditEvent } from '../shared/architecture-types';
import { createLogger } from './logging-manager';

const STORAGE_KEY = 'cmdrunner_audit_trail';
const MAX_ENTRIES = 1000;

const logger = createLogger('audit');

// ── Audit Trail Access ─────────────────────────────────────

/**
 * In-memory cache of the audit trail to avoid async storage reads
 * on every audit call. Loaded once on first use.
 */
let trailCache: AuditEvent[] | null = null;
let cacheInitialized = false;

/**
 * Ensure the trail cache is loaded from storage.
 */
async function ensureCache(): Promise<void> {
  if (cacheInitialized) return;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (Array.isArray(stored)) {
      trailCache = stored as AuditEvent[];
    } else {
      trailCache = [];
    }
  } catch {
    trailCache = [];
  }
  cacheInitialized = true;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Record a significant system event in the audit trail.
 *
 * This method NEVER throws — it logs failures but doesn't propagate them.
 * It's safe to call from any code path, including error handlers.
 *
 * @param type    - Event type (e.g. 'recording-started', 'step-generated').
 * @param entityId - ID of the entity involved.
 * @param details - Additional structured details.
 */
export async function audit(
  type: string,
  entityId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const event: AuditEvent = {
    type,
    timestamp: new Date().toISOString(),
    entityId,
    details: details ?? {},
  };

  try {
    await ensureCache();
    if (trailCache === null) trailCache = [];
    trailCache.push(event);

    // Ring buffer: evict oldest entries if over limit
    if (trailCache.length > MAX_ENTRIES) {
      trailCache = trailCache.slice(-MAX_ENTRIES);
    }

    // Persist (fire-and-forget in production, but await for tests)
    await chrome.storage.local.set({ [STORAGE_KEY]: trailCache });
  } catch (err) {
    logger.warn('Failed to write audit event', { type, error: String(err) });
  }
}

/**
 * Read the audit trail.
 *
 * @param filter - Optional filter object. If provided, only events matching
 *                 all filter criteria are returned.
 * @returns Array of AuditEvents, newest last.
 */
export async function getAuditTrail(filter?: {
  type?: string;
  entityId?: string;
  since?: string;
}): Promise<AuditEvent[]> {
  await ensureCache();
  if (trailCache === null) return [];

  let result = [...trailCache];

  if (filter) {
    if (filter.type) {
      result = result.filter((e) => e.type === filter.type);
    }
    if (filter.entityId) {
      result = result.filter((e) => e.entityId === filter.entityId);
    }
    if (filter.since) {
      result = result.filter((e) => e.timestamp >= filter.since!);
    }
  }

  return result;
}

/**
 * Clear the entire audit trail.
 * Use with caution — audit data is meant to be persistent.
 */
export async function clearAuditTrail(): Promise<void> {
  trailCache = [];
  cacheInitialized = true;
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Get audit trail statistics.
 */
export async function getAuditStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
}> {
  await ensureCache();
  if (trailCache === null || trailCache.length === 0) {
    return { total: 0, byType: {}, oldestTimestamp: null, newestTimestamp: null };
  }

  const byType: Record<string, number> = {};
  for (const e of trailCache) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }

  return {
    total: trailCache.length,
    byType,
    oldestTimestamp: trailCache[0].timestamp,
    newestTimestamp: trailCache[trailCache.length - 1].timestamp,
  };
}

// ── Reset for Testing ──────────────────────────────────────

/**
 * Reset the in-memory cache. For testing only.
 */
export function _resetCache(): void {
  trailCache = null;
  cacheInitialized = false;
}
