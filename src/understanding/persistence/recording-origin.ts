/**
 * Phase 7.0-KR — App Identity Gate (pure origin resolution).
 *
 * Spec: .drytis/specs/phase-7-0-kr-app-identity.md §5.1.
 *
 * WHY: handleStartRecording stamps `recordingStartUrl = tab.url` — the FULL
 * URL of the active tab. When the side panel is the active surface (every
 * E2E harness, and a real user edge case) that is the EXTENSION URL, so the
 * understanding pipeline persists the session under a panel-origin app row
 * (proven: phase-6e-m2 / phase-6f-m2b Dexie dumps both show
 * `chrome-extension://…/src/sidepanel/index.html` as applications[0].origin).
 * When the start tab IS a web page, the full path+query string still
 * fragments the app identity per path (audit finding #3, Aug-22).
 *
 * This module is extraction-only: no heuristics, no timing, no invention.
 * It normalizes a raw URL to its web origin and picks between two stamped
 * facts (start URL vs last main-frame committed URL in recording scope).
 * Callers keep the RAW start URL for IR generation (AC-9) — only the KR
 * key-derivation input changes.
 */

/**
 * Normalize a raw URL string to a web origin (scheme + host + port).
 *
 * http/https only — `chrome-extension:`, `about:`, `file:`, `devtools:`,
 * blank, and unparseable strings all return null (honest absence).
 */
export function normalizeWebOrigin(url: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.origin;
}

/**
 * Resolve the origin a recording session should be persisted under.
 *
 * Precedence (start-tab semantics preserved):
 *   1. The START-stamped URL, when it is a web origin — a user who starts on
 *      app A and navigates elsewhere is still recording app A's session.
 *   2. The last main-frame `webNavigation.onCommitted` URL for a
 *      recording-scope tab — recovery path for panel-active starts.
 *   3. null — honest skip: the caller must NOT persist under a synthesized
 *      key. (AC-6: unresolvable origin ⇒ KR skipped with a warning.)
 *
 * Both inputs go through the same web-origin gate; an extension-URL
 * committed value can never leak into the fallback slot (AC-4).
 */
export function resolveRecordingOrigin(input: {
  startUrl: string;
  lastCommittedWebUrl: string | null;
}): string | null {
  const fromStart = normalizeWebOrigin(input.startUrl);
  if (fromStart) return fromStart;
  if (input.lastCommittedWebUrl) {
    const fromCommitted = normalizeWebOrigin(input.lastCommittedWebUrl);
    if (fromCommitted) return fromCommitted;
  }
  return null;
}
