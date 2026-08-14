/**
 * CER-5: numeric ordering for interaction IDs.
 *
 * Interaction IDs are `int-<n>` with a monotonic counter (see
 * component-runtime.ts `int-${this.interactionCounter}`). Comparing them
 * lexically breaks after 9 interactions: "int-10" < "int-9" as strings,
 * so most-recently-updated tie-breaks and any sort over IDs silently pick
 * the wrong element.
 *
 * This comparator orders IDs by their numeric suffix; IDs that do not
 * match the `int-<digits>` shape fall back to lexical order so callers
 * never see unstable ordering.
 */

/** Parse the numeric suffix of an interaction ID. Null if not numeric. */
export function interactionIdNumber(id: string): number | null {
  const m = /^int-(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/**
 * Compare two interaction IDs in true chronological order.
 * Returns negative when `a` occurred before `b`.
 */
export function compareInteractionIds(a: string, b: string): number {
  const na = interactionIdNumber(a);
  const nb = interactionIdNumber(b);
  if (na !== null && nb !== null) {
    // compare numeric part first, fall through to lexical on equal numbers
    // (defensive: duplicate suffixes should still order deterministically)
    if (na !== nb) return na - nb;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
