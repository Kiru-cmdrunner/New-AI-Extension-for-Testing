/**
 * 7.2-M1 — KR chip becomes a deep-link button (RED first).
 *
 * Spec: .drytis/specs/phase-7-2-m1-knowledge-deeplink.md §3 (D6–D9)
 *
 *  D6  attach renders a <button> carrying data-app-id / data-signature-key,
 *      text/tone unchanged vs shipped expectations.
 *  D7  click → injected knowledge opener called with {appId, signatureKey};
 *      opener null → chip inert, no throw (honest degradation).
 *  D8  Enter / Space keydown → opener called (native button + explicit pin).
 *  D9  idempotence preserved (second attach is a no-op).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setKrLookup,
  setKnowledgeOpen,
  type KrChipResult,
} from '../../src/sidepanel/kr-chip';

function cardWith(id: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'interaction-event';
  const idEl = document.createElement('span');
  idEl.className = 'timeline-event__id';
  idEl.textContent = id;
  card.appendChild(idEl);
  // attachKrChips only renders into connected cards (shipped guard).
  document.body.appendChild(card);
  return card;
}

function cleanupCards(): void {
  for (const el of document.querySelectorAll('.interaction-event')) el.remove();
}

const CHIP: KrChipResult = {
  text: '◆ reinforced ×5 · first seen s-1',
  tone: 'reinforced',
  appId: 'http://127.0.0.1:8190',
  signatureKey: 'app-1:Click:btn',
};

describe('D6 — chip renders as button with link data', () => {
  beforeEach(() => { setKnowledgeOpen(null); cleanupCards(); });

  it('attachKrChips renders <button class="interaction-chip--kr"> with data attrs', async () => {
    setKrLookup(async () => new Map([['int-1', CHIP]]));
    const { attachKrChips } = await import('../../src/sidepanel/kr-chip');
    const card = cardWith('int-1');
    await attachKrChips(new Map([['int-1', card]]));
    const btn = card.querySelector('.interaction-chip--kr');
    expect(btn).not.toBeNull();
    expect(btn?.tagName).toBe('BUTTON');
    expect((btn as HTMLElement).dataset.appId).toBe('http://127.0.0.1:8190');
    expect((btn as HTMLElement).dataset.signatureKey).toBe('app-1:Click:btn');
    expect(btn?.textContent).toBe('◆ reinforced ×5 · first seen s-1');
  });

  it('tone class behavior preserved (has-kr-new on new)', async () => {
    setKrLookup(async () => new Map([['int-1', { ...CHIP, text: '◆ new signature', tone: 'new' }]]));
    const { attachKrChips } = await import('../../src/sidepanel/kr-chip');
    const card = cardWith('int-1');
    await attachKrChips(new Map([['int-1', card]]));
    expect(card.classList.contains('has-kr-new')).toBe(true);
  });
});

describe('D7 — click opens the knowledge browser', () => {
  beforeEach(() => { setKnowledgeOpen(null); cleanupCards(); });

  it('click → opener called with appId + signatureKey', async () => {
    const open = vi.fn();
    setKnowledgeOpen(open);
    setKrLookup(async () => new Map([['int-1', CHIP]]));
    const { attachKrChips } = await import('../../src/sidepanel/kr-chip');
    const card = cardWith('int-1');
    await attachKrChips(new Map([['int-1', card]]));
    (card.querySelector('.interaction-chip--kr') as HTMLElement).click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ appId: 'http://127.0.0.1:8190', signatureKey: 'app-1:Click:btn' });
  });

  it('no opener installed → chip renders but is inert (no throw)', async () => {
    setKnowledgeOpen(null);
    setKrLookup(async () => new Map([['int-1', CHIP]]));
    const { attachKrChips } = await import('../../src/sidepanel/kr-chip');
    const card = cardWith('int-1');
    await attachKrChips(new Map([['int-1', card]]));
    expect(card.querySelector('.interaction-chip--kr')).not.toBeNull();
    expect(() => (card.querySelector('.interaction-chip--kr') as HTMLElement).click()).not.toThrow();
  });

  it('chip WITHOUT link data (appId/signatureKey absent) → plain span, still no throw', async () => {
    setKnowledgeOpen(vi.fn());
    setKrLookup(async () => new Map([['int-2', { text: '◆ new signature', tone: 'new' }]]));
    const { attachKrChips } = await import('../../src/sidepanel/kr-chip');
    const card = cardWith('int-2');
    await attachKrChips(new Map([['int-2', card]]));
    const el = card.querySelector('.interaction-chip--kr') as HTMLElement;
    expect(el).not.toBeNull();
    expect(() => el.click()).not.toThrow();
  });
});

describe('D8 — keyboard activation', () => {
  it('Enter keydown → opener called', async () => {
    const open = vi.fn();
    setKnowledgeOpen(open);
    setKrLookup(async () => new Map([['int-1', CHIP]]));
    const { attachKrChips } = await import('../../src/sidepanel/kr-chip');
    const card = cardWith('int-1');
    await attachKrChips(new Map([['int-1', card]]));
    const btn = card.querySelector('.interaction-chip--kr') as HTMLElement;
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(open).toHaveBeenCalled();
  });

  it('Space keydown → opener called', async () => {
    const open = vi.fn();
    setKnowledgeOpen(open);
    setKrLookup(async () => new Map([['int-1', CHIP]]));
    const { attachKrChips } = await import('../../src/sidepanel/kr-chip');
    const card = cardWith('int-1');
    await attachKrChips(new Map([['int-1', card]]));
    const btn = card.querySelector('.interaction-chip--kr') as HTMLElement;
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(open).toHaveBeenCalled();
  });
});

describe('D9 — idempotence', () => {
  it('second attach adds no second chip', async () => {
    setKnowledgeOpen(null);
    setKrLookup(async () => new Map([['int-1', CHIP]]));
    const { attachKrChips } = await import('../../src/sidepanel/kr-chip');
    const card = cardWith('int-1');
    await attachKrChips(new Map([['int-1', card]]));
    await attachKrChips(new Map([['int-1', card]]));
    expect(card.querySelectorAll('.interaction-chip--kr')).toHaveLength(1);
  });
});
