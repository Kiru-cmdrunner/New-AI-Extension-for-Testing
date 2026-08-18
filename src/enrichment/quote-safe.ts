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
