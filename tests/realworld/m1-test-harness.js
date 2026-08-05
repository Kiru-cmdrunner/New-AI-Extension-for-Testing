/**
 * M1 Real-World Test Harness
 *
 * Injects the actual M1 observation pipeline (ElementStateCache,
 * DocumentObserver, ObservationCoordinator, state-cache-listeners)
 * into real web pages, simulates the EventTap onAfterEvent integration,
 * and collects ObservationResults for inspection.
 *
 * This tests the EXACT observation logic against real DOM, real event
 * sequences, and real component architectures.
 */

// ── ElementStateCache (from src/tap/element-state-cache.ts) ──────────
class ElementStateCache {
  constructor() { this.map = new WeakMap(); }

  capture(el) {
    const snap = this.readState(el);
    this.map.set(el, snap);
    return snap;
  }

  peek(el) { return this.map.get(el) ?? null; }

  read(el) { return this.readState(el); }

  clear() { this.map = new WeakMap(); }

  readState(el) {
    const isInput = el instanceof HTMLInputElement;
    const isSelect = el instanceof HTMLSelectElement;
    const htmlEl = el;
    return {
      value: this.readValue(isInput, isSelect, el),
      checked: this.readChecked(isInput, el),
      className: el.getAttribute('class') ?? '',
      disabled: htmlEl.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
      ariaExpanded: this.readBooleanAttr(el, 'aria-expanded'),
      ariaChecked: this.readBooleanAttr(el, 'aria-checked'),
      ariaPressed: this.readBooleanAttr(el, 'aria-pressed'),
      textContent: this.readTruncatedText(el),
      childCount: el.children.length,
      capturedAt: Date.now(),
    };
  }

  readValue(isInput, isSelect, el) {
    if (isInput) return el.value ?? null;
    if (isSelect) return el.value ?? null;
    return null;
  }

  readChecked(isInput, el) {
    if (isInput) {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    }
    const ac = this.readBooleanAttr(el, 'aria-checked');
    if (ac !== null) return ac;
    return this.readBooleanAttr(el, 'aria-pressed');
  }

  readBooleanAttr(el, name) {
    const val = el.getAttribute(name);
    if (val === null) return null;
    return val === 'true';
  }

  readTruncatedText(el) {
    const text = el.textContent ?? '';
    return text.length > 0 ? text.substring(0, 200) : null;
  }
}

// ── DocumentObserver (from src/tap/document-observer.ts) ─────────────
class DocumentObserver {
  constructor() {
    this.observer = null;
    this.refCount = 0;
    this.activeWindowIds = new Set();
    this.records = [];
    this.nextId = 1;
    this.pathCache = new WeakMap();
    this.performanceCondition = null;
    this.CPU_THRESHOLD_MS = 15;
  }

  start(windowId) {
    this.activeWindowIds.add(windowId);
    this.refCount++;
    if (this.refCount === 1) this._connect();
  }

