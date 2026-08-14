/**
 * network-inject.js — MAIN-world network interceptor
 *
 * Dynamically injected via chrome.scripting.executeScript({ world: 'MAIN' })
 * at recording start. Completely standalone — no imports, no extension APIs.
 *
 * Patches window.fetch and XMLHttpRequest.prototype.open/send in the page's
 * JS context to intercept all page-originated network requests.
 *
 * Communicates with ISOLATED-world NetworkBridge via CustomEvent on window
 * (shared between MAIN and ISOLATED worlds in the same renderer process).
 *
 * Timing: performance.now() is shared between MAIN and ISOLATED worlds
 * (same renderer process) — timing correlation is exact.
 *
 * Architecture: behavioral-evidence-model.md §6.2
 */
(function () {
  'use strict';

  // Guard against double-injection
  if (window.__cmdrunnerNetPatched) {
    window.dispatchEvent(new CustomEvent('cmdrunner-net-ready'));
    return;
  }
  window.__cmdrunnerNetPatched = true;

  // Save originals for restoration
  var originalFetch = window.fetch;
  var originalXhrOpen = XMLHttpRequest.prototype.open;
  var originalXhrSend = XMLHttpRequest.prototype.send;

  function dispatch(detail) {
    // Add resourceType if not already set
    if (!detail.resourceType) {
      detail.resourceType = 'fetch';
    }
    window.dispatchEvent(new CustomEvent('cmdrunner-net', { detail: detail }));
  }

  // ── Patch fetch ──────────────────────────────────────────────────

  window.fetch = function (input, init) {
    var url = '';
    var method = 'GET';

    if (typeof input === 'string') {
      url = input;
    } else if (input && typeof input.url === 'string') {
      url = input.url;
      method = input.method || 'GET';
    }
    if (init && init.method) {
      method = init.method;
    }

    var startTime = performance.now();

    dispatch({
      url: url,
      method: method.toUpperCase(),
      timestamp: startTime,
      phase: 'start',
      status: null,
      resourceType: 'fetch',
    });

    var promise = originalFetch.apply(this, arguments);

    promise.then(
      function (response) {
        dispatch({
          url: url,
          method: method.toUpperCase(),
          timestamp: performance.now(),
          phase: 'complete',
          status: response.status,
          resourceType: 'fetch',
        });
      },
      function () {
        dispatch({
          url: url,
          method: method.toUpperCase(),
          timestamp: performance.now(),
          phase: 'complete',
          status: 0,
          resourceType: 'fetch',
        });
      },
    );

    return promise;
  };

  // ── Patch XHR ────────────────────────────────────────────────────

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cmdrunnerMethod = (method || 'GET').toUpperCase();
    this.__cmdrunnerUrl = url || '';
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    var self = this;
    var startTime = performance.now();
    var url = self.__cmdrunnerUrl || '';
    var method = self.__cmdrunnerMethod || 'GET';

    dispatch({
      url: url,
      method: method,
      timestamp: startTime,
      phase: 'start',
      status: null,
      resourceType: 'xhr',
    });

    self.addEventListener('loadend', function () {
      dispatch({
        url: url,
        method: method,
        timestamp: performance.now(),
        phase: 'complete',
        status: self.status,
        resourceType: 'xhr',
      });
    });

    return originalXhrSend.apply(this, arguments);
  };

  // ── PerformanceObserver for navigation/resource requests ────────
  //
  // fetch/XHR patches can't see form-submit navigations or sendBeacon.
  // PerformanceObserver captures ALL requests including document navigations,
  // giving us coverage for traditional (non-SPA) apps like Amazon.
  //
  // Entries may duplicate fetch/XHR-captured requests — the ISOLATED-world
  // NetworkBridge handles deduplication by URL+method+timestamp.

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      var perfObserver = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];

          // 'navigation' entries are document loads (form submits, link
          // clicks); 'resource' entries include fetch/XHR.
          var entryType = entry.entryType;
          var resourceType = entryType === 'navigation' ? 'navigation' : 'resource';

          // DDC-1: NEVER fabricate an HTTP status from PerformanceObserver.
          // PerformanceObserver cannot read status codes. Inferring 200 from
          // transferSize fed synthetic success votes into outcome
          // determination. status: null means "completed, status unknown" —
          // the URL is still classified, but no status-derived vote fires.
          // When a fetch/XHR twin exists, the bridge drops this PO entry
          // entirely (dedup) and the real status comes from that twin.
          dispatch({
            url: entry.name,
            method: 'GET', // PO cannot read the method; dedup ignores method
            timestamp: performance.now() - (entry.duration || 0),
            phase: 'complete',
            status: null,
            resourceType: resourceType,
          });
        }
      });
      perfObserver.observe({ entryTypes: ['navigation', 'resource'] });
    } catch (e) {
      // PerformanceObserver may be unavailable in some contexts
    }
  }

  // ── Listen for stop signal from ISOLATED world ───────────────────

  function handleStop() {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalXhrOpen;
    XMLHttpRequest.prototype.send = originalXhrSend;
    if (perfObserver) {
      try { perfObserver.disconnect(); } catch (e) {}
      perfObserver = null;
    }
    delete window.__cmdrunnerNetPatched;
    window.removeEventListener('cmdrunner-net-stop', handleStop);
  }

  window.addEventListener('cmdrunner-net-stop', handleStop);

  // ── Signal ready ─────────────────────────────────────────────────

  window.dispatchEvent(new CustomEvent('cmdrunner-net-ready'));
})();
