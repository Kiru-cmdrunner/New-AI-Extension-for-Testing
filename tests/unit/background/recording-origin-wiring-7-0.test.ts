/**
 * Phase 7.0-KR — App Identity Gate (service-worker SOURCE pins).
 *
 * Spec §6 tests 8–9 + AC-4/AC-6 wiring. The service worker cannot be
 * imported in unit tests (chrome.* top-level listeners), so — following the
 * house pattern in tests/background/race-fix-ordering.test.ts — this file
 * pins the ACTUAL wiring lines in src/background/service-worker.ts via
 * structural source assertions. Any drift in the wiring becomes loud here
 * instead of silently re-introducing the mis-stamp (panel-origin apps /
 * unrelated-tab pollution) this phase fixes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  normalizeWebOrigin,
  resolveRecordingOrigin,
} from '../../../src/understanding/persistence/recording-origin';

const SW = readFileSync('src/background/service-worker.ts', 'utf-8');

describe('service-worker wiring source pins (7.0-KR)', () => {
  const PANEL = 'chrome-extension://gndjidfncanlhlonpcabokbdhnikglpn/src/sidepanel/index.html';

  /** AC-3/AC-5 — START resolves the normalized origin and resets the slot. */
  it('START stamps recordingOrigin via resolveRecordingOrigin and nulls lastCommittedWebUrl', () => {
    expect(SW).toContain(
      "recordingOrigin = resolveRecordingOrigin({ startUrl, lastCommittedWebUrl: null });",
    );
    expect(SW).toContain('lastCommittedWebUrl = null;');
    // IR keeps the raw form: the full URL is still stamped verbatim
    expect(SW).toContain('recordingStartUrl = startUrl;');
  });

  /** AC-4 — onCommitted fallback is scope-gated AND web-origin-gated. */
  it('onCommitted writes the fallback slot ONLY for recording-scope tabs with web URLs', () => {
    // The single conditional that guards the slot write must carry BOTH gates
    expect(SW).toContain(
      'if (isRecordingScopeTab(details.tabId) && normalizeWebOrigin(details.url)) {',
    );
    // and the recovery fill is null-guarded
    expect(SW).toContain('if (recordingOrigin === null) {');
  });

  /** 7.0-KR recovery backfill — scope-proof message adopts the sender tab's own URL. */
  it('OBSERVED_EVENT backfills the origin from the sending tab’s own URL (SPA case)', () => {
    expect(SW).toContain(
      'if (_sender?.tab?.id != null && recordingOrigin === null) {',
    );
    expect(SW).toContain('chrome.tabs.get(tabId)');
    expect(SW).toContain('normalizeWebOrigin(t.url)');
  });

  /** AC-6 — stop path resolves the key and sets the honest-skip flag. */
  it('stop path passes skipKnowledgePersistence: !origin', () => {
    expect(SW).toContain('skipKnowledgePersistence: !origin,');
    expect(SW).toContain('const krOrigin = resolveRecordingOrigin({');
  });

  /** AC-5 — preload keys on the normalized origin, never the raw startUrl. */
  it('preload consumes recordingOrigin (raw startUrl no longer feeds preloadPriorKnowledge)', () => {
    expect(SW).toContain('preloadPriorKnowledge(recordingOrigin)');
    expect(SW).not.toContain('preloadPriorKnowledge(startUrl)');
  });

  /** Session hygiene — STOP clears the fallback slot for the next session. */
  it('STOP clears lastCommittedWebUrl (no cross-session pollution)', () => {
    // The clear sits in the session-cleanup tail next to stopNetworkObservation(-1)
    const tail = SW.slice(SW.indexOf('stopNetworkObservation(-1);'));
    expect(tail.indexOf('lastCommittedWebUrl = null;')).toBeGreaterThan(-1);
    expect(tail.indexOf('lastCommittedWebUrl = null;')).toBeLessThan(600);
  });

  /** AC-9 — IR path still consumes the RAW URL. */
  it('IR harvest still receives the raw startUrl', () => {
    expect(SW).toContain('harvestSessionElements(productionInteractions, startUrl)');
    expect(SW).toContain('recordingContext: {');
  });

  /** Behavioral pin — the exact panel-start recovery chain resolves. */
  it('panel START + scope-tab commit resolves to the app origin (behavioral)', () => {
    expect(
      resolveRecordingOrigin({
        startUrl: PANEL,
        lastCommittedWebUrl: 'http://127.0.0.1:8190/kr-app-identity-validation.html',
      }),
    ).toBe('http://127.0.0.1:8190');
  });

  /** Behavioral pin — unresolvable stays honest null, skip flag true. */
  it('unresolvable → null ⇒ skipKnowledgePersistence true (behavioral)', () => {
    const origin = resolveRecordingOrigin({ startUrl: PANEL, lastCommittedWebUrl: null });
    expect(origin).toBeNull();
    expect(!origin).toBe(true);
    expect(normalizeWebOrigin(PANEL)).toBeNull();
  });
});
