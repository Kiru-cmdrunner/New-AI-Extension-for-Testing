/**
 * dialog-inject.js — MAIN-world JS dialog interceptor
 *
 * Manifest content script (world: MAIN, all_frames, document_start).
 * Completely standalone — no imports, no extension APIs. Mirrors the
 * network-inject.js pattern and the page-world interception block of the
 * legacy deterministic-recorder (src/recorder/deterministic-recorder.ts,
 * pre-b4222a6) that was never ported to the Component Runtime — the
 * 2026-08-20 full-audit gap G1.
 *
 * Wraps window.alert / confirm / prompt and window.open in the page's JS
 * context. Dialogs are recorded on <html data-cmdrunner-dialog> as JSON:
 *   {type:'alert',   message:'...'}
 *   {type:'confirm', message:'...', result:'OK'|'Cancel'}
 *   {type:'prompt',  message:'...', result:<text>|'Cancelled'}
 * window.open is recorded on <html data-cmdrunner-window-open>:
 *   {url:'...', target:'...', isWindow:<popup features?>}
 *
 * DOM attributes are shared between MAIN and ISOLATED worlds (same
 * renderer process), so the ISOLATED-world EvidenceCollector can read
 * them synchronously after the click handler returns.
 *
 * MV3 lifecycle / recording gate (same as network-inject.js): this script
 * loads on EVERY document, recording or not. recorder-entry.ts sets
 * data-cmdrunner-net-active="true" on <html> while recording. When not
 * recording, patches stay installed but record NOTHING.
 *
 * NOTE on blocking dialogs under automation: alert/confirm/prompt BLOCK
 * the page's JS — the wrapper runs BEFORE the native call, so the
 * attribute is already set when the dialog opens, even though the
 * click handler does not return until the dialog is dismissed (CDP
 * Page.handleJavaScriptDialog / auto-dismiss). That ordering is what
 * makes post-click-settle reads reliable.
 */
(function () {
  'use strict';

  // Guard against double-injection.
  if (window.__cmdrunnerDialogPatched) return;
  window.__cmdrunnerDialogPatched = true;

  function recordingActive() {
    try {
      var el = document.documentElement;
      return !!(el && el.getAttribute('data-cmdrunner-net-active') === 'true');
    } catch (e) {
      return false;
    }
  }

  function stampDialog(payload) {
    try {
      document.documentElement.setAttribute(
        'data-cmdrunner-dialog',
        JSON.stringify(payload),
      );
    } catch (e) { /* DOM gone — nothing to record on */ }
  }

  var origAlert = window.alert;
  var origConfirm = window.confirm;
  var origPrompt = window.prompt;
  var origOpen = window.open;

  window.alert = function (msg) {
    if (recordingActive()) {
      stampDialog({ type: 'alert', message: String(msg) });
    }
    return origAlert.call(this, msg);
  };

  window.confirm = function (msg) {
    var result = origConfirm.call(this, msg);
    if (recordingActive()) {
      stampDialog({
        type: 'confirm',
        message: String(msg),
        result: result ? 'OK' : 'Cancel',
      });
    }
    return result;
  };

  window.prompt = function (msg, def) {
    var result = origPrompt.call(this, msg, def);
    if (recordingActive()) {
      stampDialog({
        type: 'prompt',
        message: String(msg),
        result: result === null ? 'Cancelled' : String(result),
      });
    }
    return result;
  };

  window.open = function (url, target, features) {
    var hasWindowFeatures = !!(features &&
      (features.indexOf('width') !== -1 || features.indexOf('height') !== -1));
    if (recordingActive()) {
      try {
        document.documentElement.setAttribute(
          'data-cmdrunner-window-open',
          JSON.stringify({ url: url || '', target: target || '', isWindow: hasWindowFeatures }),
        );
      } catch (e) { /* DOM gone */ }
    }
    return origOpen.call(this, url, target, features);
  };
})();
