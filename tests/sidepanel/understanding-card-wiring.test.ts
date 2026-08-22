/**
 * MS-U3 P12 — wiring pins (source-level, established d5 pattern).
 *
 * The panel module is DOM-heavy (chrome.* at top level) — unit-importing it
 * is not viable, so wiring is pinned by scanning the real sources:
 *   - index.html carries the hidden understanding-section with a body slot.
 *   - sidepanel.ts wires load + onKeyChanged listener + record-another hide.
 *   - No writes to the knowledge DB anywhere under src/sidepanel.
 * Spec: .drytis/specs/phase-6-u3-session-understanding-card.md (P12, A5, A8).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.resolve(ROOT, 'src/sidepanel/index.html'), 'utf8');
const TS = fs.readFileSync(path.resolve(ROOT, 'src/sidepanel/sidepanel.ts'), 'utf8');

describe('P12 — MS-U3 wiring', () => {
  it('index.html has the hidden understanding section with body slot', () => {
    expect(HTML).toContain('id="understanding-section"');
    expect(HTML).toContain('id="understanding-body"');
    expect(HTML).toMatch(/id="understanding-section"[^>]*\bhidden\b/);
  });

  it('section sits between Observed Workflow and IR Plan (understanding precedes generation)', () => {
    const u = HTML.indexOf('id="understanding-section"');
    const t = HTML.indexOf('id="detected-interactions-section"');
    const ir = HTML.indexOf('id="ir-steps-section"');
    expect(t).toBeGreaterThan(-1);
    expect(u).toBeGreaterThan(t);
    expect(ir).toBeGreaterThan(u);
  });

  it('sidepanel.ts renders from understanding_result and hides on absence', () => {
    expect(TS).toContain('loadUnderstandingResult');
    expect(TS).toContain('renderSessionUnderstanding');
    expect(TS).toContain('renderUnderstandingCard');
    expect(TS.match(/understandingSection\.hidden = true/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('storage listener re-renders on late UNDERSTANDING_RESULT writes (SW writes after STOP)', () => {
    expect(TS).toContain(
      "StorageService.onKeyChanged(StorageKeys.UNDERSTANDING_RESULT"
    );
  });

  it('record-another path hides the section', () => {
    const idx = TS.indexOf('async function handleRecordAnother');
    expect(idx).toBeGreaterThan(-1);
    const tail = TS.slice(idx, idx + 2200);
    expect(tail).toContain('understandingSection.hidden = true');
  });

  it('A1 — init()/Stopped branch restores the card on panel reopen (MV3 revival)', () => {
    const stoppedIdx = TS.indexOf('uiState.recordingState === RecordingState.Stopped');
    expect(stoppedIdx).toBeGreaterThan(-1);
    const branch = TS.slice(stoppedIdx, stoppedIdx + 4200);
    expect(branch).toContain('renderSessionUnderstanding');
  });

  it('gaps lookup is read-only (where/equals/toArray only) and best-effort', () => {
    const idx = TS.indexOf('async function lookupSessionGaps');
    expect(idx).toBeGreaterThan(-1);
    const fn = TS.slice(idx, idx + 1600);
    expect(fn).toContain("where('[appId+sessionId]')");
    expect(fn).not.toMatch(/\.(put|add|bulkPut|delete|bulkDelete|update|clear)\s*\(/);
  });

  it('P8b — gaps join key is the UnderstandingResult sessionId, not repo_session_id', () => {
    // Live-probed 2026-08-22: knowledge rows are keyed by the understanding
    // sessionId; repo_session_id is a repository-v2 UUID that never matches
    // (the lookup silently returned [] for every real session).
    const idx = TS.indexOf('async function lookupSessionGaps');
    expect(idx).toBeGreaterThan(-1);
    const fn = TS.slice(idx, idx + 1800);
    expect(fn).toContain('sessionId: string');
    expect(fn).not.toContain('REPOSITORY_SESSION_ID');
    const callIdx = TS.indexOf('lookupSessionGaps(result.sessionId)');
    expect(callIdx).toBeGreaterThan(-1);
  });

  it('A5 — zero knowledge-DB writes anywhere in src/sidepanel', () => {
    const dir = path.resolve(ROOT, 'src/sidepanel');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(
        src,
        `${f} must not write to the knowledge DB`
      ).not.toMatch(/\.(put|add|bulkPut|bulkDelete|update)\s*\(\s*(gap|episode|edge|signature|session)/i);
    }
  });
});
