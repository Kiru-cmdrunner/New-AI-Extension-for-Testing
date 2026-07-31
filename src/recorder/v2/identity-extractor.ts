/**
 * Stage 1 — Identity Extractor
 *
 * W3C-based role inference and accessible name computation.
 * This is the foundational layer that resolves "what element did the user
 * interact with?" independent of any framework.
 *
 * Resolution order for roles:
 *   1. Explicit ARIA role attribute
 *   2. Framework adapter (e.g. OXD class→role)
 *   3. HTML input type→role mapping
 *   4. Implicit tag→role mapping
 *
 * Resolution order for accessible names (W3C ACCNAME algorithm, simplified):
 *   1. aria-label
 *   2. aria-labelledby reference
 *   3. label[for=element-id]
 *   4. Ancestor <label> walk (remove inner inputs, read remaining text)
 *   5. textContent (if < 200 chars and not placeholder text)
 *   6. title attribute
 *   7. placeholder attribute
 *   8. OXD label resolution (walk ancestors for .oxd-input-group > .oxd-label)
 *   9. OXD wrapper text content
 *  10. Group/fieldset legend
 *  11. name attribute (last resort)
 */

import { oxdInferRole, isOxdWrapper } from './framework-adapters';

// ─── Implicit Tag → Role Map ──────────────────────────────────────────────

export const IMPLICIT_ROLES: Record<string, string> = {
  a: 'link', button: 'button', nav: 'navigation', main: 'main',
  aside: 'complementary', header: 'banner', footer: 'contentinfo',
  section: 'region', article: 'article', form: 'form',
  select: 'listbox', textarea: 'textbox', option: 'option',
  ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row',
  td: 'cell', th: 'rowheader', dialog: 'dialog', summary: 'button',
  details: 'group', fieldset: 'group', legend: 'legend',
  datalist: 'listbox', img: 'img',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
};

// ─── Input Type → Role Map ──────────────────────────────────────────────────

export const INPUT_TYPE_ROLES: Record<string, string> = {
  button: 'button', checkbox: 'checkbox', image: 'button',
  number: 'spinbutton', radio: 'radio', range: 'slider',
  reset: 'button', search: 'searchbox', submit: 'button',
  tel: 'textbox', text: 'textbox', url: 'textbox', email: 'textbox',
  password: 'textbox', date: 'textbox', 'datetime-local': 'textbox',
  time: 'textbox', month: 'textbox', week: 'textbox', color: 'textbox',
  file: 'textbox',
};

// ─── Role Resolution ─────────────────────────────────────────────────────

/**
 * Resolve the ARIA role of an element using the 4-strategy cascade.
 *
 * Order: explicit ARIA > framework adapter > input type > implicit tag.
 */
export function getRole(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;

  // aria-checked implies checkbox semantics regardless of tag.
  // Amazon renders filter toggles as <a aria-checked="true"> — without
  // this check they'd be classified as Link instead of Checkbox.
  if (el.getAttribute('aria-checked') !== null) return 'checkbox';

  const oxdRole = oxdInferRole(el);
  if (oxdRole) return oxdRole;

  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
    return INPUT_TYPE_ROLES[type] || null;
  }

  return IMPLICIT_ROLES[tag] || null;
}

// ─── Placeholder Detection ───────────────────────────────────────────────

/**
 * Detect placeholder text in dropdown options.
 * Returns true for common placeholder patterns like "-- Select --".
 */
export function isPlaceholderText(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return lower === '-- select --' || lower.startsWith('--') ||
    lower === 'select...' || lower === 'please select' || lower === 'choose...';
}

// ─── Accessible Name Computation ──────────────────────────────────────────

/**
 * Compute the accessible name of an element using the W3C ACCNAME algorithm
 * (simplified) with framework-specific fallbacks for OXD.
 *
 * This is the function that ensures "Nationality" resolves to "Nationality"
 * and not "Blood Type" — it reads the correct label from the correct DOM
 * position in the OXD component structure.
 */
export function getAccessibleName(el: Element): string {
  // 1. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim();

  // 2. aria-labelledby reference
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref?.textContent?.trim()) return ref.textContent.trim();
  }

  // 3. label[for=element-id]
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  // 4. Walk ancestors for <label> (up to 5 levels)
  let ancestor: Element | null = el.parentElement;
  for (let i = 0; i < 5 && ancestor; i++) {
    if (ancestor.tagName === 'LABEL') {
      const clone = ancestor.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input,textarea,select').forEach(e => e.remove());
      const text = clone.textContent?.trim();
      if (text) return text;
    }
    ancestor = ancestor.parentElement;
  }

  // 5. textContent (for option/li elements, always keep; for others, filter placeholder)
  const text = el.textContent?.trim() || '';
  if (el.getAttribute('role') === 'option' || el.tagName.toLowerCase() === 'option' ||
      el.tagName.toLowerCase() === 'li') {
    if (text && text.length < 200) return text;
  }
  if (text && text.length < 200 && !isPlaceholderText(text)) return text;

  // 6. title attribute
  const title = el.getAttribute('title');
  if (title?.trim()) return title.trim();

  // 7. placeholder attribute
  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) return placeholder.trim();

  // 8. OXD label resolution — walk up to 8 ancestors
  let node: Element | null = el.parentElement;
  for (let i = 0; i < 8 && node; i++) {
    const classes = (node.className || '').toString();
    if (classes.includes('oxd-input-group')) {
      const oxdLabel = node.querySelector('.oxd-label');
      if (oxdLabel?.textContent?.trim()) return oxdLabel.textContent.trim();
    }
    if (isOxdWrapper(node)) {
      const wrapperText = node.textContent?.trim();
      if (wrapperText && !isPlaceholderText(wrapperText)) return wrapperText;
    }
    if (node.getAttribute('role') === 'group' || node.tagName === 'FIELDSET') {
      const legend = node.querySelector('legend, .oxd-label');
      if (legend?.textContent?.trim()) return legend.textContent.trim();
    }
    node = node.parentElement;
  }

  // 9. name attribute (last resort)
  const nameAttr = el.getAttribute('name');
  if (nameAttr?.trim()) return nameAttr.trim();

  return '';
}
