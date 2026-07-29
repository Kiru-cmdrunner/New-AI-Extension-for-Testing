/**
 * Delivery Coordinator — Phase 3
 *
 * Manages reliable delivery of EvidenceBatches from the content script
 * to the MV3 service worker, surviving SW eviction.
 *
 * Key reliability patterns adopted from working-better:
 * 1. sessionStorage buffer — survives SW death, page navigation
 * 2. Exponential backoff retry — 100ms → 200ms → 400ms → 800ms → 1600ms
 * 3. Confirmed delivery — events only removed from buffer on response.ok
 * 4. pagehide flush — deliver pending events before navigation
 * 5. pageshow resume — re-install tap if recording was active
 *
 * MV3 Reality:
 * - The service worker is killed when no message is received for ~30s.
 * - The content script lives as long as the page is loaded.
 * - So: buffer events in sessionStorage, retry on failure, clear on stop.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceBatch } from '../../types/evidence';

// ── Constants ────────────────────────────────────────────────────────────

const BUFFER_KEY = 'cmdrunner_evidence_buffer';
const RECORDING_KEY = 'cmdrunner_is_recording';

const MAX_BUFFER_SIZE = 500;
const MAX_RETRIES = 5;
const BASE_RETRY_MS = 100;

// ── Session Storage Buffer ───────────────────────────────────────────────

/**
 * Push a batch to the sessionStorage buffer.
 */
function pushToBuffer(batch: EvidenceBatch): void {
  try {
    const raw = sessionStorage.getItem(BUFFER_KEY);
    const buffer: EvidenceBatch[] = raw ? JSON.parse(raw) : [];
    buffer.push(batch);
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer.shift(); // drop oldest if over capacity
    }
    sessionStorage.setItem(BUFFER_KEY, JSON.stringify(buffer));
  } catch {
    // sessionStorage may be full or unavailable — silent degrade
  }
}

/**
 * Remove a batch from the buffer by ID.
 */
function removeFromBuffer(batchId: string): void {
  try {
    const raw = sessionStorage.getItem(BUFFER_KEY);
    if (!raw) return;
    const buffer: EvidenceBatch[] = JSON.parse(raw);
    const filtered = buffer.filter((b) => b.id !== batchId);
    sessionStorage.setItem(BUFFER_KEY, JSON.stringify(filtered));
  } catch {
    // silent degrade
  }
}

/**
 * Peek the buffer (non-destructive read).
 */
function peekBuffer(): EvidenceBatch[] {
  try {
    const raw = sessionStorage.getItem(BUFFER_KEY);
    return raw ? (JSON.parse(raw) as EvidenceBatch[]) : [];
  } catch {
    return [];
  }
}

/**
 * Clear the entire buffer.
 */
export function clearBuffer(): void {
  try {
    sessionStorage.removeItem(BUFFER_KEY);
  } catch {
    // silent degrade
  }
}

/**
 * Check if recording is active (from sessionStorage).
 */
export function isRecordingActive(): boolean {
  try {
    return sessionStorage.getItem(RECORDING_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Set recording state in sessionStorage.
 */
export function setRecordingActive(active: boolean): void {
  try {
    sessionStorage.setItem(RECORDING_KEY, active ? 'true' : 'false');
  } catch {
    // silent degrade
  }
}

// ── Service Worker Communication ─────────────────────────────────────────

/**
 * Message type for evidence batch delivery.
 */
export const EVIDENCE_BATCH_MESSAGE_TYPE = 'EVIDENCE_BATCH_DELIVERED';

/**
 * Send an evidence batch to the service worker.
 * Buffers first, then attempts delivery with exponential backoff.
 * Removes from buffer on confirmed delivery only.
 */
export function deliverBatch(batch: EvidenceBatch): void {
  // 1. Always buffer first
  pushToBuffer(batch);

  // 2. Attempt delivery with retry
  if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) return;

  const attempt = (retryCount: number) => {
    try {
      chrome.runtime.sendMessage(
        { type: EVIDENCE_BATCH_MESSAGE_TYPE, batch },
        (response) => {
          const lastError = (typeof chrome !== 'undefined' && chrome.runtime?.lastError) || null;
          if (lastError || !response || response.ok === false) {
            // Retry with exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
            if (retryCount < MAX_RETRIES) {
              setTimeout(
                () => attempt(retryCount + 1),
                BASE_RETRY_MS * Math.pow(2, retryCount),
              );
            }
            // If all retries failed, batch stays in buffer for next session
            return;
          }
          // Confirmed delivery — remove from buffer
          removeFromBuffer(batch.id);
        },
      );
    } catch {
      // SW may be dead — retry
      if (retryCount < MAX_RETRIES) {
        setTimeout(
          () => attempt(retryCount + 1),
          BASE_RETRY_MS * Math.pow(2, retryCount),
        );
      }
    }
  };

  attempt(0);
}

/**
 * Flush all pending buffered batches to the service worker.
 * Uses Promise.allSettled so one failure doesn't block others.
 */
export async function flushPendingBatches(): Promise<void> {
  const buffered = peekBuffer();
  if (buffered.length === 0) return;

  if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) return;

  const results = await Promise.allSettled(
    buffered.map(
      (batch) =>
        new Promise<boolean>((resolve) => {
          try {
            chrome.runtime.sendMessage(
              { type: EVIDENCE_BATCH_MESSAGE_TYPE, batch },
              (response) => {
                const lastError = (typeof chrome !== 'undefined' && chrome.runtime?.lastError) || null;
                if (lastError || !response || response.ok === false) {
                  resolve(false);
                } else {
                  resolve(true);
                }
              },
            );
          } catch {
            resolve(false);
          }
        }),
    ),
  );

  // Remove confirmed-delivered batches from buffer
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value === true) {
      removeFromBuffer(buffered[i].id);
    }
  }
}

/**
 * Get the current buffer count (for UI display).
 */
export function getBufferedCount(): number {
  return peekBuffer().length;
}

// ── Page Lifecycle Integration ───────────────────────────────────────────

/**
 * Page lifecycle listeners. Call this once on script load.
 *
 * - pagehide: flush pending batches (don't drain — they survive navigation)
 * - pageshow: if recording was active, signal resume
 */
export function installPageLifecycleHandlers(
  onResume?: () => void,
): void {
  window.addEventListener('pagehide', () => {
    flushPendingBatches();
  });

  window.addEventListener('pageshow', () => {
    if (isRecordingActive()) {
      // First flush any events from the previous page's SW session
      flushPendingBatches();
      // Then signal resume
      onResume?.();
    }
  });
}
