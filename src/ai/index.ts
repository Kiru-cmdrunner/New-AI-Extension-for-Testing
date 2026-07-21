/**
 * AI module barrel export.
 *
 * AIService is the single entry point for all AI operations.
 * Provider implementations and types are also re-exported for
 * the settings UI and tests.
 */
export { AIService } from './ai-service';
export { ProviderManager } from './provider-manager';
export { testConnection } from './connection-tester';
export type {
  AIProvider,
  ProviderConfig,
  ProviderResult,
  ProviderCapabilities,
  ModelInfo,
  ConnectionTestOutcome,
} from './providers/types';
export type { AIProviderId } from '../shared/types';
