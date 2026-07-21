import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from '../src/ai/provider-manager';
import { GeminiProvider } from '../src/ai/providers/gemini';

describe('ProviderManager', () => {
  beforeEach(() => {
    ProviderManager.reset();
  });

  describe('registration', () => {
    it('registers a provider', () => {
      ProviderManager.register(new GeminiProvider());
      const provider = ProviderManager.get('gemini');
      expect(provider).toBeDefined();
      expect(provider?.id).toBe('gemini');
    });

    it('auto-initializes built-in providers on first access', () => {
      const gemini = ProviderManager.get('gemini');
      expect(gemini).toBeDefined();
      expect(gemini?.id).toBe('gemini');
    });
  });

  describe('get()', () => {
    it('returns the correct provider', () => {
      const gemini = ProviderManager.get('gemini');
      expect(gemini?.name).toBe('Google Gemini');
    });

    it('returns undefined for unknown provider', () => {
      expect(ProviderManager.get('nonexistent')).toBeUndefined();
    });
  });

  describe('require()', () => {
    it('returns the provider for valid ID', () => {
      const gemini = ProviderManager.require('gemini');
      expect(gemini.id).toBe('gemini');
    });

    it('throws for unknown provider', () => {
      expect(() => ProviderManager.require('nonexistent')).toThrow('Unknown AI provider');
    });
  });

  describe('getAll()', () => {
    it('returns all registered providers', () => {
      const all = ProviderManager.getAll();
      expect(all.length).toBeGreaterThanOrEqual(6);
      const ids = all.map((p) => p.id);
      expect(ids).toContain('gemini');
      expect(ids).toContain('openai');
      expect(ids).toContain('claude');
      expect(ids).toContain('openrouter');
      expect(ids).toContain('azure-openai');
      expect(ids).toContain('custom');
    });
  });

  describe('getIds()', () => {
    it('returns all provider IDs', () => {
      const ids = ProviderManager.getIds();
      expect(ids.length).toBeGreaterThanOrEqual(6);
      expect(ids).toContain('gemini');
    });
  });

  describe('getOptions()', () => {
    it('returns formatted options for dropdowns', () => {
      const options = ProviderManager.getOptions();
      expect(options.length).toBeGreaterThanOrEqual(6);

      const geminiOption = options.find((o) => o.value === 'gemini');
      expect(geminiOption?.label).toBe('Google Gemini');
      expect(geminiOption?.implemented).toBe(true);
    });

    it('all six providers are now implemented', () => {
      const options = ProviderManager.getOptions();
      for (const opt of options) {
        expect(opt.implemented).toBe(true);
      }
    });
  });

  describe('getCapabilities()', () => {
    it('returns capabilities for a known provider', () => {
      const caps = ProviderManager.getCapabilities('gemini');
      expect(caps).toBeDefined();
      expect(caps?.supportsVision).toBe(true);
    });

    it('returns undefined for unknown provider', () => {
      expect(ProviderManager.getCapabilities('nonexistent')).toBeUndefined();
    });

    it('returns capabilities for all implemented providers', () => {
      const ids = ProviderManager.getIds();
      for (const id of ids) {
        const caps = ProviderManager.getCapabilities(id);
        expect(caps).toBeDefined();
        expect(typeof caps?.supportsVision).toBe('boolean');
        expect(typeof caps?.supportsFunctionCalling).toBe('boolean');
        expect(typeof caps?.supportsStreaming).toBe('boolean');
        expect(typeof caps?.supportsReasoning).toBe('boolean');
      }
    });
  });

  describe('extensibility', () => {
    it('supports adding custom providers without refactoring', () => {
      const customProvider = new GeminiProvider();
      ProviderManager.register(customProvider);
      expect(ProviderManager.get('gemini')).toBeDefined();
    });
  });
});
