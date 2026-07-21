/**
 * AIService — the single entry point for all AI operations.
 *
 * Architecture:
 *   Recorder → AIService → Selected Provider → Gemini / OpenAI / Claude / ...
 *
 * The rest of the extension (recorder, step builder, element identity,
 * JSON mapping) interacts ONLY with AIService. It never imports a
 * specific provider or calls provider APIs directly.
 *
 * Responsibilities:
 *   - Load the user-selected provider from storage
 *   - Validate the provider is configured (API key present)
 *   - Delegate to the provider's sendPrompt
 *   - Normalize the response into the standard schema (AIUnderstanding)
 *   - Expose capability queries (supportsVision, supportsFunctionCalling, etc.)
 *
 * Adding a new provider requires ZERO changes here — just implement
 * AIProvider and register it in ProviderManager.
 */
import { ProviderManager } from './provider-manager';
import { StorageService } from '../storage/storage-service';
import {
  AIUnderstanding,
  type AIProviderId,
} from '../shared/types';
import type { ProviderConfig, ProviderCapabilities } from './providers/types';
import { buildUnderstandingPrompt, parseUnderstandingResponse, type ActionElementInfo } from './ai-understanding';

/**
 * Resolved provider configuration — the active provider ID plus
 * the ProviderConfig needed to make API calls.
 */
export interface ResolvedProvider {
  providerId: AIProviderId;
  config: ProviderConfig;
}

export class AIService {
  /**
   * Resolve the currently-selected provider and its configuration.
   *
   * @returns The resolved provider, or null if no provider is
   *          configured (no API key set for the active provider).
   */
  static async resolve(): Promise<ResolvedProvider | null> {
    const aiConfig = await StorageService.getAIConfig();
    const providerId = aiConfig.activeProvider;
    const settings = aiConfig.providers[providerId];

    if (!settings || !settings.apiKey || settings.apiKey.trim() === '') {
      return null;
    }

    return {
      providerId,
      config: {
        apiKey: settings.apiKey,
        model: settings.model,
        baseUrl: settings.baseUrl,
      },
    };
  }

  /**
   * Send an action element to the AI for understanding.
   *
   * This is the only method the recorder calls. It:
   *   1. Resolves the active provider
   *   2. Validates it's configured
   *   3. Delegates to the provider
   *   4. Normalizes the response into AIUnderstanding
   *
   * Works for any action type (click, text_entry, future actions).
   * The prompt adapts based on ActionElementInfo.actionType.
   *
   * @returns AIUnderstanding on success, throws Error with a clear
   *          message on failure (missing config, API error, parse error).
   */
  static async understand(elementInfo: ActionElementInfo): Promise<AIUnderstanding> {
    const resolved = await this.resolve();

    if (!resolved) {
      throw new Error(
        'AI not configured — open Settings, select a provider, and enter your API key.',
      );
    }

    const provider = ProviderManager.get(resolved.providerId);
    if (!provider || !provider.implemented) {
      throw new Error(`Provider "${resolved.providerId}" is not available.`);
    }

    const prompt = buildUnderstandingPrompt(elementInfo);
    const result = await provider.sendPrompt(resolved.config, prompt);

    if (!result.success || !result.response) {
      throw new Error(result.error ?? 'AI returned no response.');
    }

    return parseUnderstandingResponse(result.response);
  }

  /**
   * Get the capabilities of the currently active provider.
   *
   * Instead of checking provider names, the rest of the extension
   * calls this to ask capability questions:
   *   AIService.getCapabilities()?.supportsVision
   *
   * @returns Capabilities of the active provider, or null if no
   *          active provider is configured.
   */
  static async getCapabilities(): Promise<ProviderCapabilities | null> {
    const aiConfig = await StorageService.getAIConfig();
    return ProviderManager.getCapabilities(aiConfig.activeProvider) ?? null;
  }

  /**
   * Check whether the active provider supports a specific capability.
   *
   * @example AIService.supports('supportsVision')
   */
  static async supports(
    capability: keyof ProviderCapabilities,
  ): Promise<boolean> {
    const caps = await this.getCapabilities();
    return caps ? caps[capability] : false;
  }

  /**
   * Get the ID of the currently active provider.
   */
  static async getActiveProviderId(): Promise<AIProviderId> {
    return StorageService.getActiveProvider();
  }
}
