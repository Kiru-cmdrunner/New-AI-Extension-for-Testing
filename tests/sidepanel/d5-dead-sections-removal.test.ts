/**
 * D5 — Dead UI Sections Removal (side panel)
 *
 * Regression tests for the approved D5 cleanup:
 *  1. The four dead stopped-view sections (Raw Event Timeline,
 *     Capability Analysis residue, Element Healing, Replay JSON) are gone
 *     from index.html — no ids, no visible title strings.
 *  2. All live stopped-view sections remain untouched.
 *  3. Source-level: nothing in src/ references timeline-renderer or the
 *     orphaned storage keys REPLAY_JSON / ELEMENT_HEAL_RESULT; the dead
 *     module file is deleted.
 *  4. healing-service.ts survives untouched (live infrastructure awaiting
 *     D3 wiring — explicitly out of D5 scope).
 *
 * HTML scans read the real src/sidepanel/index.html; source scans read
 * the src/ tree via fs. Spec: .drytis/specs/d5-dead-sections-removal.md
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

// ── Section 1: dead sections gone from index.html ──────────

describe('D5: dead sections removed from index.html', () => {
  const html = fs.readFileSync(
    path.resolve(ROOT, 'src/sidepanel/index.html'),
    'utf8',
  );

  const DEAD_IDS = [
    'stopped-timeline',
    'raw-events-toggle',
    'stopped-timeline-events',
    'capability-records-section',
    'capability-records-count',
    'capability-records-list',
    'healing-status-section',
    'healing-status-body',
    'replay-section',
    'replay-toggle',
    'replay-code',
  ];

  it.each(DEAD_IDS)('index.html has no element with id="%s"', (id) => {
    expect(html).not.toContain(`id="${id}"`);
  });

  const DEAD_TITLES = [
    'Raw Event Timeline',
    'Capability Analysis',
    'Element Healing',
    'Replay JSON',
  ];

  it.each(DEAD_TITLES)('index.html has no visible text "%s"', (title) => {
    expect(html).not.toContain(title);
  });
});

// ── Section 2: live sections still present ─────────────────

describe('D5: live stopped-view sections untouched', () => {
  const html = fs.readFileSync(
    path.resolve(ROOT, 'src/sidepanel/index.html'),
    'utf8',
  );

  const LIVE_IDS = [
    'detected-interactions-section',
    'detected-interactions-list',
    'detected-interactions-count',
    'ir-steps-section',
    'ir-steps-list',
    'ir-steps-count',
    'ir-playwright-section',
    'ir-files-list',
    'ir-files-count',
    'repo-status-section',
    'repo-status-body',
    'execution-section',
    'execution-body',
    'execution-running-section',
    'run-test-btn',
    'recording-interactions',
    'recording-interactions-list',
    'recording-interactions-count',
  ];

  it.each(LIVE_IDS)('index.html still has element id="%s"', (id) => {
    expect(html).toContain(`id="${id}"`);
  });

  it('live section titles are unchanged', () => {
    expect(html).toContain('Observed Workflow');
    expect(html).toContain('IR Plan — Test Steps');
    expect(html).toContain('IR Playwright Project');
    expect(html).toContain('Repository');
    expect(html).toContain('Execution');
    expect(html).toContain('Captured Steps');
  });
});

// ── Section 3: source-level orphan scan ────────────────────

describe('D5: source-level orphan scan', () => {
  function listTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...listTsFiles(full));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  const srcFiles = listTsFiles(path.join(ROOT, 'src'));

  it('timeline-renderer.ts module file is deleted', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/sidepanel/timeline-renderer.ts'))).toBe(false);
  });

  it('no src/ file imports timeline-renderer', () => {
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content, `${file} must not import timeline-renderer`).not.toMatch(
        /['"].*timeline-renderer['"]/,
      );
    }
  });

  it('no src/ file references StorageKeys.REPLAY_JSON or ELEMENT_HEAL_RESULT', () => {
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content, `${file} must not reference REPLAY_JSON`).not.toContain('REPLAY_JSON');
      expect(content, `${file} must not reference ELEMENT_HEAL_RESULT`).not.toContain(
        'ELEMENT_HEAL_RESULT',
      );
    }
  });

  it('no src/ file references the raw storage key strings', () => {
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content, `${file} must not contain 'replay_json'`).not.toContain("'replay_json'");
      expect(content, `${file} must not contain 'element_heal_result'`).not.toContain(
        "'element_heal_result'",
      );
    }
  });

  it('sidepanel.ts has no dead DOM refs or dead loaders', () => {
    const ts = fs.readFileSync(path.join(ROOT, 'src/sidepanel/sidepanel.ts'), 'utf8');
    for (const token of [
      'stopped-timeline-events',
      'raw-events-toggle',
      'replay-toggle',
      'replay-section',
      'replay-code',
      'healing-status-section',
      'healing-status-body',
      'loadReplayJson',
      'loadHealingSummary',
      'renderHealingSummary',
      'HealingSummary',
      'ReplayJson',
    ]) {
      expect(ts, `sidepanel.ts must not contain ${token}`).not.toContain(token);
    }
  });
});

// ── Section 4: healing service survives untouched ──────────

describe('D5: healing-service kept (out of scope)', () => {
  it('healing-service.ts still exists and exports healFromRecording', () => {
    const svc = fs.readFileSync(
      path.join(ROOT, 'src/repository/services/healing-service.ts'),
      'utf8',
    );
    expect(svc).toContain('export async function healFromRecording');
  });

  it('healing-service.test.ts still exists', () => {
    expect(
      fs.existsSync(path.join(ROOT, 'tests/healing-service.test.ts')),
    ).toBe(true);
  });
});