  stop(windowId) {
    if (!this.activeWindowIds.has(windowId)) return;
    this.activeWindowIds.delete(windowId);
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) this._disconnect();
  }

  _connect() {
    this.observer = new MutationObserver((mutations) => this._callback(mutations));
    this.observer.observe(document.body, {
      childList: true, attributes: true, characterData: true, subtree: true,
      attributeOldValue: true, characterDataOldValue: true,
    });
  }

  _disconnect() {
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
  }

  _callback(mutations) {
    const start = performance.now();
    const active = [...this.activeWindowIds];
    if (active.length === 0) return;

    for (const m of mutations) {
      this.records.push(this._compact(m, active));
    }

    const duration = performance.now() - start;
    if (duration > this.CPU_THRESHOLD_MS && this.records.length > 0) {
      this.performanceCondition = {
        batchRecordCount: mutations.length,
        batchDurationMs: duration,
        timestamp: performance.now(),
      };
    }
  }

  _compact(m, windowIds) {
    const target = m.target;
    let record = {
      id: this.nextId++,
      type: m.type,
      targetPath: this._computePath(target),
      targetTag: target.tagName ?? '',
      attributeName: m.attributeName ?? null,
      oldValue: m.oldValue ?? null,
      newValue: this._readNewValue(m),
      addedNodesCount: m.addedNodes ? m.addedNodes.length : 0,
      removedNodesCount: m.removedNodes ? m.removedNodes.length : 0,
      timestamp: performance.now(),
      windowIds: [...windowIds],
    };
    return record;
  }

  _readNewValue(m) {
    if (m.type === 'attributes' && m.attributeName) {
      return m.target.getAttribute(m.attributeName);
    }
    if (m.type === 'characterData') {
      return m.target.textContent;
    }
    return null;
  }

  _computePath(el) {
    if (!el) return 'unknown';
    const cached = this.pathCache.get(el);
    if (cached) return cached;

    const parts = [];
    let current = el;
    let depth = 0;
    while (current && current !== document.body && current !== document.documentElement && depth < 20) {
      const tag = current.tagName ? current.tagName.toLowerCase() : 'unknown';
      const parent = current.parentElement;
      if (!parent) break;
      const sameTag = Array.from(parent.children).filter(s => s.tagName === current.tagName);
      if (sameTag.length === 1) parts.unshift(tag);
      else parts.unshift(`${tag}:nth-of-type(${sameTag.indexOf(current) + 1})`);
      current = parent;
      depth++;
    }
    const path = parts.length > 0 ? `body > ${parts.join(' > ')}` : 'body';
    this.pathCache.set(el, path);
    return path;
  }

  getRecordsForWindow(windowId) {
    return this.records
      .filter(r => r.windowIds.includes(windowId))
      .map(r => ({ ...r, windowIds: [...r.windowIds] }));
  }

  getTotalRecordsDuringWindow(windowId) {
    return this.records.filter(r => r.windowIds.includes(windowId)).length;
  }

  pruneWindowRecords(windowId) {
    this.records = this.records.filter(r => {
      if (!r.windowIds.includes(windowId)) return true;
      if (r.windowIds.length === 1) return false;
      r.windowIds = r.windowIds.filter(id => id !== windowId);
      return true;
    });
  }

  getPerformanceCondition() { return this.performanceCondition; }

  reset() {
    this._disconnect();
    this.refCount = 0;
    this.activeWindowIds.clear();
    this.records = [];
    this.performanceCondition = null;
  }
}

// ── ObservationCoordinator (from src/tap/observation-coordinator.ts) ─
class ObservationCoordinator {
  constructor() {
    this.cache = null; this.observer = null; this.onResultCb = null;
    this.windowDurationMs = 3000;
    this.windows = new Map();
    this.timers = new Map();
    this.targetElements = new Map();
    this.results = [];
  }

  configure(config) {
    this.cache = config.cache;
    this.observer = config.observer;
    this.onResultCb = config.onResult;
    this.windowDurationMs = config.windowDurationMs ?? 3000;
  }

  openWindow(eventId, eventType, targetEl) {
    if (!this.cache || !this.observer || !this.onResultCb) return;
    const windowId = `obs-${eventId}`;
    const now = performance.now();
    const beforeSnapshot = this.cache.peek(targetEl);
    this.cache.capture(targetEl);

    const win = {
      windowId, sourceEventId: eventId, sourceEventType: eventType,
      sourceElementPath: this._computePath(targetEl),
      openedAt: now, closedAt: null, endReason: null,
      beforeSnapshot, finalSnapshot: null,
    };
    this.windows.set(windowId, win);
    this.targetElements.set(windowId, new WeakRef(targetEl));
    this.observer.start(windowId);

    const timer = setTimeout(() => this.closeWindow(windowId, 'completed'), this.windowDurationMs);
    this.timers.set(windowId, timer);
  }

