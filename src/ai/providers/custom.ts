/**
 * Custom OpenAI-compatible Provider — full implementation.
 *
 * For self-hosted models (vLLM, LM Studio, Ollama, etc.) or any
 * API that follows the OpenAI Chat Completions schema.
 *
 * The user supplies their own Base URL and model name.
 * Defaults to standard OpenAI-compatible endpoints:
 *   POST {baseUrl}/v1/chat/completions
 *   GET  {baseUrl}/v1/models
 */
import {
  AIProvider,
  ModelInfo,
  ProviderConfig,
  ProviderResult,
  ProviderCapabilities,
  ConnectionTestOutcome,
} from './types';

const CUSTOM_MODELS: ModelInfo[] = [
  { id: 'custom-model', label: 'Custom Model' },
];

// Custom providers are unknown — expose all capabilities as true
// so the extension never artificially blocks features.
const CUSTOM_CAPABILITIES: ProviderCapabilities = {
  supportsVision: true,
  supportsFunctionCalling: true,
  supportsStreaming: true,
  supportsReasoning: true,
};

export class CustomProvider implements AIProvider {
  readonly id = 'custom';
  readonly name = 'Custom (OpenAI-compatible)';
  readonly implemented = true;
  readonly models = CUSTOM_MODELS;
  readonly defaultModel = 'custom-model';
  readonly capabilities = CUSTOM_CAPABILITIES;

  async sendPrompt(config: ProviderConfig, prompt: string): Promise<ProviderResult> {
    if (!config.baseUrl) {
      return {
        success: false,
        error: 'Custom provider requires a Base URL (e.g. http://localhost:11434/v1).',
      };
    }

    const model = config.model || this.defaultModel;
    const url = `${config.baseUrl}/chat/completions`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 256,
        }),
      });

      if (!response.ok) {
        return this.parseError(response);
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content ?? '';

      if (!text) {
        return { success: false, error: 'Empty response from custom endpoint' };
      }

      return { success: true, response: text.trim() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Network error: ${message}` };
    }
  }

  async testConnection(config: ProviderConfig): Promise<ConnectionTestOutcome> {
    if (!config.apiKey || config.apiKey.trim() === '') {
      return { success: false, message: 'API key is required.' };
    }

    if (!config.baseUrl) {
      return {
        success: false,
        message: 'Custom provider requires a Base URL (e.g. http://localhost:11434/v1).',
      };
    }

    try {
      // Try GET {baseUrl}/models (OpenAI-compatible list models)
      const response = await fetch(`${config.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });

      if (!response.ok) {
        const outcome = await this.parseError(response);
        return { success: false, message: outcome.error ?? `HTTP ${response.status}` };
      }

      const data = await response.json();
      const modelCount = Array.isArray(data?.data)
        ? data.data.length
        : Array.isArray(data?.models)
          ? data.models.length
          : 0;

      return {
        success: true,
        message: `Connection successful! ${modelCount} models available.`,
        response: `${modelCount} models`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Network error: ${message}` };
    }
  }

  /** Shared error parser for OpenAI-compatible error responses. */
  private async parseError(response: Response): Promise<ProviderResult> {
    const errorBody = await response.text();
    let errorMsg = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed?.error?.message) {
        errorMsg = parsed.error.message;
      }
    } catch {
      if (errorBody) errorMsg += `: ${errorBody.substring(0, 200)}`;
    }
    return { success: false, error: errorMsg };
  }
}
