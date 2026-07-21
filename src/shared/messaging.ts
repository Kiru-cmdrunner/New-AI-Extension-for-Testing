/**
 * Typed messaging helpers for communication between extension contexts.
 */

import { AppMessage } from './types';

/** Send a typed message to the background service worker. */
export function sendMessage(message: AppMessage): Promise<void> {
  return chrome.runtime.sendMessage(message);
}

/** Register a typed message listener. Returns an unsubscribe function. */
export function onMessage(
  handler: (message: AppMessage, sender: chrome.runtime.MessageSender) => void,
): () => void {
  const listener = (msg: unknown, sender: chrome.runtime.MessageSender): boolean => {
    handler(msg as AppMessage, sender);
    return false; // synchronous — no async response
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
