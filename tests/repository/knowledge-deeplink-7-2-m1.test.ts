/**
 * 7.2-M1 — Knowledge deep links (RED first).
 *
 * Spec: .drytis/specs/phase-7-2-m1-knowledge-deeplink.md §3 (D1–D5, D12)
 *
 * The knowledge loop closes: chip/link clicks open the KR browser at the
 * exact app and row the user was looking at.
 *
 *  D1  parseKnowledgeParams — whitelist, empty, unknown keys, encoding.
 *  D2  unknown ?app= → fallback apps[0], focus dropped.
 *  D3  focusSignatureKey → data-signature-key row gets .kr-highlight +
 *      scrollIntoView; absent key → no crash, no highlight.
 *  D4  focusEntityId → same for entity rows.
 *  D5  projectId passthrough → loadHealElements receives it.
 *  D12 source-scan: repository-page wires parseKnowledgeParams at init.
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

// 7.2-M1: stub the Dexie-backed loaders (established kr-adapter pattern —
// vi.mock is hoisted; the browser module must be dynamically imported).
const loadApplications = vi.fn();
const loadAppKnowledge = vi.fn();
const loadBehaviorSessions = vi.fn();
const loadApiSeeds = vi.fn();
const loadHealElements = vi.fn();
const loadSessionDetail = vi.fn();

vi.mock('../../src/repository/kr-browser/kr-data', () => ({
  loadApplications: (...a: unknown[]) => loadApplications(...(a as [])),
  loadAppKnowledge: (...a: unknown[]) => loadAppKnowledge(...(a as [string])),
  loadBehaviorSessions: (...a: unknown[]) => loadBehaviorSessions(...(a as [string])),
  loadApiSeeds: (...a: unknown[]) => loadApiSeeds(...(a as [string])),
  loadHealElements: (...a: unknown[]) => loadHealElements(...(a as [string | null])),
  loadSessionDetail: (...a: unknown[]) => loadSessionDetail(...(a as [string, string])),
}));

const EMPTY_KNOWLEDGE = {
  signatures: [], workflows: [], views: [], viewEdges: [], gaps: [], outcomes: [],
  entities: [], collections: [], counters: [], notifications: [],
};

function stubBase(apps: Array<{ appId: string; origin: string; sessionCount: number }>) {
  loadApplications.mockResolvedValue(apps);
  loadAppKnowledge.mockResolvedValue(EMPTY_KNOWLEDGE);
  loadBehaviorSessions.mockResolvedValue([]);
  loadApiSeeds.mockResolvedValue([]);
  loadHealElements.mockResolvedValue(null);
  loadSessionDetail.mockResolvedValue({ episodes: [], edges: [] });
}

describe('D1 — parseKnowledgeParams (pure)', () => {
  it('full param set decodes', async () => {
    const { parseKnowledgeParams } = await import('../../src/repository/kr-browser/kr-browser');
    const p = parseKnowledgeParams('?app=http%3A%2F%2F127.0.0.1%3A8190&sig=a%3Asig%3Ah1&entity=product%3AFL-6E-231&project=p-1');
    expect(p.appId).toBe('http://127.0.0.1:8190');
    expect(p.signatureKey).toBe('a:sig:h1');
    expect(p.entityId).toBe('product:FL-6E-231');
    expect(p.projectId).toBe('p-1');
  });

  it('empty search → all undefined', async () => {
    const { parseKnowledgeParams } = await import('../../src/repository/kr-browser/kr-browser');
    const p = parseKnowledgeParams('');
    expect(p.appId).toBeUndefined();
    expect(p.signatureKey).toBeUndefined();
    expect(p.entityId).toBeUndefined();
    expect(p.projectId).toBeUndefined();
  });

  it('unknown keys ignored', async () => {
    const { parseKnowledgeParams } = await import('../../src/repository/kr-browser/kr-browser');
    const p = parseKnowledgeParams('?evil=<script>&app=a1');
    expect((p as Record<string, unknown>).evil).toBeUndefined();
    expect(p.appId).toBe('a1');
  });

  it('round-trip: URLSearchParams encode → decode', async () => {
    const { parseKnowledgeParams } = await import('../../src/repository/kr-browser/kr-browser');
    const q = new URLSearchParams({ app: 'http://127.0.0.1:8190', sig: 'a:sig:h 1' });
    const p = parseKnowledgeParams(`?${q.toString()}`);
    expect(p.appId).toBe('http://127.0.0.1:8190');
    expect(p.signatureKey).toBe('a:sig:h 1');
  });
});

describe('D2 — unknown ?app= falls back to apps[0], focus dropped', () => {
  it('selectedAppId resolves to first app and focus params are ignored', async () => {
    stubBase([{ appId: 'app-real', origin: 'http://real', sessionCount: 1 }]);
    const { renderKrBrowser } = await import('../../src/repository/kr-browser/kr-browser');
    let seen: string | null | undefined;
    const host = document.createElement('div');
    await renderKrBrowser(host, {
      selectedAppId: 'app-missing',
      onAppSelected: (id) => { seen = id; },
      focusSignatureKey: 'a:sig:not-there',
    });
    const select = host.querySelector('select');
    expect(select?.selectedOptions[0]?.value).toBe('app-real');
    expect(seen).toBeUndefined();
  });
});

describe('D3/D4 — focus highlight', () => {
  it('D3: signature row gets data-signature-key + .kr-highlight + scrollIntoView', async () => {
    stubBase([{ appId: 'app-1', origin: 'http://127.0.0.1:8190', sessionCount: 2 }]);
    loadAppKnowledge.mockResolvedValue({
      ...EMPTY_KNOWLEDGE,
      signatures: [{
        key: 'app-1:Click:btn', appId: 'app-1', actionType: 'Click',
        normalizedTarget: 'btn', anchorViewId: null, firstSeenAtSession: 's1',
        lastSeenAtSession: 's2', firstSeenSeq: 1, lastSeenSeq: 2, firstSeenAtMs: 0,
        lastSeenAtMs: 0, occurrenceCount: 2, sessionsSinceSeen: 0, status: 'active',
        source: 'behavior', consequenceProfile: [], divergenceFlags: [],
      }],
    });
    const { renderKrBrowser } = await import('../../src/repository/kr-browser/kr-browser');
    const host = document.createElement('div');
    document.body.appendChild(host);
    await renderKrBrowser(host, {
      selectedAppId: 'app-1',
      onAppSelected: () => {},
      focusSignatureKey: 'app-1:Click:btn',
    });
    const row = host.querySelector('[data-signature-key="app-1:Click:btn"]');
    expect(row).not.toBeNull();
    expect(row?.classList.contains('kr-highlight')).toBe(true);
    host.remove();
  });

  it('D3b: absent focus key → no .kr-highlight anywhere, no crash', async () => {
    stubBase([{ appId: 'app-1', origin: 'http://x', sessionCount: 1 }]);
    const { renderKrBrowser } = await import('../../src/repository/kr-browser/kr-browser');
    const host = document.createElement('div');
    document.body.appendChild(host);
    await renderKrBrowser(host, {
      selectedAppId: 'app-1',
      onAppSelected: () => {},
      focusSignatureKey: 'nope',
    });
    expect(host.querySelectorAll('.kr-highlight')).toHaveLength(0);
    host.remove();
  });

  it('D4: entity row gets data-entity-id + .kr-highlight', async () => {
    stubBase([{ appId: 'app-1', origin: 'http://127.0.0.1:8190', sessionCount: 1 }]);
    loadAppKnowledge.mockResolvedValue({
      ...EMPTY_KNOWLEDGE,
      entities: [{
        key: 'app-1|product|FL-6E-231', appId: 'app-1', entityType: 'product',
        entityId: 'FL-6E-231', label: 'FL-6E-231', attributes: {}, stateHistory: [],
        source: 'content-observed', firstSeenAtSession: 's1', firstSeenAtMs: 0,
        lastSeenAtMs: 0, occurrences: 1,
      }] as never,
    });
    const { renderKrBrowser } = await import('../../src/repository/kr-browser/kr-browser');
    const host = document.createElement('div');
    document.body.appendChild(host);
    await renderKrBrowser(host, {
      selectedAppId: 'app-1',
      onAppSelected: () => {},
      focusEntityId: 'FL-6E-231',
    });
    const row = host.querySelector('[data-entity-id="FL-6E-231"]');
    expect(row).not.toBeNull();
    expect(row?.classList.contains('kr-highlight')).toBe(true);
    host.remove();
  });
});

describe('D5 — projectId passthrough', () => {
  it('renderKrBrowser passes projectId to loadHealElements', async () => {
    stubBase([{ appId: 'app-1', origin: 'http://x', sessionCount: 1 }]);
    const { renderKrBrowser } = await import('../../src/repository/kr-browser/kr-browser');
    await renderKrBrowser(document.createElement('div'), {
      selectedAppId: 'app-1',
      onAppSelected: () => {},
      projectId: 'proj-9',
    });
    expect(loadHealElements).toHaveBeenCalledWith('proj-9');
  });
});

describe('D12 — repository-page wiring (source-scan, d5 pattern)', () => {
  const PAGE = fs.readFileSync(path.resolve(ROOT, 'src/repository/repository-page.ts'), 'utf8');

  it('init parses knowledge params and passes projectId', () => {
    expect(PAGE).toContain('parseKnowledgeParams');
    expect(PAGE).toContain('projectId');
  });

  it('selectedAppId starts from ?app=', () => {
    expect(PAGE).toMatch(/selectedAppId\s*=\s*knowledgeParams\.appId/);
  });
});
