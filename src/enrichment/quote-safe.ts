/**
 * Quote-Safe Title — D10 (audit D11) navigation label quoting
 *
 * Page titles arrive raw from the page (document.title / chrome.tabs title)
 * and may contain — or be entirely wrapped in — double quotes. The Navigation
 * label templates wrap the title in double quotes, so any title quote nests
 * or double-wraps ("Navigate to ""Title""").
 *
 * quoteSafeTitle() makes a title safe to embed inside a double-quoted label:
 *   1. Trim whitespace (a blank title falls back to the URL label).
 *   2. Strip fully-wrapping quote pairs (""x"" -> x, "x" -> x).
 *   3. Replace remaining inner double quotes with single quotes.
 *
 * Pure, deterministic, evidence-preserving: content is never invented or
 * reordered — only quote characters are normalized for display.
 *
 * Architecture: .drytis/specs/d10-nav-label-quoting.md
 */

/**
 * Normalize a page title for embedding in a double-quoted label.
 */
export function quoteSafeTitle(raw: string): string {
  let s = raw.trim();
  // Strip fully-wrapping double-quote pairs: "x", ""x"", """"x"""" …
  while (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    const inner = s.slice(1, -1);
    // '""' unwraps to '' — stop when nothing but quotes remain paired.
    s = inner;
  }
  return s.replace(/"/g, "'");
}

/**
 * 6F-M3 O14 (E2E run-4 finding): Chrome synthesizes the tab title from the
 * URL for untitled pages — `chrome.tabs.get` at onCommitted then returns the
 * FULL query-bearing URL as `pageTitle`, and the title-first label branch
 * renders it verbatim. True when the title carries no information beyond
 * the URL (exact equality after quote-safety) — the caller should use the
 * displayUrl form instead of the quoted "title".
 */
export function isUrlDerivedTitle(title: string, url: string): boolean {
  if (title === '' || url === '') return false;
  const t = quoteSafeTitle(title);
  if (t === url) return true;
  // Chrome's synthesized pseudo-title omits the scheme ("host/path?q"),
  // so also compare against the URL with its scheme stripped.
  const schemeStripped = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  return t === schemeStripped;
}

/**
 * Display URL for panel labels — 6F-M3 O14.
 *
 * When a Navigation card has no page title, the fallback label shows the
 * URL. The raw URL can carry query strings, tracking params and tokens —
 * noisy in card labels and leak-prone in screenshots. This helper keeps
 * origin + pathname only (search/hash dropped) and truncates to `maxLen`
 * characters with a single trailing ellipsis.
 *
 * Pure and honest: unparseable input is returned unchanged (never throws,
 * never invents a scheme). This is a DISPLAY form only — the machine record
 * (metadata.pageUrl, IR, KR) keeps the full raw URL.
 */
export function displayUrl(raw: string, maxLen = 60): string {
  let display = raw;
  try {
    const parsed = new URL(raw);
    // Opaque origins (about:, data:, …) serialize as the literal string
    // "null" — meaningless as a display prefix. Keep the raw string.
    if (parsed.origin && parsed.origin !== 'null') {
      display = `${parsed.origin}${parsed.pathname}`;
    }
  } catch {
    // Not a parseable absolute URL — keep the raw string.
  }
  if (display.length > maxLen) {
    return `${display.slice(0, maxLen)}…`;
  }
  return display;
}
