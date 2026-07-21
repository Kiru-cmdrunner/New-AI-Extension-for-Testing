/**
 * AI Domain Types — provider configuration and connection state.
 *
 * Previously in shared/types.ts. Extracted for domain cohesion.
 * Re-exported through shared/types.ts for backward compatibility.
 */

/** Supported AI provider IDs. */
export type AIProviderId =
  | 'gemini'
  | 'openai'
  | 'claude'
  | 'openrouter'
  | 'azure-openai'
  | 'custom';

/**
 * Per-provider configuration — each provider stores its own API key,
 * model, and optional base URL independently.
 */
export interface ProviderSettings {
  /** API key for this provider. */
  apiKey: string;
  /** Selected model ID for this provider. */
  model: string;
  /** Custom base URL (if applicable). */
  baseUrl?: string;
  /** Connection status from last test for this provider. */
  connectionStatus: ConnectionStatus;
  /** Timestamp of last connection test. */
  lastTestedAt?: string;
}

/** Connection test states. */
export type ConnectionStatus =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'failed';

/**
 * Persisted AI configuration.
 *
 * Stores per-provider settings so the user can configure multiple
 * providers and switch between them without re-entering credentials.
 * `activeProvider` determines which provider the extension uses.
 */
export interface AIConfig {
  /** The currently selected provider. */
  activeProvider: AIProviderId;
  /** Per-provider configurations keyed by provider ID. */
  providers: Partial<Record<AIProviderId, ProviderSettings>>;
}

/** Default settings for a newly-initialised provider entry. */
export function defaultProviderSettings(model: string): ProviderSettings {
  return {
    apiKey: '',
    model,
    connectionStatus: 'not_connected',
  };
}

/** Default AI configuration. */
export const DEFAULT_AI_CONFIG: AIConfig = {
  activeProvider: 'gemini',
  providers: {
    gemini: defaultProviderSettings('gemini-2.5-flash'),
  },
};
