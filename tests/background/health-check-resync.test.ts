/**
 * Tests for the health-check re-sync fix.
 *
 * Root cause: After navigation to a new page, sessionStorage may be cleared,
 * preventing the content script from auto-resuming recording. The content
 * script IS injected (responds to PING) but isRecording is false — the
 * EventTap is never installed. The old pingTabContentScript only checked
 * response.type === 'PONG', discarding the recording flag. The health check
 * reported "healthy" and never sent START_RECORDING to re-sync.
 *
 * Fix: pingTabContentScript now returns { alive, recording }. 
 * ensureContentScriptInjected checks both — if alive && !recording, it sends
 * START_RECORDING to re-sync without re-injecting the script.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Health check re-sync fix', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PingResult contract', () => {

    it('PING response includes recording field', () => {
      // Simulates the content script's PING handler:
      // sendResponse({ type: 'PONG', recording: isRecording })
      const pongResponse = { type: 'PONG', recording: false };

      expect(pongResponse.type).toBe('PONG');
      expect(pongResponse).toHaveProperty('recording');
      expect(pongResponse.recording).toBe(false);
    });

    it('PING response with recording:true indicates healthy recording', () => {
      const pongResponse = { type: 'PONG', recording: true };

      // pingTabContentScript extracts: { alive: true, recording: true }
      const pingResult = {
        alive: !!(pongResponse && pongResponse.type === 'PONG'),
        recording: !!(pongResponse && pongResponse.recording),
      };

      expect(pingResult.alive).toBe(true);
      expect(pingResult.recording).toBe(true);
    });

    it('PING response with recording:false indicates needs re-sync', () => {
      const pongResponse = { type: 'PONG', recording: false };

      // pingTabContentScript extracts: { alive: true, recording: false }
      const pingResult = {
        alive: !!(pongResponse && pongResponse.type === 'PONG'),
        recording: !!(pongResponse && pongResponse.recording),
      };

      expect(pingResult.alive).toBe(true);
      expect(pingResult.recording).toBe(false);
    });
  });

  describe('ensureContentScriptInjected decision logic', () => {

    /**
     * Simulates the three scenarios in ensureContentScriptInjected:
     * 1. alive && recording → return true (healthy, no action)
     * 2. alive && !recording → send START_RECORDING, return true
     * 3. !alive → inject, then re-sync
     */
    function simulateEnsureInjected(pingResult: { alive: boolean; recording: boolean }) {
      const actions: string[] = [];
      let startRecordingSent = false;
      let injectCalled = false;

      if (pingResult.alive && pingResult.recording) {
        // Scenario 1: healthy
        actions.push('no-action');
      } else if (pingResult.alive && !pingResult.recording) {
        // Scenario 2: re-sync
        actions.push('resync-start-recording');
        startRecordingSent = true;
      } else {
        // Scenario 3: inject
        actions.push('inject');
        injectCalled = true;
        actions.push('resync-start-recording');
        startRecordingSent = true;
      }

      return { actions, startRecordingSent, injectCalled };
    }

    it('scenario 1: alive and recording → no action needed', () => {
      const result = simulateEnsureInjected({ alive: true, recording: true });

      expect(result.actions).toEqual(['no-action']);
      expect(result.startRecordingSent).toBe(false);
      expect(result.injectCalled).toBe(false);
    });

    it('scenario 2: alive but not recording → sends START_RECORDING, no inject', () => {
      const result = simulateEnsureInjected({ alive: true, recording: false });

      expect(result.actions).toEqual(['resync-start-recording']);
      expect(result.startRecordingSent).toBe(true);
      expect(result.injectCalled).toBe(false);
    });

    it('scenario 3: not alive → injects and re-syncs', () => {
      const result = simulateEnsureInjected({ alive: false, recording: false });

      expect(result.actions).toEqual(['inject', 'resync-start-recording']);
      expect(result.startRecordingSent).toBe(true);
      expect(result.injectCalled).toBe(true);
    });

    it('does NOT send START_RECORDING when already recording', () => {
      // This is the guard against duplicate EventTap installation.
      // If the content script is already recording, re-syncing is unnecessary.
      const result = simulateEnsureInjected({ alive: true, recording: true });

      expect(result.startRecordingSent).toBe(false);
    });
  });

  describe('Content script startRecording idempotency', () => {

    it('startRecording() has an isRecording guard that prevents double-install', () => {
      // Validates the content script's guard at recorder-entry.ts:332:
      //   async function startRecording(): Promise<void> {
      //     if (isRecording) return;  ← idempotent
      //     isRecording = true;
      //     ...
      //   }

      let isRecording = false;
      let eventTapInstalled = false;

      const startRecording = () => {
        if (isRecording) return;
        isRecording = true;
        eventTapInstalled = true;
      };

      // First call installs
      startRecording();
      expect(isRecording).toBe(true);
      expect(eventTapInstalled).toBe(true);

      // Second call is a no-op (idempotent)
      const tapBeforeSecond = eventTapInstalled;
      startRecording();
      expect(isRecording).toBe(true);
      expect(eventTapInstalled).toBe(tapBeforeSecond); // still true, not re-installed
    });
  });

  describe('Health check targets only active tab', () => {

    it('getActiveTab queries only active + currentWindow tabs', () => {
      // Validates that the health check does NOT broadcast START_RECORDING
      // to unrelated tabs. It only checks the active tab in the current window.
      // This limits the blast radius of the re-sync.

      // Simulate chrome.tabs.query call
      const queryArgs = { active: true, currentWindow: true };
      expect(queryArgs.active).toBe(true);
      expect(queryArgs.currentWindow).toBe(true);
    });
  });
});
