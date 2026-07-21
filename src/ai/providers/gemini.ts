/**
 * Google Gemini AI Provider.
 *
 * Uses the Gemini REST API:
 * POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *
 * Docs: https://ai.google.dev/gemini-api/docs/text-generation
 */
import {
  AIProvider,
  ModelInfo,
  ProviderConfig,
  ProviderResult,
  ProviderCapabilities,
  ConnectionTestOutcome,
} from './types';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

const GEMINI_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
];

const GEMINI_CAPABILITIES: ProviderCapabilities = {
  supportsVision: true,
  supportsFunctionCalling: true,
  supportsStreaming: true,
  supportsReasoning: true,
};

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini';
  readonly name = 'Google Gemini';
  readonly implemented = true;
  readonly models = GEMINI_MODELS;
  readonly defaultModel = 'gemini-2.5-flash';
  readonly capabilities = GEMINI_CAPABILITIES;

  async sendPrompt(config: ProviderConfig, prompt: string): Promise<ProviderResult> {
    const model = config.model || this.defaultModel;
    const baseUrl = config.baseUrl || GEMINI_BASE_URL;
    const url = `${baseUrl}/v1beta/models/${model}:generateContent`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 256,
          },
        }),
      });

      if (!response.ok) {
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

      const data = await response.json();

      // Extract text from the response
      const text =
        data?.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text ?? '')
          .join('') ?? '';

      if (!text) {
        return { success: false, error: 'Empty response from Gemini' };
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

    const baseUrl = config.baseUrl || GEMINI_BASE_URL;

    try {
      // Use the models.list endpoint — cheapest way to verify the key
      const response = await fetch(
        `${baseUrl}/v1beta/models?key=${encodeURIComponent(config.apiKey)}`,
        { method: 'GET' },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        let msg = `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(errorBody);
          if (parsed?.error?.message) msg = parsed.error.message;
        } catch {
          if (errorBody) msg += `: ${errorBody.substring(0, 200)}`;
        }
        return { success: false, message: msg };
      }

      const data = await response.json();
      const modelCount = Array.isArray(data?.models) ? data.models.length : 0;

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
}
