/**
 * Azure OpenAI Provider — full implementation.
 *
 * Azure uses a different URL pattern than standard OpenAI:
 *   POST {resource_base}/openai/deployments/{deployment-id}/chat/completions?api-version={api-version}
 *   Auth: api-key header.
 *
 * The user must provide their Azure resource endpoint as `baseUrl`
 * (e.g. `https://my-resource.openai.azure.com`) and the deployment
 * name as the `model` field.
 *
 * Docs: https://learn.microsoft.com/en-us/azure/ai-services/openai/reference
 */
import {
  AIProvider,
  ModelInfo,
  ProviderConfig,
  ProviderResult,
  ProviderCapabilities,
  ConnectionTestOutcome,
} from './types';

/** Azure API version used for all requests. */
const AZURE_API_VERSION = '2024-06-01';

const AZURE_MODELS: ModelInfo[] = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'gpt-4', label: 'GPT-4' },
  { id: 'gpt-35-turbo', label: 'GPT-3.5 Turbo' },
];

const AZURE_CAPABILITIES: ProviderCapabilities = {
  supportsVision: true,
  supportsFunctionCalling: true,
  supportsStreaming: true,
  supportsReasoning: false,
};

export class AzureOpenAIProvider implements AIProvider {
  readonly id = 'azure-openai';
  readonly name = 'Azure OpenAI';
  readonly implemented = true;
  readonly models = AZURE_MODELS;
  readonly defaultModel = 'gpt-4o';
  readonly capabilities = AZURE_CAPABILITIES;

  async sendPrompt(config: ProviderConfig, prompt: string): Promise<ProviderResult> {
    // baseUrl is required for Azure — it's the resource endpoint
    if (!config.baseUrl) {
      return {
        success: false,
        error: 'Azure requires a Base URL (resource endpoint, e.g. https://my-resource.openai.azure.com).',
      };
    }

    const deployment = config.model || this.defaultModel;
    const url = `${config.baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${AZURE_API_VERSION}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': config.apiKey,
        },
        body: JSON.stringify({
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
        return { success: false, error: 'Empty response from Azure OpenAI' };
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
        message: 'Azure requires a Base URL (resource endpoint, e.g. https://my-resource.openai.azure.com).',
      };
    }

    const deployment = config.model || this.defaultModel;

    try {
      // Send a minimal chat completion to verify the deployment + key.
      // Azure doesn't have a lightweight "list models" that works with key auth.
      const response = await fetch(
        `${config.baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${AZURE_API_VERSION}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': config.apiKey,
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 1,
          },
          ),
        },
      );

      if (!response.ok) {
        const outcome = await this.parseError(response);
        return { success: false, message: outcome.error ?? `HTTP ${response.status}` };
      }

      return {
        success: true,
        message: `Connection successful! Deployment "${deployment}" verified.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Network error: ${message}` };
    }
  }

  /** Shared error parser for Azure OpenAI error responses. */
  private async parseError(response: Response): Promise<ProviderResult> {
    const errorBody = await response.text();
    let errorMsg = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed?.error?.message) {
        errorMsg = parsed.error.message;
      } else if (parsed?.error?.code) {
        errorMsg = `${parsed.error.code}: ${parsed.error.message ?? 'Unknown error'}`;
      }
    } catch {
      if (errorBody) errorMsg += `: ${errorBody.substring(0, 200)}`;
    }
    return { success: false, error: errorMsg };
  }
}