  shutdown() {
    const openIds = [...this.windows.keys()];
    for (const id of openIds) this.closeWindow(id, 'recording-stopped');
    this.cache = null; this.observer = null; this.onResultCb = null;
  }

  closeWindow(windowId, reason) {
    const win = this.windows.get(windowId);
    if (!win) return;
    if (!this.cache || !this.observer || !this.onResultCb) return;

    const now = performance.now();
    const timer = this.timers.get(windowId);
    if (timer) { clearTimeout(timer); this.timers.delete(windowId); }

    const ref = this.targetElements.get(windowId);
    let finalSnapshot = null;
    let actualReason = reason;
    if (ref) {
      const el = ref.deref();
      if (el && document.contains(el)) finalSnapshot = this.cache.read(el);
      else actualReason = 'element-removed';
      this.targetElements.delete(windowId);
    }

    const mutations = this.observer.getRecordsForWindow(windowId);
    const mutationCount = mutations.length;
    const docWideTotal = this.observer.getTotalRecordsDuringWindow(windowId);
    this.observer.pruneWindowRecords(windowId);
    this.observer.stop(windowId);

    const result = {
      sourceEventId: win.sourceEventId,
      sourceEventType: win.sourceEventType,
      windowId,
      openedAt: win.openedAt,
      closedAt: now,
      durationMs: Math.round((now - win.openedAt) * 100) / 100,
      endReason: actualReason,
      beforeSnapshot: win.beforeSnapshot,
      finalSnapshot,
      mutations,
      mutationCount,
      documentWideMutationTotal: docWideTotal,
      performanceCondition: this.observer.getPerformanceCondition(),
    };
    this.windows.delete(windowId);
    this.results.push(result);
    this.onResultCb(result);
  }

  getOpenWindowCount() { return this.windows.size; }
  getResults() { return this.results; }

  _computePath(el) {
    const parts = [];
    let current = el;
    let depth = 0;
    while (current && current !== document.body && current !== document.documentElement && depth < 20) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) break;
      const sameTag = Array.from(parent.children).filter(s => s.tagName === current.tagName);
      if (sameTag.length === 1) parts.unshift(tag);
      else parts.unshift(`${tag}:nth-of-type(${sameTag.indexOf(current) + 1})`);
      current = parent; depth++;
    }
    return parts.length > 0 ? `body > ${parts.join(' > ')}` : 'body';
  }
}

// ── State Cache Listeners (from src/tap/state-cache-listeners.ts) ────
function setupStateCacheListeners(cache) {
  const onMouseDown = (event) => {
    const el = event.target;
    if (el instanceof HTMLElement) cache.capture(el);
  };
  const onFocus = (event) => {
    const el = event.target;
    if (el instanceof HTMLElement) cache.capture(el);
  };
  document.addEventListener('mousedown', onMouseDown, { capture: true, passive: true });
  document.addEventListener('focus', onFocus, { capture: true, passive: true });
  return () => {
    document.removeEventListener('mousedown', onMouseDown, { capture: true });
    document.removeEventListener('focus', onFocus, { capture: true });
  };
}

