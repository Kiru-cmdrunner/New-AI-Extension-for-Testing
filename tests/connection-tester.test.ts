import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testConnection, TEST_PROMPT } from '../src/ai/connection-tester';
import { ProviderManager } from '../src/ai/provider-manager';
import type { AIProvider, ProviderResult, ConnectionTestOutcome } from '../src/ai/providers/types';

// Helper: create a mock provider with testConnection
function mockProvider(
  id: string,
  implemented: boolean,
  promptResult: ProviderResult,
  testOutcome: ConnectionTestOutcome,
): AIProvider {
  return {
    id,
    name: `Mock ${id}`,
    implemented,
    models: [{ id: 'mock-model', label: 'Mock Model' }],
    defaultModel: 'mock-model',
    capabilities: {
      supportsVision: false,
      supportsFunctionCalling: false,
      supportsStreaming: false,
      supportsReasoning: false,
    },
    sendPrompt: vi.fn(async () => promptResult),
    testConnection: vi.fn(async () => testOutcome),
  };
}

describe('ConnectionTester', () => {
  beforeEach(() => {
    ProviderManager.reset();
  });

  describe('TEST_PROMPT', () => {
    it('is a simple connection test prompt', () => {
      expect(TEST_PROMPT).toBe('Reply with: Connection Successful');
    });
  });

  describe('testConnection — validation', () => {
    it('fails when API key is empty', async () => {
      ProviderManager.register(
        mockProvider('gemini', true, { success: true, response: 'ok' }, { success: true, message: 'ok' }),
      );
      const result = await testConnection('gemini', {
        apiKey: '',
        model: 'gemini-2.5-flash',
      });
      expect(result.status).toBe('failed');
      expect(result.message).toContain('API key is required');
    });

    it('fails when API key is whitespace only', async () => {
      ProviderManager.register(
        mockProvider('gemini', true, { success: true, response: 'ok' }, { success: true, message: 'ok' }),
      );
      const result = await testConnection('gemini', {
        apiKey: '   ',
        model: 'gemini-2.5-flash',
      });
      expect(result.status).toBe('failed');
      expect(result.message).toContain('API key is required');
    });

    it('fails when provider is unknown', async () => {
      const result = await testConnection('nonexistent', {
        apiKey: 'key',
        model: 'model',
      });
      expect(result.status).toBe('failed');
      expect(result.message).toContain('Unknown provider');
    });

    it('fails when provider is not implemented', async () => {
      ProviderManager.register(
        mockProvider('placeholder', false, { success: true, response: 'ok' }, { success: true, message: 'ok' }),
      );
      const result = await testConnection('placeholder', {
        apiKey: 'key',
        model: 'model',
      });
      expect(result.status).toBe('failed');
      expect(result.message).toContain('not yet available');
    });
  });

  describe('testConnection — success', () => {
    it('returns connected when provider.testConnection succeeds', async () => {
      ProviderManager.register(
        mockProvider('gemini', true, { success: true, response: 'ok' }, {
          success: true,
          message: 'Connection successful! 5 models available.',
          response: '5 models',
        }),
      );
      const result = await testConnection('gemini', {
        apiKey: 'valid-key',
        model: 'gemini-2.5-flash',
      });
      expect(result.status).toBe('connected');
      expect(result.response).toBe('5 models');
      expect(result.message).toContain('Connection successful');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('testConnection — failure', () => {
    it('returns failed when provider.testConnection fails', async () => {
      ProviderManager.register(
        mockProvider('gemini', true, { success: false, error: 'bad' }, {
          success: false,
          message: 'Invalid API key',
        }),
      );
      const result = await testConnection('gemini', {
        apiKey: 'bad-key',
        model: 'gemini-2.5-flash',
      });
      expect(result.status).toBe('failed');
      expect(result.message).toBe('Invalid API key');
    });

    it('returns failed when provider.testConnection throws', async () => {
      const throwingProvider: AIProvider = {
        id: 'gemini',
        name: 'Gemini',
        implemented: true,
        models: [],
        defaultModel: 'm',
        capabilities: {
          supportsVision: false,
          supportsFunctionCalling: false,
          supportsStreaming: false,
          supportsReasoning: false,
        },
        sendPrompt: vi.fn(async () => ({ success: true, response: 'ok' })),
        testConnection: vi.fn(async (): Promise<ConnectionTestOutcome> => {
          throw new Error('Network timeout');
        }),
      };
      ProviderManager.register(throwingProvider);

      const result = await testConnection('gemini', {
        apiKey: 'key',
        model: 'model',
      });
      expect(result.status).toBe('failed');
      expect(result.message).toContain('Network timeout');
    });
  });
});
