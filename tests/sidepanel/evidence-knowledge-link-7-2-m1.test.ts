/**
 * 7.2-M1 — Evidence drilldown knowledge link (RED first).
 *
 * Spec: .drytis/specs/phase-7-2-m1-knowledge-deeplink.md §3 (D10–D11)
 *
 *  D10 entityId + installed opener → "Open in knowledge browser" link;
 *      click → opener({appId, entityId}). No opener → plain line, no link.
 *  D11 The MS-U4 placeholder string is gone from the renderer source.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  renderObservedItemDetailForTest,
  setKnowledgeLink,
} from '../../src/sidepanel/evidence-renderer';
import type { WireObservedItem } from '../../src/shared/page-content-wire';

const baseItem = (over: Partial<WireObservedItem>): WireObservedItem =>
  ({
    kind: 'entity',
    matchedSelector: 'div.product-card',
    attributes: {},
    visible: true,
    uniqueInSnapshot: true,
    entityId: 'FL-6E-231',
    entityType: 'product',
    ...over,
  }) as WireObservedItem;

describe('D10 — item detail knowledge link', () => {
  beforeEach(() => setKnowledgeLink(null));

  it('entityId + opener → link present; click → opener({appId, entityId})', () => {
    const open = vi.fn();
    setKnowledgeLink(open);
    const detail = renderObservedItemDetailForTest(baseItem({}), 'http://127.0.0.1:8190');
    expect(detail).not.toBeNull();
    const link = detail!.querySelector('.evidence-knowledge-link') as HTMLElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('Open in knowledge browser');
    link.click();
    expect(open).toHaveBeenCalledWith({
      appId: 'http://127.0.0.1:8190',
      entityId: 'FL-6E-231',
    });
  });

  it('no opener → honest absence: no link, no throw, detail still renders', () => {
    setKnowledgeLink(null);
    const detail = renderObservedItemDetailForTest(baseItem({}), 'http://127.0.0.1:8190');
    expect(detail).not.toBeNull();
    expect(detail!.querySelector('.evidence-knowledge-link')).toBeNull();
  });

  it('no entityId → no link even with opener installed', () => {
    setKnowledgeLink(vi.fn());
    const detail = renderObservedItemDetailForTest(
      baseItem({ entityId: undefined }),
      'http://127.0.0.1:8190',
    );
    expect(detail).not.toBeNull();
    expect(detail!.querySelector('.evidence-knowledge-link')).toBeNull();
  });
});

describe('D11 — MS-U4 placeholder gone (source-scan)', () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'sidepanel', 'evidence-renderer.ts'),
    'utf8',
  );

  it('no MS-U4 placeholder string anywhere', () => {
    expect(SRC).not.toContain('Knowledge browser arrives in MS-U4');
  });

  it('seam present (setKnowledgeLink export)', () => {
    expect(SRC).toContain('export function setKnowledgeLink');
  });
});

import { vi } from 'vitest';
