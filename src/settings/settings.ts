/**
 * Settings page logic — tab switching + AI provider configuration.
 *
 * Provider-agnostic AI section:
 *   - Per-provider API key, model, and base URL (each provider stores independently)
 *   - Capabilities badges (vision, function calling, streaming, reasoning)
 *   - Test Connection per provider
 *   - Developer log
 */
import { AIProviderId } from '../shared/types';
import { StorageService } from '../storage/storage-service';
import { ProviderManager } from '../ai/provider-manager';
import { testConnection } from '../ai/connection-tester';
import type { ProviderCapabilities } from '../ai/providers/types';

// ── Tab Switching ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll<HTMLElement>('.tab');
  const sections = document.querySelectorAll<HTMLElement>('.section');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetSection = tab.dataset.section!;

      tabs.forEach((t) => t.classList.remove('tab--active'));
      sections.forEach((s) => s.classList.remove('section--active'));

      tab.classList.add('tab--active');
      document.getElementById(targetSection)?.classList.add('section--active');
    });
  });

  // Initialize AI section
  initAISection();
});

// ── AI Section ─────────────────────────────────────────────

const providerSelect = document.getElementById('ai-provider') as HTMLSelectElement;
const apiKeyInput = document.getElementById('ai-api-key') as HTMLInputElement;
const modelSelect = document.getElementById('ai-model') as HTMLSelectElement;
const baseUrlGroup = document.getElementById('ai-baseurl-group')!;
const baseUrlInput = document.getElementById('ai-base-url') as HTMLInputElement;
const baseUrlHint = document.getElementById('ai-baseurl-hint')!;
const testBtn = document.getElementById('ai-test-btn') as HTMLButtonElement;
const saveBtn = document.getElementById('ai-save-btn') as HTMLButtonElement;
const statusDot = document.getElementById('ai-status-dot')!;
const statusLabel = document.getElementById('ai-status-label')!;
const devlog = document.getElementById('ai-devlog')!;
const devlogContent = document.getElementById('ai-devlog-content')!;
const capsContainer = document.getElementById('ai-capabilities')!;

/** Providers that require a custom base URL. */
const PROVIDERS_WITH_BASE_URL = new Set<string>(['azure-openai', 'custom']);

/** Base URL placeholder hints per provider. */
const BASE_URL_HINTS: Record<string, string> = {
  'azure-openai': 'https://my-resource.openai.azure.com',
  'custom': 'http://localhost:11434/v1',
  'gemini': 'Override the default Gemini endpoint (optional)',
  'openai': 'Override the default OpenAI endpoint (optional)',
  'claude': 'Override the default Claude endpoint (optional)',
  'openrouter': 'Override the default OpenRouter endpoint (optional)',
};

async function initAISection(): Promise<void> {
  // Populate provider dropdown
  const options = ProviderManager.getOptions();
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    providerSelect.appendChild(el);
  }

  // Load saved config
  const config = await StorageService.getAIConfig();

  providerSelect.value = config.activeProvider;

  // Load settings for the active provider
  await loadProviderFields(config.activeProvider);

  // Event listeners
  providerSelect.addEventListener('change', () => {
    const providerId = providerSelect.value as AIProviderId;
    loadProviderFields(providerId);
  });

  testBtn.addEventListener('click', handleTestConnection);
  saveBtn.addEventListener('click', handleSaveSettings);
}

/**
 * Load the fields (API key, model, base URL) for a given provider
 * from storage. Also updates capabilities badges, model dropdown,
 * and base URL visibility.
 */
async function loadProviderFields(providerId: AIProviderId): Promise<void> {
  const provider = ProviderManager.get(providerId);
  const fallbackModel = provider?.defaultModel ?? '';
  const settings = await StorageService.getProviderSettings(providerId, fallbackModel);

  // Populate API key
  apiKeyInput.value = settings.apiKey ?? '';

  // Populate models
  populateModels(providerId, settings.model);

  // Base URL visibility + hint
  updateBaseUrlVisibility(providerId);

  // Capabilities badges
  renderCapabilities(provider?.capabilities);

  // Connection status
  renderConnectionStatus(settings.connectionStatus);
}

function populateModels(providerId: string, selectedModel: string): void {
  modelSelect.innerHTML = '';
  const provider = ProviderManager.get(providerId);
  if (!provider) return;

  for (const model of provider.models) {
    const el = document.createElement('option');
    el.value = model.id;
    el.textContent = model.label;
    modelSelect.appendChild(el);
  }

  modelSelect.value = selectedModel || provider.defaultModel;
}

