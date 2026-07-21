/**
 * Shared Chrome mock factory for tests.
 * Provides a minimal chrome.storage.local and chrome.runtime mock
 * that the unit tests can use.
 */

export function mockChromeStorage(data: Record<string, unknown> = {}) {
  let store = { ...data };

  const onChangedListeners: Array<(
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: chrome.storage.AreaName,
  ) => void> = [];

  const storage = {
    local: {
      get: vi.fn(async (keys?: string | string[]) => {
        if (keys === undefined) return { ...store };
        const keyArr = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const k of keyArr) {
          if (k in store) result[k] = structuredClone(store[k]);
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        const cloned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(items)) {
          cloned[k] = structuredClone(v);
        }
        store = { ...store, ...cloned };
      }),
    },
    onChanged: {
      addListener: vi.fn((fn: typeof onChangedListeners[0]) => {
        onChangedListeners.push(fn);
      }),
      removeListener: vi.fn((fn: typeof onChangedListeners[0]) => {
        const idx = onChangedListeners.indexOf(fn);
        if (idx >= 0) onChangedListeners.splice(idx, 1);
      }),
      _listeners: onChangedListeners,
    },
    _store: store,
  };

  return storage;
}

export function mockChromeRuntime() {
  const listeners: Array<(msg: unknown, sender: unknown) => boolean | undefined> = [];

  const runtime = {
    onMessage: {
      addListener: vi.fn((fn: typeof listeners[0]) => {
        listeners.push(fn);
      }),
      removeListener: vi.fn((fn: typeof listeners[0]) => {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      }),
      _listeners: listeners,
    },
    sendMessage: vi.fn(async (_msg: unknown) => {}),
    openOptionsPage: vi.fn(async () => {}),
  };

  return runtime;
}

/** Set up global chrome mock for the current test. */
export function setupChromeMock(
  data: Record<string, unknown> = {},
) {
  const storage = mockChromeStorage(data);
  const runtime = mockChromeRuntime();

  globalThis.chrome = {
    storage: storage,
    runtime,
  } as unknown as typeof chrome;

  return { storage, runtime };
}
