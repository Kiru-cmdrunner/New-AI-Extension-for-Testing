/**
 * Stage 1 — Framework Adapters
 *
 * Framework-specific role inference and wrapper detection.
 * These adapters supplement the W3C ARIA algorithm in identity-extractor.ts
 * for frameworks that use custom CSS class patterns instead of standard ARIA.
 *
 * Currently supports:
 * - OrangeHRM OXD (Orange XML Design system)
 *
 * Future adapters (MUI, Ant Design, Shoelace, Ionic, etc.) can be added
 * without touching the core identity extractor — they just register new
 * class→role mappings.
 */

// ─── OXD (OrangeHRM Design System) ──────────────────────────────────────────

/** OXD CSS classes that imply an ARIA role. */
export const OXD_CLASS_ROLE_MAP: Record<string, string> = {
  'oxd-select-text': 'combobox',
  'oxd-select-text-input': 'combobox',
  'oxd-input': 'textbox',
  'oxd-button': 'button',
  'oxd-date-input': 'textbox',
};

/** OXD wrapper classes — elements that wrap a native input (radio, checkbox). */
export const OXD_WRAPPER_CLASSES = new Set([
  'oxd-select-wrapper',
  'oxd-radio-wrapper',
  'oxd-checkbox-wrapper',
]);

/** OXD checked state class — applied when a checkbox is checked. */
export const OXD_CHECKED_CLASS = 'oxd-checkbox-checked';

/**
 * Infer an ARIA role from OXD CSS classes on an element.
 * Returns null if no OXD class matches.
 */
export function oxdInferRole(el: Element): string | null {
  const classList = (el.className || '').toString().split(/\s+/);
  for (const cls of classList) {
    if (OXD_CLASS_ROLE_MAP[cls]) return OXD_CLASS_ROLE_MAP[cls];
  }
  return null;
}

/**
 * Check if an element is an OXD wrapper (contains a native input inside).
 * Used by the label-wrapper fallback strategy in matchEvent().
 */
export function isOxdWrapper(el: Element): boolean {
  const classList = (el.className || '').toString().split(/\s+/);
  return classList.some(c => OXD_WRAPPER_CLASSES.has(c));
}
