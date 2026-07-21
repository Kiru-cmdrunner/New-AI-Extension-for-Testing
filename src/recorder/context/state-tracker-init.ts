/**
 * State Tracker Content Script Entry Point
 *
 * Architecture C Phase 5
 *
 * This script runs on every page (document_idle — after DOM is ready).
 * It creates a StateTracker instance, syncs recording state, and forwards
 * DeterministicState updates to the service worker.
 *
 * When ARCHITECTURE_C_ENABLED is OFF, the tracker stays dormant.
 * When ON, it observes DOM mutations and sends DETERMINISTIC_STATE messages.
 */

import {
  StateTracker,
  computeDeterministicState,
} from './state-tracker';
import type { DeterministicState } from '../../shared/architecture-types';
import { StorageKeys } from '../../shared/types';

// Singleton tracker instance
let tracker: StateTracker | null = null;
let isRecording = false;
let archCEnabled = true;

/**
 * Read the feature flag from chrome.storage.local.
 */
async function checkArchCFlag(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(StorageKeys.ARCHITECTURE_C_ENABLED);
    if (StorageKeys.ARCHITECTURE_C_ENABLED in result) {
      return result[StorageKeys.ARCHITECTURE_C_ENABLED] === true;
    }
    return true;
  } catch {
    return true;
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
 * Update tracker state based on current flags.
 */
async function syncState(): Promise<void> {
  isRecording = await checkRecordingState();
  archCEnabled = await checkArchCFlag();

  const shouldTrack = isRecording && archCEnabled;

  if (shouldTrack && !tracker) {
    // Start tracking
    tracker = new StateTracker();
    tracker.onEmit((state: DeterministicState) => {
      try {
        chrome.runtime.sendMessage({ type: 'DETERMINISTIC_STATE', payload: state });
      } catch {
        // Extension context may be invalidated — ignore
      }
    });
    tracker.start();
  } else if (!shouldTrack && tracker) {
    // Stop tracking
    tracker.stop();
    tracker = null;
  }
}

// Listen for storage changes
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

// SPA navigation: listen for popstate events (history.pushState/replaceState
// don't fire native events, but popstate covers back/forward navigation).
// The webNavigation API is NOT available in content scripts — only in the
// service worker. The SW already handles webNavigation.onCommitted and
// routes through the pipeline, which triggers state recomputation via the
// DETERMINISTIC_STATE message cycle.
window.addEventListener('popstate', () => {
  if (tracker && isRecording) {
    const state = computeDeterministicState(document);
    try {
      chrome.runtime.sendMessage({ type: 'DETERMINISTIC_STATE', payload: state });
    } catch {
      // ignore
    }
  }
});

// Initial state sync
syncState();