function updateBaseUrlVisibility(providerId: string): void {
  // Show base URL for all providers (it's optional for most, required for custom/azure)
  const showBase = PROVIDERS_WITH_BASE_URL.has(providerId);
  baseUrlGroup.hidden = !showBase;
  baseUrlInput.placeholder = BASE_URL_HINTS[providerId] ?? '';
  baseUrlHint.textContent = showBase
    ? 'Required: enter your API endpoint URL.'
    : '';
}

/** Capability metadata for rendering badges. */
const CAPABILITY_META: Array<{ key: keyof ProviderCapabilities; label: string; icon: string }> = [
  { key: 'supportsVision', label: 'Vision', icon: '👁' },
  { key: 'supportsFunctionCalling', label: 'Function Calling', icon: '🔧' },
  { key: 'supportsStreaming', label: 'Streaming', icon: '⚡' },
  { key: 'supportsReasoning', label: 'Reasoning', icon: '🧠' },
];

function renderCapabilities(caps?: ProviderCapabilities): void {
  capsContainer.innerHTML = '';

  if (!caps) {
    capsContainer.hidden = true;
    return;
  }

  capsContainer.hidden = false;

  for (const meta of CAPABILITY_META) {
    const supported = caps[meta.key];
    const badge = document.createElement('span');
    badge.className = supported
      ? 'cap-badge cap-badge--on'
      : 'cap-badge cap-badge--off';
    badge.textContent = `${meta.icon} ${meta.label}`;
    badge.title = supported ? 'Supported' : 'Not supported';
    capsContainer.appendChild(badge);
  }
}

function renderConnectionStatus(status: string): void {
  // Reset classes
  statusDot.className = 'ai-status__dot';
  statusLabel.className = 'ai-status__label';

  switch (status) {
    case 'not_connected':
      statusDot.classList.add('ai-status__dot--idle');
      statusLabel.textContent = 'Not Connected';
      break;
    case 'connecting':
      statusDot.classList.add('ai-status__dot--connecting');
      statusLabel.textContent = 'Connecting…';
      break;
    case 'connected':
      statusDot.classList.add('ai-status__dot--connected');
      statusLabel.textContent = 'Connected';
      break;
    case 'failed':
      statusDot.classList.add('ai-status__dot--failed');
      statusLabel.textContent = 'Connection Failed';
      break;
  }
}

function log(message: string): void {
  devlog.hidden = false;
  const timestamp = new Date().toLocaleTimeString();
  devlogContent.textContent += `[${timestamp}] ${message}\n`;
}

async function handleTestConnection(): Promise<void> {
  const providerId = providerSelect.value as AIProviderId;
  const apiKey = apiKeyInput.value.trim();
  const model = modelSelect.value;
  const baseUrl = baseUrlInput.value.trim();

  renderConnectionStatus('connecting');
  testBtn.disabled = true;
  testBtn.textContent = 'Testing…';

  try {
    const result = await testConnection(providerId, {
      apiKey,
      model,
      baseUrl: baseUrl || undefined,
    });

    renderConnectionStatus(result.status);

    if (result.status === 'connected') {
      log(`✅ SUCCESS — ${result.message}`);
      if (result.response) {
        log(`   AI Response: "${result.response}"`);
      }
    } else {
      log(`❌ FAILED — ${result.message}`);
    }

    // Save connection status for this provider
    const fallbackModel = ProviderManager.get(providerId)?.defaultModel ?? model;
    const current = await StorageService.getProviderSettings(providerId, fallbackModel);
    await StorageService.setProviderSettings(providerId, {
      ...current,
      apiKey,
      model,
      baseUrl: baseUrl || undefined,
      connectionStatus: result.status,
      lastTestedAt: result.timestamp,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    renderConnectionStatus('failed');
    log(`❌ ERROR — ${message}`);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
}

async function handleSaveSettings(): Promise<void> {
  const providerId = providerSelect.value as AIProviderId;
  const apiKey = apiKeyInput.value.trim();
  const model = modelSelect.value;
  const baseUrl = baseUrlInput.value.trim();

  // Preserve the current connection status from the last test
  const fallbackModel = ProviderManager.get(providerId)?.defaultModel ?? model;
  const existing = await StorageService.getProviderSettings(providerId, fallbackModel);

  // Save per-provider settings
  await StorageService.setProviderSettings(providerId, {
    apiKey,
    model,
    baseUrl: baseUrl || undefined,
    connectionStatus: existing.connectionStatus,
    lastTestedAt: existing.lastTestedAt,
  });

  // Set as active provider
  await StorageService.setActiveProvider(providerId);

  saveBtn.textContent = 'Saved!';
  setTimeout(() => {
    saveBtn.textContent = 'Save Settings';
  }, 2000);

  log(`Settings saved. Active provider: ${ProviderManager.get(providerId)?.name ?? providerId}`);
}
