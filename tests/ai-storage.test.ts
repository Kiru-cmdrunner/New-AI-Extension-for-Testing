import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { StorageService } from '../src/storage/storage-service';
import { StorageKeys, DEFAULT_AI_CONFIG, type AIConfig } from '../src/shared/types';

describe('AI Storage Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupChromeMock();
  });

  describe('getAIConfig', () => {
    it('returns default config when nothing is stored', async () => {
      const config = await StorageService.getAIConfig();
      expect(config.activeProvider).toBe('gemini');
      expect(config.providers.gemini?.model).toBe('gemini-2.5-flash');
      expect(config.providers.gemini?.connectionStatus).toBe('not_connected');
    });

    it('returns stored config (new format)', async () => {
      setupChromeMock({
        [StorageKeys.AI_CONFIG]: {
          activeProvider: 'openai',
          providers: {
            openai: {
              apiKey: 'sk-test',
              model: 'gpt-4o',
              connectionStatus: 'connected',
            },
          },
        },
      });
      const config = await StorageService.getAIConfig();
      expect(config.activeProvider).toBe('openai');
      expect(config.providers.openai?.model).toBe('gpt-4o');
      expect(config.providers.openai?.connectionStatus).toBe('connected');
    });

    it('migrates legacy config format (single provider + model)', async () => {
      setupChromeMock({
        [StorageKeys.AI_CONFIG]: {
          provider: 'openai',
          model: 'gpt-4o',
        },
        ai_api_key: 'sk-legacy-key',
      });
      const config = await StorageService.getAIConfig();
      expect(config.activeProvider).toBe('openai');
      expect(config.providers.openai?.model).toBe('gpt-4o');
      expect(config.providers.openai?.apiKey).toBe('sk-legacy-key');
    });
  });

  describe('setAIConfig', () => {
    it('persists the config', async () => {
      const { storage } = setupChromeMock();
      const config: AIConfig = {
        activeProvider: 'claude',
        providers: {
          claude: {
            apiKey: 'sk-claude',
            model: 'claude-sonnet-4-5-20250514',
            connectionStatus: 'connected',
          },
        },
      };
      await StorageService.setAIConfig(config);
      expect(storage.local.set).toHaveBeenCalledWith({
        [StorageKeys.AI_CONFIG]: config,
      });
    });
  });

  describe('Per-provider settings', () => {
    it('getProviderSettings returns defaults when not stored', async () => {
      const settings = await StorageService.getProviderSettings('openai', 'gpt-4o');
      expect(settings.model).toBe('gpt-4o');
      expect(settings.apiKey).toBe('');
      expect(settings.connectionStatus).toBe('not_connected');
    });

    it('setProviderSettings saves and getProviderSettings retrieves', async () => {
      await StorageService.setProviderSettings('openai', {
        apiKey: 'sk-test',
        model: 'gpt-4o',
        connectionStatus: 'connected',
      });
      const settings = await StorageService.getProviderSettings('openai', 'gpt-4o');
      expect(settings.apiKey).toBe('sk-test');
      expect(settings.model).toBe('gpt-4o');
      expect(settings.connectionStatus).toBe('connected');
    });

    it('preserves other providers when saving one', async () => {
      await StorageService.setProviderSettings('gemini', {
        apiKey: 'key1',
        model: 'gemini-2.5-flash',
        connectionStatus: 'connected',
      });
      await StorageService.setProviderSettings('openai', {
        apiKey: 'key2',
        model: 'gpt-4o',
        connectionStatus: 'not_connected',
      });
      const gemini = await StorageService.getProviderSettings('gemini', 'gemini-2.5-flash');
      expect(gemini.apiKey).toBe('key1');
      const openai = await StorageService.getProviderSettings('openai', 'gpt-4o');
      expect(openai.apiKey).toBe('key2');
    });
  });

  describe('Active provider', () => {
    it('setActiveProvider and getActiveProvider', async () => {
      await StorageService.setActiveProvider('claude');
      const active = await StorageService.getActiveProvider();
      expect(active).toBe('claude');
    });

    it('getActiveProvider returns default when not set', async () => {
      const active = await StorageService.getActiveProvider();
      expect(active).toBe(DEFAULT_AI_CONFIG.activeProvider);
    });
  });
});
