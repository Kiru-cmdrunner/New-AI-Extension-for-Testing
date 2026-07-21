/**
 * Anthropic Claude Provider — full implementation via the Messages API.
 *
 * POST https://api.anthropic.com/v1/messages
 * Docs: https://docs.anthropic.com/en/api/messages
 *
 * Auth: x-api-key header + anthropic-version header.
 */
import {
  AIProvider,
  ModelInfo,
  ProviderConfig,
  ProviderResult,
  ProviderCapabilities,
  ConnectionTestOutcome,
} from './types';

const CLAUDE_BASE_URL = 'https://api.anthropic.com';

const CLAUDE_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
];

const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  supportsVision: true,
  supportsFunctionCalling: true,
  supportsStreaming: true,
  supportsReasoning: true,
};

export class ClaudeProvider implements AIProvider {
  readonly id = 'claude';
  readonly name = 'Anthropic Claude';
  readonly implemented = true;
  readonly models = CLAUDE_MODELS;
  readonly defaultModel = 'claude-sonnet-4-5-20250514';
  readonly capabilities = CLAUDE_CAPABILITIES;

  async sendPrompt(config: ProviderConfig, prompt: string): Promise<ProviderResult> {
    const model = config.model || this.defaultModel;
    const baseUrl = config.baseUrl || CLAUDE_BASE_URL;
    const url = `${baseUrl}/v1/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        return this.parseError(response);
      }

      const data = await response.json();

      // Claude returns content as an array of blocks
      const text = Array.isArray(data?.content)
        ? data.content
            .map((block: { type?: string; text?: string }) =>
              block.type === 'text' ? block.text ?? '' : '',
            )
            .join('')
        : '';

      if (!text) {
        return { success: false, error: 'Empty response from Claude' };
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

    const model = config.model || this.defaultModel;
    const baseUrl = config.baseUrl || CLAUDE_BASE_URL;

    try {
      // Send a minimal message — Claude has no lightweight "list models" endpoint.
      // Use max_tokens: 1 to minimise cost.
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      if (!response.ok) {
        const outcome = await this.parseError(response);
        return { success: false, message: outcome.error ?? `HTTP ${response.status}` };
      }

      return {
        success: true,
        message: 'Connection successful! Credentials verified.',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Network error: ${message}` };
    }
  }

  /** Shared error parser for Anthropic-style error responses. */
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
