/**
 * OpenRouter Provider — full implementation.
 *
 * OpenRouter is OpenAI-compatible with additional provider routing.
 * POST https://openrouter.ai/api/v1/chat/completions
 * Docs: https://openrouter.ai/docs
 *
 * Auth: Bearer token. Optional HTTP-referer and X-Title headers
 * for app ranking display.
 */
import {
  AIProvider,
  ModelInfo,
  ProviderConfig,
  ProviderResult,
  ProviderCapabilities,
  ConnectionTestOutcome,
} from './types';

const OPENROUTER_BASE_URL = 'https://openrouter.ai';

const OPENROUTER_MODELS: ModelInfo[] = [
  { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o' },
  { id: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o mini' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
];

const OPENROUTER_CAPABILITIES: ProviderCapabilities = {
  supportsVision: true,
  supportsFunctionCalling: true,
  supportsStreaming: true,
  supportsReasoning: true,
};

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter';
  readonly implemented = true;
  readonly models = OPENROUTER_MODELS;
  readonly defaultModel = 'openai/gpt-4o-mini';
  readonly capabilities = OPENROUTER_CAPABILITIES;

  async sendPrompt(config: ProviderConfig, prompt: string): Promise<ProviderResult> {
    const model = config.model || this.defaultModel;
    const baseUrl = config.baseUrl || OPENROUTER_BASE_URL;
    const url = `${baseUrl}/api/v1/chat/completions`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          'HTTP-Referer': 'https://cmdrunner.dev',
          'X-Title': 'CmdRunner Smart Recorder',
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
        return { success: false, error: 'Empty response from OpenRouter' };
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

    const baseUrl = config.baseUrl || OPENROUTER_BASE_URL;

    try {
      // GET /api/v1/key/info validates the key and returns limits/usage
      const response = await fetch(`${baseUrl}/api/v1/key/info`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });

      if (!response.ok) {
        const outcome = await this.parseError(response);
        return { success: false, message: outcome.error ?? `HTTP ${response.status}` };
      }

      const data = await response.json();
      const limit = data?.data?.limit ?? 'unknown';
      const usage = data?.data?.usage ?? 'unknown';

      return {
        success: true,
        message: `Connection successful! Limit: ${limit}, Usage: ${usage}.`,
        response: `Limit: ${limit}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Network error: ${message}` };
    }
  }

  /** Shared error parser for OpenRouter (OpenAI-style) error responses. */
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
