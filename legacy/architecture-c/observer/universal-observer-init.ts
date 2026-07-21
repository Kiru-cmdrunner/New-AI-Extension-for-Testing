/**
 * Universal Observer Content Script Entry Point
 *
 * Architecture C Phase 5
 *
 * This script runs on every page. It creates a UniversalInteractionObserver
 * instance, syncs recording state from chrome.storage, and forwards
 * RawEvidence to the service worker via chrome.runtime.sendMessage.
 *
 * When ARCHITECTURE_C_ENABLED is OFF, the observer remains dormant and
 * the legacy content scripts handle all interactions. When ON, the observer
 * captures events and sends RAW_EVIDENCE messages.
 *
 * Both old and new scripts run simultaneously — the service worker decides
 * which pipeline to route through based on the feature flag. Old scripts
 * send CLICK_CAPTURED etc.; the observer sends RAW_EVIDENCE. The SW ignores
 * whichever type is irrelevant for the current flag setting.
 */

import { UniversalInteractionObserver } from './universal-interaction-observer';
import type { RawEvidence } from '../../shared/evidence-types';
import { StorageKeys } from '../../shared/types';

// Singleton observer instance
let observer: UniversalInteractionObserver | null = null;
let isRecording = false;
let archCEnabled = true;

/**
 * Read the feature flag from chrome.storage.local.
 * Returns false when Pipeline V2 is enabled (V2 takes priority).
 */
async function checkArchCFlag(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get([
      StorageKeys.ARCHITECTURE_C_ENABLED,
      StorageKeys.PIPELINE_V2_ENABLED,
    ]);
    // Pipeline V2 takes priority — if V2 is on, Arch C should not capture.
    const v2Enabled = result[StorageKeys.PIPELINE_V2_ENABLED] !== false;
    if (v2Enabled) return false;

    if (StorageKeys.ARCHITECTURE_C_ENABLED in result) {
      return result[StorageKeys.ARCHITECTURE_C_ENABLED] === true;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Read recording state from chrome.storage.local.
 */
async function checkRecordingState(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(StorageKeys.UI_STATE);
    const uiState = result[StorageKeys.UI_STATE];
    return uiState?.recordingState === 'recording';
  } catch {
    return false;
  }
}

/**
 * Update observer state based on current flags.
 */
async function syncState(): Promise<void> {
  isRecording = await checkRecordingState();
  archCEnabled = await checkArchCFlag();

  if (!observer) return;

  // Only capture when BOTH recording is active AND Architecture C is enabled.
  // Otherwise the observer stays dormant and the legacy scripts handle things.
  const shouldRecord = isRecording && archCEnabled;
  observer.setRecording(shouldRecord);
  // Allow untrusted events in test environments; in production the browser
  // sets isTrusted=true for real user events, so this is a no-op.
  observer.setAllowUntrusted(false);
}

/**
 * Initialize the universal observer.
 */
function init(): void {
  if (observer) return;

  observer = new UniversalInteractionObserver();

  // Wire evidence emission → service worker
  observer.onEmit((evidence: RawEvidence) => {
    // Send as RAW_EVIDENCE message
    try {
      chrome.runtime.sendMessage({ type: 'RAW_EVIDENCE', payload: evidence });
    } catch {
      // Extension context may be invalidated on page unload — ignore
    }
  });

  observer.start();

  // Initial state sync
  syncState();
}

// Listen for storage changes (recording start/stop, flag toggle)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  let needsSync = false;

  if (changes[StorageKeys.UI_STATE]) {
    needsSync = true;
  }

  if (changes[StorageKeys.ARCHITECTURE_C_ENABLED]) {
    needsSync = true;
  }

  if (needsSync) {
    syncState();
  }
});

// Initialize on script load
init();
