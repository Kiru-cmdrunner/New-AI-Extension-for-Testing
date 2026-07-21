import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from '../src/ai/provider-manager';
import { GeminiProvider } from '../src/ai/providers/gemini';
import { OpenAIProvider } from '../src/ai/providers/openai';
import { ClaudeProvider } from '../src/ai/providers/claude';
import { OpenRouterProvider } from '../src/ai/providers/openrouter';
import { AzureOpenAIProvider } from '../src/ai/providers/azure-openai';
import { CustomProvider } from '../src/ai/providers/custom';

describe('Provider Capabilities', () => {
  beforeEach(() => {
    ProviderManager.reset();
  });

  const providers = [
    { name: 'Gemini', ctor: GeminiProvider, id: 'gemini' },
    { name: 'OpenAI', ctor: OpenAIProvider, id: 'openai' },
    { name: 'Claude', ctor: ClaudeProvider, id: 'claude' },
    { name: 'OpenRouter', ctor: OpenRouterProvider, id: 'openrouter' },
    { name: 'Azure OpenAI', ctor: AzureOpenAIProvider, id: 'azure-openai' },
    { name: 'Custom', ctor: CustomProvider, id: 'custom' },
  ];

  for (const { name, ctor } of providers) {
    describe(`${name}`, () => {
      it('exposes a capabilities object with all four keys', () => {
        const provider = new ctor();
        const caps = provider.capabilities;
        expect(caps).toBeDefined();
        expect(typeof caps.supportsVision).toBe('boolean');
        expect(typeof caps.supportsFunctionCalling).toBe('boolean');
        expect(typeof caps.supportsStreaming).toBe('boolean');
        expect(typeof caps.supportsReasoning).toBe('boolean');
      });

      it('is implemented', () => {
        const provider = new ctor();
        expect(provider.implemented).toBe(true);
      });
    });
  }

  describe('Specific capability values', () => {
    it('Gemini supports vision, function calling, streaming, reasoning', () => {
      const caps = new GeminiProvider().capabilities;
      expect(caps.supportsVision).toBe(true);
      expect(caps.supportsFunctionCalling).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsReasoning).toBe(true);
    });

    it('OpenAI supports vision, function calling, streaming, reasoning', () => {
      const caps = new OpenAIProvider().capabilities;
      expect(caps.supportsVision).toBe(true);
      expect(caps.supportsFunctionCalling).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsReasoning).toBe(true);
    });

    it('Claude supports vision, function calling, streaming, reasoning', () => {
      const caps = new ClaudeProvider().capabilities;
      expect(caps.supportsVision).toBe(true);
      expect(caps.supportsFunctionCalling).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsReasoning).toBe(true);
    });

    it('Azure does NOT support reasoning', () => {
      const caps = new AzureOpenAIProvider().capabilities;
      expect(caps.supportsReasoning).toBe(false);
    });

    it('Custom supports everything (unknown = permissive)', () => {
      const caps = new CustomProvider().capabilities;
      expect(caps.supportsVision).toBe(true);
      expect(caps.supportsFunctionCalling).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsReasoning).toBe(true);
    });
  });

  describe('ProviderManager.getCapabilities()', () => {
    it('returns capabilities from the registry', () => {
      const caps = ProviderManager.getCapabilities('openai');
      expect(caps).toBeDefined();
      expect(caps!.supportsFunctionCalling).toBe(true);
    });
  });
});
