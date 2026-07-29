/**
 * Channel E — Focus & Overlay
 *
 * Collects evidence about focus transitions and overlay/dialog tracking.
 *
 * Provenance: This logic is inspired by the existing recorder's focus/blur
 * handlers and dialog interception (alert/confirm/prompt) in
 * deterministic-recorder.ts.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceRecord } from '../../types/foundation';
import type { EvidenceChannel, ChannelCollectInput } from './evidence-channel';

// ── Focus State Helpers ──────────────────────────────────────────────────

/**
 * Check if the element is focusable (has tabindex or is a native form element).
 */
function isFocusable(el: Element): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement || el instanceof HTMLButtonElement) {
    return true;
  }
  if (el.hasAttribute('tabindex')) return true;
  if (el.getAttribute('contenteditable') === 'true') return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

/**
 * Get the focus chain from the target element up to document.body.
 *
 * Returns the ancestor chain of focusable containers.
 */
function getFocusContext(el: Element): string[] {
  const chain: string[] = [];
  let current: Element | null = el.parentElement;
  let depth = 0;
  while (current && current !== document.body && depth < 10) {
    if (isFocusable(current)) {
      const tag = current.tagName.toLowerCase();
      const role = current.getAttribute('role');
      chain.push(role ? `${tag}[role=${role}]` : tag);
    }
    current = current.parentElement;
    depth++;
  }
  return chain;
}

/**
 * Check if the element is inside an open dialog or overlay.
 */
function getOverlayContext(el: Element): { inDialog: boolean; dialogRole: string | null } {
  let current: Element | null = el.parentElement;
  while (current && current !== document.body) {
    const role = current.getAttribute('role');
    if (role === 'dialog' || role === 'alertdialog') {
      return { inDialog: true, dialogRole: role };
    }
    if (current.tagName === 'DIALOG') {
      return { inDialog: true, dialogRole: 'dialog' };
    }
    current = current.parentElement;
  }
  return { inDialog: false, dialogRole: null };
}

// ── Channel E Implementation ─────────────────────────────────────────────

export const ChannelE: EvidenceChannel = {
  channelId: 'E',
  name: 'Focus & Overlay',

  collect(input: ChannelCollectInput): EvidenceRecord[] {
    const records: EvidenceRecord[] = [];
    const { target, eventType, timestamp } = input;

    try {
      // Focus enter/exit
      if (eventType === 'focus') {
        records.push({
          channelId: 'E',
          signalType: 'focusEnter',
          timestamp,
          value: {
            tag: target.tagName,
            focusable: isFocusable(target),
          },
          confidence: 1.0,
        });
      }

      if (eventType === 'blur') {
        records.push({
          channelId: 'E',
          signalType: 'focusExit',
          timestamp,
          value: {
            tag: target.tagName,
            hadFocus: true,
          },
          confidence: 1.0,
        });
      }

      // Focus context (ancestors that are focusable containers)
      if (eventType === 'focus' || eventType === 'click') {
        const focusChain = getFocusContext(target);
        if (focusChain.length > 0) {
          records.push({
            channelId: 'E',
            signalType: 'focusDuration',
            timestamp,
            value: { focusChain },
            confidence: 0.8,
          });
        }
      }

      // Overlay/dialog context
      const overlay = getOverlayContext(target);
      if (overlay.inDialog) {
        records.push({
          channelId: 'E',
          signalType: 'overlayOpen',
          timestamp,
          value: { dialogRole: overlay.dialogRole },
          confidence: 0.9,
        });
      }

      // Dialog open/close detection from aria-expanded
      if (eventType === 'click') {
        const hasPopup = target.getAttribute('aria-haspopup');
        const expanded = target.getAttribute('aria-expanded');
        if (hasPopup && expanded === 'true') {
          records.push({
            channelId: 'E',
            signalType: 'overlayOpen',
            timestamp,
            value: {
              triggerElement: target.tagName,
              popupType: hasPopup,
            },
            confidence: 0.8,
          });
        }
        if (hasPopup && expanded === 'false') {
          records.push({
            channelId: 'E',
            signalType: 'overlayClose',
            timestamp,
            value: {
              triggerElement: target.tagName,
              popupType: hasPopup,
            },
            confidence: 0.8,
          });
        }
      }

      // Tabindex tracking
      const tabindex = target.getAttribute('tabindex');
      if (tabindex !== null) {
        records.push({
          channelId: 'E',
          signalType: 'focusEnter',
          timestamp,
          value: { tabindex: parseInt(tabindex, 10) },
          confidence: 0.5,
        });
      }
    } catch {
      // Non-fatal
    }

    return records;
  },
};
