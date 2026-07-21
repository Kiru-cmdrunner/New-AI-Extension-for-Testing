/**
 * AI Provider abstraction layer.
 *
 * Every provider implements this interface. New providers can be added
 * without modifying existing code — just implement the interface and
 * register it in provider-manager.ts.
 */

/** Information about a specific AI model. */
export interface ModelInfo {
  id: string;
  label: string;
}

/** Result of a connection test or AI call. */
export interface ProviderResult {
  success: boolean;
  response?: string;
  error?: string;
}

/** Configuration passed to a provider for making API calls. */
export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/**
 * Provider Capabilities — describes what a provider supports.
 *
 * The rest of the extension asks capability questions (e.g.
 * `supportsVision`) rather than checking provider IDs. This makes
 * the architecture scalable — new providers declare their capabilities
 * and consumers never need if/else on provider names.
 */
export interface ProviderCapabilities {
  /** Can the provider accept image inputs alongside text? */
  supportsVision: boolean;
  /** Does the provider support function/tool calling? */
  supportsFunctionCalling: boolean;
  /** Does the provider support streaming responses? */
  supportsStreaming: boolean;
  /** Does the provider offer reasoning/thinking models? */
  supportsReasoning: boolean;
}

/** Default capabilities (all false) for safety. */
export const NO_CAPABILITIES: ProviderCapabilities = {
  supportsVision: false,
  supportsFunctionCalling: false,
  supportsStreaming: false,
  supportsReasoning: false,
};

/** Result of a dedicated connection test. */
export interface ConnectionTestOutcome {
  success: boolean;
  message: string;
  response?: string;
}

/**
 * The interface every AI provider must implement.
 *
 * `sendPrompt` is the primary AI call.
 * `testConnection` is a lightweight connectivity check that should
 * validate credentials without consuming significant tokens.
 */
export interface AIProvider {
  /** Unique provider ID. */
  readonly id: string;

  /** Human-readable name. */
  readonly name: string;

  /** Whether this provider is implemented or a placeholder. */
  readonly implemented: boolean;

  /** Available models for this provider. */
  readonly models: ModelInfo[];

  /** Default model ID. */
  readonly defaultModel: string;

  /** Feature capabilities of this provider. */
  readonly capabilities: ProviderCapabilities;

  /**
   * Send a prompt to the AI and get a text response.
   */
  sendPrompt(config: ProviderConfig, prompt: string): Promise<ProviderResult>;

  /**
   * Test the connection to the provider with the given config.
   *
   * Should validate credentials as cheaply as possible — e.g. list
   * models or send a minimal prompt. Must NOT throw; always return
   * a ConnectionTestOutcome.
   *
   * Default implementation (if not overridden): sends TEST_PROMPT
   * via sendPrompt and checks for a non-empty response.
   */
  testConnection(config: ProviderConfig): Promise<ConnectionTestOutcome>;
}
