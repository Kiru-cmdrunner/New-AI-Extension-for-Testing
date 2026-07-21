import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { sendMessage, onMessage } from '../src/shared/messaging';
import { AppMessage, RecordingState } from '../src/shared/types';

describe('Messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupChromeMock();
  });

  describe('sendMessage', () => {
    it('sends a START_RECORDING message via chrome.runtime.sendMessage', async () => {
      const msg: AppMessage = { type: 'START_RECORDING' };
      await sendMessage(msg);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(msg);
    });

    it('sends a STOP_RECORDING message', async () => {
      const msg: AppMessage = { type: 'STOP_RECORDING' };
      await sendMessage(msg);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(msg);
    });

    it('sends a STATE_UPDATE message with payload', async () => {
      const msg: AppMessage = {
        type: 'STATE_UPDATE',
        payload: { recordingState: RecordingState.Recording, lastChanged: '2026-07-10T00:00:00Z' },
      };
      await sendMessage(msg);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(msg);
    });
  });

  describe('onMessage', () => {
    it('registers a listener on chrome.runtime.onMessage', () => {
      const handler = vi.fn();
      const unsub = onMessage(handler);
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
      unsub();
      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
    });

    it('the wrapped listener calls the handler', () => {
      const handler = vi.fn();
      const { runtime } = setupChromeMock();
      onMessage(handler);

      const listeners = runtime.onMessage._listeners;
      expect(listeners.length).toBe(1);

      const msg: AppMessage = { type: 'OPEN_SETTINGS' };
      listeners[0](msg, { id: 'sender' });

      expect(handler).toHaveBeenCalledWith(msg, { id: 'sender' });
    });

    it('returns an unsubscribe function that removes the listener', () => {
      const { runtime } = setupChromeMock();
      const unsub = onMessage(vi.fn());
      expect(runtime.onMessage._listeners.length).toBe(1);
      unsub();
      expect(runtime.onMessage._listeners.length).toBe(0);
    });
  });
});
