/**
 * nav-inject.js — MAIN-world SPA navigation observer (7.1-W1)
 *
 * Spec: .drytis/specs/phase-7-1-w1-spa-nav-inject.md
 *
 * Injected as a MAIN-world content script at document_start. Completely
 * standalone — no imports, no extension APIs (same conventions as
 * network-inject.js / dialog-inject.js).
 *
 * WHY THIS EXISTS: the ISOLATED-world EventTap also patches
 * history.pushState/replaceState, but each world has its own `history`
 * wrapper — page-world router calls (React Router, inline scripts) can
 * only be observed from the MAIN world. This script observes them and
 * notifies the ISOLATED world via a window CustomEvent, which the
 * EventTap bridge converts into the existing synthetic navigation
 * ObservedEvent.
 *
 * Communication: CustomEvent 'cmdrunner-nav' on window — CustomEvents
 * cross MAIN↔ISOLATED in the same renderer process. The ISOLATED side
 * dedups (lastKnownUrl) so a URL change observed in BOTH worlds still
 * yields exactly one synthetic event.
 *
 * Timing: performance.now() is shared between worlds (same renderer
 * process) — but this script sends NO timestamps; the ISOLATED side
 * stamps its own at emit time (event-driven, no timing rules).
 */
(function () {
  'use strict';

  // D8: signal readiness durably on the shared DOM. The CustomEvent only
  // reaches listeners attached at dispatch time; the ISOLATED-world
  // EventTap may be created later (recording starts after load). DOM
  // attributes are shared between MAIN and ISOLATED worlds.
  function markReady() {
    try {
      document.documentElement.setAttribute('data-cmdrunner-nav-ready', 'true');
    } catch (e) { /* document not ready — the event path still works */ }
    window.dispatchEvent(new CustomEvent('cmdrunner-nav-ready'));
  }

  // Guard against double-injection (content_scripts + any dynamic path).
  if (window.__cmdrunnerNavPatched) {
    markReady();
    return;
  }
  window.__cmdrunnerNavPatched = true;

  /** Track last known URL to suppress duplicate navigation notifications. */
  var lastKnownUrl = null;
  try { lastKnownUrl = location.href; } catch (e) { /* noop */ }

  // Raw references (NOT .bind copies) — restore must put the exact
  // original function objects back; apply() supplies the receiver.
  var originalPushState = history.pushState;
  var originalReplaceState = history.replaceState;
  var onPopState = null;
  var onHashChange = null;

  function notify(navType) {
    try {
      var toUrl = location.href;
      if (toUrl === lastKnownUrl) return; // suppress duplicates
      var fromUrl = lastKnownUrl;
      lastKnownUrl = toUrl;
      window.dispatchEvent(
        new CustomEvent('cmdrunner-nav', {
          detail: { navType: navType, fromUrl: fromUrl, toUrl: toUrl },
        }),
      );
    } catch (e) { /* never break the page */ }
  }

  // ── Patch History API (call-through; page behavior unchanged) ──────
  history.pushState = function patchedPushState() {
    var result = originalPushState.apply(history, arguments);
    notify('pushState');
    return result;
  };
  history.replaceState = function patchedReplaceState() {
    var result = originalReplaceState.apply(history, arguments);
    notify('replaceState');
    return result;
  };

  // ── popstate (back/forward) + hashchange (hash routers) ────────────
  onPopState = function () { notify('popstate'); };
  onHashChange = function () { notify('hashchange'); };
  window.addEventListener('popstate', onPopState);
  window.addEventListener('hashchange', onHashChange);

  // ── Restore path ───────────────────────────────────────────────────
  // Mirrors network-inject.js: the ISOLATED world (or a teardown) can
  // request restore; originals are put back and the guard cleared so a
  // later re-injection works.
  window.addEventListener('cmdrunner-nav-stop', function onNavStop() {
    window.removeEventListener('cmdrunner-nav-stop', onNavStop);
    try {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      delete window.__cmdrunnerNavPatched;
      if (onPopState) window.removeEventListener('popstate', onPopState);
      if (onHashChange) window.removeEventListener('hashchange', onHashChange);
      document.documentElement.removeAttribute('data-cmdrunner-nav-ready');
    } catch (e) { /* noop */ }
  });

  markReady();
})();
