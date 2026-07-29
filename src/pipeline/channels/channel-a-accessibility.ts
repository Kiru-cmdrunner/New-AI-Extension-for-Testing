/**
 * Channel A — Accessibility
 *
 * Collects ARIA roles, ARIA states, accessible name, and landmark information.
 *
 * This channel is the accessibility layer of the evidence pipeline. It reads
 * the DOM element's ARIA attributes and computes its accessible name to
 * produce structured evidence for the recognition pipeline.
 *
 * Provenance: This logic is extracted from the existing recorder's
 * `extractIdentity()` and `captureDomContext()` functions in
 * deterministic-recorder.ts (lines 670-714, 974-1028).
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceRecord } from '../../types/foundation';
import type { EvidenceChannel, ChannelCollectInput } from './evidence-channel';

// ── Helper: get implicit/explicit ARIA role ──────────────────────────────

/**
 * Implicit ARIA roles for HTML elements.
 *
 * Based on the ARIA in HTML spec. Elements not listed here have no
 * implicit role (null). This is the same mapping used by the existing
 * recorder's getImplicitRole() function.
 */
const IMPLICIT_ROLES: Record<string, string | undefined> = {
  a: 'link',
  button: 'button',
  h1: 'heading', h2: 'heading', h3: 'heading',
  h4: 'heading', h5: 'heading', h6: 'heading',
  img: 'img',
  input: 'textbox', // overridden by type below
  nav: 'navigation',
  main: 'main',
  aside: 'complementary',
  header: 'banner',
  footer: 'contentinfo',
  section: 'region',
  article: 'article',
  form: 'form',
  search: 'search',
  select: 'listbox',
  textarea: 'textbox',
  option: 'option',
  ul: 'list', ol: 'list',
  li: 'listitem',
  table: 'table',
  tr: 'row',
  td: 'cell', th: 'rowheader',
  dialog: 'dialog',
  summary: 'button',
  details: 'group',
  fieldset: 'group',
  legend: 'legend',
  datalist: 'listbox',
  output: 'status',
  progress: 'progressbar',
  meter: 'meter',
  menu: 'menu',
};

/**
 * Implicit roles for <input> elements based on the `type` attribute.
 */
const INPUT_TYPE_ROLES: Record<string, string | undefined> = {
  button: 'button',
  checkbox: 'checkbox',
  image: 'button',
  number: 'spinbutton',
  radio: 'radio',
  range: 'slider',
  reset: 'button',
  search: 'searchbox',
  submit: 'button',
  tel: 'textbox',
  text: 'textbox',
  url: 'textbox',
  email: 'textbox',
  password: 'textbox',
  date: 'textbox',
  'datetime-local': 'textbox',
  time: 'textbox',
  month: 'textbox',
  week: 'textbox',
  color: 'textbox',
  file: 'textbox',
  hidden: undefined,
};

/**
 * Get the implicit or explicit ARIA role of an element.
 *
 * Priority:
 *   1. Explicit role attribute (role="button")
 *   2. Implicit role from tag name (+ input type)
 *   3. null (no role)
 */
export function getAriaRole(el: Element): string | null {
  // Explicit role wins
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;

  // Implicit role from tag name
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
    return INPUT_TYPE_ROLES[type] ?? null;
  }
  return IMPLICIT_ROLES[tag] ?? null;
}

// ── Helper: compute accessible name ──────────────────────────────────────

/**
 * Compute the accessible name of an element.
 *
 * Priority (per ARIA naming computation, simplified):
 *   1. aria-label
 *   2. aria-labelledby (resolve referenced element's text content)
 *   3. <label> associated via for=input.id or wrapping <label>
 *   4. text content / innerText
 *   5. title attribute
 *   6. placeholder (for input/textarea)
 *
 * This is the same logic as computeAccessibleName() in the existing recorder.
 */
