/**
 * Provider Manager — registry and factory for AI providers.
 *
 * To add a new provider: implement AIProvider, then register it here.
 * No existing code needs to change.
 */
import { AIProvider, ProviderCapabilities } from './providers/types';
import { GeminiProvider } from './providers/gemini';
import { OpenAIProvider } from './providers/openai';
import { ClaudeProvider } from './providers/claude';
import { OpenRouterProvider } from './providers/openrouter';
import { AzureOpenAIProvider } from './providers/azure-openai';
import { CustomProvider } from './providers/custom';
import type { AIProviderId } from '../shared/types';

export class ProviderManager {
  private static providers = new Map<string, AIProvider>();
  private static initialized = false;

  /** Register all built-in providers. Called once. */
  private static init(): void {
    if (this.initialized) return;
    const builtins = [
      new GeminiProvider(),
      new OpenAIProvider(),
      new ClaudeProvider(),
      new OpenRouterProvider(),
      new AzureOpenAIProvider(),
      new CustomProvider(),
    ];
    for (const p of builtins) {
      if (!this.providers.has(p.id)) {
        this.providers.set(p.id, p);
      }
    }
    this.initialized = true;
  }

  /** Register a single provider. */
  static register(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
  }

  /** Get a provider by ID. Returns undefined if not found. */
  static get(id: string): AIProvider | undefined {
    this.init();
    return this.providers.get(id);
  }

  /** Get a provider by ID, throwing if not found. */
  static require(id: string): AIProvider {
    this.init();
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Unknown AI provider: ${id}`);
    }
    return provider;
  }

  /** Get all registered providers. */
  static getAll(): AIProvider[] {
    this.init();
    return Array.from(this.providers.values());
  }

  /** Get all provider IDs. */
  static getIds(): string[] {
    this.init();
    return Array.from(this.providers.keys());
  }

  /** Get all provider options for UI dropdowns. */
  static getOptions(): Array<{ value: AIProviderId; label: string; implemented: boolean }> {
    this.init();
    return this.getAll().map((p) => ({
      value: p.id as AIProviderId,
      label: p.name,
      implemented: p.implemented,
    }));
  }

  /**
   * Get the capabilities for a provider by ID.
   * Returns undefined if the provider is not found.
   */
  static getCapabilities(id: string): ProviderCapabilities | undefined {
    this.init();
    return this.providers.get(id)?.capabilities;
  }

  /** Reset registry (for testing). */
  static reset(): void {
    this.providers.clear();
    this.initialized = false;
  }
}
