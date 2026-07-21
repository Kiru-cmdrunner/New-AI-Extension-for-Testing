import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiProvider } from '../src/ai/providers/gemini';
import { OpenAIProvider } from '../src/ai/providers/openai';
import { ClaudeProvider } from '../src/ai/providers/claude';
import { OpenRouterProvider } from '../src/ai/providers/openrouter';
import { AzureOpenAIProvider } from '../src/ai/providers/azure-openai';
import { CustomProvider } from '../src/ai/providers/custom';
import type { ProviderConfig } from '../src/ai/providers/types';

// Helper: mock global fetch
function mockFetch(response: Response | { ok: boolean; status: number; json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  const res = response as Response;
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(res as Response);
}

function makeResponse(opts: {
  ok: boolean;
  status: number;
  body?: unknown;
  text?: string;
}): Response {
  const body = opts.text ?? JSON.stringify(opts.body ?? {});
  return new Response(body, {
    status: opts.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const validConfig: ProviderConfig = {
  apiKey: 'test-key',
  model: 'test-model',
};

describe('Provider testConnection()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Gemini', () => {
    it('fails when API key is missing', async () => {
      const provider = new GeminiProvider();
      const result = await provider.testConnection({ apiKey: '', model: 'gemini-2.5-flash' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('API key is required');
    });

    it('succeeds when models.list returns OK', async () => {
      mockFetch(makeResponse({ ok: true, status: 200, body: { models: [{ name: 'gemini-1.5-pro' }, { name: 'gemini-1.5-flash' }] } }));
      const provider = new GeminiProvider();
      const result = await provider.testConnection(validConfig);
      expect(result.success).toBe(true);
      expect(result.message).toContain('2 models');
    });

    it('fails when API returns error', async () => {
      mockFetch(makeResponse({ ok: false, status: 403, body: { error: { message: 'API key expired' } } }));
      const provider = new GeminiProvider();
      const result = await provider.testConnection(validConfig);
      expect(result.success).toBe(false);
      expect(result.message).toContain('API key expired');
    });
  });

  describe('OpenAI', () => {
    it('fails when API key is missing', async () => {
      const provider = new OpenAIProvider();
      const result = await provider.testConnection({ apiKey: '', model: 'gpt-4o' });
      expect(result.success).toBe(false);
    });

    it('succeeds when /v1/models returns OK', async () => {
      mockFetch(makeResponse({ ok: true, status: 200, body: { data: [{ id: 'gpt-4o' }] } }));
      const provider = new OpenAIProvider();
      const result = await provider.testConnection(validConfig);
      expect(result.success).toBe(true);
    });

    it('fails on 401', async () => {
      mockFetch(makeResponse({ ok: false, status: 401, body: { error: { message: 'Invalid key' } } }));
      const provider = new OpenAIProvider();
      const result = await provider.testConnection(validConfig);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid key');
    });
  });

  describe('Claude', () => {
    it('fails when API key is missing', async () => {
      const provider = new ClaudeProvider();
      const result = await provider.testConnection({ apiKey: '', model: 'claude-sonnet-4-5-20250514' });
      expect(result.success).toBe(false);
    });

    it('succeeds when /v1/messages returns OK', async () => {
      mockFetch(makeResponse({ ok: true, status: 200, body: { content: [{ type: 'text', text: 'Hi' }] } }));
      const provider = new ClaudeProvider();
      const result = await provider.testConnection(validConfig);
      expect(result.success).toBe(true);
    });

    it('fails on 401', async () => {
      mockFetch(makeResponse({ ok: false, status: 401, body: { error: { message: 'Unauthorized' } } }));
      const provider = new ClaudeProvider();
      const result = await provider.testConnection(validConfig);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unauthorized');
    });
  });

  describe('OpenRouter', () => {
    it('fails when API key is missing', async () => {
      const provider = new OpenRouterProvider();
      const result = await provider.testConnection({ apiKey: '', model: 'openai/gpt-4o' });
      expect(result.success).toBe(false);
    });

    it('succeeds when /api/v1/key/info returns OK', async () => {
      mockFetch(makeResponse({ ok: true, status: 200, body: { data: { limit: 100, usage: 10 } } }));
      const provider = new OpenRouterProvider();
      const result = await provider.testConnection(validConfig);
      expect(result.success).toBe(true);
    });

    it('fails on 401', async () => {
      mockFetch(makeResponse({ ok: false, status: 401, body: { error: { message: 'Invalid key' } } }));
      const provider = new OpenRouterProvider();
      const result = await provider.testConnection(validConfig);
      expect(result.success).toBe(false);
    });
  });

  describe('Azure OpenAI', () => {
    it('fails when API key is missing', async () => {
      const provider = new AzureOpenAIProvider();
      const result = await provider.testConnection({ apiKey: '', model: 'gpt-4o', baseUrl: 'https://my-resource.openai.azure.com' });
      expect(result.success).toBe(false);
    });

    it('fails when base URL is missing', async () => {
      const provider = new AzureOpenAIProvider();
      const result = await provider.testConnection({ apiKey: 'key', model: 'gpt-4o' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Base URL');
    });

    it('succeeds when deployment chat completions returns OK', async () => {
      mockFetch(makeResponse({ ok: true, status: 200, body: { choices: [{ message: { content: 'Hi' } }] } }));
      const provider = new AzureOpenAIProvider();
      const result = await provider.testConnection({
        apiKey: 'azure-key',
        model: 'gpt-4o',
        baseUrl: 'https://my-resource.openai.azure.com',
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('gpt-4o');
    });
  });

  describe('Custom', () => {
    it('fails when API key is missing', async () => {
      const provider = new CustomProvider();
      const result = await provider.testConnection({ apiKey: '', model: 'custom', baseUrl: 'http://localhost:11434/v1' });
      expect(result.success).toBe(false);
    });

    it('fails when base URL is missing', async () => {
      const provider = new CustomProvider();
      const result = await provider.testConnection({ apiKey: 'key', model: 'custom' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Base URL');
    });

    it('succeeds when /models returns OK', async () => {
      mockFetch(makeResponse({ ok: true, status: 200, body: { data: [{ id: 'llama3' }] } }));
      const provider = new CustomProvider();
      const result = await provider.testConnection({
        apiKey: 'key',
        model: 'custom',
        baseUrl: 'http://localhost:11434/v1',
      });
      expect(result.success).toBe(true);
    });

    it('handles Ollama-style { models: [...] } response', async () => {
      mockFetch(makeResponse({ ok: true, status: 200, body: { models: [{ name: 'llama3' }] } }));
      const provider = new CustomProvider();
      const result = await provider.testConnection({
        apiKey: 'key',
        model: 'custom',
        baseUrl: 'http://localhost:11434/v1',
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('Provider sendPrompt()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Gemini extracts text from candidates', async () => {
    mockFetch(makeResponse({
      ok: true, status: 200,
      body: { candidates: [{ content: { parts: [{ text: 'Hello World' }] } }] },
    }));
    const result = await new GeminiProvider().sendPrompt(validConfig, 'test');
    expect(result.success).toBe(true);
    expect(result.response).toBe('Hello World');
  });

  it('OpenAI extracts text from choices', async () => {
    mockFetch(makeResponse({
      ok: true, status: 200,
      body: { choices: [{ message: { content: 'Hello World' } }] },
    }));
    const result = await new OpenAIProvider().sendPrompt(validConfig, 'test');
    expect(result.success).toBe(true);
    expect(result.response).toBe('Hello World');
  });

  it('Claude extracts text from content blocks', async () => {
    mockFetch(makeResponse({
      ok: true, status: 200,
      body: { content: [{ type: 'text', text: 'Hello World' }] },
    }));
    const result = await new ClaudeProvider().sendPrompt(validConfig, 'test');
    expect(result.success).toBe(true);
    expect(result.response).toBe('Hello World');
  });

  it('Azure requires baseUrl', async () => {
    const result = await new AzureOpenAIProvider().sendPrompt({ apiKey: 'key', model: 'gpt-4o' }, 'test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Base URL');
  });

  it('Custom requires baseUrl', async () => {
    const result = await new CustomProvider().sendPrompt({ apiKey: 'key', model: 'custom' }, 'test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Base URL');
  });

  it('OpenRouter extracts text from choices', async () => {
    mockFetch(makeResponse({
      ok: true, status: 200,
      body: { choices: [{ message: { content: 'Hello World' } }] },
    }));
    const result = await new OpenRouterProvider().sendPrompt(validConfig, 'test');
    expect(result.success).toBe(true);
    expect(result.response).toBe('Hello World');
  });

  it('handles network errors gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));
    const result = await new GeminiProvider().sendPrompt(validConfig, 'test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });
});
