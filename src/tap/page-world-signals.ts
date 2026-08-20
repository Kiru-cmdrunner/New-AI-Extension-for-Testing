/**
 * page-world-signals.ts — read MAIN-world dialog/window.open stamps
 *
 * Port of the legacy deterministic-recorder's readPageWorldSignals()
 * (pre-b4222a6 page-world interception block) to the Component Runtime —
 * the 2026-08-20 full-audit gap G1.
 *
 * The MAIN-world dialog-inject.js content script (manifest, world MAIN)
 * wraps window.alert/confirm/prompt/open and records JSON payloads on
 * documentElement attributes. DOM attributes are shared between MAIN and
 * ISOLATED worlds (same renderer process), so this module can read them
 * synchronously — no CustomEvent ordering involved.
 *
 * Destructive read by design (matches the legacy behavior): the
 * attributes are REMOVED on read, so the same dialog is never attributed
 * to two evidence windows. The EvidenceCollector reads at window OPEN
 * (covers dialogs fired synchronously inside the click handler before the
 * window machinery runs) and at window CLOSE (covers dialogs fired during
 * the evidence window's lifetime, e.g. from a setTimeout after the click).
 *
 * Generic across applications: no selectors, no allowlists — any page
 * calling these four browser APIs is captured identically. Strict-CSP
 * sites that somehow blocked the installer degrade silently (attributes
 * simply never appear).
 */

/** Wire shape written by public/assets/dialog-inject.js. */
interface RawDialogPayload {
  type: 'alert' | 'confirm' | 'prompt';
  message: string;
  result?: string;
}

interface RawWindowOpenPayload {
  url: string;
  target: string;
  isWindow: boolean;
}

/** Parsed page-world signals (some subset present). */
export interface PageWorldSignals {
  dialog: {
    type: 'alert' | 'confirm' | 'prompt';
    message: string;
    result: string | null;
  } | null;
  windowOpen: {
    url: string;
    target: string;
    isWindow: boolean;
  } | null;
}

/** Attribute names — must stay in sync with dialog-inject.js. */
const DIALOG_ATTR = 'data-cmdrunner-dialog';
const WINDOW_OPEN_ATTR = 'data-cmdrunner-window-open';

/**
 * Read and CLEAR the dialog + window.open stamps. Safe when document is
 * unavailable or the attributes were never written (returns empty).
 */
export function readPageWorldSignals(): PageWorldSignals {
  const signals: PageWorldSignals = { dialog: null, windowOpen: null };
  if (typeof document === 'undefined') return signals;

  const root = document.documentElement;
  if (!root) return signals;

  const dialogAttr = root.getAttribute(DIALOG_ATTR);
  if (dialogAttr !== null) {
    root.removeAttribute(DIALOG_ATTR);
    try {
      const raw = JSON.parse(dialogAttr) as RawDialogPayload;
      if (raw && typeof raw.type === 'string') {
        signals.dialog = {
          type: raw.type,
          message: typeof raw.message === 'string' ? raw.message : '',
          result: raw.result !== undefined ? String(raw.result) : null,
        };
      }
    } catch {
      // Malformed JSON — leave the signal absent, never throw.
    }
  }

  const openAttr = root.getAttribute(WINDOW_OPEN_ATTR);
  if (openAttr !== null) {
    root.removeAttribute(WINDOW_OPEN_ATTR);
    try {
      const raw = JSON.parse(openAttr) as RawWindowOpenPayload;
      if (raw && typeof raw.url === 'string') {
        signals.windowOpen = {
          url: raw.url,
          target: typeof raw.target === 'string' ? raw.target : '',
          isWindow: raw.isWindow === true,
        };
      }
    } catch {
      // Malformed JSON — skip.
    }
  }

  return signals;
}
