/**
 * V2 Event Observer Initializer — Content Script Entry Point
 *
 * This content script starts the V2 Event Observer on every page.
 * The observer captures DOM events and sends PIPELINE_EVENT messages
 * to the service worker.
 *
 * FEATURE FLAG: The observer checks PIPELINE_V2_ENABLED in chrome.storage.local
 * before starting. If the flag is false (default), it does nothing — the
 * legacy or Architecture C pipeline handles recording.
 *
 * MV3 SAFE: Content scripts are injected at document_start and persist for
 * the page's lifetime. The observer uses event delegation (capture phase
 * listeners on document) for efficiency.
 */

import { V2EventObserver } from './v2-event-observer';
import { StorageKeys } from '../../shared/types';

let observer: V2EventObserver | null = null;
let isRecording = false;
let v2Enabled = false;

/**
 * Check if Pipeline V2 is enabled and recording is active.
 */
async function checkStatus(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([
      StorageKeys.PIPELINE_V2_ENABLED,
      StorageKeys.UI_STATE,
    ]);

    const wasEnabled = v2Enabled;
    // Default: Pipeline V2 is active (v8.0.0+). If the key has been
    // explicitly set, respect it; otherwise default to true.
    if (StorageKeys.PIPELINE_V2_ENABLED in result) {
      v2Enabled = result[StorageKeys.PIPELINE_V2_ENABLED] === true;
    } else {
      v2Enabled = true;
    }

    // Check recording state
    const uiState = result[StorageKeys.UI_STATE];
    const nowRecording = uiState?.recordingState === 'recording';

    if (v2Enabled && nowRecording && !isRecording) {
      // Start observing
      console.log('[CmdRunner V2 Observer] checkStatus: starting observer (v2Enabled=true, recording=true)');
      startObserver();
    } else if ((!v2Enabled || !nowRecording) && isRecording) {
      // Stop observing
      console.log('[CmdRunner V2 Observer] checkStatus: stopping observer');
      stopObserver();
    }

    isRecording = nowRecording;
  } catch {
    // Storage may not be available — stay inactive
  }
}

function startObserver(): void {
  if (observer) return;
  observer = new V2EventObserver();
  observer.onEvent((event) => {
    // Send to service worker
    try {
      chrome.runtime.sendMessage({
        type: 'PIPELINE_EVENT',
        payload: event,
      });
    } catch {
      // Service worker may be restarting — message will be retried on next event
      console.warn('[CmdRunner V2 Observer] Failed to send PIPELINE_EVENT — service worker may be restarting');
    }
  });
  observer.start();
  console.log('[CmdRunner V2 Observer] Started observing on', window.location.href);
}

function stopObserver(): void {
  if (observer) {
    observer.stop();
    observer = null;
  }
}

// Listen for storage changes (feature flag toggled, recording started/stopped)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (
    StorageKeys.PIPELINE_V2_ENABLED in changes ||
    StorageKeys.UI_STATE in changes
  ) {
    checkStatus();
  }
});

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'START_RECORDING' || message.type === 'STOP_RECORDING') {
    checkStatus();
  }
});

// Check on script load
checkStatus();

// Re-check periodically (covers edge cases where storage change events are missed)
setInterval(checkStatus, 2000);
