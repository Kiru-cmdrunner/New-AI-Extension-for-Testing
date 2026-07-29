import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { StorageService } from '../src/storage/storage-service';
import { RecordingState, StorageKeys, DEFAULT_UI_STATE } from '../src/shared/types';

describe('StorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUIState', () => {
    it('returns default state when nothing is stored', async () => {
      setupChromeMock({});
      const state = await StorageService.getUIState();
      expect(state.recordingState).toBe(DEFAULT_UI_STATE.recordingState);
      expect(state.recordingState).toBe(RecordingState.Ready);
    });

    it('returns stored state when present', async () => {
      const stored = {
        recordingState: RecordingState.Recording,
        lastChanged: '2026-07-10T10:00:00.000Z',
      };
      setupChromeMock({ [StorageKeys.UI_STATE]: stored });
      const state = await StorageService.getUIState();
      expect(state.recordingState).toBe(RecordingState.Recording);
      expect(state.lastChanged).toBe('2026-07-10T10:00:00.000Z');
    });

    it('returns default when stored value is malformed', async () => {
      setupChromeMock({ [StorageKeys.UI_STATE]: { bad: 'data' } });
      const state = await StorageService.getUIState();
      expect(state.recordingState).toBe(RecordingState.Ready);
    });
  });

  describe('setUIState', () => {
    it('persists the full UI state object', async () => {
      const { storage } = setupChromeMock({});
      const newState = {
        recordingState: RecordingState.Stopped,
        lastChanged: '2026-07-10T11:00:00.000Z',
      };
      await StorageService.setUIState(newState);
      expect(storage.local.set).toHaveBeenCalledWith({
        [StorageKeys.UI_STATE]: newState,
      });
    });
  });

  describe('setRecordingState', () => {
    it('persists only the recording state and stamps timestamp', async () => {
      const { storage } = setupChromeMock({});
      const result = await StorageService.setRecordingState(RecordingState.Recording);
      expect(result.recordingState).toBe(RecordingState.Recording);
      expect(result.lastChanged).toBeDefined();
      // Validate ISO format
      expect(new Date(result.lastChanged).getTime()).not.toBeNaN();
      expect(storage.local.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetUIState', () => {
    it('resets to default state', async () => {
      const { storage } = setupChromeMock({
        [StorageKeys.UI_STATE]: { recordingState: RecordingState.Recording, lastChanged: 'x' },
      });
      await StorageService.resetUIState();
      expect(storage.local.set).toHaveBeenCalledWith({
        [StorageKeys.UI_STATE]: {
          recordingState: RecordingState.Ready,
          lastChanged: DEFAULT_UI_STATE.lastChanged,
          recorderEngine: 'legacy',
        },
      });
    });
  });
});
