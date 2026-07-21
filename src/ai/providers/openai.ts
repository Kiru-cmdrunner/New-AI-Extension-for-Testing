/**
 * OpenAI Provider — full implementation via the Chat Completions API.
 *
 * POST https://api.openai.com/v1/chat/completions
 * Docs: https://platform.openai.com/docs/api-reference/chat
 */
import {
  AIProvider,
  ModelInfo,
  ProviderConfig,
  ProviderResult,
  ProviderCapabilities,
  ConnectionTestOutcome,
} from './types';

const OPENAI_BASE_URL = 'https://api.openai.com';

const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { id: 'o3-mini', label: 'o3-mini' },
];

const OPENAI_CAPABILITIES: ProviderCapabilities = {
  supportsVision: true,
  supportsFunctionCalling: true,
  supportsStreaming: true,
  supportsReasoning: true,
};

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';
  readonly implemented = true;
  readonly models = OPENAI_MODELS;
  readonly defaultModel = 'gpt-4o';
  readonly capabilities = OPENAI_CAPABILITIES;

  async sendPrompt(config: ProviderConfig, prompt: string): Promise<ProviderResult> {
    const model = config.model || this.defaultModel;
    const baseUrl = config.baseUrl || OPENAI_BASE_URL;
    const url = `${baseUrl}/v1/chat/completions`;

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
        return { success: false, error: 'Empty response from OpenAI' };
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

    const baseUrl = config.baseUrl || OPENAI_BASE_URL;

    try {
      // GET /v1/models validates the key without consuming tokens
      const response = await fetch(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });

      if (!response.ok) {
        const outcome = await this.parseError(response);
        return { success: false, message: outcome.error ?? `HTTP ${response.status}` };
      }

      const data = await response.json();
      const modelCount = Array.isArray(data?.data) ? data.data.length : 0;

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

  /** Shared error parser for OpenAI-style error responses. */
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
