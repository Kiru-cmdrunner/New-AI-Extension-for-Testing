import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIService } from '../src/ai/ai-service';
import { StorageService } from '../src/storage/storage-service';
import { ProviderManager } from '../src/ai/provider-manager';
import { setupChromeMock } from './mock-chrome';
import type { AIProvider, ProviderResult, ConnectionTestOutcome, ProviderCapabilities } from '../src/ai/providers/types';

const DEFAULT_CAPS: ProviderCapabilities = {
  supportsVision: false,
  supportsFunctionCalling: false,
  supportsStreaming: false,
  supportsReasoning: false,
};

/** Create a fully-mocked provider for AIService tests. */
function mockAIProvider(
  id: string,
  promptResult: ProviderResult,
  caps: Partial<ProviderCapabilities> = {},
): AIProvider {
  return {
    id,
    name: `Mock ${id}`,
    implemented: true,
    models: [{ id: 'mock-model', label: 'Mock Model' }],
    defaultModel: 'mock-model',
    capabilities: { ...DEFAULT_CAPS, ...caps },
    sendPrompt: vi.fn(async () => promptResult),
    testConnection: vi.fn(async (): Promise<ConnectionTestOutcome> => ({
      success: true,
      message: 'ok',
    })),
  };
}

describe('AIService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupChromeMock();
    ProviderManager.reset();
  });

  describe('resolve()', () => {
    it('returns null when no API key is configured', async () => {
      const resolved = await AIService.resolve();
      expect(resolved).toBeNull();
    });

    it('returns resolved provider when API key is set', async () => {
      ProviderManager.register(mockAIProvider('gemini', { success: true, response: 'ok' }));
      await StorageService.setProviderSettings('gemini', {
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
        connectionStatus: 'connected',
      });

      const resolved = await AIService.resolve();
      expect(resolved).not.toBeNull();
      expect(resolved!.providerId).toBe('gemini');
      expect(resolved!.config.apiKey).toBe('test-key');
    });

    it('returns null when API key is whitespace only', async () => {
      await StorageService.setProviderSettings('gemini', {
        apiKey: '   ',
        model: 'gemini-2.5-flash',
        connectionStatus: 'not_connected',
      });

      const resolved = await AIService.resolve();
      expect(resolved).toBeNull();
    });
  });

  describe('understand()', () => {
    it('throws clear error when no provider is configured', async () => {
      await expect(AIService.understand({ actionType: 'click', text: 'Click', tag: 'BUTTON', role: 'button', className: null }))
        .rejects.toThrow('AI not configured');
    });

    it('returns AIUnderstanding on success', async () => {
      ProviderManager.register(mockAIProvider('gemini', {
        success: true,
        response: JSON.stringify({
          businessName: 'Login Button',
          controlType: 'Button',
          userIntent: 'Submit login form',
          confidenceScore: 0.95,
        }),
      }));
      await StorageService.setProviderSettings('gemini', {
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
        connectionStatus: 'connected',
      });

      const result = await AIService.understand({ actionType: 'click', text: 'Login', tag: 'BUTTON', role: 'button', className: null });
      expect(result.businessName).toBe('Login Button');
      expect(result.controlType).toBe('Button');
      expect(result.userIntent).toBe('Submit login form');
      expect(result.confidenceScore).toBe(0.95);
    });

    it('throws with provider error when sendPrompt fails', async () => {
      ProviderManager.register(mockAIProvider('gemini', {
        success: false,
        error: 'Invalid API key',
      }));
      await StorageService.setProviderSettings('gemini', {
        apiKey: 'bad-key',
        model: 'gemini-2.5-flash',
        connectionStatus: 'not_connected',
      });

      await expect(AIService.understand({ actionType: 'click', text: 'Click', tag: 'BUTTON', role: null, className: null }))
        .rejects.toThrow('Invalid API key');
    });

    it('uses the active provider, not a hardcoded one', async () => {
      const openaiProvider = mockAIProvider('openai', {
        success: true,
        response: JSON.stringify({
          businessName: 'Search',
          controlType: 'Text Field',
          userIntent: 'Search for products',
          confidenceScore: 0.8,
        }),
      });
      ProviderManager.register(openaiProvider);
      ProviderManager.register(mockAIProvider('gemini', {
        success: true,
        response: 'wrong provider',
      }));

      // Set openai as active
      await StorageService.setProviderSettings('openai', {
        apiKey: 'sk-openai-key',
        model: 'gpt-4o',
        connectionStatus: 'connected',
      });
      await StorageService.setActiveProvider('openai');

      const result = await AIService.understand({ actionType: 'click', text: 'Search', tag: 'INPUT', role: null, className: null });
      expect(result.businessName).toBe('Search');
      expect(openaiProvider.sendPrompt).toHaveBeenCalled();
    });
  });

  describe('getCapabilities()', () => {
    it('returns capabilities of the active provider', async () => {
      ProviderManager.register(mockAIProvider('gemini', { success: true, response: 'ok' }, {
        supportsVision: true,
        supportsFunctionCalling: true,
        supportsStreaming: false,
        supportsReasoning: true,
      }));

      const caps = await AIService.getCapabilities();
      expect(caps).not.toBeNull();
      expect(caps!.supportsVision).toBe(true);
      expect(caps!.supportsFunctionCalling).toBe(true);
      expect(caps!.supportsStreaming).toBe(false);
      expect(caps!.supportsReasoning).toBe(true);
    });

    it('returns null when provider not found', async () => {
      await StorageService.setActiveProvider('nonexistent' as never);
      const caps = await AIService.getCapabilities();
      expect(caps).toBeNull();
    });
  });

  describe('supports()', () => {
    it('returns true for supported capability', async () => {
      ProviderManager.register(mockAIProvider('gemini', { success: true, response: 'ok' }, {
        supportsVision: true,
      }));
      expect(await AIService.supports('supportsVision')).toBe(true);
    });

    it('returns false for unsupported capability', async () => {
      ProviderManager.register(mockAIProvider('gemini', { success: true, response: 'ok' }, {
        supportsReasoning: false,
      }));
      expect(await AIService.supports('supportsReasoning')).toBe(false);
    });
  });

  describe('getActiveProviderId()', () => {
    it('returns the active provider ID', async () => {
      await StorageService.setActiveProvider('claude');
      const id = await AIService.getActiveProviderId();
      expect(id).toBe('claude');
    });
  });
});