export function computeAccessibleName(el: Element): string {
  // 1. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  // 2. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref) {
      const text = ref.textContent?.trim() || (ref as HTMLElement).innerText?.trim();
      if (text) return text;
    }
  }

  // 3. Associated <label> (for form elements with id)
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label) {
      const text = label.textContent?.trim() || (label as HTMLElement).innerText?.trim();
      if (text) return text;
    }
  }

  // 3b. Wrapping <label>
  const parent = el.parentElement;
  if (parent && parent.tagName === 'LABEL') {
    // Clone and remove the input to get label text without the input's value
    const clone = parent.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, textarea, select').forEach(e => e.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // 4. Text content for elements that have it
  if (el instanceof HTMLElement) {
    const text = el.innerText?.trim() || el.textContent?.trim();
    if (text) return text;
  }

  // 5. title attribute
  const title = el.getAttribute('title');
  if (title && title.trim()) return title.trim();

  // 6. placeholder for inputs
  const placeholder = el.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) return placeholder.trim();

  return '';
}

// ── Helper: get ARIA state attributes ────────────────────────────────────

/**
 * Collect all ARIA state attributes from an element.
 *
 * Returns a map of attribute name → value for recognized ARIA states.
 */
export function collectAriaStates(el: Element): Record<string, string> {
  const states: Record<string, string> = {};
  const ariaStateAttrs = [
    'aria-expanded', 'aria-checked', 'aria-pressed', 'aria-selected',
    'aria-disabled', 'aria-hidden', 'aria-readonly',
    'aria-current', 'aria-busy', 'aria-invalid',
  ];
  for (const attr of ariaStateAttrs) {
    const value = el.getAttribute(attr);
    if (value !== null) {
      states[attr] = value;
    }
  }
  return states;
}

// ── Helper: detect landmark role ─────────────────────────────────────────

/**
 * Check if the element (or an ancestor) is a landmark.
 *
 * Landmarks are elements with implicit or explicit roles: navigation,
 * main, complementary, banner, contentinfo, region, search, form.
 */
export function detectLandmark(el: Element): string | null {
  const role = getAriaRole(el);
  const landmarks = new Set([
    'navigation', 'main', 'complementary', 'banner',
    'contentinfo', 'region', 'search', 'form',
  ]);
  if (role && landmarks.has(role)) return role;
  return null;
}

// ── Channel A Implementation ─────────────────────────────────────────────

export const ChannelA: EvidenceChannel = {
  channelId: 'A',
  name: 'Accessibility',

  collect(input: ChannelCollectInput): EvidenceRecord[] {
    const records: EvidenceRecord[] = [];
    const { target, timestamp } = input;

    try {
      // ARIA Role
      const role = getAriaRole(target);
      if (role) {
        records.push({
          channelId: 'A',
          signalType: 'ariaRole',
          timestamp,
          value: role,
          confidence: 1.0,
        });
      }

      // Accessible Name
      const name = computeAccessibleName(target);
      if (name) {
        records.push({
          channelId: 'A',
          signalType: 'accessibleName',
          timestamp,
          value: name,
          confidence: 1.0,
        });
      }

      // ARIA States
      const states = collectAriaStates(target);
      if (Object.keys(states).length > 0) {
        records.push({
          channelId: 'A',
          signalType: 'ariaState',
          timestamp,
          value: states,
          confidence: 1.0,
        });
      }

      // ARIA-haspopup
      const hasPopup = target.getAttribute('aria-haspopup');
      if (hasPopup) {
        records.push({
          channelId: 'A',
          signalType: 'ariaAttribute',
          timestamp,
          value: { attribute: 'aria-haspopup', value: hasPopup },
          confidence: 1.0,
        });
      }

      // ARIA-expanded (as its own signal for convenience)
      const expanded = target.getAttribute('aria-expanded');
      if (expanded !== null) {
        records.push({
          channelId: 'A',
          signalType: 'ariaAttribute',
          timestamp,
          value: { attribute: 'aria-expanded', value: expanded === 'true' },
          confidence: 1.0,
        });
      }

      // Landmark detection
      const landmark = detectLandmark(target);
      if (landmark) {
        records.push({
          channelId: 'A',
          signalType: 'landmark',
          timestamp,
          value: landmark,
          confidence: 1.0,
        });
      }
    } catch {
      // Non-fatal: return what we have
    }

    return records;
  },
};