// ── M1 Test Controller ───────────────────────────────────────────────
// Exposed on window.__m1 for control from test runner
window.__m1 = {
  cache: null, observer: null, coordinator: null, cleanup: null,
  eventCounter: 0,

  start(windowDurationMs) {
    this.cache = new ElementStateCache();
    this.observer = new DocumentObserver();
    this.coordinator = new ObservationCoordinator();
    this.coordinator.configure({
      cache: this.cache,
      observer: this.observer,
      windowDurationMs: windowDurationMs ?? 3000,
      onResult: (r) => { /* collected via getResults */ },
    });
    this.cleanup = setupStateCacheListeners(this.cache);
    this.eventCounter = 0;

    // Install click/change listeners that simulate EventTap.onAfterEvent
    this._clickHandler = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const eventId = `evt-${++this.eventCounter}`;
      this.coordinator.openWindow(eventId, 'click', target);
    };
    this._changeHandler = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const eventId = `evt-${++this.eventCounter}`;
      this.coordinator.openWindow(eventId, 'change', target);
    };
    document.addEventListener('click', this._clickHandler, { capture: false, passive: true });
    document.addEventListener('change', this._changeHandler, { capture: false, passive: true });
  },

  stop() {
    if (this._clickHandler) document.removeEventListener('click', this._clickHandler);
    if (this._changeHandler) document.removeEventListener('change', this._changeHandler);
    if (this.coordinator) this.coordinator.shutdown();
    if (this.cleanup) this.cleanup();
  },

  getResults() {
    return this.coordinator ? this.coordinator.getResults() : [];
  },

  getOpenWindows() {
    return this.coordinator ? this.coordinator.getOpenWindowCount() : 0;
  },

  // Helper: find element by selector and click it natively
  clickElement(selector) {
    const el = document.querySelector(selector);
    if (!el) return { error: 'Element not found: ' + selector };
    el.click();
    return { ok: true, tag: el.tagName, id: el.id, class: el.className };
  },

  // Helper: find select and change its value
  changeSelect(selector, value) {
    const sel = document.querySelector(selector);
    if (!sel) return { error: 'Select not found: ' + selector };
    const oldValue = sel.value;
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, oldValue, newValue: value };
  },

  // Helper: check a checkbox
  toggleCheckbox(selector) {
    const cb = document.querySelector(selector);
    if (!cb) return { error: 'Checkbox not found: ' + selector };
    const oldChecked = cb.checked;
    cb.checked = !oldChecked;
    cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    cb.click();
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, oldChecked, newChecked: cb.checked };
  },

  // Helper: dispatch a full native interaction (mousedown → click → change)
  nativeClick(selector) {
    const el = document.querySelector(selector);
    if (!el) return { error: 'Element not found: ' + selector };
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    return { ok: true, tag: el.tagName };
  },

  // Format results for readable output
  formatResults() {
    const results = this.getResults();
    return results.map(r => ({
      eventId: r.sourceEventId,
      eventType: r.sourceEventType,
      windowId: r.windowId,
      durationMs: Math.round(r.durationMs),
      endReason: r.endReason,
      before: r.beforeSnapshot ? {
        value: r.beforeSnapshot.value,
        checked: r.beforeSnapshot.checked,
        className: r.beforeSnapshot.className,
        ariaExpanded: r.beforeSnapshot.ariaExpanded,
        ariaChecked: r.beforeSnapshot.ariaChecked,
        ariaPressed: r.beforeSnapshot.ariaPressed,
        textContent: r.beforeSnapshot.textContent?.substring(0, 60),
        childCount: r.beforeSnapshot.childCount,
      } : null,
      after: r.finalSnapshot ? {
        value: r.finalSnapshot.value,
        checked: r.finalSnapshot.checked,
        className: r.finalSnapshot.className,
        ariaExpanded: r.finalSnapshot.ariaExpanded,
        ariaChecked: r.finalSnapshot.ariaChecked,
        ariaPressed: r.finalSnapshot.ariaPressed,
        textContent: r.finalSnapshot.textContent?.substring(0, 60),
        childCount: r.finalSnapshot.childCount,
      } : null,
      mutationCount: r.mutationCount,
      docWideTotal: r.documentWideMutationTotal,
      mutations: r.mutations.slice(0, 15).map(m => ({
        type: m.type,
        path: m.targetPath.substring(0, 80),
        tag: m.targetTag,
        attr: m.attributeName,
        oldVal: m.oldValue?.substring(0, 40),
        newVal: m.newValue?.substring(0, 40),
        added: m.addedNodesCount,
        removed: m.removedNodesCount,
      })),
      perfCondition: r.performanceCondition,
    }));
  }
};
