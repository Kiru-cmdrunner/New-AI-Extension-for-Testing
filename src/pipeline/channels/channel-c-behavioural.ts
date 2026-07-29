/**
 * Channel C — Behavioural
 *
 * Collects event sequence information, value transitions, checked-state
 * transitions, and interaction pattern signals.
 *
 * Provenance: This logic is extracted from the existing recorder's
 * event handlers in deterministic-recorder.ts:
 * - captureValue() (lines 718-746)
 * - captureCheckedState() (lines 748-781)
 * - valueTracker Map + snapshot logic
 * - Event type → interaction mapping
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceRecord } from '../../types/foundation';
import type { EvidenceChannel, ChannelCollectInput } from './evidence-channel';

// ── Helper: capture element value ────────────────────────────────────────

/**
 * Capture the current value of an element.
 *
 * Priority:
 *   1. <select> → selected option text
 *   2. <input>/<textarea> → .value
 *   3. aria-valuetext (custom sliders, spinbuttons)
 *   4. aria-valuenow (raw numeric value)
 *   5. contenteditable → innerText
 *   6. aria-selected descendant
 *   7. aria-activedescendant descendant
 *   8. undefined (no value)
 *
 * Same logic as captureValue() in the existing recorder.
 */
export function captureValue(el: Element): string | undefined {
  if (el instanceof HTMLSelectElement) {
    const option = el.options[el.selectedIndex];
    if (option) return option.text?.trim() || option.textContent?.trim() || option.value || '';
    return '';
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value ?? '';
  }
  // ARIA value for custom sliders, spinbuttons
  const ariaValueText = el.getAttribute('aria-valuetext');
  if (ariaValueText !== null) return ariaValueText;
  const ariaValueNow = el.getAttribute('aria-valuenow');
  if (ariaValueNow !== null) return ariaValueNow;
  // Contenteditable
  if (el instanceof HTMLElement && el.isContentEditable) {
    return el.innerText?.trim() || el.textContent?.trim() || '';
  }
  const selected = el.querySelector('[aria-selected="true"]');
  if (selected) return selected.textContent?.trim() || selected.getAttribute('aria-label') || '';
  const descendantId = el.getAttribute('aria-activedescendant');
  if (descendantId) {
    const option = document.getElementById(descendantId);
    if (option) return option.textContent?.trim() || option.getAttribute('aria-label') || '';
  }
  return undefined;
}

// ── Helper: capture checked state ────────────────────────────────────────

/**
 * Capture the checked/pressed/selected state of an element.
 *
 * Priority:
 *   1. Native checkbox/radio → .checked
 *   2. aria-checked attribute
 *   3. aria-pressed attribute
 *   4. CSS-class-based fallback (MUI, AntD, Bootstrap patterns)
 *
 * Same logic as captureCheckedState() in the existing recorder.
 */
export function captureCheckedState(el: Element): boolean | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
  }
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked !== null) return ariaChecked === 'true';
  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed !== null) return ariaPressed === 'true';

  // CSS-class-based fallback for custom checkboxes/switches without ARIA
  const cls = (el.getAttribute('class') || '').toLowerCase();
  if (cls) {
    if (
      cls.includes('mui-checked') ||
      cls.includes('ant-checkbox-checked') ||
      cls.includes('ant-radio-checked') ||
      cls.includes('ant-switch-checked') ||
      cls.includes('checked')
    ) {
      if (cls.includes('unchecked') || cls.includes('not-checked')) return false;
      return true;
    }
  }

  return undefined;
}

// ── Helper: capture DOM attributes ───────────────────────────────────────

/**
 * Capture semantically relevant DOM attributes (validation, type, etc.).
 */
export function captureDomAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  const validationAttrs = [
    'required', 'aria-required', 'type', 'min', 'max', 'step',
    'pattern', 'minlength', 'maxlength', 'multiple', 'accept', 'autocomplete',
  ];
  for (const attr of validationAttrs) {
    const value = el.getAttribute(attr);
    if (value !== null) {
      attrs[attr] = value;
    }
  }
  if (el instanceof HTMLInputElement) {
    if (!('type' in attrs)) {
      attrs['type'] = el.type || 'text';
    }
  }
  if (el instanceof HTMLElement && (el.isContentEditable || el.getAttribute('contenteditable') === 'true')) {
    attrs['contenteditable'] = 'true';
  }
  return attrs;
}

// ── Channel C Implementation ─────────────────────────────────────────────

export const ChannelC: EvidenceChannel = {
  channelId: 'C',
  name: 'Behavioural',

  collect(input: ChannelCollectInput): EvidenceRecord[] {
    const records: EvidenceRecord[] = [];
    const { target, eventType, timestamp, valueBefore, valueAfter, checkedBefore, checkedAfter } = input;

    try {
      // Event type / sequence
      records.push({
        channelId: 'C',
        signalType: 'eventSequence',
        timestamp,
        value: eventType,
        confidence: 1.0,
      });

      // Value transition (only if both before and after are available)
      if (valueBefore !== null || valueAfter !== null) {
        records.push({
          channelId: 'C',
          signalType: 'valueTransition',
          timestamp,
          value: {
            before: valueBefore ?? '',
            after: valueAfter ?? '',
          },
          confidence: 1.0,
        });
      }

      // Checked transition
      if (checkedBefore !== null && checkedAfter !== null) {
        records.push({
          channelId: 'C',
          signalType: 'checkedTransition',
          timestamp,
          value: {
            before: checkedBefore,
            after: checkedAfter,
            property: target instanceof HTMLInputElement &&
              (target.type === 'radio' || target.type === 'checkbox')
              ? 'checked'
              : (target.getAttribute('aria-pressed') !== null ? 'aria-pressed'
                : (target.getAttribute('aria-selected') !== null ? 'aria-selected'
                  : 'aria-checked')),
          },
          confidence: 1.0,
        });
      }

      // DOM attributes (validation constraints)
      const attrs = captureDomAttributes(target);
      if (Object.keys(attrs).length > 0) {
        records.push({
          channelId: 'C',
          signalType: 'ariaAttribute', // semantic attributes are structurally similar
          timestamp,
          value: attrs,
          confidence: 1.0,
        });
      }

      // Input type (for form elements)
      if (target instanceof HTMLInputElement) {
        records.push({
          channelId: 'C',
          signalType: 'tag',
          timestamp,
          value: { inputType: target.type || 'text' },
          confidence: 1.0,
        });
      }
    } catch {
      // Non-fatal
    }

    return records;
  },
};
