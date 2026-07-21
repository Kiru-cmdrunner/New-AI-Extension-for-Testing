/**
 * Connection Tester — tests connectivity to an AI provider.
 *
 * Delegates to the provider's own testConnection() method, which
 * validates credentials as cheaply as possible (list models, minimal
 * prompt, etc.). Falls back to sendPrompt for providers that don't
 * override testConnection.
 */
import { ProviderManager } from './provider-manager';
import { ProviderConfig } from './providers/types';

/** The test prompt sent as a fallback when a provider doesn't override testConnection. */
export const TEST_PROMPT = 'Reply with: Connection Successful';

export interface ConnectionTestResult {
  status: 'connected' | 'failed';
  message: string;
  response?: string;
  timestamp: string;
}

/**
 * Test the connection to an AI provider.
 *
 * @param providerId  The provider to test (e.g. 'gemini', 'openai')
 * @param config      Provider configuration (API key, model, optional base URL)
 * @returns           Connection test result
 */
export async function testConnection(
  providerId: string,
  config: ProviderConfig,
): Promise<ConnectionTestResult> {
  const timestamp = new Date().toISOString();

  // Validate API key
  if (!config.apiKey || config.apiKey.trim() === '') {
    return {
      status: 'failed',
      message: 'API key is required.',
      timestamp,
    };
  }

  // Get the provider
  const provider = ProviderManager.get(providerId);
  if (!provider) {
    return {
      status: 'failed',
      message: `Unknown provider: ${providerId}`,
      timestamp,
    };
  }

  // Check if the provider is implemented
  if (!provider.implemented) {
    return {
      status: 'failed',
      message: `${provider.name} is not yet available.`,
      timestamp,
    };
  }

  // Delegate to the provider's testConnection()
  try {
    const outcome = await provider.testConnection(config);

    if (outcome.success) {
      return {
        status: 'connected',
        message: outcome.message,
        response: outcome.response,
        timestamp,
      };
    }

    return {
      status: 'failed',
      message: outcome.message,
      timestamp,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'failed',
      message: `Error during connection test: ${message}`,
      timestamp,
    };
  }
}
