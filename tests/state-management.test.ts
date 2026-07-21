import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { StorageService } from '../src/storage/storage-service';
import { RecordingState } from '../src/shared/types';

/**
 * State management tests — verify the state machine transitions
 * and persistence behavior work correctly.
 *
 * These mirror the side panel's transition logic without DOM dependency.
 */

describe('State Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupChromeMock();
  });

  describe('State transitions', () => {
    it('Ready → Recording transition', async () => {
      await StorageService.setRecordingState(RecordingState.Recording);
      const state = await StorageService.getUIState();
      expect(state.recordingState).toBe(RecordingState.Recording);
    });

    it('Recording → Stopped transition', async () => {
      await StorageService.setRecordingState(RecordingState.Recording);
      await StorageService.setRecordingState(RecordingState.Stopped);
      const state = await StorageService.getUIState();
      expect(state.recordingState).toBe(RecordingState.Stopped);
    });

    it('Stopped → Recording transition (restart recording)', async () => {
      await StorageService.setRecordingState(RecordingState.Stopped);
      await StorageService.setRecordingState(RecordingState.Recording);
      const state = await StorageService.getUIState();
      expect(state.recordingState).toBe(RecordingState.Recording);
    });
  });

  describe('Rapid Start/Stop clicks', () => {
    it('state reflects the last operation after rapid clicks', async () => {
      // Simulate rapid clicking
      await StorageService.setRecordingState(RecordingState.Recording);
      await StorageService.setRecordingState(RecordingState.Stopped);
      await StorageService.setRecordingState(RecordingState.Recording);
      await StorageService.setRecordingState(RecordingState.Stopped);
      const state = await StorageService.getUIState();
      expect(state.recordingState).toBe(RecordingState.Stopped);
    });
  });

  describe('State persistence across reopen', () => {
    it('persisted state survives a simulated reopen', async () => {
      // Simulate: user clicks Start (state = Recording)
      await StorageService.setRecordingState(RecordingState.Recording);

      // Simulate: side panel reopens — new storage mock that reads the same store
      // Since our mock persists in-memory, getUIState reads it
      const state = await StorageService.getUIState();
      expect(state.recordingState).toBe(RecordingState.Recording);
    });

    it('Stopped state is correctly restored on reopen', async () => {
      await StorageService.setRecordingState(RecordingState.Recording);
      await StorageService.setRecordingState(RecordingState.Stopped);

      const state = await StorageService.getUIState();
      expect(state.recordingState).toBe(RecordingState.Stopped);
    });
  });

  describe('Timestamp tracking', () => {
    it('each state change updates the lastChanged timestamp', async () => {
      const before = Date.now();
      const result = await StorageService.setRecordingState(RecordingState.Recording);
      const after = Date.now();

      const ts = new Date(result.lastChanged).getTime();
      expect(ts).toBeGreaterThanOrEqual(before - 1000);
      expect(ts).toBeLessThanOrEqual(after + 1000);
    });
  });

  describe('Reset behavior', () => {
    it('resetUIState returns to Ready', async () => {
      await StorageService.setRecordingState(RecordingState.Recording);
      await StorageService.resetUIState();
      const state = await StorageService.getUIState();
      expect(state.recordingState).toBe(RecordingState.Ready);
    });
  });
});
