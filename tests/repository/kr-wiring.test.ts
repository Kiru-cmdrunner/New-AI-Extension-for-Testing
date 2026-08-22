/**
 * MS-U4 pins — wiring (source-scan, established d5 pattern) + read-only
 * guarantees for the KR browser.
 *
 * Spec: .drytis/specs/phase-6-u4-kr-browser.md (§6 P8–P11, A2, A13).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.resolve(ROOT, 'src/repository/index.html'), 'utf8');
const PAGE = fs.readFileSync(path.resolve(ROOT, 'src/repository/repository-page.ts'), 'utf8');
const KR_DATA = fs.readFileSync(path.resolve(ROOT, 'src/repository/kr-browser/kr-data.ts'), 'utf8');
const KR_BROWSER = fs.readFileSync(
  path.resolve(ROOT, 'src/repository/kr-browser/kr-browser.ts'),
  'utf8',
);
const KR_DIR = path.resolve(ROOT, 'src/repository/kr-browser');

describe('P9 — Knowledge tab wiring (A2)', () => {
  it('tab bar is Knowledge | Elements | Classic Tree, Knowledge default-active', () => {
    expect(HTML).toContain('data-view="knowledge"');
    expect(HTML).toContain('data-view="elements"');
    expect(HTML).toContain('data-view="classic"');
    const knowledgeIdx = HTML.indexOf('data-view="knowledge"');
    const elementsIdx = HTML.indexOf('data-view="elements"');
    expect(knowledgeIdx).toBeLessThan(elementsIdx);
    // default-active class on the knowledge tab
    const tabMatch = HTML.match(/class="view-tab view-tab--active" data-view="knowledge"/);
    expect(tabMatch).not.toBeNull();
  });

  it('knowledge-view main exists; capabilities DOM fully removed', () => {
    expect(HTML).toContain('id="knowledge-view"');
    expect(HTML).not.toContain('capabilities-view');
    expect(HTML).not.toContain('data-view="capabilities"');
    expect(HTML).not.toContain('capability-list');
    expect(HTML).not.toContain('cap-empty');
    expect(PAGE).not.toContain('capabilities');
  });

  it('repository-page.ts dispatches to renderKrBrowser on the knowledge view', () => {
    expect(PAGE).toContain('renderKrBrowser');
    expect(PAGE).toContain("'knowledge'");
  });
});

describe('P8 — appId-scoped reads (MS-U3 join-key lesson)', () => {
  it('kr-data.ts NEVER references REPOSITORY_SESSION_ID / repo_session_id', () => {
    expect(KR_DATA).not.toContain('REPOSITORY_SESSION_ID');
    expect(KR_DATA).not.toContain('repo_session_id');
  });

  it('kr-data.ts scopes every read by appId (no unscoped toArray of knowledge tables)', () => {
    // Every db.knowledgeX / db.applications read must be preceded by a
    // .where('appId') or live inside KnowledgeRepository methods (listApplications).
    expect(KR_DATA).toContain('KnowledgeRepository');
    expect(KR_DATA).toContain('createKnowledgeDatabase');
    // raw unscoped bulk reads are forbidden:
    expect(KR_DATA).not.toMatch(/db\.knowledge\w+\.toArray\(\)/);
  });
});

describe('P11 — zero KR writes anywhere in the kr modules', () => {
  const files = fs.readdirSync(KR_DIR).filter((f) => f.endsWith('.ts'));
  it('kr-browser dir is non-empty', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });
  for (const f of files) {
    it(`${f}: no write/delete/clear calls on knowledge tables`, () => {
      const src = fs.readFileSync(path.join(KR_DIR, f), 'utf8');
      expect(
        src,
        `${f} must not write to the KR`
      ).not.toMatch(/\.(bulkPut|bulkDelete|bulkAdd)\s*\(/);
      expect(src).not.toMatch(/db\.\w+\.(put|add|delete|update|clear)\s*\(/);
    });
  }
  it('repository-page.ts adds no KR write paths', () => {
    expect(PAGE).not.toMatch(/db\.knowledge\w+\.(put|add|delete|update|clear)\s*\(/);
  });
});

describe('P10 — API-seed adapter is read-only', () => {
  it('seed evidence adapter only reads (getBySession + episode-derived join)', () => {
    expect(KR_DATA).toContain('buildSeedEvidenceAccess');
    expect(KR_DATA).toContain('getBySession');
    expect(KR_DATA).toContain('getInteractionEventIds');
    expect(KR_DATA).not.toMatch(/behavioralEvidence\.(put|add|delete|update|clear)\s*\(/);
  });

  it('listApiSeeds is the frozen contract query (no new derivation in kr modules)', () => {
    expect(KR_DATA).toContain('listApiSeeds');
    // and kr-browser.ts renders seeds, never derives them
    expect(KR_BROWSER).toContain('renderApiSeedsSection');
    expect(KR_BROWSER).not.toContain('deriveSessionSeeds');
  });
});

describe('A13 — renderer-only diff surface', () => {
  it('kr modules import only read-side understanding/repository pieces', () => {
    const imports = [...KR_DATA.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const imp of imports) {
      // allowed: understanding persistence read types/repo, contract read
      // queries, repository v2 read repo, relative kr modules
      expect(
        imp.startsWith('../../understanding/') ||
          imp.startsWith('../v2/') ||
          imp.startsWith('./'),
        `unexpected import: ${imp}`
      ).toBe(true);
    }
  });

  it('kr-browser.ts has no Dexie IMPORT (renderer purity; comments exempt)', () => {
    // import statement check — a bare mention in a comment is fine, an
    // actual import (which would couple the renderer to IndexedDB) is not.
    expect(KR_BROWSER).not.toMatch(/import[^;]*from\s+'[^']*dexie[^']*'/);
    expect(KR_BROWSER).not.toMatch(/import\s+'dexie'/);
  });
});
