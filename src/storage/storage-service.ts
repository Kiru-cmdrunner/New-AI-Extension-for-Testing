/**
 * Storage Service — the single entry point for chrome.storage.local.
 * All other modules use this service; direct chrome.storage calls are avoided.
 */
import { RecordingState, StorageKeys, UIState, DEFAULT_UI_STATE, SessionEvent, RecordingContext, AIConfig, DEFAULT_AI_CONFIG, TestStep, AIProviderId, ProviderSettings, defaultProviderSettings, TestRepository, TestCaseDraft } from '../shared/types';

export class StorageService {
  // ── UI State ────────────────────────────────────────────

  /**
   * Read the current persisted UI state.
   * Falls back to DEFAULT_UI_STATE when nothing is stored or the stored
   * value is malformed.
   */
  static async getUIState(): Promise<UIState> {
    const result = await chrome.storage.local.get(StorageKeys.UI_STATE);
    const stored = result[StorageKeys.UI_STATE];
    if (
      stored &&
      typeof stored === 'object' &&
      'recordingState' in stored &&
      Object.values(RecordingState).includes(
        (stored as UIState).recordingState,
      )
    ) {
      return stored as UIState;
    }
    return { ...DEFAULT_UI_STATE };
  }

  /**
   * Persist the full UI state object.
   */
  static async setUIState(state: UIState): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.UI_STATE]: state });
  }

  /**
   * Update only the recording state and stamp the timestamp.
   */
  static async setRecordingState(state: RecordingState): Promise<UIState> {
    const newState: UIState = {
      recordingState: state,
      lastChanged: new Date().toISOString(),
    };
    await chrome.storage.local.set({ [StorageKeys.UI_STATE]: newState });
    return newState;
  }

  /**
   * Reset to the default UI state (Ready).
   */
  static async resetUIState(): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.UI_STATE]: { ...DEFAULT_UI_STATE } });
  }

  // ── Session Events ──────────────────────────────────────

  /**
   * Read all captured events from the current recording session.
   * Returns an empty array when nothing is stored.
   */
  static async getEvents(): Promise<SessionEvent[]> {
    const result = await chrome.storage.local.get(StorageKeys.SESSION_EVENTS);
    const stored = result[StorageKeys.SESSION_EVENTS];
    if (Array.isArray(stored)) {
      return stored as SessionEvent[];
    }
    return [];
  }

  /**
   * Persist the full events array (replaces existing).
   */
  static async setEvents(events: SessionEvent[]): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.SESSION_EVENTS]: events });
  }

  /**
   * Clear all stored session events.
   */
  static async clearEvents(): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.SESSION_EVENTS]: [] });
  }

  // ── Recording Context ──────────────────────────────────

  /**
   * Read the recording context (starting URL/title) for the current session.
   * Returns null when no context has been stored.
   */
  static async getRecordingContext(): Promise<RecordingContext | null> {
    const result = await chrome.storage.local.get(StorageKeys.SESSION_CONTEXT);
    const stored = result[StorageKeys.SESSION_CONTEXT];
    if (stored && typeof stored === 'object' && 'startUrl' in stored) {
      return stored as RecordingContext;
    }
    return null;
  }

  /**
   * Persist the recording context for the current session.
   */
  static async setRecordingContext(ctx: RecordingContext): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.SESSION_CONTEXT]: ctx });
  }

  /**
   * Clear the stored recording context.
   */
  static async clearRecordingContext(): Promise<void> {
    await chrome.storage.local.remove(StorageKeys.SESSION_CONTEXT);
  }

  // ── Session Steps ──────────────────────────────────────

  /**
   * Read all generated test steps from the current recording session.
   * Returns an empty array when nothing is stored.
   */
  static async getSteps(): Promise<TestStep[]> {
    const result = await chrome.storage.local.get(StorageKeys.STEPS);
    const stored = result[StorageKeys.STEPS];
    if (Array.isArray(stored)) {
      return stored as TestStep[];
    }
    return [];
  }

  /**
   * Persist the full steps array (replaces existing).
   */
  static async setSteps(steps: TestStep[]): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.STEPS]: steps });
  }

  /**
   * Clear all stored test steps.
   */
  static async clearSteps(): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.STEPS]: [] });
  }

  // ── Test Case Draft ─────────────────────────────────────

  /**
   * Read the active Test Case draft (created before recording).
   * Returns null when no draft exists.
   */
  static async getTestCaseDraft(): Promise<TestCaseDraft | null> {
    const result = await chrome.storage.local.get(StorageKeys.TEST_CASE_DRAFT);
    const stored = result[StorageKeys.TEST_CASE_DRAFT];
    if (stored && typeof stored === 'object' && 'name' in stored && 'projectId' in stored) {
      return stored as TestCaseDraft;
    }
    return null;
  }

  /**
   * Persist the Test Case draft.
   */
  static async setTestCaseDraft(draft: TestCaseDraft): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.TEST_CASE_DRAFT]: draft });
  }

  /**
   * Clear the Test Case draft.
   */
  static async clearTestCaseDraft(): Promise<void> {
    await chrome.storage.local.remove(StorageKeys.TEST_CASE_DRAFT);
  }

  // ── Storage change listener ─────────────────────────────

  /**
   * Register a listener for changes to a specific storage key.
   * Returns an unsubscribe function.
   */
  static onKeyChanged(
    key: StorageKeys,
    callback: (newValue: unknown) => void,
  ): () => void {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: chrome.storage.AreaName,
    ) => {
      if (areaName !== 'local') return;
      if (key in changes) {
        callback(changes[key].newValue);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  // ── AI Configuration ────────────────────────────────────

  /**
   * Read the saved AI configuration.
   * Falls back to DEFAULT_AI_CONFIG when nothing is stored.
   * Migrates legacy configs (single-key format) automatically.
   */
  static async getAIConfig(): Promise<AIConfig> {
    const result = await chrome.storage.local.get(StorageKeys.AI_CONFIG);
    const stored = result[StorageKeys.AI_CONFIG];

    if (stored && typeof stored === 'object') {
      // New format: has activeProvider + providers map
      if ('activeProvider' in stored && 'providers' in stored) {
        return { ...DEFAULT_AI_CONFIG, ...(stored as AIConfig) };
      }
      // Legacy format: has provider + model at top level
      if ('provider' in stored) {
        const legacy = stored as { provider: AIProviderId; model: string; baseUrl?: string; connectionStatus?: unknown };
        // Try to migrate the old single API key
        const keyResult = await chrome.storage.local.get('ai_api_key');
        const oldKey = (keyResult['ai_api_key'] as string) ?? '';
        const settings: ProviderSettings = {
          apiKey: oldKey,
          model: legacy.model,
          baseUrl: legacy.baseUrl,
          connectionStatus: 'not_connected',
        };
        return {
          activeProvider: legacy.provider,
          providers: { [legacy.provider]: settings },
        };
      }
    }
    return { ...DEFAULT_AI_CONFIG };
  }

  /**
   * Persist the full AI configuration.
   */
  static async setAIConfig(config: AIConfig): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.AI_CONFIG]: config });
  }

  // ── Per-Provider Settings ───────────────────────────────

  /**
   * Get settings for a specific provider. Returns a default entry
   * if the provider has no stored settings yet.
   */
  static async getProviderSettings(
    providerId: AIProviderId,
    fallbackModel: string,
  ): Promise<ProviderSettings> {
    const config = await this.getAIConfig();
    const existing = config.providers[providerId];
    if (existing) return existing;
    return defaultProviderSettings(fallbackModel);
  }

  /**
   * Save settings for a specific provider (merges into existing config).
   */
  static async setProviderSettings(
    providerId: AIProviderId,
    settings: ProviderSettings,
  ): Promise<void> {
    const config = await this.getAIConfig();
    config.providers[providerId] = settings;
    await this.setAIConfig(config);
  }

  /**
   * Set the active provider (the one the extension uses).
   */
  static async setActiveProvider(providerId: AIProviderId): Promise<void> {
    const config = await this.getAIConfig();
    config.activeProvider = providerId;
    await this.setAIConfig(config);
  }

  /**
   * Get the active provider ID.
   */
  static async getActiveProvider(): Promise<AIProviderId> {
    const config = await this.getAIConfig();
    return config.activeProvider;
  }

  // ── Test Repository ─────────────────────────────────────

  /** Get the full test repository. */
  static async getRepository(): Promise<TestRepository> {
    const result = await chrome.storage.local.get(StorageKeys.REPOSITORY);
    const stored = result[StorageKeys.REPOSITORY];
    if (stored && typeof stored === 'object' && Array.isArray(stored.projects)) {
      return structuredClone(stored as TestRepository);
    }
    return { projects: [] };
  }

  /** Persist the test repository. */
  static async setRepository(repo: TestRepository): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.REPOSITORY]: repo });
  }

  // ── Generic Raw Access ──────────────────────────────────

  /**
   * Persist any value under a storage key.
   * Used for keys that don't have a dedicated typed method (e.g. EXECUTION_IR_PLAN).
   */
  static async setRaw(key: StorageKeys, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  /**
   * Read a raw value by storage key.
   */
  static async getRaw(key: StorageKeys): Promise<unknown> {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }
}
