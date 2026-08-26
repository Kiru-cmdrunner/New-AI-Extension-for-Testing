var Gu = Object.defineProperty;
var Hu = (t, e, n) => e in t ? Gu(t, e, { enumerable: !0, configurable: !0, writable: !0, value: n }) : t[e] = n;
var B = (t, e, n) => Hu(t, typeof e != "symbol" ? e + "" : e, n);
function xa(t) {
  return {
    apiKey: "",
    model: t,
    connectionStatus: "not_connected"
  };
}
const Fs = {
  activeProvider: "gemini",
  providers: {
    gemini: xa("gemini-2.5-flash")
  }
};
var ii = /* @__PURE__ */ ((t) => (t.Ready = "ready", t.Recording = "recording", t.Stopped = "stopped", t))(ii || {}), ae = /* @__PURE__ */ ((t) => (t.UI_STATE = "ui_state", t.SESSION_EVENTS = "session_events", t.SESSION_CONTEXT = "session_context", t.AI_CONFIG = "ai_config", t.STEPS = "session_steps", t.REPOSITORY = "test_repository", t.SCREENSHOTS = "session_screenshots", t.TEST_CASE_DRAFT = "test_case_draft", t.DETECTED_INTERACTIONS = "detected_interactions", t.DETECTED_INTERACTIONS_V2 = "detected_interactions_v2", t.DETECTED_INTERACTIONS_MERGED = "detected_interactions_merged", t.KNOWLEDGE_FRAGMENT = "knowledge_fragment", t.RECOGNITION_COMPONENTS = "recognition_components", t.DOMAIN_ENTITIES = "domain_entities", t.EXECUTION_IR_PLAN = "execution_ir_plan", t.GENERATED_FILES = "generated_files", t.UNDERSTANDING_RESULT = "understanding_result", t.REPOSITORY_SESSION_ID = "repo_session_id", t.EXECUTION_RESULT = "execution_result", t.LIVE_INTERACTIONS = "cmdrunner_live_interactions", t.UNATTACHED_REQUESTS = "cmdrunner_unattached_requests", t.PENDING_NAV_DOCS = "cmdrunner_pending_nav_docs", t))(ae || {});
const Ks = {
  recordingState: "ready",
  lastChanged: (/* @__PURE__ */ new Date(0)).toISOString()
};
class Be {
  // ── UI State ────────────────────────────────────────────
  /**
   * Read the current persisted UI state.
   * Falls back to DEFAULT_UI_STATE when nothing is stored or the stored
   * value is malformed.
   */
  static async getUIState() {
    const n = (await chrome.storage.local.get(ae.UI_STATE))[ae.UI_STATE];
    return n && typeof n == "object" && "recordingState" in n && Object.values(ii).includes(
      n.recordingState
    ) ? n : { ...Ks };
  }
  /**
   * Persist the full UI state object.
   */
  static async setUIState(e) {
    await chrome.storage.local.set({ [ae.UI_STATE]: e });
  }
  /**
   * Update only the recording state and stamp the timestamp.
   */
  static async setRecordingState(e) {
    const n = {
      recordingState: e,
      lastChanged: (/* @__PURE__ */ new Date()).toISOString()
    };
    return await chrome.storage.local.set({ [ae.UI_STATE]: n }), n;
  }
  /**
   * Reset to the default UI state (Ready).
   */
  static async resetUIState() {
    await chrome.storage.local.set({ [ae.UI_STATE]: { ...Ks } });
  }
  // ── Session Events ──────────────────────────────────────
  /**
   * Read all captured events from the current recording session.
   * Returns an empty array when nothing is stored.
   */
  static async getEvents() {
    const n = (await chrome.storage.local.get(ae.SESSION_EVENTS))[ae.SESSION_EVENTS];
    return Array.isArray(n) ? n : [];
  }
  /**
   * Persist the full events array (replaces existing).
   */
  static async setEvents(e) {
    await chrome.storage.local.set({ [ae.SESSION_EVENTS]: e });
  }
  /**
   * Clear all stored session events.
   */
  static async clearEvents() {
    await chrome.storage.local.set({ [ae.SESSION_EVENTS]: [] });
  }
  // ── Recording Context ──────────────────────────────────
  /**
   * Read the recording context (starting URL/title) for the current session.
   * Returns null when no context has been stored.
   */
  static async getRecordingContext() {
    const n = (await chrome.storage.local.get(ae.SESSION_CONTEXT))[ae.SESSION_CONTEXT];
    return n && typeof n == "object" && "startUrl" in n ? n : null;
  }
  /**
   * Persist the recording context for the current session.
   */
  static async setRecordingContext(e) {
    await chrome.storage.local.set({ [ae.SESSION_CONTEXT]: e });
  }
  /**
   * Clear the stored recording context.
   */
  static async clearRecordingContext() {
    await chrome.storage.local.remove(ae.SESSION_CONTEXT);
  }
  // ── Session Steps ──────────────────────────────────────
  /**
   * Read all generated test steps from the current recording session.
   * Returns an empty array when nothing is stored.
   */
  static async getSteps() {
    const n = (await chrome.storage.local.get(ae.STEPS))[ae.STEPS];
    return Array.isArray(n) ? n : [];
  }
  /**
   * Persist the full steps array (replaces existing).
   */
  static async setSteps(e) {
    await chrome.storage.local.set({ [ae.STEPS]: e });
  }
  /**
   * Clear all stored test steps.
   */
  static async clearSteps() {
    await chrome.storage.local.set({ [ae.STEPS]: [] });
  }
  // ── Test Case Draft ─────────────────────────────────────
  /**
   * Read the active Test Case draft (created before recording).
   * Returns null when no draft exists.
   */
  static async getTestCaseDraft() {
    const n = (await chrome.storage.local.get(ae.TEST_CASE_DRAFT))[ae.TEST_CASE_DRAFT];
    return n && typeof n == "object" && "name" in n && "projectId" in n ? n : null;
  }
  /**
   * Persist the Test Case draft.
   */
  static async setTestCaseDraft(e) {
    await chrome.storage.local.set({ [ae.TEST_CASE_DRAFT]: e });
  }
  /**
   * Clear the Test Case draft.
   */
  static async clearTestCaseDraft() {
    await chrome.storage.local.remove(ae.TEST_CASE_DRAFT);
  }
  // ── Storage change listener ─────────────────────────────
  /**
   * Register a listener for changes to a specific storage key.
   * Returns an unsubscribe function.
   */
  static onKeyChanged(e, n) {
    const r = (o, s) => {
      s === "local" && e in o && n(o[e].newValue);
    };
    return chrome.storage.onChanged.addListener(r), () => chrome.storage.onChanged.removeListener(r);
  }
  // ── AI Configuration ────────────────────────────────────
  /**
   * Read the saved AI configuration.
   * Falls back to DEFAULT_AI_CONFIG when nothing is stored.
   * Migrates legacy configs (single-key format) automatically.
   */
  static async getAIConfig() {
    const n = (await chrome.storage.local.get(ae.AI_CONFIG))[ae.AI_CONFIG];
    if (n && typeof n == "object") {
      if ("activeProvider" in n && "providers" in n)
        return { ...Fs, ...n };
      if ("provider" in n) {
        const r = n, c = {
          apiKey: (await chrome.storage.local.get("ai_api_key")).ai_api_key ?? "",
          model: r.model,
          baseUrl: r.baseUrl,
          connectionStatus: "not_connected"
        };
        return {
          activeProvider: r.provider,
          providers: { [r.provider]: c }
        };
      }
    }
    return { ...Fs };
  }
  /**
   * Persist the full AI configuration.
   */
  static async setAIConfig(e) {
    await chrome.storage.local.set({ [ae.AI_CONFIG]: e });
  }
  // ── Per-Provider Settings ───────────────────────────────
  /**
   * Get settings for a specific provider. Returns a default entry
   * if the provider has no stored settings yet.
   */
  static async getProviderSettings(e, n) {
    const o = (await this.getAIConfig()).providers[e];
    return o || xa(n);
  }
  /**
   * Save settings for a specific provider (merges into existing config).
   */
  static async setProviderSettings(e, n) {
    const r = await this.getAIConfig();
    r.providers[e] = n, await this.setAIConfig(r);
  }
  /**
   * Set the active provider (the one the extension uses).
   */
  static async setActiveProvider(e) {
    const n = await this.getAIConfig();
    n.activeProvider = e, await this.setAIConfig(n);
  }
  /**
   * Get the active provider ID.
   */
  static async getActiveProvider() {
    return (await this.getAIConfig()).activeProvider;
  }
  // ── Test Repository ─────────────────────────────────────
  /** Get the full test repository. */
  static async getRepository() {
    const n = (await chrome.storage.local.get(ae.REPOSITORY))[ae.REPOSITORY];
    return n && typeof n == "object" && Array.isArray(n.projects) ? structuredClone(n) : { projects: [] };
  }
  /** Persist the test repository. */
  static async setRepository(e) {
    await chrome.storage.local.set({ [ae.REPOSITORY]: e });
  }
  // ── Generic Raw Access ──────────────────────────────────
  /**
   * Persist any value under a storage key.
   * Used for keys that don't have a dedicated typed method (e.g. EXECUTION_IR_PLAN).
   */
  static async setRaw(e, n) {
    await chrome.storage.local.set({ [e]: n });
  }
  /**
   * Read a raw value by storage key.
   */
  static async getRaw(e) {
    return (await chrome.storage.local.get(e))[e];
  }
}
const Gs = 2e3;
function He(t, e, n, r) {
  if (t && t.trim()) return t.trim();
  if (e && e.trim()) return e.trim();
  if (n && n.trim()) return n.trim();
  const o = zu(r);
  return o || "element";
}
const Ln = {
  plus: "add",
  add: "add",
  minus: "remove",
  remove: "remove",
  close: "close",
  cancel: "close",
  x: "close",
  delete: "delete",
  trash: "delete",
  search: "search",
  arrowdown: "arrow-down",
  arrowup: "arrow-up",
  arrowleft: "arrow-left",
  arrowright: "arrow-right",
  chevrondown: "chevron-down",
  chevronup: "chevron-up",
  chevronleft: "chevron-left",
  chevronright: "chevron-right",
  calendar: "calendar",
  menu: "menu",
  hamburger: "menu",
  edit: "edit",
  pencil: "edit"
};
function zu(t) {
  if (!t) return null;
  const e = t.toLowerCase(), n = e.match(/\bfa-(?:solid|regular|brands?-)?([a-z][-a-z0-9]+)\b/);
  if (n) {
    const l = n[1].replace(/-/g, "");
    return `${Ln[l] ?? n[1]} icon`;
  }
  const r = e.match(/\bmdi-([a-z][-a-z0-9]+)\b/);
  if (r) {
    const l = r[1].replace(/-/g, "");
    return `${Ln[l] ?? r[1]} icon`;
  }
  const o = e.match(/\bbi-([a-z][-a-z0-9]*)\b/);
  if (o) {
    const l = o[1].replace(/-/g, "");
    return `${Ln[l] ?? o[1]} icon`;
  }
  const s = e.match(/\bicon-([a-z][-a-z0-9]+)\b/);
  if (s) {
    const l = s[1].replace(/-/g, "");
    return `${Ln[l] ?? s[1]} icon`;
  }
  const c = e.match(/\b([a-z][-a-z0-9]+)-icon\b/);
  if (c) {
    const l = c[1].replace(/-/g, "");
    return `${Ln[l] ?? c[1]} icon`;
  }
  return null;
}
const Wu = /* @__PURE__ */ new Set([
  "BUTTON",
  "A",
  "SELECT",
  "INPUT",
  "TEXTAREA",
  "SUMMARY",
  "OPTION"
]), Yu = /* @__PURE__ */ new Set([
  "button",
  "link",
  "combobox",
  "listbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "textbox",
  "spinbutton",
  "slider",
  "treeitem",
  "gridcell"
]), Xu = /(btn|button|clickable|selectable|dropdown|menu-item|nav-item|tab-item|chip|toggle|action|stepper|counter|increment|decrement|qty|quantity|plus|minus|add-btn|remove-btn|arrow|chevron|expand|collapse)/i, Qu = /* @__PURE__ */ new Set([
  "listbox",
  "menu",
  "grid",
  "dialog"
]);
function oi(t) {
  const e = [];
  for (const n of t) {
    const r = /^(\S+)\[role=(.+)\]$/.exec(n);
    if (r) {
      const o = r[2].replace(/["']/g, "").split(/\s+/).filter(Boolean);
      e.push(...o);
    } else
      e.push(n);
  }
  return e;
}
const Zu = /(listbox|dropdown|popover|overlay|modal|dialog|flyout|menu|popup|suggestion|autocomplete|typeahead|options-list|MuiDialog|ant-modal|p-dialog)/i;
function Ju(t, e) {
  return oi(t).some((r) => Qu.has(r)) ? !0 : e.some((r) => Zu.test(r));
}
function $a(t, e, n, r) {
  return !!(Wu.has(t) || e && Yu.has(e) || r !== null && r >= 0 || n && Xu.test(n));
}
const el = /* @__PURE__ */ new Set([
  "combobox",
  "listbox"
]), tl = /* @__PURE__ */ new Set([
  "option"
]), nl = /(oxd-select-text|select|combobox|dropdown|antd.*select|MuiSelect|selector|traveler|passenger|cabin|class-selector|trip-type|economy|traveller)/i, rl = /(oxd-select-option|select-option|option-item|list-option|ant-select-item)/i, il = /(oxd-select-dropdown|select-dropdown|listbox|dropdown-menu|popover|overlay)/i;
function Hs(t, e, n) {
  return !!(t === "SELECT" || e && el.has(e) || n && nl.test(n));
}
function qr(t, e) {
  return !!(t && tl.has(t) || e && rl.test(e));
}
function Or(t) {
  return t ? il.test(t) : !1;
}
function zs(t) {
  return t.replace(/^[-–—:*\s]+|[-–—:*\s]+$/g, "").trim();
}
const ol = /* @__PURE__ */ new Set([
  "date",
  "time",
  "datetime-local",
  "month",
  "week"
]), sl = /(^|[^a-z])(?:oxd-date-input|date[_-]?picker|date-input|calendar-input)/i, Ws = /(?:(?:^|[^a-z0-9])(?:depart|return|onward|arrival)(?=$|[^a-z0-9]|[_-])|date|birth|dob|expire|expiry|calendar)/i, fo = /(oxd-date-day|calendar-day|datepicker-day|datepicker__day|day-cell|flatpickr-day)/i, al = /(oxd-date-input-dropdown|oxd-calendar|calendar|datepicker|flatpickr-calendar)/i, cl = /(oxd-calendar-switch-button|calendar.*nav|datepicker.*nav|prev|next|today|switch|chevron)/i;
function Ys(t, e, n, r, o, s = null) {
  return n && fo.test(n) ? !1 : !!(t === "INPUT" && e && ol.has(e) || n && sl.test(n) || r === "dialog" && t === "INPUT" || o && Ws.test(o) || s && t === "INPUT" && Ws.test(s));
}
function Un(t, e, n) {
  return !!(n != null && Da(n, null) && (t === "option" || t === "gridcell" || t === "button") || (t === "gridcell" || t === "option") && e && fo.test(e) || e && fo.test(e));
}
const ul = /^(?:choose|select|pick)?\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday),\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/i;
function Da(t, e) {
  const n = t || e || "";
  return n ? ul.test(n.trim()) : !1;
}
function Kr(t) {
  return t ? al.test(t) : !1;
}
function Xs(t, e, n) {
  if (t !== "button" && t !== null) return !1;
  if (n && cl.test(n)) return !0;
  if (e) {
    const r = e.toLowerCase();
    if (/^(next|previous|prev|today|switch|change month|change year)/i.test(r)) return !0;
  }
  return !1;
}
function ll(t, e, n) {
  return t === "INPUT" && e === "checkbox" || n === "checkbox" || n === "switch" || n === "menuitemcheckbox";
}
function dl(t, e, n) {
  return t === "INPUT" && e === "radio" || n === "radio" || n === "menuitemradio";
}
function fl(t, e) {
  return t === "A" || e === "link";
}
function La(t, e, n, r) {
  return !!(t === "TEXTAREA" || t === "INPUT" && (e === "text" || e === "email" || e === "password" || e === "search" || e === "tel" || e === "url" || e === "number" || e === null) || n === "textbox" || r);
}
function pl(t, e) {
  return (t ?? 0) !== 0 || (e ?? 0) !== 0;
}
function he(t) {
  if (t.testId) return `testId:${t.testId}`;
  if (t.dataCy) return `dataCy:${t.dataCy}`;
  if (t.dataQa) return `dataQa:${t.dataQa}`;
  if (t.stableId) return `id:${t.stableId}`;
  if (t.dataAutoId) return `dataAutoId:${t.dataAutoId}`;
  if (t.autoId) return `autoId:${t.autoId}`;
  const e = t.accessibleName || "", n = t.cssSelector || "";
  return e && n ? `name:${e}|sel:${n}` : n ? `sel:${n}` : `tag:${t.tag}`;
}
function hl(t, e) {
  return t === "INPUT" && e === "file";
}
function ml(t, e, n) {
  return t === "INPUT" && e === "range" || n === "slider" || n === "spinbutton";
}
function gl(t) {
  return t === "tab";
}
const ut = /* @__PURE__ */ new Set([
  "click",
  "contextmenu",
  "mousedown",
  "keydown",
  "dragstart",
  "drop"
  // M9.10 — drag & drop are discrete user actions
]), Gr = "cmdrunner_evidence_ledger";
function Qs(t) {
  const e = t.match(/^evt-(.+)-\d+$/);
  return e ? e[1] : "unknown";
}
class Ma {
  constructor() {
    B(this, "entries", /* @__PURE__ */ new Map());
  }
  /**
   * Append an ObservedEvent to the ledger.
   * Filters to discrete action types only. Deduplicates by eventId.
   * New entries start with disposition='pending'.
   */
  append(e) {
    ut.has(e.eventType) && (this.entries.has(e.eventId) || this.entries.set(e.eventId, {
      eventId: e.eventId,
      captureSeq: e.captureSeq,
      pageId: Qs(e.eventId),
      eventType: e.eventType,
      timestamp: e.timestamp,
      disposition: "pending",
      targetTag: e.target.tag,
      targetName: e.target.accessibleName,
      targetRole: e.target.ariaRole,
      // D1: full identity + origin for twin affinity.
      targetIdentity: e.target ? { ...e.target } : null,
      captureOrigin: e.captureOrigin ? {
        tabId: e.captureOrigin.tabId,
        frameId: e.captureOrigin.frameId
      } : null,
      // LP3: shallow-copy the ancestor arrays out of domContext. Defensively
      // handle events whose domContext is undefined (older senders / tests)
      // by persisting null — the projection falls back to [] for those.
      ancestorRoles: e.domContext ? [...e.domContext.ancestorRoles ?? []] : null,
      ancestorClasses: e.domContext ? [...e.domContext.ancestorClasses ?? []] : null
    }));
  }
  /**
   * 7.4-B3 S3: append a SYNTHETIC entry minted from an accumulating event
   * episode (typed text that no lifecycle ever claimed).
   *
   * Bypasses the DISCRETE_ACTION_TYPES filter (that filter is the R1 raw
   * contract — raw input/change events stay un-stored; only this curated,
   * terminal-value sample crosses the boundary as a synthesized 'change').
   * Same eventId dedup + disposition lifecycle as append(). The entry is
   * marked synthetic=true so M5 self-consistency and downstream consumers
   * can distinguish it from raw capture.
   */
  appendSynthetic(e) {
    if (this.entries.has(e.eventId)) return;
    const n = {
      eventId: e.eventId,
      captureSeq: e.captureSeq,
      pageId: Qs(e.eventId),
      eventType: e.eventType,
      timestamp: e.timestamp,
      disposition: "pending",
      targetTag: e.target.tag,
      targetName: e.target.accessibleName,
      targetRole: e.target.ariaRole,
      targetIdentity: e.target ? { ...e.target } : null,
      captureOrigin: e.captureOrigin ? { tabId: e.captureOrigin.tabId, frameId: e.captureOrigin.frameId } : null,
      ancestorRoles: e.domContext ? [...e.domContext.ancestorRoles ?? []] : null,
      ancestorClasses: e.domContext ? [...e.domContext.ancestorClasses ?? []] : null,
      // S3 marker
      synthetic: !0,
      sampledValueAfter: e.valueAfter != null ? String(e.valueAfter) : void 0
    };
    this.entries.set(e.eventId, n);
  }
  /**
   * Update the disposition of a single entry.
   * No-op if the eventId is not in the ledger.
   * 'claimed' and 'unclaimed' are terminal — cannot be overwritten.
   */
  setDisposition(e, n, r, o) {
    const s = this.entries.get(e);
    s && (s.disposition === "claimed" || s.disposition === "unclaimed" || (s.disposition = n, r !== void 0 && (s.claimedBy = r), o !== void 0 && (s.claimType = o)));
  }
  /**
   * Bulk-release all entries claimed by a specific lifecycle/interaction.
   * Sets their disposition to 'unclaimed'.
   * Used when a lifecycle is abandoned or interrupted.
   */
  releaseClaims(e) {
    for (const n of this.entries.values())
      n.claimedBy === e && n.disposition === "absorbed" && (n.disposition = "unclaimed");
  }
  /**
   * Get all entries sorted by (pageId, captureSeq).
   * Within the same page/document, entries are in browser-observed order.
   * Across documents, page boundaries are preserved (no global ordering).
   */
  getEntries() {
    return Array.from(this.entries.values()).sort((e, n) => e.pageId !== n.pageId ? e.pageId.localeCompare(n.pageId) : e.captureSeq - n.captureSeq);
  }
  /**
   * Get entries filtered by disposition status.
   */
  getByDisposition(e) {
    return this.getEntries().filter((n) => n.disposition === e);
  }
  /**
   * Serialize the ledger for persistence (chrome.storage.local).
   */
  snapshot() {
    return this.getEntries().map((e) => ({ ...e }));
  }
  /**
   * Restore from a snapshot.
   * Always calls resetAbsorbedToUnclaimed() after restoring —
   * 'absorbed' entries from a previous SW lifecycle have lost their
   * claimant (the ComponentRuntime that absorbed them is gone).
   */
  restore(e) {
    this.entries.clear();
    for (const n of e)
      this.entries.set(n.eventId, {
        ...n,
        targetIdentity: n.targetIdentity ?? null,
        captureOrigin: n.captureOrigin ?? null,
        ancestorRoles: n.ancestorRoles ?? null,
        ancestorClasses: n.ancestorClasses ?? null
      });
    this.resetAbsorbedToUnclaimed();
  }
  /**
   * SW restart rule: set all 'absorbed' entries to 'unclaimed'.
   * After a service-worker restart, the ComponentRuntime's in-memory
   * active stack is empty — any 'absorbed' entries have lost their
   * claimant and must be treated as unclaimed evidence.
   * 'claimed' entries are preserved (backed by persisted liveInteractions).
   * 'unclaimed' entries are preserved (already terminal).
   * 'pending' entries are preserved (not yet processed).
   */
  resetAbsorbedToUnclaimed() {
    for (const e of this.entries.values())
      e.disposition === "absorbed" && (e.disposition = "unclaimed");
  }
  /**
   * Clear all entries.
   */
  clear() {
    this.entries.clear();
  }
  /** Number of entries in the ledger. */
  get size() {
    return this.entries.size;
  }
  /**
   * Get a single entry by eventId (for testing/debugging).
   */
  get(e) {
    return this.entries.get(e);
  }
}
const yl = 500;
function Bt(t) {
  const e = t.match(/^evt-(.+)-\d+$/);
  return e ? e[1] : "unknown";
}
function vl(t) {
  const e = t.targetIdentity;
  return e ? he(e) : "tag:∅";
}
const wl = 3e5;
function bl(t, e, n) {
  const { tag: r, ariaRole: o } = t.target, s = n.semanticChildRoles != null && n.semanticChildRoles.includes(o ?? ""), c = n.semanticChildTags != null && n.semanticChildTags.includes(r);
  if (!s && !c) return !1;
  const l = e.data.surfaceRole;
  return !(!l || !oi(t.domContext.ancestorRoles).includes(l));
}
function Va(t, e) {
  return new Il(t, e);
}
class Il {
  constructor(e, n) {
    B(this, "definitions");
    B(this, "clickDefinition");
    B(this, "nonClickDefinitions");
    B(this, "config");
    B(this, "ledger");
    B(this, "activeStack", []);
    B(this, "seenEventIds", /* @__PURE__ */ new Set());
    B(this, "interactionCounter");
    B(this, "lifecycleCounter", 0);
    /** Per-type dedup: tracks the last interaction of each type independently. */
    B(this, "dedupByType", /* @__PURE__ */ new Map());
    /**
     * 7.4-B3 S2: last emitted interaction per type (object ref). The dedup
     * fold appends suppressed events to this interaction instead of leaving
     * them unclaimed. NOT serialized — after an SW restart the map is empty
     * and the suppress-and-release degradation applies (pinned).
     */
    B(this, "lastInteractionByType", /* @__PURE__ */ new Map());
    B(this, "errorLog", []);
    // ── 6F-M1 A: gesture ownership ───────────────────────────────────────
    //
    // A lifecycle that completes on MOUSEDOWN forgets its gesture: the paired
    // click of the same physical gesture arrives immediately after the
    // mousedown in the DISCRETE-event ledger order, finds no active lifecycle
    // (it was spliced at completion), and falls through to discovery → twin
    // Click card + duplicate IR step (6E-M2 E2E Finding 2; 6F-M1 run-1
    // grounded the real stream: the pair is consecutive in ledger-entry order
    // with ~90ms raw captureSeq gap — browser-monotonic captureSeq is NOT
    // +1-adjacent across a gesture because non-discrete events share the
    // counter).
    //
    // The pairing predicate is the runtime analog of the shipped S1' projection
    // rule (projection-engine.ts pairPhysicalPress) — same structural family,
    // owner-corrected doctrine (2026-08-20): same pageId, same elementKey, and
    // the click is the NEXT discrete event after the completing mousedown —
    // no intervening DISCRETE event on that page (interleaved non-discrete
    // events — focus/mousemove/input — never break a physical press-release
    // gesture). NO TIMING FIELDS participate (no Date.now, no timestamp
    // deltas, no captureSeq arithmetic) — timing rules are doctrinally
    // forbidden.
    //
    // The bound below is memory hygiene only (most-recent-first eviction),
    // not a timing rule: entries are never expired by time.
    B(this, "MAX_GESTURE_RECORDS", 16);
    B(this, "completedGestures", []);
    this.definitions = [...e].sort((r, o) => r.priority - o.priority), this.config = n, this.ledger = n.evidenceLedger ?? null, this.interactionCounter = n.initialInteractionId ?? 0, this.clickDefinition = this.definitions.find((r) => r.type === "Click") ?? null, this.nonClickDefinitions = this.definitions.filter(
      (r) => r.type !== "Click"
    );
  }
  // ── Public API ───────────────────────────────────────────────────
  get activeCount() {
    return this.activeStack.length;
  }
  get errors() {
    return [...this.errorLog];
  }
  process(e) {
    var o, s, c, l, f;
    const n = [];
    if (this.seenEventIds.has(e.eventId)) return n;
    if (this.trackSeenEvent(e.eventId), e.eventType === "navigation") {
      const h = this.flush();
      n.push(...h);
    }
    if (this.cleanupStaleComponents(e, n), ut.has(e.eventType) && e.eventType !== "click") {
      const h = Bt(e.eventId);
      for (const m of this.completedGestures)
        m.pageId === h && (m.superseded = !0);
    }
    let r = !1;
    for (let h = this.activeStack.length - 1; h >= 0; h--) {
      const m = this.activeStack[h], g = this.findDefForType(m.type);
      if (!g) continue;
      let I = !1;
      try {
        I = g.isInScope(e, m);
      } catch (b) {
        this.logError(g.type, "isInScope", b);
      }
      if (I) {
        m.memberEvents.push(e), m.lastActivityTime = e.timestamp;
        let b = null;
        try {
          b = g.handleEvent(e, m);
        } catch (O) {
          this.logError(g.type, "handleEvent", O);
        }
        if (b) {
          r = !0, m.state = b.endState, m.endTime = e.timestamp, ut.has(e.eventType) && ((o = this.ledger) == null || o.setDisposition(e.eventId, "absorbed", m.lifecycleId, m.type));
          const O = this.completeComponent(m, g, b);
          O && n.push(O), this.activeStack.splice(h, 1);
        } else {
          const O = ut.has(e.eventType), q = he(e.target) === he(m.trigger);
          O && !q ? bl(e, m, g) ? (r = !0, (s = this.ledger) == null || s.setDisposition(e.eventId, "absorbed", m.lifecycleId, m.type)) : m.memberEvents.pop() : (r = !0, O && ((c = this.ledger) == null || c.setDisposition(e.eventId, "absorbed", m.lifecycleId, m.type)));
        }
      } else {
        let b = !1;
        try {
          b = g.shouldCancelOnOutside(e, m);
        } catch (O) {
          this.logError(g.type, "shouldCancelOnOutside", O);
        }
        if (b) {
          m.state = "abandoned", m.endTime = e.timestamp;
          const O = this.completeComponent(m, g, {
            endState: "abandoned"
          });
          O && n.push(O), this.activeStack.splice(h, 1);
        } else {
          let O = !1;
          if (g.shouldCompleteOnOutside)
            try {
              O = g.shouldCompleteOnOutside(e, m);
            } catch (q) {
              this.logError(g.type, "shouldCompleteOnOutside", q);
            }
          if (O) {
            m.state = "completed", m.endTime = e.timestamp;
            const q = this.completeComponent(m, g, {
              endState: "completed"
            });
            q && n.push(q), this.activeStack.splice(h, 1);
          }
        }
      }
    }
    if (r && ut.has(e.eventType)) {
      const h = Bt(e.eventId);
      for (const m of this.completedGestures)
        m.pageId === h && m.mousedownCaptureSeq < e.captureSeq && (m.superseded = !0);
    }
    if (!r && e.eventType === "click" && this.completedGestures.length > 0) {
      const h = Bt(e.eventId), m = he(e.target), g = this.completedGestures.find(
        (I) => !I.superseded && I.pageId === h && I.elementKey === m && e.captureSeq > I.mousedownCaptureSeq
      );
      if (g)
        r = !0, (l = this.ledger) == null || l.setDisposition(
          e.eventId,
          "claimed",
          g.interactionId,
          g.interactionType
        ), g.interaction.memberEvents.some((I) => I.eventId === e.eventId) || g.interaction.memberEvents.push(e), this.completedGestures = this.completedGestures.filter((I) => I !== g);
      else
        for (const I of this.completedGestures)
          I.pageId === h && (I.superseded = !0);
    }
    if (!r) {
      const h = this.tryDiscovery(e);
      if (h) {
        this.activeStack.push(h), ut.has(e.eventType) && ((f = this.ledger) == null || f.setDisposition(e.eventId, "absorbed", h.lifecycleId, h.type));
        const m = this.findDefForType(h.type);
        if (m) {
          let g = null;
          try {
            g = m.handleEvent(e, h);
          } catch (I) {
            this.logError(m.type, "handleEvent", I);
          }
          if (g) {
            h.state = g.endState, h.endTime = e.timestamp;
            const I = this.completeComponent(h, m, g);
            I && n.push(I), this.activeStack.pop();
          }
        }
      }
    }
    return n;
  }
  flush() {
    const e = [];
    for (let n = this.activeStack.length - 1; n >= 0; n--) {
      const r = this.activeStack[n], o = this.findDefForType(r.type), s = o != null && o.shouldCompleteOnOutside ? "completed" : "interrupted";
      if (r.state = s, r.endTime = Date.now(), o) {
        const c = this.completeComponent(r, o, {
          endState: s
        });
        c && e.push(c);
      }
    }
    return this.activeStack = [], e;
  }
  /**
   * Abandon active components that have been idle for longer than
   * LIFECYCLE_IDLE_TIMEOUT_MS. Idle means the lifecycle has received ZERO
   * in-scope events for the entire idle period.
   *
   * This is leak-protection, NOT a user-facing timing limit. A lifecycle
   * that is actively receiving events stays alive regardless of total age.
   *
   * Gesture components (Scroll) are completed, not abandoned, since they
   * accumulated valid data — the user just didn't do anything afterwards.
   *
   * Called on every event, so staleness is caught promptly.
   */
  cleanupStaleComponents(e, n) {
    for (let r = this.activeStack.length - 1; r >= 0; r--) {
      const o = this.activeStack[r];
      if (e.timestamp - (o.lastActivityTime ?? o.startTime) > wl) {
        const c = this.findDefForType(o.type), l = c != null && c.shouldCompleteOnOutside ? "completed" : "abandoned";
        if (o.state = l, o.endTime = e.timestamp, c) {
          const f = this.completeComponent(o, c, {
            endState: l
          });
          f && n.push(f);
        }
        this.activeStack.splice(r, 1);
      }
    }
  }
  snapshot() {
    return {
      interactionCounter: this.interactionCounter,
      seenEventIds: [...this.seenEventIds],
      dedupRecords: [...this.dedupByType.values()]
    };
  }
  restore(e) {
    this.interactionCounter = e.interactionCounter, this.seenEventIds = new Set(e.seenEventIds), this.dedupByType = new Map(
      (e.dedupRecords ?? []).map((n) => [n.type, n])
    );
  }
  /**
   * 7.4-B3 S3: read-only view of the live stack (trigger identity included).
   */
  getLiveLifecycles() {
    return this.activeStack.map((e) => ({
      id: e.lifecycleId,
      trigger: e.trigger
    }));
  }
  // ── Internal ─────────────────────────────────────────────────────
  /**
   * Try to discover a matching definition for this event.
   * Iterates definitions by priority ascending — lower number = higher priority
   * (excluding Click fallback).
   * Returns a new ComponentContext if a definition matched.
   */
  tryDiscovery(e) {
    for (const n of this.nonClickDefinitions) {
      if (!n.triggerEventTypes.has(e.eventType)) continue;
      let r = null;
      try {
        r = n.detectTrigger(e);
      } catch (o) {
        this.logError(n.type, "detectTrigger", o);
        continue;
      }
      if (r)
        return this.createContext(n, e);
    }
    if (this.clickDefinition) {
      const n = this.clickDefinition;
      if (!n.triggerEventTypes.has(e.eventType)) return null;
      let r = null;
      try {
        r = n.detectTrigger(e);
      } catch (o) {
        this.logError(n.type, "detectTrigger", o);
      }
      if (r)
        return this.createContext(n, e);
    }
    return null;
  }
  /**
   * Create a new ComponentContext for a freshly triggered definition.
   */
  createContext(e, n) {
    const r = {
      type: e.type,
      lifecycleId: `lc-${++this.lifecycleCounter}`,
      state: "active",
      trigger: n.target,
      triggerEvent: n,
      memberEvents: [n],
      scopeKeys: /* @__PURE__ */ new Set([he(n.target)]),
      startTime: n.timestamp,
      lastActivityTime: n.timestamp,
      endTime: 0,
      data: {}
    };
    if (this.config.onLifecycleStart)
      try {
        this.config.onLifecycleStart(r);
      } catch {
      }
    return r;
  }
  // M5: createUnclassifiedInteraction removed.
  // The Projection Engine now surfaces unclaimed/pending ledger entries as
  // Unclassified interactions at stopRecording time.
  /**
   * Complete a component: build result, dedup, emit.
   * Returns the interaction if emitted, null if suppressed by dedup.
   */
  completeComponent(e, n, r) {
    var l;
    let o = {};
    try {
      o = n.buildResult(e, r).metadata;
    } catch (f) {
      this.logError(n.type, "buildResult", f);
    }
    const s = he(e.trigger);
    if (this.isDuplicate(e, o, s)) {
      const f = this.lastInteractionByType.get(e.type);
      return f ? this.foldIntoPrior(e, f) : (l = this.ledger) == null || l.releaseClaims(e.lifecycleId ?? ""), null;
    }
    this.interactionCounter++;
    const c = {
      interactionId: `int-${this.interactionCounter}`,
      lifecycleId: e.lifecycleId,
      type: e.type,
      trigger: e.trigger,
      triggerEvent: e.triggerEvent,
      memberEvents: [...e.memberEvents],
      startTime: e.startTime,
      endTime: e.endTime,
      endState: r.endState,
      metadata: o
    };
    if (this.dedupByType.set(e.type, {
      type: e.type,
      elementKey: s,
      endTime: e.endTime,
      metadata: { ...o },
      interactionId: c.interactionId
    }), this.lastInteractionByType.set(e.type, c), this.ledger)
      if (r.endState === "completed")
        for (const f of e.memberEvents)
          ut.has(f.eventType) && this.ledger.setDisposition(f.eventId, "claimed", c.interactionId, e.type);
      else
        this.ledger.releaseClaims(e.lifecycleId ?? "");
    if (r.endState === "completed") {
      const f = e.memberEvents[e.memberEvents.length - 1];
      if (f && f.eventType === "mousedown") {
        for (const h of this.completedGestures)
          h.pageId === Bt(f.eventId) && (h.superseded = !0);
        this.completedGestures.push({
          pageId: Bt(f.eventId),
          elementKey: he(f.target),
          mousedownCaptureSeq: f.captureSeq,
          superseded: !1,
          lifecycleId: e.lifecycleId ?? "",
          interactionId: c.interactionId,
          interactionType: e.type,
          interaction: c
        }), this.completedGestures.length > this.MAX_GESTURE_RECORDS && this.completedGestures.shift();
      }
    }
    try {
      this.config.onEmit(c);
    } catch (f) {
      this.logError(n.type, "onEmit", f);
    }
    return c;
  }
  /**
   * 7.4-B3 S2: fold a dedup-suppressed lifecycle into the prior emitted
   * interaction of the same type.
   *
   * - All discrete member events of the suppressed lifecycle are appended
   *   to the prior's memberEvents (eventId-guarded) and their ledger
   *   disposition set to 'claimed' by the PRIOR interactionId — projection
   *   therefore mints no Unclassified card for them.
   * - The gesture's press-half (the PENDING mousedown twin that preceded
   *   the suppressed click in ledger order on the same element) is claimed
   *   too. Without this, pairPhysicalPress cannot pair the pair (they are
   *   non-adjacent in the [...unclaimed, ...pending] projection order) and
   *   the twin surfaces as a separate Unclassified card — the int-17
   *   half-card observed on the B2 dump.
   * - metadata.repeatCount increments on the prior (repeat information is
   *   preserved, not lost).
   */
  foldIntoPrior(e, n) {
    var o, s, c, l, f;
    const r = new Set((n.memberEvents ?? []).map((h) => h.eventId));
    for (const h of e.memberEvents)
      ut.has(h.eventType) && (r.has(h.eventId) || (n.memberEvents.push(h), r.add(h.eventId)), (o = this.ledger) == null || o.setDisposition(h.eventId, "claimed", n.interactionId, e.type));
    if (this.ledger) {
      const h = he(e.trigger), m = Bt(((s = e.triggerEvent) == null ? void 0 : s.eventId) ?? ""), g = this.ledger.getEntries();
      for (let I = g.length - 1; I >= 0; I--) {
        const b = g[I];
        if (b.eventId !== ((c = e.triggerEvent) == null ? void 0 : c.eventId) && b.disposition === "pending") {
          if (b.eventType !== "mousedown") break;
          Bt(b.eventId) === m && vl(b) === h && (r.has(b.eventId) || (n.memberEvents.push({
            eventId: b.eventId,
            eventType: b.eventType,
            timestamp: b.timestamp,
            captureSeq: b.captureSeq,
            target: b.targetIdentity ?? e.trigger,
            isTrusted: !0
          }), r.add(b.eventId)), this.ledger.setDisposition(b.eventId, "claimed", n.interactionId, e.type));
          break;
        }
      }
    }
    n.metadata.repeatCount = (typeof n.metadata.repeatCount == "number" ? n.metadata.repeatCount : 0) + 1;
    try {
      (f = (l = this.config).onDedupFold) == null || f.call(l, n, e);
    } catch (h) {
      this.logError(e.type, "onDedupFold", h);
    }
  }
  /**
   * Check if this interaction is a duplicate of the last emitted interaction
   * of the SAME type. Per-type dedup prevents interleaved interactions of
   * different types from resetting the dedup window.
   *
   * Dedup rules:
   * - Same type + same elementKey + gap (endTime_prev → startTime_now) ≤ DEDUP_WINDOW_MS
   * - DatePicker: also compare selectedDate — same date = duplicate
   */
  isDuplicate(e, n, r) {
    const o = this.dedupByType.get(e.type);
    if (!o) return !1;
    if ((e.type === "Checkbox" || e.type === "RadioButton") && o.elementKey !== r) {
      const c = String(o.metadata.targetName ?? ""), l = String(n.targetName ?? "");
      if (c && c === l && e.startTime - o.endTime <= Gs)
        return !0;
    }
    if (o.elementKey !== r || e.startTime - o.endTime > Gs) return !1;
    if (e.type === "DatePicker") {
      const c = o.metadata.selectedDate, l = n.selectedDate;
      if (c !== l) return !1;
    }
    return e.type !== "Scroll";
  }
  /**
   * Find the definition for a given interaction type.
   */
  findDefForType(e) {
    return this.definitions.find((n) => n.type === e) ?? null;
  }
  /**
   * Track a seen event ID. Halve the set when it exceeds the cap.
   */
  trackSeenEvent(e) {
    if (this.seenEventIds.add(e), this.seenEventIds.size > yl) {
      const n = [...this.seenEventIds], r = n.slice(Math.floor(n.length / 2));
      this.seenEventIds = new Set(r);
    }
  }
  /**
   * Log an error from a definition method without crashing the runtime.
   */
  logError(e, n, r) {
    const o = `[${e}.${n}] ${r instanceof Error ? r.message : String(r)}`;
    this.errorLog.push(o);
  }
}
const El = {
  type: "DragDrop",
  priority: 5,
  triggerEventTypes: /* @__PURE__ */ new Set(["dragstart"]),
  detectTrigger(t) {
    return t.eventType !== "dragstart" ? null : { type: "DragDrop" };
  },
  isInScope(t, e) {
    if (t.eventType === "drop") return !0;
    const n = he(t.target), r = he(e.trigger);
    return n === r;
  },
  handleEvent(t, e) {
    if (t.eventType === "drop")
      return e.data.dropTarget = t.target, e.data.dropTargetName = He(
        t.target.accessibleName,
        t.target.ariaLabel
      ), { endState: "completed" };
    if (t.eventType === "dragstart") {
      const n = he(t.target), r = he(e.trigger);
      if (n === r)
        return null;
    }
    return null;
  },
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  buildResult(t, e) {
    const n = He(
      t.trigger.accessibleName,
      t.trigger.ariaLabel
    ), r = t.data.dropTarget, o = t.data.dropTargetName ?? "";
    return {
      metadata: {
        sourceName: n,
        sourceTag: t.trigger.tag,
        sourceRole: t.trigger.ariaRole,
        dropTargetName: o,
        dropTargetTag: (r == null ? void 0 : r.tag) ?? null,
        dropTargetRole: (r == null ? void 0 : r.ariaRole) ?? null
      }
    };
  }
}, Sl = /* @__PURE__ */ new Set([
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Escape",
  "Tab",
  "Enter",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Backspace"
]);
function Tl(t) {
  const e = [];
  t.ctrlKey && e.push("Ctrl"), t.metaKey && e.push("Cmd"), t.altKey && e.push("Alt"), t.shiftKey && e.push("Shift");
  const r = {
    " ": "Space",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Escape: "Esc",
    Backspace: "Backspace",
    Delete: "Del",
    Enter: "Enter",
    Tab: "Tab"
  }[t.key ?? ""] ?? t.key ?? "";
  return r && e.push(r), e.join("+");
}
const Cl = {
  type: "KeyboardShortcut",
  priority: 8,
  triggerEventTypes: /* @__PURE__ */ new Set(["keydown"]),
  detectTrigger(t) {
    return t.eventType !== "keydown" || t.key === null ? null : t.ctrlKey || t.metaKey || t.altKey ? { type: "KeyboardShortcut" } : t.shiftKey && Sl.has(t.key) ? { type: "KeyboardShortcut" } : /^F\d{1,2}$/.test(t.key) ? { type: "KeyboardShortcut" } : null;
  },
  isInScope(t, e) {
    return !1;
  },
  handleEvent(t, e) {
    return { endState: "completed" };
  },
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  buildResult(t, e) {
    return {
      metadata: {
        shortcut: Tl(t.triggerEvent),
        key: t.triggerEvent.key,
        code: t.triggerEvent.code,
        ctrlKey: t.triggerEvent.ctrlKey,
        metaKey: t.triggerEvent.metaKey,
        altKey: t.triggerEvent.altKey,
        shiftKey: t.triggerEvent.shiftKey,
        targetName: t.trigger.accessibleName ?? t.trigger.ariaLabel ?? t.trigger.tag
      }
    };
  }
}, kl = {
  type: "DatePicker",
  priority: 10,
  triggerEventTypes: /* @__PURE__ */ new Set([
    "focus",
    "click"
  ]),
  detectTrigger(t) {
    const { tag: e, className: n, name: r, placeholder: o } = t.target, { inputType: s, ariaHasPopup: c } = t.domContext;
    if (c === "listbox")
      return null;
    if (Ys(e, s, n, c, r, o))
      return { type: "DatePicker" };
    if (Un(t.target.ariaRole, t.target.className) || Un(t.target.ariaRole, t.target.className, t.target.accessibleName)) return null;
    const f = t.domContext.ancestorClasses.join(" ");
    return Ys(e, s, f, null, r) ? { type: "DatePicker" } : null;
  },
  isInScope(t, e) {
    const n = he(t.target), r = he(e.trigger);
    if (n === r || Kr(t.target.className)) return !0;
    const o = t.domContext.ancestorClasses.join(" ");
    return !!(Kr(o) || Un(t.target.ariaRole, t.target.className, t.target.accessibleName));
  },
  handleEvent(t, e) {
    if (e.data.surfaceRole || (e.data.surfaceRole = e.triggerEvent.domContext.ariaHasPopup === "grid" ? "grid" : null), (t.eventType === "input" || t.eventType === "change") && t.valueAfter && t.valueAfter.trim() && (e.data.dateValue = t.valueAfter, e.data.selectedDate = t.valueAfter), t.eventType === "blur") {
      const n = e.data.dateValue || t.valueAfter || "";
      return n.trim() ? (e.data.dateValue = n, e.data.selectedDate = n, { endState: "completed" }) : { endState: "abandoned" };
    }
    if ((t.eventType === "click" || t.eventType === "mousedown") && Un(t.target.ariaRole, t.target.className, t.target.accessibleName))
      return Xs(t.target.ariaRole, t.target.accessibleName, t.target.className) || (e.data.selectedDate = t.target.accessibleName || "", e.data.dateValue = t.valueAfter ?? t.target.accessibleName ?? "", !(e.data.dateValue || "").trim()) ? null : { endState: "completed" };
    if (t.eventType === "change" && e.trigger.tag === "INPUT") {
      const n = t.valueAfter ?? e.data.dateValue ?? "";
      if (n.trim())
        return e.data.selectedDate = n, e.data.dateValue = n, { endState: "completed" };
    }
    return (t.eventType === "click" || t.eventType === "mousedown") && Xs(t.target.ariaRole, t.target.accessibleName, t.target.className), null;
  },
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  buildResult(t, e) {
    const n = t.data.selectedDate ?? "", r = t.data.dateValue ?? "";
    return {
      metadata: {
        targetName: He(
          t.trigger.accessibleName,
          t.trigger.ariaLabel,
          t.trigger.placeholder
        ),
        selectedDate: n,
        dateValue: r
      }
    };
  },
  // W3C-standard semantic children for ownership testing.
  // Only role="gridcell" and native <td> are recognized as date cells.
  semanticChildRoles: ["gridcell"],
  semanticChildTags: ["TD"]
}, Al = {
  type: "Dropdown",
  priority: 20,
  triggerEventTypes: /* @__PURE__ */ new Set([
    "click",
    "mousedown",
    "focus"
  ]),
  detectTrigger(t) {
    const { tag: e, ariaRole: n, className: r } = t.target, { ariaHasPopup: o, inputType: s, isContentEditable: c } = t.domContext;
    if (La(e, s, n, c) && t.domContext.readOnly !== !0 || qr(n, r))
      return null;
    if (Hs(e, n, r))
      return { type: "Dropdown" };
    if (o === "listbox")
      return { type: "Dropdown" };
    if (e === "INPUT" && s === "text" && t.domContext.readOnly) {
      const l = t.domContext.ancestorClasses.join(" ");
      if (Hs("", null, l))
        return { type: "Dropdown" };
    }
    return null;
  },
  // Capture surface role from aria-haspopup for ownership testing.
  // detectTrigger returns ComponentTrigger (not ctx), so surfaceRole is
  // captured in handleEvent when the first in-scope event arrives.
  // The runtime's lifecycleOwnsTarget() reads ctx.data.surfaceRole.
  isInScope(t, e) {
    const n = he(t.target), r = he(e.trigger);
    if (n === r || qr(t.target.ariaRole, t.target.className))
      return !0;
    if (Or(t.target.className) || Or(t.domContext.ancestorClasses.join(" "))) {
      const { tag: o, ariaRole: s } = t.target;
      return !(o === "BUTTON" || o === "A" || o === "INPUT" || s === "button" || s === "link" || s === "checkbox" || s === "radio" || s === "spinbutton" || s === "slider");
    }
    return !1;
  },
  handleEvent(t, e) {
    if (e.data.surfaceRole || (e.data.surfaceRole = e.triggerEvent.domContext.ariaHasPopup === "listbox" ? "listbox" : null), (t.eventType === "click" || t.eventType === "mousedown") && (Un(t.target.ariaRole, t.target.className, t.target.accessibleName) || Da(t.target.accessibleName, t.target.ariaLabel)))
      return null;
    if ((t.eventType === "click" || t.eventType === "mousedown") && qr(t.target.ariaRole, t.target.className)) {
      const n = t.target.accessibleName || t.target.ariaLabel || "", r = Or(t.target.className) || Or(t.domContext.ancestorClasses.join(" ")), o = Kr(t.target.className) || Kr(t.domContext.ancestorClasses.join(" "));
      return r && !o || e.data.surfaceRole != null && // Phase 6D.0: semantic-role parse — capture stores `div[role=listbox]`,
      // surfaceRole is the bare token 'listbox'.
      oi(t.domContext.ancestorRoles).includes(
        e.data.surfaceRole
      ) ? (e.data.selectedValue = n, e.data.selectionConfirmed = !0, { endState: "completed" }) : (e.data.pendingOptionClick = { eventId: t.eventId, name: n }, null);
    }
    if (t.eventType === "change" && e.trigger.tag === "SELECT")
      return e.data.selectedValue = t.valueAfter ?? "", e.data.selectionConfirmed = !0, e.data.nativeSelectActive = !0, null;
    if (t.eventType === "blur" && e.trigger.tag === "SELECT" && e.data.nativeSelectActive === !0)
      return t.valueAfter != null && t.valueAfter !== "" && (e.data.selectedValue = t.valueAfter), { endState: "completed" };
    if (t.eventType === "click" || t.eventType === "mousedown") {
      const n = he(t.target), r = he(e.trigger);
      if (n === r) return null;
    }
    return null;
  },
  shouldCancelOnOutside(t, e) {
    if (e.data.pendingOptionClick == null || !ut.has(t.eventType)) return !1;
    const n = he(t.target), r = he(e.trigger);
    return n !== r;
  },
  buildResult(t, e) {
    const n = t.data.selectedValue ?? "", r = t.trigger.accessibleName || t.triggerEvent.valueBefore || "", o = He(
      t.trigger.accessibleName,
      t.trigger.ariaLabel,
      t.trigger.placeholder,
      t.trigger.className
    ), s = zs(n), c = zs(r), l = s === c && s !== "", f = t.data.pendingOptionClick, h = t.data.selectionConfirmed === !0, m = {
      targetName: o,
      selectedValue: n,
      noOpSelection: l
    };
    return h ? m.selectionConfirmed = !0 : f && (m.provisionalSelection = f.name, m.selectionConfirmed = !1), { metadata: m };
  },
  // W3C-standard semantic children for ownership testing.
  // Only role="option" and native <option> are recognized as dropdown items.
  semanticChildRoles: ["option"],
  semanticChildTags: ["OPTION"]
}, _l = {
  type: "Slider",
  priority: 25,
  triggerEventTypes: /* @__PURE__ */ new Set(["focus"]),
  detectTrigger(t) {
    if (t.eventType !== "focus") return null;
    const { tag: e, ariaRole: n } = t.target, { inputType: r } = t.domContext;
    return ml(e, r, n) ? { type: "Slider" } : null;
  },
  isInScope(t, e) {
    return he(t.target) === he(e.trigger);
  },
  handleEvent(t, e) {
    if (t.eventType === "input" || t.eventType === "change")
      return e.data.userAdjusted = !0, e.data.finalValue = t.valueAfter ?? null, null;
    if (t.eventType === "blur") {
      if (t.valueAfter != null && (e.data.finalValue = t.valueAfter, e.data.userAdjusted !== !0)) {
        const n = e.triggerEvent.valueBefore;
        n != null && t.valueAfter !== n && (e.data.userAdjusted = !0);
      }
      return { endState: "completed" };
    }
    return null;
  },
  shouldCancelOnOutside(t, e) {
    return t.eventType === "click" ? he(t.target) !== he(e.trigger) : !1;
  },
  buildResult(t, e) {
    const n = t.data.userAdjusted === !0, r = t.data.finalValue ?? null;
    return {
      metadata: {
        targetName: He(
          t.trigger.accessibleName,
          t.trigger.ariaLabel,
          t.trigger.placeholder
        ),
        value: r ?? t.triggerEvent.valueBefore ?? null,
        userAdjusted: n
      }
    };
  }
}, Rl = /* @__PURE__ */ new Set([
  "input",
  "change",
  "blur"
]), Nl = {
  type: "ColorInput",
  priority: 15,
  triggerEventTypes: /* @__PURE__ */ new Set(["focus"]),
  detectTrigger(t) {
    return t.eventType !== "focus" ? null : t.target.tag === "INPUT" && t.domContext.inputType === "color" ? { type: "ColorInput" } : null;
  },
  isInScope(t, e) {
    return Rl.has(t.eventType) ? he(t.target) === he(e.trigger) : !1;
  },
  handleEvent(t, e) {
    const n = e.triggerEvent.valueBefore;
    return t.eventType === "input" || t.eventType === "change" ? (t.valueAfter != null && t.valueAfter !== n && (e.data.userAdjusted = !0, e.data.finalValue = t.valueAfter), null) : t.eventType === "blur" ? (t.valueAfter != null && (e.data.finalValue = t.valueAfter, e.data.userAdjusted !== !0 && n != null && t.valueAfter !== n && (e.data.userAdjusted = !0)), { endState: "completed" }) : null;
  },
  shouldCancelOnOutside(t, e) {
    return t.eventType === "click" ? he(t.target) !== he(e.trigger) : !1;
  },
  buildResult(t, e) {
    const n = t.data.userAdjusted === !0, r = t.data.finalValue ?? null;
    return {
      metadata: {
        targetName: He(
          t.trigger.accessibleName,
          t.trigger.ariaLabel,
          t.trigger.placeholder
        ),
        value: r ?? t.triggerEvent.valueBefore ?? null,
        userAdjusted: n
      }
    };
  }
}, Ol = /\b(?:checkbox.*wrapper|checkbox.*input|oxd-checkbox|checkbox-input|custom-checkbox)\b/i, Pl = {
  type: "Checkbox",
  priority: 30,
  // Only trigger on click — change events are a side-effect of the click.
  // Triggering on both click and change causes double-capture when the
  // browser fires both events for the same user action.
  triggerEventTypes: /* @__PURE__ */ new Set(["click"]),
  detectTrigger(t) {
    const { tag: e, ariaRole: n, className: r } = t.target, { inputType: o, ancestorClasses: s } = t.domContext;
    if (ll(e, o, n))
      return { type: "Checkbox" };
    const c = (r ?? "") + " " + s.join(" ");
    return Ol.test(c) ? { type: "Checkbox" } : null;
  },
  isInScope(t, e) {
    return !1;
  },
  handleEvent(t, e) {
    return { endState: "completed" };
  },
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  buildResult(t, e) {
    let n;
    return t.triggerEvent.checkedBefore !== null ? n = t.triggerEvent.checkedBefore : n = !0, {
      metadata: {
        targetName: He(
          t.trigger.accessibleName,
          t.trigger.ariaLabel,
          t.trigger.placeholder
        ),
        checked: n
      }
    };
  }
}, xl = {
  type: "FileUpload",
  priority: 35,
  triggerEventTypes: /* @__PURE__ */ new Set(["click", "change"]),
  detectTrigger(t) {
    const { tag: e } = t.target, { inputType: n } = t.domContext;
    return hl(e, n) ? { type: "FileUpload" } : null;
  },
  isInScope(t, e) {
    return !1;
  },
  handleEvent(t, e) {
    return { endState: "completed" };
  },
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  buildResult(t, e) {
    return {
      metadata: {
        targetName: He(
          t.trigger.accessibleName,
          t.trigger.ariaLabel,
          t.trigger.placeholder
        ),
        fileName: t.triggerEvent.valueAfter ?? null
      }
    };
  }
}, $l = /\b(?:radio.*wrapper|radio.*input|oxd-radio|radio-input|radio-btn|custom-radio)\b/i, Dl = {
  type: "RadioButton",
  priority: 40,
  triggerEventTypes: /* @__PURE__ */ new Set(["click", "change"]),
  detectTrigger(t) {
    const { tag: e, ariaRole: n, className: r } = t.target, { inputType: o, ancestorClasses: s } = t.domContext;
    if (dl(e, o, n))
      return { type: "RadioButton" };
    const c = (r ?? "") + " " + s.join(" ");
    return $l.test(c) ? { type: "RadioButton" } : null;
  },
  isInScope(t, e) {
    return !1;
  },
  handleEvent(t, e) {
    return { endState: "completed" };
  },
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  buildResult(t, e) {
    return {
      metadata: {
        targetName: He(
          t.trigger.accessibleName,
          t.trigger.ariaLabel,
          t.trigger.placeholder
        ),
        noOpSelection: !1
      }
    };
  }
}, Ll = {
  type: "TextEntry",
  priority: 50,
  triggerEventTypes: /* @__PURE__ */ new Set(["focus"]),
  detectTrigger(t) {
    if (t.eventType !== "focus") return null;
    const { tag: e, ariaRole: n } = t.target, { inputType: r, isContentEditable: o } = t.domContext;
    return La(e, r, n, o) ? { type: "TextEntry" } : null;
  },
  isInScope(t, e) {
    return he(t.target) === he(e.trigger);
  },
  handleEvent(t, e) {
    return t.eventType === "input" || t.eventType === "change" ? (e.data.userTyped = !0, e.data.textValue = t.valueAfter ?? "", e.data.typedValue = t.valueAfter ?? "", null) : t.eventType === "blur" ? (t.valueAfter != null && t.valueAfter !== "" && (e.data.textValue = t.valueAfter, e.data.userTyped !== !0 && (e.data.userTyped = !0), e.data.typedValue == null && (e.data.typedValue = t.valueAfter)), { endState: "completed" }) : null;
  },
  shouldCancelOnOutside(t, e) {
    return t.eventType === "click" ? he(t.target) !== he(e.trigger) : !1;
  },
  buildResult(t, e) {
    var m, g;
    const n = t.data.userTyped === !0, r = t.data.textValue ?? "", o = t.data.typedValue ?? r, s = He(
      t.trigger.accessibleName,
      t.trigger.ariaLabel,
      t.trigger.placeholder
    ), c = (m = t.triggerEvent.domContext) == null ? void 0 : m.ariaAutoComplete, l = (g = t.triggerEvent.domContext) == null ? void 0 : g.listId, f = typeof c == "string" && c !== "" ? c : typeof l == "string" && l !== "" ? "datalist" : void 0, h = {
      targetName: s,
      textValue: r,
      typedValue: o,
      userTyped: n
    };
    return f !== void 0 && (h.comboboxSignal = f), { metadata: h };
  }
}, Ml = 100, Vl = 70, ql = 65, Ul = 60, Bl = 50, qa = 50, zi = 500, jl = 3e3, Fl = 10, Zs = /* @__PURE__ */ new Set([
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tooltip",
  "tab"
]), Kl = /* @__PURE__ */ new Set([
  "menu",
  "listbox",
  "dialog",
  "tooltip",
  "tree",
  "grid"
]), Gl = /\b(?:has-submenu|has-children|submenu|mega-menu|nav-item|menu-link|menu-trigger|dropdown-trigger|popover-trigger|drawer-toggle|nav-link|with-dropdown)\b/i, Hl = /\b(?:navbar|navigation|header-nav|main-nav|primary-nav|top-nav|side-nav|main-menu|primary-menu)\b/i, zl = /* @__PURE__ */ new Set([
  "mouseenter",
  "mouseleave",
  "mousemove"
]), Wl = {
  type: "Hover",
  priority: 60,
  triggerEventTypes: /* @__PURE__ */ new Set(["mouseenter"]),
  detectTrigger(t) {
    if (t.eventType !== "mouseenter") return null;
    const { tag: e, ariaRole: n, className: r } = t.target;
    return $a(e, n, r, t.domContext.tabIndex ?? null) ? { type: "Hover" } : null;
  },
  isInScope(t, e) {
    return zl.has(t.eventType);
  },
  handleEvent(t, e) {
    if (e.data.pointerOriginX === void 0 && t.clientX !== null && (e.data.pointerOriginX = t.clientX, e.data.pointerOriginY = t.clientY, e.data.maxDisplacement = 0), Js(t, e), t.eventType === "mouseleave") {
      if (he(t.target) === he(e.trigger)) {
        const r = t.timestamp - e.startTime;
        return e.data.dwellMs = r, (e.data.confidence ?? 0) >= qa ? (e.data.meaningful = !0, { endState: "completed" }) : { endState: "discarded" };
      }
      return null;
    }
    return t.eventType === "mousemove" && (Yl(t, e), Js(t, e)), null;
  },
  shouldCancelOnOutside(t, e) {
    return t.eventType === "click";
  },
  buildResult(t, e) {
    return {
      metadata: {
        targetName: He(
          t.trigger.accessibleName,
          t.trigger.ariaLabel,
          t.trigger.placeholder
        ),
        dwellMs: t.data.dwellMs ?? 0,
        meaningful: t.data.meaningful === !0,
        confidence: t.data.confidence ?? 0,
        evidenceReason: t.data.evidenceReason ?? null
      }
    };
  }
};
function Js(t, e) {
  const n = e.data.confidence ?? 0, r = t.timestamp - e.startTime;
  if (e.data.evidenceAriaExpanded !== !0 && t.domContext.ariaExpanded === !0 && e.triggerEvent.domContext.ariaExpanded !== !0) {
    e.data.confidence = n + Ml, e.data.evidenceAriaExpanded = !0, Mn(e, "aria-expanded");
    return;
  }
  if (e.data.evidenceOverlayRole !== !0 && r >= zi) {
    const o = e.triggerEvent.target.ariaRole, s = e.triggerEvent.domContext.ancestorRoles ?? [];
    if (o && Zs.has(o) || oi(s).some((l) => Zs.has(l))) {
      e.data.confidence = (e.data.confidence ?? 0) + Vl, e.data.evidenceOverlayRole = !0, Mn(e, "overlay-role-dwell");
      return;
    }
  }
  if (e.data.evidenceOverlayCss !== !0 && r >= zi) {
    const o = e.triggerEvent.target.className ?? "", s = (e.triggerEvent.domContext.ancestorClasses ?? []).join(" "), c = `${o} ${s}`, l = Gl.test(c), f = Hl.test(s);
    if (l || f) {
      e.data.confidence = (e.data.confidence ?? 0) + ql, e.data.evidenceOverlayCss = !0, Mn(e, l ? "overlay-css" : "nav-ancestor");
      return;
    }
  }
  if (e.data.evidenceHasPopup !== !0 && r >= zi) {
    const o = e.triggerEvent.domContext.ariaHasPopup;
    if (o && Kl.has(o)) {
      e.data.confidence = (e.data.confidence ?? 0) + Ul, e.data.evidenceHasPopup = !0, Mn(e, "haspopup-dwell");
      return;
    }
  }
  if (e.data.evidenceSustainedDwell !== !0 && r >= jl && (e.data.maxDisplacement ?? 999) <= Fl) {
    e.data.confidence = (e.data.confidence ?? 0) + Bl, e.data.evidenceSustainedDwell = !0, Mn(e, "sustained-dwell-stationary");
    return;
  }
}
function Yl(t, e) {
  if (t.clientX === null || t.clientY === null) return;
  const n = e.data.pointerOriginX ?? t.clientX, r = e.data.pointerOriginY ?? t.clientY, o = t.clientX - n, s = t.clientY - r, c = Math.sqrt(o * o + s * s), l = e.data.maxDisplacement ?? 0;
  c > l && (e.data.maxDisplacement = c);
}
function Mn(t, e) {
  (t.data.confidence ?? 0) >= qa && !t.data.evidenceReason && (t.data.evidenceReason = e, t.data.meaningful = !0);
}
const Xl = {
  type: "Link",
  priority: 70,
  triggerEventTypes: /* @__PURE__ */ new Set(["click"]),
  detectTrigger(t) {
    const { tag: e, ariaRole: n } = t.target;
    return fl(e, n) ? { type: "Link" } : null;
  },
  isInScope(t, e) {
    return !1;
  },
  handleEvent(t, e) {
    return { endState: "completed" };
  },
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  buildResult(t, e) {
    return {
      metadata: {
        targetName: He(
          t.trigger.accessibleName,
          t.trigger.ariaLabel,
          t.trigger.placeholder
        ),
        href: t.trigger.href ?? null
      }
    };
  }
}, Ql = {
  type: "Tab",
  priority: 65,
  triggerEventTypes: /* @__PURE__ */ new Set(["click"]),
  detectTrigger(t) {
    const { ariaRole: e } = t.target;
    return gl(e) ? { type: "Tab" } : null;
  },
  isInScope(t, e) {
    return !1;
  },
  handleEvent(t, e) {
    return { endState: "completed" };
  },
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  buildResult(t, e) {
    return {
      metadata: {
        targetName: He(
          t.trigger.accessibleName,
          t.trigger.ariaLabel,
          t.trigger.placeholder
        )
      }
    };
  }
}, Zl = {
  type: "Expander",
  priority: 80,
  triggerEventTypes: /* @__PURE__ */ new Set(["click"]),
  detectTrigger(t) {
    const e = t.domContext.ariaExpanded;
    return e !== !0 && e !== !1 ? null : { type: "Expander" };
  },
  isInScope(t, e) {
    return !1;
  },
  handleEvent(t, e) {
    return { endState: "completed" };
  },
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  buildResult(t, e) {
    return {
      metadata: {
        targetName: He(
          t.trigger.accessibleName,
          t.trigger.ariaLabel,
          t.trigger.placeholder,
          t.trigger.className
        ),
        targetTag: t.trigger.tag,
        targetRole: t.trigger.ariaRole,
        clientX: t.triggerEvent.clientX,
        clientY: t.triggerEvent.clientY,
        // PRE-flip value at trigger time — diagnostic only. The POST-flip
        // direction lives on the behavioral layer (contract.expanded /
        // state row). Never a replay input.
        expandedAtTrigger: t.triggerEvent.domContext.ariaExpanded
      }
    };
  }
}, Jl = 500, ed = {
  type: "Scroll",
  priority: 110,
  triggerEventTypes: /* @__PURE__ */ new Set(["scroll"]),
  detectTrigger(t) {
    return t.eventType !== "scroll" ? null : { type: "Scroll" };
  },
  /**
   * isInScope: A scroll event is in-scope if it arrives within
   * SCROLL_BURST_GAP_MS of the last scroll event in this component.
   * This is how consecutive scroll events are coalesced into one gesture.
   *
   * Non-scroll events are never in scope (Scroll doesn't own them).
   */
  isInScope(t, e) {
    if (t.eventType !== "scroll") return !1;
    const n = e.memberEvents[e.memberEvents.length - 1];
    return n ? t.timestamp - n.timestamp <= Jl : !1;
  },
  /**
   * handleEvent: Accumulate scroll position. Never completes on a scroll
   * event — the burst continues. Completion is driven by the runtime when
   * isInScope returns false for the next event (a non-scroll or a scroll
   * after the gap), or by the stale-component timeout.
   *
   * Note: The runtime doesn't have a "complete when leaving scope" mechanism
   * built into handleEvent. Instead, when isInScope returns false for an
   * active Scroll and shouldCancelOnOutside returns false, the Scroll stays
   * on the stack. The runtime's cleanupStaleComponents will eventually flush it.
   *
   * To ensure the Scroll completes promptly when the burst ends, we use a
   * self-contained timeout approach: if the gap between the current event
   * and the last member event exceeds SCROLL_BURST_GAP_MS, complete here.
   */
  handleEvent(t, e) {
    if (t.eventType !== "scroll") return null;
    const n = t.scrollDeltaY ?? 0, r = t.scrollDeltaX ?? 0;
    return e.data.lastScrollY = n, e.data.lastScrollX = r, null;
  },
  /**
   * Never abandon on outside events — Scroll is a passive accumulator.
   * Completion happens via shouldCompleteOnOutside, timeout, or navigation flush.
   */
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  /**
   * Complete the scroll gesture when any non-scroll event arrives.
   * This is how a scroll burst is finalized — the user moved on to a
   * different action, so the accumulated scroll delta is emitted as
   * a single completed interaction.
   */
  shouldCompleteOnOutside(t, e) {
    return !0;
  },
  buildResult(t, e) {
    const n = t.triggerEvent.scrollDeltaY ?? 0, r = t.triggerEvent.scrollDeltaX ?? 0, o = t.data.lastScrollY ?? n, s = t.data.lastScrollX ?? r, c = o - n, l = s - r, f = t.triggerEvent.target, h = he(f), m = f.tag === "HTML" || f.tag === "BODY" || h === "html" || h === "body";
    return {
      metadata: {
        scrollDeltaY: c,
        scrollDeltaX: l,
        hasDelta: pl(c, l),
        pageUrl: t.triggerEvent.pageUrl,
        scrollTarget: m ? "page" : f.accessibleName || f.className || f.tag || "container",
        scrollTargetType: m ? "page" : "container"
      }
    };
  }
}, td = {
  type: "Navigation",
  priority: 120,
  triggerEventTypes: /* @__PURE__ */ new Set(["navigation"]),
  detectTrigger(t) {
    return t.eventType === "navigation" ? { type: "Navigation" } : null;
  },
  isInScope(t, e) {
    return !1;
  },
  handleEvent(t, e) {
    return { endState: "completed" };
  },
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  buildResult(t, e) {
    return {
      metadata: {
        pageUrl: t.triggerEvent.pageUrl,
        pageTitle: t.triggerEvent.pageTitle
      }
    };
  }
}, nd = {
  type: "Click",
  priority: 180,
  triggerEventTypes: /* @__PURE__ */ new Set([
    "click",
    "contextmenu"
  ]),
  detectTrigger(t) {
    const { tag: e, ariaRole: n, className: r } = t.target, o = t.domContext.tabIndex ?? null;
    return !$a(e, n, r, o) && !Ju(
      t.domContext.ancestorRoles,
      t.domContext.ancestorClasses
    ) && !t.target.autoId && !t.target.dataAutoId && !t.domContext.pointerCursor && !t.domContext.clickHandler ? null : { type: "Click" };
  },
  isInScope(t, e) {
    return !1;
  },
  handleEvent(t, e) {
    return { endState: "completed" };
  },
  shouldCancelOnOutside(t, e) {
    return !1;
  },
  buildResult(t, e) {
    return {
      metadata: {
        // S2: pass the icon class tokens so icon-only targets (<i class="icon-plus">)
        // get a derived name instead of the vacuous 'element'.
        targetName: He(
          t.trigger.accessibleName,
          t.trigger.ariaLabel,
          t.trigger.placeholder,
          t.trigger.className
        ),
        targetTag: t.trigger.tag,
        targetRole: t.trigger.ariaRole,
        clientX: t.triggerEvent.clientX,
        clientY: t.triggerEvent.clientY
      }
    };
  }
}, Ua = [
  El,
  // priority 5
  Cl,
  // priority 8
  kl,
  // priority 10
  Al,
  // priority 20
  _l,
  // priority 25
  Nl,
  // priority 15
  Pl,
  // priority 30
  xl,
  // priority 35
  Dl,
  // priority 40
  Ll,
  // priority 50
  Wl,
  // priority 60
  Ql,
  // priority 65
  Xl,
  // priority 70
  Zl,
  // priority 80 (7.4-B1: aria-expanded disclosure)
  ed,
  // priority 110
  td,
  // priority 120
  nd
  // priority 180 (fallback)
], vt = {
  close: "Close",
  x: "Close",
  cancel: "Close",
  delete: "Delete",
  trash: "Delete",
  remove: "Remove",
  edit: "Edit",
  pencil: "Edit",
  editpencil: "Edit",
  add: "Add",
  plus: "Add",
  search: "Search",
  magnifier: "Search",
  filter: "Filter",
  funnel: "Filter",
  download: "Download",
  upload: "Upload",
  refresh: "Refresh",
  reload: "Refresh",
  sync: "Refresh",
  settings: "Settings",
  gear: "Settings",
  cog: "Settings",
  bell: "Notifications",
  notification: "Notifications",
  menu: "Menu",
  hamburger: "Menu",
  more: "More options",
  overflow: "More options",
  ellipsis: "More options",
  chevrondown: "Expand",
  chevronup: "Collapse",
  chevronright: "Expand",
  chevronleft: "Back",
  arrowright: "Next",
  arrowleft: "Previous",
  arrowup: "Up",
  arrowdown: "Down",
  star: "Favourite",
  heart: "Favourite",
  favorite: "Favourite",
  favourite: "Favourite",
  bookmark: "Bookmark",
  share: "Share",
  copy: "Copy",
  clipboard: "Copy",
  print: "Print",
  printer: "Print",
  home: "Home",
  user: "User",
  person: "User",
  account: "Account",
  info: "Info",
  help: "Help",
  question: "Help",
  warning: "Warning",
  alert: "Alert",
  check: "Confirm",
  checkmark: "Confirm",
  tick: "Confirm",
  eye: "Show",
  eyeoff: "Hide",
  lock: "Lock",
  unlock: "Unlock",
  logout: "Sign out",
  signin: "Sign in",
  login: "Sign in"
}, rd = [
  { framework: "MUI", re: /\bMui\w+/ },
  { framework: "AntDesign", re: /\bant-\w+/ },
  { framework: "PrimeReact", re: /\bp-\w+/ },
  { framework: "AGGrid", re: /\bag-(?:theme|header|row|cell|grid)\b/ },
  { framework: "ChakraUI", re: /\bchakra-\w+/ },
  { framework: "RadixUI", re: /\bradix-\w+|data-radix/ },
  { framework: "OXD", re: /\boxd-\w+/ },
  { framework: "Syncfusion", re: /\be-control\b|\bsf-\w+/ },
  { framework: "DevExtreme", re: /\bdx-\w+/ },
  { framework: "Quill", re: /\bql-(?:editor|toolbar)\b/ },
  { framework: "TinyMCE", re: /\btox-(?:editor|edit-area)\b/ }
];
function id(t) {
  for (const { framework: e, re: n } of rd)
    if (n.test(t)) return e;
  return "Generic";
}
const od = /\b(?:ag-(?:grid|header|row|cell|theme)|MuiDataGrid|ant-table|p-datatable|oxd-table|data-grid|grid-view)\b/i, sd = /\b(?:tree-view|ant-tree|p-tree|MuiTreeItem)\b/i, ad = /\b(?:accordion|MuiAccordion|ant-collapse|p-accordion)\b/i, cd = /\b(?:modal|MuiDialog|ant-modal|p-dialog|dialog|popup|overlay)\b/i, ud = /\b(?:drawer|MuiDrawer|ant-drawer|sidebar|slide-over|offcanvas)\b/i, ld = /\b(?:carousel|swiper|slick|slide|slider-track)\b/i, dd = /\b(?:context-menu|dropdown-menu|ant-dropdown-menu|p-menu|popover-menu)\b/i, fd = /\b(?:breadcrumb|MuiBreadcrumbs|ant-breadcrumb)\b/i, pd = /\b(?:stepper|MuiStepper|ant-steps|p-steps|wizard)\b/i, hd = /\b(?:sort|sortable|column-header)\b/i, md = /\b(?:grid-toggle|list-toggle|view-toggle|layout-toggle|grid-view|list-view)\b/i, gd = /\b(?:autocomplete|MuiAutocomplete|ant-select-show-search|typeahead)\b/i, yd = /\b(?:ql-editor|tox-edit-area|rich-text|contenteditable-editor|ProseMirror)\b/i, vd = /\b(?:chip-input|MuiChipInput|tag-input|token-input)\b/i, wd = /\b(?:split-button|btn-group|MuiButtonGroup)\b/i, bd = /\b(?:spinner|loading|loader|progress-spinner|preloader)\b/i, Id = /\b(?:alert|MuiAlert|ant-alert|p-message|notification)\b/i, Ed = /\b(?:tooltip|MuiTooltip|ant-tooltip|p-tooltip|hint)\b/i, Sd = /\b(?:progress-bar|MuiLinearProgress|ant-progress|p-progressbar)\b/i, Td = /\b(?:rating|star-rating|MuiRating|ant-rate|p-rating)\b/i, Cd = /\b(?:toggle-switch|switch|MuiSwitch|ant-switch|p-toggleswitch)\b/i, kd = [
  // ── Specific structural elements checked first ──
  // SortButton and GridToggle must be checked BEFORE DataGrid,
  // because grid headers with sort often match both patterns.
  {
    type: "SortButton",
    test: (t, e, n) => hd.test(n)
  },
  {
    type: "GridToggle",
    test: (t, e, n) => md.test(n)
  },
  {
    type: "DataGrid",
    test: (t, e, n) => od.test(n) || t.ariaRole === "grid" || t.ariaRole === "gridcell" || t.ariaRole === "columnheader"
  },
  {
    type: "TreeView",
    test: (t, e, n) => sd.test(n) || t.ariaRole === "treeitem" || t.ariaRole === "tree"
  },
  {
    type: "Accordion",
    test: (t, e, n) => ad.test(n)
  },
  {
    type: "Dialog",
    test: (t, e, n) => cd.test(n) || t.ariaRole === "dialog"
  },
  {
    type: "Drawer",
    test: (t, e, n) => ud.test(n)
  },
  {
    type: "Carousel",
    test: (t, e, n) => ld.test(n)
  },
  {
    type: "ContextMenu",
    test: (t, e, n) => dd.test(n) || t.ariaRole === "menu"
  },
  {
    type: "Breadcrumb",
    test: (t, e, n) => fd.test(n)
  },
  {
    type: "Stepper",
    test: (t, e, n) => pd.test(n)
  },
  {
    type: "Autocomplete",
    test: (t, e, n) => gd.test(n)
  },
  {
    type: "RichTextEditor",
    test: (t, e, n) => yd.test(n) || e.isContentEditable
  },
  {
    type: "ChipInput",
    test: (t, e, n) => vd.test(n)
  },
  {
    type: "SplitButton",
    test: (t, e, n) => wd.test(n)
  },
  {
    type: "ProgressBar",
    test: (t, e, n) => Sd.test(n)
  },
  {
    type: "Rating",
    test: (t, e, n) => Td.test(n)
  },
  {
    type: "ToggleSwitch",
    test: (t, e, n) => Cd.test(n)
  }
];
function Ad(t) {
  return !(t.accessibleName && t.accessibleName.trim().length > 0 || t.ariaLabel && t.ariaLabel.trim().length > 0) && t.tag === "BUTTON";
}
function _d(t) {
  const e = t.toLowerCase(), n = e.match(/\bfa-(?:solid|regular|brands?-)?([a-z][-a-z0-9]+)\b/);
  if (n) {
    const s = n[1].replace(/[-_]/g, "");
    return vt[s] ? vt[s] : vt[n[1].replace(/-/g, "")] ? vt[n[1].replace(/-/g, "")] : n[1].replace(/-/g, " ");
  }
  const r = e.match(/\bicon-([a-z][-a-z0-9]+)\b/);
  if (r) {
    const s = r[1].replace(/[-_]/g, "");
    return vt[s] ? vt[s] : r[1].replace(/-/g, " ");
  }
  for (const [s, c] of Object.entries(vt))
    if (new RegExp(`\\b(?:${s}|icon-${s}|fa-${s})\\b`, "i").test(e)) return c;
  const o = e.match(/oxd-icon-(?:button-)?([a-z][-a-z0-9]*)/);
  if (o) {
    const s = o[1].replace(/[-_]/g, "");
    if (vt[s]) return vt[s];
  }
  return null;
}
function Rd(t) {
  const { target: e, domContext: n } = t, r = e.className ?? "", o = n.ancestorClasses.join(" "), s = `${r} ${o}`, c = id(s), l = {};
  let f = "Generic";
  for (const h of kd)
    if (h.test(e, n, s)) {
      f = h.type;
      break;
    }
  if (f === "Generic" && Ad(e)) {
    f = "IconButton";
    const h = _d(s);
    h && (l.iconName = h);
  }
  return f === "Generic" && (Id.test(s) ? f = "Alert" : Ed.test(s) ? f = "Tooltip" : bd.test(s) && (f = "Spinner")), f === "DataGrid" && e.accessibleName && (l.columnName = e.accessibleName), f === "SortButton" && e.accessibleName && (l.columnName = e.accessibleName), {
    componentType: f,
    componentFramework: c,
    businessMeaning: "",
    // resolved by MeaningResolver
    componentData: l
  };
}
function Ba(t) {
  let e = t.trim();
  for (; e.length >= 2 && e.startsWith('"') && e.endsWith('"'); )
    e = e.slice(1, -1);
  return e.replace(/"/g, "'");
}
function Nd(t, e) {
  if (t === "" || e === "") return !1;
  const n = Ba(t);
  if (n === e) return !0;
  const r = e.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  return n === r;
}
function Od(t, e = 60) {
  let n = t;
  try {
    const r = new URL(t);
    r.origin && r.origin !== "null" && (n = `${r.origin}${r.pathname}`);
  } catch {
  }
  return n.length > e ? `${n.slice(0, e)}…` : n;
}
function Pd(t, e) {
  const { type: n, metadata: r } = t, { componentType: o, componentData: s } = e, c = String(r.targetName ?? "element"), f = s.iconName != null && s.iconName !== "" && (c === "element" || c.endsWith(" icon")) ? String(s.iconName) : c;
  switch (o) {
    case "IconButton":
      return `Click ${s.iconName ?? f} button`;
    case "SortButton":
      return `Sort by ${s.columnName ?? f}`;
    case "GridToggle":
      return `Switch to ${f}`;
    case "DataGrid": {
      const h = s.columnName ?? f;
      return n === "Click" ? `Click ${h} in data grid` : `${n} on ${h} in data grid`;
    }
    case "TreeView":
      return `${n} on "${f}" tree node`;
    case "Accordion":
      return `${n} on "${f}" accordion section`;
    case "Carousel":
      return `${n} on carousel (${f})`;
    case "Dialog":
      return s.iconName === "Close" ? `Close the "${f}" dialog` : `${n} on "${f}" dialog`;
    case "Breadcrumb":
      return `Navigate to ${f} via breadcrumb`;
    case "Stepper":
      return `Go to ${f} step`;
    case "Rating":
      return `Rate ${r.value ?? ""} stars for ${f}`;
    case "ToggleSwitch":
      return `${r.checked === !0 ? "Enable" : "Disable"} ${f}`;
    case "RichTextEditor": {
      const h = String(r.textValue ?? "");
      return h ? `Type "${h}" in rich text editor` : "Click in rich text editor";
    }
    case "ChipInput": {
      const h = String(r.textValue ?? "");
      return h ? `Add tag "${h}"` : "Click in tag input";
    }
    case "ProgressBar":
      return `Interact with progress bar (${f})`;
    case "ContextMenu":
      return `Select "${f}" from context menu`;
    case "Drawer":
      return `${n} on "${f}" drawer`;
    case "SplitButton":
      return `${n} on "${f}" split button`;
    case "Alert":
      return `${n} on alert (${f})`;
    case "Tooltip":
      return `${n} on tooltip (${f})`;
    case "Spinner":
      return `${n} on spinner (${f})`;
  }
  switch (n) {
    case "Click":
      return `Click "${f}"`;
    case "TextEntry": {
      const h = String(r.textValue ?? "");
      return h ? `Enter "${h}" in "${f}"` : `Click in "${f}"`;
    }
    case "Dropdown": {
      const h = String(r.selectedValue ?? "");
      return h ? `Select "${h}" from "${f}"` : `Click "${f}" dropdown`;
    }
    case "Checkbox":
      return `${r.checked === !0 ? "Check" : "Uncheck"} "${f}"`;
    case "RadioButton":
      return `Select "${f}"`;
    case "DatePicker": {
      const h = String(r.dateValue ?? r.selectedDate ?? "");
      return h ? `Select date "${h}" (${f})` : `Click date picker "${f}"`;
    }
    case "Slider": {
      const h = r.value != null ? String(r.value) : "";
      return h ? `Set "${f}" to ${h}` : `Click slider "${f}"`;
    }
    case "FileUpload": {
      const h = r.fileName ? String(r.fileName) : "";
      return h ? `Upload file "${h}"` : `Click file upload "${f}"`;
    }
    case "Tab":
      return `Click "${f}" tab`;
    case "Hover":
      return `Hover over "${f}"`;
    case "Link":
      return `Click "${f}" link`;
    case "Scroll":
      return "Scroll page";
    case "Navigation": {
      const h = String(r.pageUrl ?? ""), m = String(r.pageTitle ?? ""), g = Ba(m);
      return g && !Nd(m, h) ? `Navigate to "${g}"` : `Navigate to ${Od(h)}`;
    }
    default:
      return `${n} on "${f}"`;
  }
}
function No(t) {
  const e = Rd(t.triggerEvent), n = Pd(t, e);
  return t.componentType = e.componentType, t.componentFramework = e.componentFramework, t.businessMeaning = n, t;
}
function xd(t, e) {
  var h;
  e.value++;
  const n = t.targetIdentity ?? null, r = n ? { ...n } : {
    accessibleName: t.targetName,
    ariaRole: t.targetRole,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: t.targetTag,
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: "",
    xPath: "",
    inIframe: !1,
    shadowDom: !1,
    href: null,
    inputType: null,
    elementId: ""
  }, o = t.pairedAtProjection === !0, s = o ? (h = [...Oo.entries()].find(
    ([, m]) => Hr(m) === Hr(t) && m.eventType === "mousedown"
  )) == null ? void 0 : h[1] : void 0, c = t.ancestorRoles ?? [], l = t.ancestorClasses ?? [], f = {
    eventId: t.eventId,
    eventType: t.eventType,
    timestamp: t.timestamp,
    captureSeq: t.captureSeq,
    isTrusted: !0,
    target: r,
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: !1,
      disabled: !1,
      readOnly: !1,
      required: !1,
      ancestorRoles: c,
      ancestorClasses: l,
      tabIndex: null
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: !1,
    ctrlKey: !1,
    altKey: !1,
    metaKey: !1,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: "",
    pageTitle: "",
    // D1: carry the capture origin so downstream consumers (episode
    // builder tab scoping, workflow subsumption) see the same tab as the
    // recognized interaction.
    captureOrigin: t.captureOrigin ? { ...t.captureOrigin } : void 0
  };
  return {
    interactionId: `int-${e.value}`,
    type: "Unclassified",
    trigger: r,
    triggerEvent: f,
    memberEvents: s ? [
      {
        ...f,
        eventId: s.eventId,
        eventType: "mousedown",
        timestamp: s.timestamp,
        captureSeq: s.captureSeq
      }
    ] : [],
    startTime: t.timestamp,
    endTime: t.timestamp,
    endState: "completed",
    metadata: {
      physicalEventType: t.eventType,
      recognized: !1,
      reason: "unclaimed-at-projection",
      targetName: t.targetName,
      targetTag: t.targetTag,
      targetRole: t.targetRole,
      // S1': when this card collapsed an adjacent mousedown→click pair,
      // record BOTH physical events for evidence completeness.
      pairedAtProjection: o || void 0,
      physicalEvents: o ? ["mousedown", "click"] : void 0,
      // D1: propagate the origin into metadata as well — sw-integration
      // stamps interaction.metadata.captureOrigin for recognized
      // interactions, and affinity comparisons read both places.
      captureOrigin: t.captureOrigin ? { ...t.captureOrigin } : void 0,
      // 7.4-B3 S3: surfaced terminal value for synthetic typed-text
      // samples — the projected card must SHOW what the user typed,
      // not just that a 'change' happened.
      sampledValueAfter: t.synthetic ? t.sampledValueAfter : void 0
    }
  };
}
function $d(t) {
  const e = [], n = /* @__PURE__ */ new Set();
  for (let r = 0; r < t.length; r++) {
    const o = t[r], s = t[r + 1];
    s && o.eventType === "mousedown" && s.eventType === "click" && o.pageId === s.pageId && Hr(o) === Hr(s) ? (e.push({ ...s, pairedAtProjection: !0 }), n.add(o.eventId), Oo.set(o.eventId, o), r++) : e.push(o);
  }
  return { collapsed: e, pairedEventIds: n };
}
const Oo = /* @__PURE__ */ new Map();
function Hr(t) {
  if (t.targetIdentity)
    return he(t.targetIdentity);
  const e = t.targetName ?? "";
  return `tag:${t.targetTag}|name:${e}|role:${t.targetRole ?? ""}`;
}
function Dd(t, e) {
  var q;
  const n = e.filter(
    (E) => E.endState === "completed"
  ), r = /* @__PURE__ */ new Set();
  for (const E of n) {
    (q = E.triggerEvent) != null && q.eventId && r.add(E.triggerEvent.eventId);
    for (const $ of E.memberEvents ?? [])
      r.add($.eventId);
  }
  const o = t.getByDisposition("unclaimed"), s = t.getByDisposition("pending"), c = [...o, ...s].filter(
    (E) => !r.has(E.eventId)
  ), l = /* @__PURE__ */ new Set(), f = c.filter((E) => l.has(E.eventId) ? !1 : (l.add(E.eventId), !0));
  Oo.clear();
  const { collapsed: h, pairedEventIds: m } = $d(f);
  let g = 0;
  for (const E of n) {
    const $ = E.interactionId.match(/^int-(\d+)$/);
    if ($) {
      const V = parseInt($[1], 10);
      V > g && (g = V);
    }
  }
  const I = { value: g }, b = h.map(
    (E) => xd(E, I)
  );
  return {
    interactions: [...n, ...b],
    projectedUnclassified: b,
    projectedEntries: f,
    /** S1': eventIds collapsed into another card's physicalEvents record. */
    pairedEventIds: m
  };
}
function Ld(t) {
  if (t.match)
    return `[Verification] MATCH — runtime output (${t.runtimeOutput.length} interactions) matches projection output (${t.projectedOutput.length} interactions).`;
  const e = [
    `[Verification] MISMATCH — ${t.differences.length} difference(s) found.`,
    `  Runtime output: ${t.runtimeOutput.length} interactions`,
    `  Projected output: ${t.projectedOutput.length} interactions`,
    ""
  ];
  for (const n of t.differences) {
    e.push(`  [${n.kind}] ${n.description}`);
    for (const r of n.ledgerEntries)
      e.push(
        `    Ledger: eventId=${r.eventId} disposition=${r.disposition} claimedBy=${r.claimedBy ?? "N/A"} eventType=${r.eventType}`
      );
  }
  return e.join(`
`);
}
const Yn = "cmdrunner_live_interactions", Xn = "cmdrunner_runtime_snapshot", zt = "cmdrunner_recording_active", pn = "cmdrunner_pending_evidence";
let it = null, We = [], tr = !1, hn = !1, Le = null, si = null;
const Ke = /* @__PURE__ */ new Map(), ja = 100, Bn = /* @__PURE__ */ new Map(), po = /* @__PURE__ */ new Set();
let Fa = 1e9;
function Pr(t) {
  return he(t);
}
function Md(t, e, n) {
  if (t.eventType === "input" && t.valueAfter != null) {
    !Ud(n, t.target) && e.length === 0 ? Bn.set(Pr(t.target), {
      elementKey: Pr(t.target),
      target: t.target,
      domContext: t.domContext,
      pageId: qd(t.eventId),
      lastValueAfter: t.valueAfter,
      lastInputEventId: t.eventId,
      lastInputCaptureSeq: t.captureSeq,
      lastTimestamp: t.timestamp
    }) : Bn.delete(Pr(t.target));
    return;
  }
  if (t.eventType === "blur") {
    const r = Pr(t.target), o = Bn.get(r);
    if (!o) return;
    Bn.delete(r), Vd(o, t);
  }
}
function Vd(t, e) {
  if (!Le) return;
  const n = `evt-${t.pageId}-${Fa++}`;
  po.has(n) || (po.add(n), Le.appendSynthetic({
    eventId: n,
    eventType: "change",
    // Position at the LAST INPUT of the episode, not the blur. The blur can
    // fire between another element's mousedown and its click (mousedown
    // moves focus → blur → click); positioning on the blur wedges the
    // sample between that gesture's halves and breaks pairPhysicalPress
    // adjacency (two BODY cards instead of one). The value belongs to the
    // typing, so it sorts at the episode's own end.
    timestamp: t.lastTimestamp,
    captureSeq: t.lastInputCaptureSeq,
    isTrusted: !0,
    // minted from trusted input events; the sample is curated, not synthetic user input
    target: t.target,
    domContext: t.domContext,
    valueBefore: null,
    valueAfter: t.lastValueAfter,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: !1,
    ctrlKey: !1,
    altKey: !1,
    metaKey: !1,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: e.pageUrl,
    pageTitle: e.pageTitle
  }), Mo());
}
function qd(t) {
  const e = /^evt-(.+?)-\d+$/.exec(t);
  return e ? e[1] : "";
}
function Ud(t, e) {
  const n = t.getLiveLifecycles(), r = he(e);
  return n.some(
    (o) => he(o.trigger) === r
  );
}
function Bd(t) {
  var s, c;
  const e = t.behavioralEvidence ?? void 0;
  if (!e) {
    t.metadata.actionabilityEvidence = !1;
    return;
  }
  const n = e.applicationEvidence, r = ((s = t.triggerEvent) == null ? void 0 : s.eventId) ?? ((c = t.metadata) == null ? void 0 : c.eventId) ?? null, o = n.networkActivity.some(
    (l) => r !== null && l.sourceEventId === r
  );
  t.metadata.actionabilityEvidence = !!(n.domChanges.length > 0 || n.newSurfaces.length + n.removedSurfaces.length > 0 || n.visibilityChanges.length > 0 || n.navigation.length > 0 || o);
}
let Ur = null;
function jd(t, e) {
  if (t.size !== e.size) return !1;
  for (const n of t) if (!e.has(n)) return !1;
  return !0;
}
const Po = /* @__PURE__ */ new Set();
function Fd(t) {
  for (const e of t)
    Po.add(e);
}
function Kd(t) {
  return t.filter(
    (e) => e.behavioralEvidence && !Po.has(e.behavioralEvidence.windowId)
  );
}
function xo() {
  Po.clear();
}
const Gd = 3e5, Ht = /* @__PURE__ */ new Map();
function ho(t) {
  var s;
  if (t.behavioralEvidence) return;
  const e = t.interactionId, n = (s = t.triggerEvent) == null ? void 0 : s.eventId, r = Ht.get(e);
  r && clearTimeout(r);
  const o = setTimeout(() => {
    var f;
    Ht.delete(e);
    const c = We.find((h) => h.interactionId === e);
    if (!c || c.behavioralEvidence) return;
    const l = {
      sourceEventId: n ?? e,
      sourceEventType: ((f = c.triggerEvent) == null ? void 0 : f.eventType) ?? "unknown",
      windowId: `timeout-${e}`,
      frameId: "main",
      window: {
        openedAt: 0,
        closedAt: 0,
        durationMs: 0,
        endReason: "evidence-timeout",
        stabilityTrace: []
      },
      targetEvidence: {
        identity: null,
        identityCapturedAt: 0,
        before: null,
        after: null,
        focusMovement: null
      },
      applicationEvidence: {
        domChanges: [],
        domChangeOverflow: 0,
        coarseMode: !1,
        newSurfaces: [],
        removedSurfaces: [],
        visibilityChanges: [],
        navigation: [],
        networkActivity: [],
        performanceCondition: {
          mainThreadBlocked: !1,
          highChurnMode: !1,
          longestBatchMs: 0,
          totalBatches: 0
        }
      }
    };
    c.behavioralEvidence = l, Ge(), chrome.runtime.sendMessage({
      type: "INTERACTION_EVIDENCE_UPDATE",
      payload: { interactionId: e, evidence: l }
    }).catch(() => {
    });
  }, Gd);
  Ht.set(e, o);
}
function Hd(t) {
  const e = Ht.get(t);
  e && (clearTimeout(e), Ht.delete(t));
}
function Ka(t) {
  chrome.tabs.query({ active: !0, currentWindow: !0 }).then((e) => {
    e.length === 0 || !e[0].id || chrome.tabs.sendMessage(e[0].id, {
      type: "LIFECYCLE_BOUND",
      payload: {
        lifecycleId: t.lifecycleId,
        triggerEventId: t.triggerEvent.eventId,
        interactionType: t.type
      }
    }).catch(() => {
    });
  }).catch(() => {
  });
}
function Ga(t) {
  var n;
  const e = [];
  (n = t.triggerEvent) != null && n.eventId && e.push(t.triggerEvent.eventId);
  for (const r of t.memberEvents ?? [])
    r.eventId && !e.includes(r.eventId) && e.push(r.eventId);
  chrome.tabs.query({ active: !0, currentWindow: !0 }).then((r) => {
    r.length === 0 || !r[0].id || chrome.tabs.sendMessage(r[0].id, {
      type: "FINALIZE_EVIDENCE",
      payload: {
        lifecycleId: t.lifecycleId,
        interactionId: t.interactionId,
        interactionType: t.type,
        eventIds: e,
        metadata: t.metadata ?? {},
        endState: t.endState,
        triggerIdentity: t.trigger ?? void 0
      }
    }).catch(() => {
    });
  }).catch(() => {
  });
}
function Ha(t, e) {
  var r;
  const n = [];
  (r = t.triggerEvent) != null && r.eventId && n.push(t.triggerEvent.eventId);
  for (const o of t.memberEvents ?? [])
    o.eventId && !n.includes(o.eventId) && n.push(o.eventId);
  chrome.tabs.query({ active: !0, currentWindow: !0 }).then((o) => {
    o.length === 0 || !o[0].id || chrome.tabs.sendMessage(o[0].id, {
      type: "FINALIZE_EVIDENCE",
      payload: {
        lifecycleId: t.lifecycleId,
        interactionId: e.interactionId,
        interactionType: e.type,
        eventIds: n,
        metadata: e.metadata ?? {},
        endState: e.endState,
        triggerIdentity: e.trigger ?? void 0
      }
    }).catch(() => {
    });
  }).catch(() => {
  });
}
function za(t) {
  if (Ke.size >= ja) {
    const e = Ke.keys().next().value;
    e && Ke.delete(e);
  }
  Ke.set(t.sourceEventId, t), Za();
}
function Br(t, e) {
  const n = new Set(
    t.map((s) => s.requestId).filter((s) => !!s)
  ), r = new Set(
    t.map((s) => `${s.method}:${s.url}`)
  ), o = e.filter((s) => !(s.requestId && n.has(s.requestId) || !s.requestId && r.has(`${s.method}:${s.url}`)));
  return [...t, ...o];
}
function $o(t, e) {
  var h, m;
  const n = (g) => {
    var b, O, q, E, $, V, j;
    const I = g.applicationEvidence;
    return g.targetEvidence == null && I != null && I.networkActivity != null && I.networkActivity.length > 0 && (((b = I.domChanges) == null ? void 0 : b.length) ?? 0) === 0 && (((O = I.newSurfaces) == null ? void 0 : O.length) ?? 0) === 0 && (((q = I.removedSurfaces) == null ? void 0 : q.length) ?? 0) === 0 && (((E = I.visibilityChanges) == null ? void 0 : E.length) ?? 0) === 0 && ((($ = I.navigation) == null ? void 0 : $.length) ?? 0) === 0 && (((j = (V = I.resultingState) == null ? void 0 : V.items) == null ? void 0 : j.length) ?? 0) === 0;
  }, r = (g, I) => {
    var O, q, E;
    const b = Br(
      ((O = g.applicationEvidence) == null ? void 0 : O.networkActivity) ?? [],
      ((q = I.applicationEvidence) == null ? void 0 : q.networkActivity) ?? []
    );
    return b.length === (((E = g.applicationEvidence) == null ? void 0 : E.networkActivity) ?? []).length ? g : {
      ...g,
      applicationEvidence: {
        ...g.applicationEvidence,
        networkActivity: b
      }
    };
  }, o = (g) => {
    var E, $, V, j, F, P, L;
    if (!g.behavioralEvidence)
      return g.behavioralEvidence = e, Ge(), Hd(g.interactionId), !0;
    if (n(e))
      return g.behavioralEvidence = r(
        g.behavioralEvidence,
        e
      ), Ge(), !0;
    const I = (E = e.applicationEvidence) == null ? void 0 : E.resultingState;
    if (!(($ = g.behavioralEvidence.applicationEvidence) == null ? void 0 : $.resultingState) && I != null && (((V = I.items) == null ? void 0 : V.length) ?? 0) > 0 && e.targetEvidence != null)
      return g.behavioralEvidence = {
        ...e,
        applicationEvidence: {
          ...e.applicationEvidence,
          // G5-E: carry over any network rows the placeholder had
          networkActivity: Br(
            ((j = g.behavioralEvidence.applicationEvidence) == null ? void 0 : j.networkActivity) ?? [],
            ((F = e.applicationEvidence) == null ? void 0 : F.networkActivity) ?? []
          )
        }
      }, Ge(), !0;
    if (e.targetEvidence == null && g.behavioralEvidence.targetEvidence != null)
      return !1;
    const O = zr(g.behavioralEvidence);
    if (zr(e) > O) {
      const Y = Br(
        ((P = g.behavioralEvidence.applicationEvidence) == null ? void 0 : P.networkActivity) ?? [],
        ((L = e.applicationEvidence) == null ? void 0 : L.networkActivity) ?? []
      );
      return g.behavioralEvidence = {
        ...e,
        applicationEvidence: {
          ...e.applicationEvidence,
          networkActivity: Y
        }
      }, Ge(), !0;
    }
    return !1;
  }, s = (((m = (h = e.applicationEvidence) == null ? void 0 : h.navigation) == null ? void 0 : m.length) ?? 0) > 0, c = (g) => g.type === "Navigation", l = We.filter(
    (g) => {
      var I;
      return ((I = g.triggerEvent) == null ? void 0 : I.eventId) === t;
    }
  );
  if (l.length > 0) {
    if (s) {
      const g = l.find(c);
      if (g)
        return o(g), g.interactionId;
    }
    return o(l[0]), l[0].interactionId;
  }
  const f = We.filter(
    (g) => {
      var I;
      return (I = g.memberEvents) == null ? void 0 : I.some((b) => b.eventId === t);
    }
  );
  if (f.length > 0) {
    if (s) {
      const g = f.find(c);
      if (g)
        return o(g), g.interactionId;
    }
    return o(f[0]), f[0].interactionId;
  }
  return null;
}
function Do(t) {
  var c;
  if (t.behavioralEvidence) return;
  const e = [], n = [], r = (c = t.triggerEvent) == null ? void 0 : c.eventId;
  r && Ke.has(r) && (e.push(Ke.get(r)), n.push(r));
  for (const l of t.memberEvents ?? [])
    Ke.has(l.eventId) && (e.push(Ke.get(l.eventId)), n.push(l.eventId));
  if (e.length === 0) return;
  let o = e[0], s = zr(o);
  for (let l = 1; l < e.length; l++) {
    const f = zr(e[l]);
    f > s && (o = e[l], s = f);
  }
  t.behavioralEvidence = o;
  for (const l of n)
    Ke.delete(l);
}
function zr(t) {
  var o, s, c, l, f, h;
  let e = 0;
  const { targetEvidence: n, applicationEvidence: r } = t;
  if (n != null && n.before && (n != null && n.after)) {
    const m = n.before, g = n.after;
    m.value !== g.value && (m.value !== null || g.value !== null) && (e += 10), m.checked !== g.checked && (e += 10), m.disabled !== g.disabled && (e += 5), m.ariaExpanded !== g.ariaExpanded && (e += 5), m.ariaChecked !== g.ariaChecked && (e += 5), m.ariaPressed !== g.ariaPressed && (e += 5), m.textContent !== g.textContent && (m.textContent || g.textContent) && (e += 8), m.childCount !== g.childCount && (e += 3), m.controlledValue !== g.controlledValue && (m.controlledValue !== null || g.controlledValue !== null) && (e += 8), m.scrollTop !== g.scrollTop && (m.scrollTop !== null || g.scrollTop !== null) && (e += 5), (m.selectedValues || g.selectedValues) && JSON.stringify(m.selectedValues) !== JSON.stringify(g.selectedValues) && (e += 10);
  }
  return (o = r == null ? void 0 : r.domChanges) != null && o.length && (e += r.domChanges.length), (s = r == null ? void 0 : r.newSurfaces) != null && s.length && (e += r.newSurfaces.length * 2), (c = r == null ? void 0 : r.removedSurfaces) != null && c.length && (e += r.removedSurfaces.length * 2), (l = r == null ? void 0 : r.visibilityChanges) != null && l.length && (e += r.visibilityChanges.length * 2), (f = r == null ? void 0 : r.navigation) != null && f.length && (e += r.navigation.length * 3), (h = r == null ? void 0 : r.networkActivity) != null && h.length && (e += r.networkActivity.length * 2), e;
}
function Wa() {
  We = [], hn = !0, tr = !1, Le = new Ma(), si = null, Ke.clear(), dt && (clearTimeout(dt), dt = null), Ur = null, xo(), chrome.storage.local.remove(pn).catch(() => {
  }), it = Va(Ua, {
    onEmit: (e) => {
      var r;
      No(e);
      const n = (r = e.triggerEvent) == null ? void 0 : r.captureOrigin;
      n && (e.metadata.captureOrigin = { ...n }), Do(e), We.push(e), Ge(), Ga(e), e.behavioralEvidence || ho(e);
    },
    onLifecycleStart: (e) => {
      Ka(e);
    },
    onDedupFold: (e, n) => {
      Ge(), Ha(n, e);
    },
    evidenceLedger: Le
  }), chrome.storage.local.set({ [zt]: !0 }).catch(() => {
  }), Ge(), Mo();
}
function Ya() {
  var t;
  if (tr = !0, it && (it.flush(), Ge(), Le)) {
    const e = Le, n = Dd(e, We);
    for (const f of n.interactions)
      f.type === "Unclassified" && Do(f);
    const r = new Set(Ke.keys());
    (Ur === null || !jd(Ur, r)) && Za(), Ur = r;
    for (const f of n.interactions)
      f.type === "Unclassified" && (No(f), Bd(f));
    const o = e.getEntries(), s = /* @__PURE__ */ new Set();
    for (const f of n.interactions) {
      (t = f.triggerEvent) != null && t.eventId && s.add(f.triggerEvent.eventId);
      for (const h of f.memberEvents ?? [])
        s.add(h.eventId);
      f.type === "Unclassified" && f.metadata.eventId && s.add(f.metadata.eventId);
    }
    const c = o.filter((f) => !s.has(f.eventId)).map((f) => ({ eventId: f.eventId, eventType: f.eventType })), l = {
      match: c.length === 0,
      differences: c.map((f) => ({
        kind: "missing",
        eventId: f.eventId,
        description: `Discrete ${f.eventType} event not represented in projection`,
        ledgerEntries: e.get(f.eventId) ? [e.get(f.eventId)] : []
      })),
      runtimeOutput: We,
      projectedOutput: n.interactions,
      ledgerSnapshot: e.snapshot()
    };
    return si = l, l.match || console.error(Ld(l)), chrome.storage.local.set({
      cmdrunner_verification_result: l
    }).catch(() => {
    }), hn = !1, chrome.storage.local.set({ [zt]: !1 }).catch(() => {
    }), n.interactions;
  }
  return hn = !1, chrome.storage.local.set({ [zt]: !1 }).catch(() => {
  }), [...We];
}
function Lo(t) {
  if (!it || !hn) return [];
  Le == null || Le.append(t);
  const e = it.process(t);
  return Md(t, e, it), Le && Mo(), e.length > 0 && Wd(), e;
}
function mn() {
  return [...We];
}
function zd() {
  return Le;
}
function Xa() {
  We = [], it = null, hn = !1, tr = !0, Le = null, si = null, Bn.clear(), po.clear(), Fa = 1e9, xo(), Ke.clear(), dt && (clearTimeout(dt), dt = null);
  for (const t of Ht.values())
    clearTimeout(t);
  Ht.clear(), chrome.storage.local.remove([
    Yn,
    Xn,
    zt,
    Gr,
    pn,
    "cmdrunner_verification_result"
  ]).catch(() => {
  });
}
async function Qa() {
  try {
    const t = await chrome.storage.local.get([
      zt,
      Yn,
      Xn,
      Gr,
      pn
    ]);
    if (!(t[zt] === !0)) return !1;
    tr = !1, We = t[Yn] ?? [];
    const n = t[pn];
    if (Array.isArray(n))
      for (const [c, l] of n)
        Ke.size < ja && Ke.set(c, l);
    Le = new Ma();
    const r = t[Gr];
    r && Array.isArray(r) && Le.restore(r), it = Va(Ua, {
      onEmit: (c) => {
        var f;
        No(c);
        const l = (f = c.triggerEvent) == null ? void 0 : f.captureOrigin;
        l && (c.metadata.captureOrigin = { ...l }), Do(c), We.push(c), Ge(), Ga(c), c.behavioralEvidence || ho(c);
      },
      onLifecycleStart: (c) => {
        Ka(c);
      },
      onDedupFold: (c, l) => {
        Ge(), Ha(l, c);
      },
      evidenceLedger: Le
    });
    const s = t[Xn];
    s && it.restore(s);
    for (const c of We)
      c.behavioralEvidence || ho(c);
    return hn = !0, !0;
  } catch {
    return !1;
  }
}
function Ge() {
  return tr ? Promise.resolve(!1) : chrome.storage.local.set({ [Yn]: We }).then(
    () => !0,
    () => !1
  );
}
function Wd() {
  if (!it) return;
  const t = it.snapshot();
  chrome.storage.local.set({
    [Xn]: t
  }).catch(() => {
  });
}
function Mo() {
  if (!Le) return;
  const t = Le.snapshot();
  chrome.storage.local.set({
    [Gr]: t
  }).catch(() => {
  });
}
const Yd = 500;
let dt = null;
function Za() {
  dt && clearTimeout(dt), dt = setTimeout(() => {
    dt = null;
    const t = Array.from(Ke.entries());
    chrome.storage.local.set({
      [pn]: t
    }).catch(() => {
    });
  }, Yd);
}
function Xd() {
  return si;
}
const Qd = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  LIVE_INTERACTIONS_KEY: Yn,
  PENDING_EVIDENCE_KEY: pn,
  RECORDING_ACTIVE_KEY: zt,
  RUNTIME_SNAPSHOT_KEY: Xn,
  attachEvidenceToInteraction: $o,
  clearPersistedEvidenceGuard: xo,
  filterUnpersistedEvidence: Kd,
  getEvidenceLedger: zd,
  getLiveInteractions: mn,
  getVerificationResult: Xd,
  initRecording: Wa,
  markEvidencePersisted: Fd,
  mergeNetworkActivity: Br,
  persistLiveInteractions: Ge,
  processObservedEvent: Lo,
  resetState: Xa,
  restoreFromStorage: Qa,
  stopRecording: Ya,
  storePendingEvidence: za
}, Symbol.toStringTag, { value: "Module" }));
function Zd(t) {
  if (t.endState !== "completed") return !1;
  const { type: e, metadata: n } = t;
  switch (e) {
    case "TextEntry":
      return !(n.userTyped !== !0 || !n.textValue || String(n.textValue).trim() === "");
    case "Dropdown":
      return n.noOpSelection !== !0;
    case "RadioButton":
      return n.noOpSelection !== !0;
    case "DatePicker":
      return !(!n.selectedDate || String(n.selectedDate).trim() === "");
    case "Scroll":
      return n.hasDelta === !0;
    case "Slider":
      return n.userAdjusted === !0;
    case "ColorInput":
      return n.userAdjusted === !0;
    case "Click":
    case "Link":
    case "Checkbox":
    case "Navigation":
      return !0;
    case "Hover":
      return n.meaningful === !0;
    case "Unclassified":
      return !0;
    default:
      return !0;
  }
}
function Jd(t) {
  return t.filter(Zd);
}
const ef = 500;
function tf(t) {
  if (t.length === 0) return [];
  const e = (o) => {
    var l, f, h, m;
    const s = (f = (l = o.triggerEvent) == null ? void 0 : l.captureOrigin) == null ? void 0 : f.tabId;
    if (typeof s == "number") return { tabId: s };
    const c = (m = (h = o.metadata) == null ? void 0 : h.captureOrigin) == null ? void 0 : m.tabId;
    return typeof c == "number" ? { tabId: c } : null;
  }, n = /* @__PURE__ */ new Map();
  for (const o of t) {
    if (o.type === "Unclassified") continue;
    const s = he(o.trigger), c = n.get(s);
    c ? c.push(o) : n.set(s, [o]);
  }
  const r = /* @__PURE__ */ new Set();
  for (const o of t) {
    if (o.type !== "Unclassified") continue;
    const s = he(o.trigger), c = n.get(s);
    if (!c) continue;
    const l = e(o);
    for (const f of c) {
      const h = e(f);
      if (l && h && l.tabId !== h.tabId)
        continue;
      const m = f.startTime - o.startTime;
      if (m >= 0 && m <= ef) {
        r.add(o.interactionId);
        break;
      }
    }
  }
  return r.size === 0 ? t : t.filter(
    (o) => !r.has(o.interactionId)
  );
}
const nf = /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff2?|ttf)(\?|$)/i, rf = /\/unagi|\/events\/|\/beacon|\/pixel|\/csm|\/aax2|\/impression|fls-|\/1\/batch\/|uedata/i;
function of(t) {
  return nf.test(t) || rf.test(t);
}
const sn = ae.UNATTACHED_REQUESTS, sf = /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff2?|ttf)(\?|$)/i, af = /\/unagi|\/events\/|\/beacon|\/pixel|\/csm|\/aax2|\/impression|fls-|\/1\/batch\/|uedata/i;
function cf(t) {
  return t.mainFrame ? !0 : !(sf.test(t.url) || af.test(t.url));
}
const Wi = 20, ea = 500;
function uf(t) {
  return typeof t == "number" && t > 0;
}
class lf {
  constructor() {
    B(this, "owners", /* @__PURE__ */ new Map());
  }
  /** Rebuild from persisted interactions (crash-point-A convergence). */
  rebuildFromInteractions(e) {
    var n, r;
    this.owners.clear();
    for (const o of e) {
      const s = ((r = (n = o.behavioralEvidence) == null ? void 0 : n.applicationEvidence) == null ? void 0 : r.networkActivity) ?? [];
      for (const c of s) {
        const l = c.requestId;
        l && this.owners.set(l, o.interactionId);
      }
    }
  }
  isAttached(e) {
    return this.owners.has(e);
  }
  getInteractionId(e) {
    return this.owners.get(e) ?? null;
  }
  markAttached(e, n) {
    this.owners.set(e, n);
  }
}
function Ja(t, e, n) {
  var o, s;
  const r = (c) => {
    var f;
    const l = (f = c.metadata) == null ? void 0 : f.captureOrigin;
    return n && l ? l.tabId === n.tabId && l.frameId === n.frameId : !0;
  };
  for (const c of e)
    if (((o = c.triggerEvent) == null ? void 0 : o.eventId) === t) {
      if (ta(c) || !r(c)) continue;
      return c;
    }
  for (const c of e)
    if ((s = c.memberEvents) != null && s.some((l) => l.eventId === t)) {
      if (ta(c) || !r(c)) continue;
      return c;
    }
  return null;
}
function ta(t) {
  var e, n;
  return ((n = (e = t.behavioralEvidence) == null ? void 0 : e.window) == null ? void 0 : n.endReason) === "page-reload-synthetic";
}
function df(t) {
  return typeof t == "object" && t !== null && typeof t.tag == "string" && t.tag.length > 0;
}
function ec(t, e) {
  var s, c, l;
  if (t.behavioralEvidence) return t.behavioralEvidence;
  const n = (c = (s = t.metadata) == null ? void 0 : s.captureOrigin) == null ? void 0 : c.frameId, r = n === void 0 || n === 0 ? "main" : String(n), o = {
    sourceEventId: e,
    sourceEventType: ((l = t.triggerEvent) == null ? void 0 : l.eventType) ?? "click",
    windowId: `sw-${e}`,
    frameId: r,
    window: {
      openedAt: 0,
      closedAt: 0,
      durationMs: 0,
      endReason: "sw-recovered-form-submit",
      stabilityTrace: []
    },
    targetEvidence: {
      // 6F-M2b (F4-D display honesty): seed the identity from the owning
      // interaction's trigger — the SAME captured element that produced the
      // click (trigger IS an ElementIdentity, component-types.ts:287). The
      // identity was never lost by the SW lifecycle; it simply wasn't copied
      // into the thin shape, so the panel rendered "Unknown element" for
      // exactly the cards whose ownership resolution had succeeded.
      // Clone (never share the reference) + guard: a shape-less trigger
      // (no tag) keeps null — honesty over fabrication.
      identity: df(t.trigger) ? { ...t.trigger } : null,
      identityCapturedAt: 0,
      before: null,
      after: null,
      focusMovement: null
    },
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: !1,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [],
      performanceCondition: {
        mainThreadBlocked: !1,
        highChurnMode: !1,
        longestBatchMs: 0,
        totalBatches: 0
      }
    }
  };
  return t.behavioralEvidence = o, o;
}
class ff {
  constructor() {
    /** In-memory mirror of the durable store: sourceEventId → entries. */
    B(this, "entries", /* @__PURE__ */ new Map());
    /** Shared exactly-once authority across all attach paths. */
    B(this, "ownership", new lf());
    /** Whether a durable write has succeeded this session (degrade tracking). */
    B(this, "durable", !0);
    /**
     * Fix B bookkeeping: requestIds whose owning interaction row was STILL
     * NULL-status at the moment they were marked attached (first-delivery
     * freeze). Their ledger entries are NOT pruned at attach — they are the
     * Stop-time status-enrichment source until the completion merge lands a
     * real status (Fix A), the session ends (clearAll), or they are
     * acknowledged. Cleared on acknowledge/clearAll — the enrichment window
     * is bounded to the live session.
     */
    B(this, "nullOwnedRequestIds", /* @__PURE__ */ new Set());
    /** Resolves AFTER the latest in-flight durable write settles (gate). */
    B(this, "writeChain", Promise.resolve());
    /**
     * Fix B bookkeeping: remember the interactions the ledger last saw so the
     * already-owned skip branch can inspect the owning row's CURRENT status
     * (live paths keep mutating rows after attach). Replaced on every
     * attachToInteractions pass.
     */
    B(this, "lastSeenInteractions", []);
    // ── Attach (identity join + synthesize-on-missing, INV-1/INV-4) ────
    /** Attached entries awaiting the caller's LIVE_INTERACTIONS persist. */
    B(this, "pendingAck", []);
  }
  // ── Capture (durability gate) ──────────────────────────────────────
  /**
   * Record a stamped request. Durable before this promise resolves
   * (or memory-only if storage rejected — logged, non-fatal).
   *
   * STATUS ENRICHMENT: a duplicate push (same requestId) is a *completion*
   * update, not a no-op — the at-capture write stores status 0 ("completion
   * not yet observed", network-observation.ts:984) and the onCompleted
   * dispatch (:1066) re-pushes with the real status. Merge-in-place:
   *   - status: upgrade-only (incoming > 0 AND stored <= 0 → adopt);
   *     a stored real status is NEVER overwritten or downgraded.
   *   - requestBody/sourceEventId/captureOrigin/documentRequest/mainFrame:
   *     fill-absent only, never clobber.
   * The stored object is mutated in place (no splice/re-push) so FIFO
   * eviction order and landed/ownership state are preserved.
   */
  async pushStamped(e) {
    if (!e.sourceEventId) return;
    if (this.ownership.isAttached(e.requestId)) {
      if (!uf(e.status)) return;
      const o = this.findStoredByRequestId(e.requestId);
      if (o) {
        this.mergeIntoStored(o, e), this.writeChain = this.writeChain.then(() => this.persist()).catch(() => {
        }), await this.writeChain;
        return;
      }
      const s = { ...e };
      s.pendingComplete = !0;
      const c = this.entries.get(e.sourceEventId) ?? [];
      c.push(s), this.entries.set(e.sourceEventId, c), this.nullOwnedRequestIds.add(e.requestId), this.writeChain = this.writeChain.then(() => this.persist()).catch(() => {
      }), await this.writeChain;
      return;
    }
    const n = this.entries.get(e.sourceEventId) ?? [], r = n.find((o) => o.requestId === e.requestId);
    if (r) {
      this.mergeIntoStored(r, e), this.writeChain = this.writeChain.then(() => this.persist()).catch(() => {
      }), await this.writeChain;
      return;
    }
    n.push(e), n.length > Wi && n.splice(0, n.length - Wi), this.entries.set(e.sourceEventId, n), this.countAll() > ea && this.evictOldestInMemory(), this.writeChain = this.writeChain.then(() => this.persist()).catch(() => {
    }), await this.writeChain;
  }
  /**
   * Fix A helper: locate the kept ledger copy of an already-owned requestId
   * (any sourceEventId key). Null when none survived (pruned + acked).
   */
  findStoredByRequestId(e) {
    for (const n of this.entries.values()) {
      const r = n.find((o) => o.requestId === e);
      if (r) return r;
    }
  }
  /**
   * Status-enrichment merge (in-place): upgrade-only status, fill-absent
   * metadata. See pushStamped's doc comment for the contract.
   */
  mergeIntoStored(e, n) {
    typeof n.status == "number" && n.status > 0 && !(typeof e.status == "number" && e.status > 0) && (e.status = n.status), e.requestBody === void 0 && n.requestBody !== void 0 && (e.requestBody = n.requestBody), e.captureOrigin === void 0 && n.captureOrigin !== void 0 && (e.captureOrigin = n.captureOrigin), e.documentRequest === void 0 && n.documentRequest !== void 0 && (e.documentRequest = n.documentRequest), e.mainFrame === void 0 && n.mainFrame !== void 0 && (e.mainFrame = n.mainFrame);
  }
  /** Read-only flat copy of all stamped entries (status-enrichment source). */
  snapshotStamped() {
    const e = [];
    for (const n of this.entries.values())
      for (const r of n) e.push({ ...r });
    return e;
  }
  /**
   * Pre-attach filter + attempt: used by push-time fast paths that have
   * interactions at hand (not currently wired — kept for parity).
   */
  /**
   * G5-D (INV-F5): hold a stamped doc request whose owner is not yet live.
   * Idempotent — same dedup rules as `pushStamped` (requestId ownership +
   * per-key dedup). The entry stays durable for the retry paths (STOP
   * drain, BEHAVIORAL_EVIDENCE retry, boot rehydrate); it is NEVER
   * rendered on the synthetic nav.
   */
  async holdStampedActivity(e) {
    await this.pushStamped(e);
  }
  size() {
    return this.countAll();
  }
  // ── Commit-time routing entry point (INV-5) ────────────────────────
  /**
   * Push a stamped entry (idempotent — enriches status/url if the durable
   * at-capture copy is older) and attempt immediate attach to `interactions`.
   * Returns true when at least one entry attached (caller must persist
   * LIVE_INTERACTIONS — persist-before-ack).
   */
  async attachStampedActivity(e, n) {
    return await this.pushStamped(e), this.attachToInteractions(n) > 0;
  }
  /**
   * Attach every attachable stamped entry to its owning interaction
   * (two-tier identity join). Synthesizes thin evidence when the interaction
   * has none. Returns the number of entries attached (not interactions).
   *
   * DELETE-AFTER-PERSIST: attached entries move to `pendingAck`, NOT yet
   * deleted from the durable store. The caller persists LIVE_INTERACTIONS
   * and then calls `acknowledgePersisted()` — only then are they durably
   * deleted. A crash between attach and ack converges via boot
   * reconciliation's ownership rebuild (crash-point A drops the leftover;
   * nothing duplicates, nothing is lost).
   */
  attachToInteractions(e) {
    var o, s;
    if (this.entries.size === 0) return 0;
    this.ownership.rebuildFromInteractions(e), this.lastSeenInteractions = e;
    let n = 0;
    const r = [];
    for (const [c, l] of this.entries) {
      const f = Ja(
        c,
        e,
        (o = l[0]) == null ? void 0 : o.captureOrigin
      );
      if (f) {
        for (const h of [...l]) {
          if (this.ownership.isAttached(h.requestId)) {
            const b = this.ownership.getInteractionId(h.requestId), O = b ? this.findNetworkRow(b, h.requestId) : void 0;
            b && O && O.status == null ? this.nullOwnedRequestIds.add(h.requestId) : this.nullOwnedRequestIds.delete(h.requestId);
            continue;
          }
          if (!cf(h)) {
            (s = this.entries.get(c)) == null || s.splice(
              this.entries.get(c).indexOf(h),
              1
            );
            continue;
          }
          const g = ec(f, c).applicationEvidence.networkActivity;
          if (g.length >= Wi) continue;
          g.push(pf(h)), this.ownership.markAttached(h.requestId, f.interactionId);
          const I = g[g.length - 1];
          I && I.status == null && this.nullOwnedRequestIds.add(h.requestId), !h.pendingComplete && (r.push(h), (h.mainFrame || h.documentRequest) && this.stampCausalLink(e, f.interactionId), n++);
        }
        this.pruneKey(c);
      }
    }
    return r.length > 0 && this.pendingAck.push(...r), n;
  }
  /**
   * FIX B (pendingAck admission): a freshly attached entry whose new row is
   * still null-status must NOT be admitted to pendingAck — the ack that
   * follows LIVE_INTERACTIONS persistence would delete the only durable
   * completion record before onCompleted can merge the real status (the
   * ack window fires mid-request on a main-frame POST). Its enrichment
   * source must survive until Stop.
   */
  isEnrichmentHeld(e) {
    return this.nullOwnedRequestIds.has(e.requestId);
  }
  /**
   * Acknowledge that the caller's LIVE_INTERACTIONS persistence LANDED —
   * now the attached entries may leave the durable store. Call this ONLY
   * after the persist resolved (directly awaited, or via
   * `acknowledgeAfterPersist` which gates on `landed === true`).
   */
  acknowledgePersisted() {
    if (this.pendingAck.length === 0) return;
    const e = new Set(
      this.pendingAck.filter((n) => !this.isEnrichmentHeld(n)).map((n) => n.requestId)
    );
    this.pendingAck = this.pendingAck.filter((n) => this.isEnrichmentHeld(n)), this.acknowledge([...e]);
  }
  // ── Boot reconciliation (event-driven recovery, T11–T16) ───────────
  /**
   * SW boot: rebuild from the durable store + LIVE_INTERACTIONS.
   *   - Entries whose requestId is already attached (crash-point A:
   *     persisted but not acked) are dropped and the store cleaned.
   *   - Resolvable entries are attached (crash-point B: stored, never
   *     attached) — final state identical to the no-crash run.
   *   - Unresolved entries remain (evidence flush still pending) and are
   *     retried on the next event-driven trigger.
   */
  async rehydrate(e) {
    this.entries.clear(), this.ownership.rebuildFromInteractions(e), this.lastSeenInteractions = e;
    const n = await chrome.storage.local.get(sn), r = (n == null ? void 0 : n[sn]) ?? {};
    for (const [l, f] of Object.entries(r))
      Array.isArray(f) && f.length > 0 && this.entries.set(l, [...f]);
    this.nullOwnedRequestIds.clear();
    let o = !1;
    for (const [l, f] of this.entries) {
      const h = f.filter((m) => {
        if (!this.ownership.isAttached(m.requestId)) return !0;
        const g = this.ownership.getInteractionId(m.requestId), I = g ? this.findNetworkRow(g, m.requestId) : void 0;
        return I && I.status == null ? (this.nullOwnedRequestIds.add(m.requestId), !0) : !1;
      });
      h.length !== f.length && (o = !0), h.length === 0 ? this.entries.delete(l) : this.entries.set(l, h);
    }
    if ((o || this.entries.size > 0) && await this.persist(), this.entries.size === 0)
      return await chrome.storage.local.remove(sn).catch(() => {
      }), { attached: [], unresolved: [] };
    const s = this.attachToInteractions(e), c = [];
    for (const l of this.entries.values()) c.push(...l);
    return o && await this.persist(), {
      attached: s > 0 ? this.collectAttached(e) : [],
      unresolved: c
    };
  }
  /** Entries the interactions already own (used to report what rehydrate attached). */
  collectAttached(e) {
    var r, o;
    const n = [];
    for (const s of e)
      for (const c of ((o = (r = s.behavioralEvidence) == null ? void 0 : r.applicationEvidence) == null ? void 0 : o.networkActivity) ?? []) {
        const l = c.requestId;
        l && this.ownership.isAttached(l) && n.push({
          requestId: l,
          url: c.url,
          method: c.method,
          status: c.status ?? 0,
          sourceEventId: c.sourceEventId
        });
      }
    return n;
  }
  // ── Acknowledge / cleanup ──────────────────────────────────────────
  /**
   * Delete requestIds from the durable store AFTER their interactions were
   * persisted to LIVE_INTERACTIONS. Fire-and-forget from attach paths;
   * crash between persist and ack converges via rehydrate's crash-point-A
   * drop (ownership rebuild).
   */
  acknowledge(e) {
    if (e.length !== 0) {
      for (const n of e)
        if (!this.nullOwnedRequestIds.has(n))
          for (const [r, o] of this.entries) {
            const s = o.findIndex((c) => c.requestId === n);
            s >= 0 && (o.splice(s, 1), o.length === 0 && this.entries.delete(r));
          }
      this.persist();
    }
  }
  /** Session-end cleanup: STOP / new recording start (INV session scoping). */
  async clearAll() {
    this.entries.clear(), this.nullOwnedRequestIds.clear(), this.lastSeenInteractions = [], this.ownership.rebuildFromInteractions([]), await chrome.storage.local.remove(sn).catch(() => {
    }), this.durable = !0;
  }
  /** Whether the last durable write succeeded (diagnostics). */
  isDurable() {
    return this.durable;
  }
  // ── Ack ordering (LANDED-INV Delete-after-persist) ─────────────────
  /**
   * Chain the durable delete to a persist that LANDED.
   *
   * `persist` resolves `true` when the caller's LIVE_INTERACTIONS write
   * landed, `false` on failure (and is rejected-safe). Only a landed persist
   * acknowledges: a failed persist keeps the durable entry so boot
   * reconciliation can recover it — never ack-after-failed-persist.
   *
   * All fire-and-forget ack call sites MUST go through this helper instead
   * of calling acknowledgePersisted() on the line after a persist — an
   * unguarded ack deletes the durable entry before/without its interaction
   * landing in storage, losing the request irrecoverably.
   */
  acknowledgeAfterPersist(e) {
    e.then(
      (n) => {
        n && this.acknowledgePersisted();
      },
      () => {
      }
    );
  }
  // ── Internal ───────────────────────────────────────────────────────
  /** The owning interaction's current row for a requestId (null when absent). */
  findNetworkRow(e, n) {
    var r, o;
    for (const s of this.lastSeenInteractions) {
      if (s.interactionId !== e) continue;
      return (((o = (r = s.behavioralEvidence) == null ? void 0 : r.applicationEvidence) == null ? void 0 : o.networkActivity) ?? []).find(
        (l) => l.requestId === n
      );
    }
  }
  /** Drop entries already attached/filtered under a key; delete key if empty. */
  pruneKey(e) {
    const n = this.entries.get(e);
    if (!n) return;
    const r = n.filter(
      (o) => !this.ownership.isAttached(o.requestId) || this.nullOwnedRequestIds.has(o.requestId)
    );
    r.length === 0 ? this.entries.delete(e) : this.entries.set(e, r);
  }
  /**
   * INV-5: when a recovered document request attaches to its causal owner
   * (the click), stamp causedByInteractionId on the synthetic navigation it
   * produced — the nav records the causal link but carries no network.
   */
  stampCausalLink(e, n) {
    var r, o;
    for (const s of e) {
      const c = s.behavioralEvidence;
      c && ((o = (r = s.behavioralEvidence) == null ? void 0 : r.window) == null ? void 0 : o.endReason) === "page-reload-synthetic" && c.causedByInteractionId === void 0 && (c.causedByInteractionId = n);
    }
  }
  countAll() {
    let e = 0;
    for (const n of this.entries.values()) e += n.length;
    return e;
  }
  evictOldestInMemory() {
    for (; this.countAll() > ea && this.entries.size > 0; ) {
      const e = this.entries.keys().next().value, n = this.entries.get(e);
      n.shift(), n.length === 0 && this.entries.delete(e);
    }
  }
  /** Write the current entry map through to storage (single key, atomic). */
  async persist() {
    try {
      this.entries.size === 0 ? await chrome.storage.local.remove(sn) : await chrome.storage.local.set({
        [sn]: Object.fromEntries(this.entries)
      }), this.durable = !0;
    } catch (e) {
      this.durable = !1, console.warn(
        "[AttributionLedger] durable write failed — memory-only degrade:",
        e == null ? void 0 : e.message
      );
    }
  }
}
function pf(t) {
  return {
    url: t.url,
    method: t.method,
    status: t.status || null,
    startRelativeToEvent: 0,
    endRelativeToEvent: null,
    durationMs: null,
    resourceType: t.mainFrame ? "navigation" : "unknown",
    source: "webrequest",
    requestBody: t.requestBody,
    sourceEventId: t.sourceEventId,
    requestId: t.requestId
  };
}
const Wr = "cmdrunner_net_observing_tabs", Qn = "cmdrunner_net_last_action", tc = 3e4, hf = ["http://*/*", "https://*/*"], nc = 1e4, rc = 100;
let Vo = null;
const lt = /* @__PURE__ */ new Map(), rt = [], ot = /* @__PURE__ */ new Map();
function dn() {
  var t, e;
  try {
    const n = {};
    for (const [r, o] of ot)
      n[String(r)] = o;
    return ((e = (t = chrome == null ? void 0 : chrome.storage) == null ? void 0 : t.local) != null && e.set ? chrome.storage.local.set({ [ae.PENDING_NAV_DOCS]: n }) : Promise.resolve()).then(
      () => {
      },
      () => {
      }
      // storage failure — memory remains source of truth
    );
  } catch {
    return Promise.resolve();
  }
}
function ic() {
  var e, n;
  return ((n = (e = chrome == null ? void 0 : chrome.storage) == null ? void 0 : e.local) != null && n.get ? chrome.storage.local.get(ae.PENDING_NAV_DOCS) : Promise.resolve({})).then(
    (r) => {
      const o = (r == null ? void 0 : r[ae.PENDING_NAV_DOCS]) ?? {};
      for (const [s, c] of Object.entries(o)) {
        const l = Number(s);
        Number.isFinite(l) && c && !ot.has(l) && ot.set(l, c);
      }
    },
    () => {
    }
  );
}
const Nt = /* @__PURE__ */ new Map(), Ze = /* @__PURE__ */ new Map();
function vn(t, e) {
  return `${t}:${e}`;
}
let gn = !1, ai = !1, ft = null;
const Yr = "cmdrunner_recording_active";
let oc = null;
const et = /* @__PURE__ */ new Set();
let Fn = null, fn = null, Kn = null, Gn = null;
function sc(t) {
  return et.has(t);
}
function mf(t) {
  return et.has(t);
}
function jn(t) {
  return ft === !0 ? !0 : ft !== !1;
}
const gf = jn;
function jr(t) {
  return ft !== !0 ? !1 : mf(t);
}
function yf(t) {
  return jr(t);
}
function qo() {
  var t, e;
  try {
    const n = {
      [Wr]: [...et]
    };
    (e = (t = chrome == null ? void 0 : chrome.storage) == null ? void 0 : t.local) != null && e.set ? chrome.storage.local.set(n) : Promise.resolve();
  } catch {
  }
}
function vf() {
  return (async () => {
    try {
      const t = await chrome.storage.local.get(Wr), e = t == null ? void 0 : t[Wr];
      if (Array.isArray(e))
        for (const n of e)
          typeof n == "number" && et.add(n);
    } catch {
    }
  })();
}
function mo(t) {
  et.has(t) || (et.add(t), qo());
}
async function ac(t) {
  var e, n, r;
  ft = !0;
  try {
    (r = (n = (e = chrome == null ? void 0 : chrome.storage) == null ? void 0 : e.local) == null ? void 0 : n.set) == null || r.call(n, { [Yr]: !0 });
  } catch {
  }
  Vo = t, lt.clear(), rt.length = 0, ot.clear(), Nt.clear(), Ze.clear(), dn(), uc(), et.clear(), et.add(t), qo(), ai = !0, jo(), await Bf(t);
}
function cc(t) {
  var e, n, r;
  ft = !1;
  try {
    (r = (n = (e = chrome == null ? void 0 : chrome.storage) == null ? void 0 : e.local) == null ? void 0 : n.set) == null || r.call(n, { [Yr]: !1 });
  } catch {
  }
  ai = !0, Vo = null, et.clear(), qo(), lt.clear(), ot.clear(), dn(), Nt.clear(), Ze.clear(), uc();
}
function wf() {
  return gn;
}
function bf(t) {
  ai = t.seeded, et.clear();
  for (const e of t.tabs) et.add(e);
}
function If(t) {
  ft = t === void 0 ? null : t;
}
function Ef() {
  return {
    seeded: ai,
    recordingActive: ft,
    tabs: [...et],
    startTab: Vo
  };
}
function Sf() {
  gn = !1, jo();
}
function Tf() {
  Ze.clear(), lt.clear();
}
function Cf() {
  return oc ?? Promise.resolve();
}
function uc() {
  var t, e, n;
  try {
    const r = {};
    for (const [o, s] of Ze)
      r[o] = {
        tabId: s.tabId,
        frameId: s.frameId,
        action: { eventId: s.eventId, interactionId: s.interactionId },
        wallClock: s.wallClock
      };
    (n = (e = (t = chrome == null ? void 0 : chrome.storage) == null ? void 0 : t.local) == null ? void 0 : e.set) == null || n.call(e, { [Qn]: r });
  } catch {
  }
}
function kf(t, e) {
  const n = e ? new RegExp(e, "i") : null;
  return rt.filter(
    (r) => r.endWallClock >= t && (!n || n.test(r.url))
  );
}
const Af = /* @__PURE__ */ new Set([
  "click",
  "contextmenu",
  "change",
  "drop"
]), _f = /* @__PURE__ */ new Set(["submit"]);
function Uo(t, e) {
  return t === "keydown" ? e === "Enter" ? "primary" : "ineligible" : _f.has(t) ? "secondary" : Af.has(t) ? "primary" : "ineligible";
}
function Rf(t, e) {
  return Uo(t, e) !== "ineligible";
}
function Bo(t, e, n) {
  var r, o;
  Ze.set(vn(t, e), {
    tabId: t,
    frameId: e,
    ...n,
    wallClock: Date.now()
  });
  try {
    const s = {};
    for (const [c, l] of Ze)
      s[c] = {
        tabId: l.tabId,
        frameId: l.frameId,
        action: { eventId: l.eventId, interactionId: l.interactionId },
        wallClock: l.wallClock
      };
    (o = (r = chrome == null ? void 0 : chrome.storage) == null ? void 0 : r.local) != null && o.set ? chrome.storage.local.set({ [Qn]: s }) : Promise.resolve();
  } catch {
  }
}
function lc(t, e, n) {
  Ze.has(vn(t, e)) || Bo(t, e, n);
}
function Nf(t, e = 0) {
  const n = Ze.get(vn(t, e));
  return n ? { eventId: n.eventId, interactionId: n.interactionId } : null;
}
function dc(t) {
  const e = /* @__PURE__ */ new Map();
  for (const [n, r] of Ze)
    r.tabId === t && e.set(n, { eventId: r.eventId, interactionId: r.interactionId });
  return e;
}
function fc(t) {
  var r;
  const e = Ze.get(vn(t, 0));
  if (e) return e.eventId;
  const n = dc(t);
  return n.size === 1 ? ((r = n.values().next().value) == null ? void 0 : r.eventId) ?? null : null;
}
function pc() {
  return (async () => {
    try {
      const t = await chrome.storage.local.get(Qn), e = t == null ? void 0 : t[Qn];
      if (e && typeof e == "object")
        for (const [n, r] of Object.entries(e))
          !Ze.has(n) && r && typeof r.tabId == "number" && typeof r.frameId == "number" && r.action && typeof r.action.eventId == "string" && Date.now() - r.wallClock < tc && Ze.set(n, {
            tabId: r.tabId,
            frameId: r.frameId,
            eventId: r.action.eventId,
            interactionId: r.action.interactionId,
            wallClock: r.wallClock
          });
    } catch {
    }
  })();
}
function Of(t) {
  return ot.get(t) ?? null;
}
function hc(t) {
  const e = ot.get(t) ?? null;
  return e && (ot.delete(t), dn()), e;
}
function Pf(t, e) {
  return rt.filter((n) => !(n.sourceEventId !== t || e && typeof n.tabId == "number" && (n.tabId !== e.tabId || typeof n.frameId == "number" && n.frameId !== e.frameId)));
}
function xf(t) {
  return t.size === 0 ? [] : rt.filter((e) => e.requestId != null && t.has(e.requestId));
}
function mc(t, e) {
  const n = [];
  for (const r of lt.values())
    r.tabId === t && (r.frameId === 0 || r.resourceKind === "xmlhttprequest" || r.resourceKind === "fetch") && (r.navEventId = e, n.push({
      requestId: r.requestId,
      url: r.originalUrl,
      originalUrl: r.originalUrl,
      method: r.method,
      requestBody: r.requestBody
    }));
  return n;
}
const $f = 100, Df = 2;
let nt = null;
function Lf(t, e) {
  return t === "xmlhttprequest" || t === "fetch" ? !0 : e === 0 && t !== "main_frame" && t !== "websocket" && t !== "ping" && t !== "csp_report";
}
function Mf(t, e, n, r, o) {
  const s = nt;
  s && Lf(o, e) && (of(r) || s.internals.noteStart(t, n));
}
function na(t, e) {
  const n = nt;
  n && n.internals.noteFinish(t, e);
}
function Vf() {
  nt == null || nt.drain.dispose();
  const t = /* @__PURE__ */ new Set(), e = /* @__PURE__ */ new Map();
  let n = !1;
  const r = {
    noteStart(s, c) {
      if (n || !t.has(s)) return;
      let l = e.get(s);
      l || (l = /* @__PURE__ */ new Set(), e.set(s, l)), l.add(c);
    },
    noteFinish(s, c) {
      const l = e.get(s);
      l != null && l.delete(c) && l.size === 0 && e.delete(s);
    },
    countInFlight(s) {
      var c;
      return ((c = e.get(s)) == null ? void 0 : c.size) ?? 0;
    }
  }, o = {
    beginTab(s) {
      n || t.add(s);
    },
    endTab(s) {
      t.delete(s), e.delete(s);
    },
    async drainForTab(s, c) {
      const l = performance.now();
      if (c <= 0 || n || !t.has(s))
        return { drained: !0, timedOut: !1, waitedMs: 0 };
      let f = 0;
      for (; performance.now() - l < c; ) {
        if (r.countInFlight(s) === 0) {
          if (f++, f >= Df)
            return { drained: !0, timedOut: !1, waitedMs: performance.now() - l };
        } else
          f = 0;
        await new Promise((m) => setTimeout(m, $f));
      }
      const h = r.countInFlight(s);
      return { drained: h === 0, timedOut: h > 0, waitedMs: performance.now() - l };
    },
    dispose() {
      n = !0, t.clear(), e.clear(), (nt == null ? void 0 : nt.drain) === o && (nt = null);
    }
  };
  return nt = { drain: o, internals: r }, o;
}
function qf(t) {
  const e = nt;
  return e ? e.internals.countInFlight(t) : 0;
}
function gc(t) {
  const e = rt.filter((r) => r.navEventId === t), n = [];
  for (const r of lt.values())
    r.navEventId === t && n.push({
      url: r.originalUrl,
      finalUrl: r.url,
      method: r.method,
      status: -1,
      // sentinel: still in flight
      startWallClock: Date.now(),
      endWallClock: Date.now(),
      requestId: r.requestId,
      tabId: r.tabId,
      frameId: r.frameId,
      documentRequest: r.resourceKind === "main_frame",
      navEventId: r.navEventId,
      sourceEventId: r.sourceEventId,
      requestBody: r.requestBody
    });
  return [...e, ...n];
}
function jo() {
  if (gn || !(chrome != null && chrome.webRequest)) return;
  Fn = async (e) => {
    var s;
    if (Mf(
      e.tabId,
      e.frameId,
      e.requestId,
      e.url,
      e.type ?? "other"
    ), !jn(e.tabId)) return;
    let n;
    if ((s = e.requestBody) != null && s.formData) {
      n = {};
      for (const [c, l] of Object.entries(e.requestBody.formData))
        Array.isArray(l) && l.length > 0 && (n[c] = l[0]);
    }
    const r = Ze.get(vn(e.tabId, e.frameId)), o = r == null ? void 0 : r.eventId;
    lt.set(e.requestId, {
      url: e.url,
      originalUrl: e.url,
      method: e.method,
      startTime: performance.now(),
      requestId: e.requestId,
      tabId: e.tabId,
      frameId: e.frameId,
      resourceKind: e.type ?? "other",
      requestBody: n,
      sourceEventId: o
    }), e.type === "main_frame" && e.frameId === 0 && (ot.set(e.tabId, {
      requestId: e.requestId,
      tabId: e.tabId,
      frameId: e.frameId,
      originalUrl: e.url,
      method: e.method,
      requestBody: n,
      sourceEventId: o
    }), await dn()), o && await go({
      url: e.url,
      method: e.method,
      status: 0,
      // completion not yet observed
      requestId: e.requestId,
      sourceEventId: o,
      requestBody: n,
      documentRequest: e.type === "main_frame",
      resourceKind: e.type ?? "other",
      captureOrigin: { tabId: e.tabId, frameId: e.frameId }
    }), jr(e.tabId) && Yi(e.tabId, {
      url: e.url,
      method: e.method,
      timestamp: performance.now(),
      wallClock: Date.now(),
      phase: "start",
      status: null,
      requestId: e.requestId
    });
  }, fn = (e) => {
    if (!jn(e.tabId)) return;
    const n = Nt.get(e.requestId) ?? [e.url];
    n.push(e.redirectUrl), Nt.set(e.requestId, n);
  }, Kn = async (e) => {
    if (na(e.tabId, e.requestId), !jn(e.tabId)) return;
    const n = lt.get(e.requestId);
    lt.delete(e.requestId);
    const r = ot.get(e.tabId), o = (r == null ? void 0 : r.requestId) === e.requestId;
    o && (r.completionStatus = e.statusCode, dn());
    const s = Nt.get(e.requestId);
    Nt.delete(e.requestId), ra({
      url: (n == null ? void 0 : n.originalUrl) ?? e.url,
      finalUrl: e.url,
      redirectChain: s,
      method: (n == null ? void 0 : n.method) ?? e.method,
      status: e.statusCode,
      startWallClock: n ? Date.now() - (performance.now() - n.startTime) : Date.now(),
      endWallClock: Date.now(),
      requestId: e.requestId,
      tabId: (n == null ? void 0 : n.tabId) ?? e.tabId,
      frameId: (n == null ? void 0 : n.frameId) ?? e.frameId,
      documentRequest: o,
      navEventId: n == null ? void 0 : n.navEventId,
      sourceEventId: n == null ? void 0 : n.sourceEventId,
      requestBody: n == null ? void 0 : n.requestBody
    }), n != null && n.sourceEventId && await go({
      url: n.originalUrl ?? e.url,
      method: n.method,
      status: e.statusCode,
      requestId: e.requestId,
      sourceEventId: n.sourceEventId,
      requestBody: n.requestBody,
      documentRequest: o,
      resourceKind: n.resourceKind,
      captureOrigin: { tabId: n.tabId, frameId: n.frameId }
    }), jr(e.tabId) && Yi(e.tabId, {
      url: e.url,
      method: (n == null ? void 0 : n.method) ?? e.method,
      timestamp: performance.now(),
      wallClock: Date.now(),
      phase: "complete",
      status: e.statusCode,
      requestId: e.requestId
    });
  }, Gn = (e) => {
    if (na(e.tabId, e.requestId), !jn(e.tabId)) return;
    const n = lt.get(e.requestId);
    lt.delete(e.requestId);
    const r = ot.get(e.tabId), o = (r == null ? void 0 : r.requestId) === e.requestId;
    o && (r.completionStatus = -1, dn());
    const s = Nt.get(e.requestId);
    Nt.delete(e.requestId), ra({
      url: (n == null ? void 0 : n.originalUrl) ?? e.url,
      finalUrl: e.url,
      redirectChain: s,
      method: (n == null ? void 0 : n.method) ?? "GET",
      status: 0,
      startWallClock: n ? Date.now() - (performance.now() - n.startTime) : Date.now(),
      endWallClock: Date.now(),
      requestId: e.requestId,
      tabId: (n == null ? void 0 : n.tabId) ?? e.tabId,
      frameId: (n == null ? void 0 : n.frameId) ?? e.frameId,
      documentRequest: o,
      navEventId: n == null ? void 0 : n.navEventId,
      sourceEventId: n == null ? void 0 : n.sourceEventId,
      requestBody: n == null ? void 0 : n.requestBody
    }), jr(e.tabId) && Yi(e.tabId, {
      url: e.url,
      method: (n == null ? void 0 : n.method) ?? "GET",
      timestamp: performance.now(),
      wallClock: Date.now(),
      phase: "complete",
      status: 0,
      requestId: e.requestId
    });
  };
  const t = {
    urls: hf
  };
  try {
    chrome.webRequest.onBeforeRequest.addListener(
      Fn,
      t,
      ["requestBody"]
    ), fn && chrome.webRequest.onBeforeRedirect.addListener(fn, t), chrome.webRequest.onCompleted.addListener(
      Kn,
      t
    ), chrome.webRequest.onErrorOccurred.addListener(
      Gn,
      t
    ), gn = !0;
  } catch (e) {
    console.warn("[NetworkObservation] Failed to register webRequest listeners:", e);
  }
}
function Uf() {
  if (gn && chrome != null && chrome.webRequest) {
    try {
      Fn && chrome.webRequest.onBeforeRequest.removeListener(Fn), fn && chrome.webRequest.onBeforeRedirect.removeListener(fn), Kn && chrome.webRequest.onCompleted.removeListener(Kn), Gn && chrome.webRequest.onErrorOccurred.removeListener(Gn);
    } catch {
    }
    Fn = null, fn = null, Kn = null, Gn = null, gn = !1;
  }
}
function ra(t) {
  rt.push(t);
  const e = Date.now() - nc;
  for (; rt.length > 0 && rt[0].endWallClock < e; )
    rt.shift();
  for (; rt.length > rc; )
    rt.shift();
}
const yc = new ff();
function wn() {
  return yc;
}
function go(t) {
  return t.sourceEventId ? yc.pushStamped({
    url: t.url,
    method: t.method,
    status: t.status,
    requestId: t.requestId,
    sourceEventId: t.sourceEventId,
    requestBody: t.requestBody,
    documentRequest: t.documentRequest,
    mainFrame: t.resourceKind === "main_frame",
    captureOrigin: t.captureOrigin
  }) : Promise.resolve();
}
async function Bf(t) {
  try {
    return await chrome.scripting.executeScript({
      target: { tabId: t, allFrames: !0 },
      world: "MAIN",
      files: ["assets/network-inject.js"],
      injectImmediately: !0
    }), !0;
  } catch (e) {
    return console.warn("[NetworkObservation] MAIN-world injection failed:", e), !1;
  }
}
function Yi(t, e) {
  try {
    chrome.tabs.sendMessage(t, {
      type: "NETWORK_REQUEST",
      detail: e
    }).catch(() => {
    });
  } catch {
  }
}
typeof chrome < "u" && (chrome != null && chrome.webRequest) && (oc = (async () => {
  await vf(), await jf(), await pc(), await ic();
})(), jo());
function jf() {
  return (async () => {
    try {
      const t = await chrome.storage.local.get(Yr), e = t == null ? void 0 : t[Yr];
      ft === null && (e === !0 && (ft = !0), e === !1 && (ft = !1));
    } catch {
    }
  })();
}
const Xr = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  COMPLETED_BUFFER_TTL_MS: nc,
  LAST_ACTION_KEY: Qn,
  LAST_ACTION_TTL_MS: tc,
  MAX_COMPLETED_ENTRIES: rc,
  OBSERVING_TABS_KEY: Wr,
  __testForwardToTab: yf,
  __testGetGateState: Ef,
  __testRegisterForListeners: Sf,
  __testResetStamps: Tf,
  __testSetGateStateForSim: bf,
  __testSetRecordingActive: If,
  consumeMainFrameCorrelation: hc,
  createExecutionDrain: Vf,
  frameKey: vn,
  getAttributionLedger: wn,
  getBootRestorePromise: Cf,
  getCompletedByRequestIds: xf,
  getCompletedBySourceEventId: Pf,
  getExecutionDrainInFlightForTab: qf,
  getFrameStamp: dc,
  getLastTrustedAction: Nf,
  getMainFrameCorrelation: Of,
  getNetworkEvidenceForNavigation: gc,
  getRecentRequests: kf,
  isObserving: wf,
  isRecordingScopeTab: sc,
  noteRecordingScopeTab: mo,
  recordStampedRequest: go,
  resolveBackfillStamp: fc,
  restoreLastTrustedActionFromStorage: pc,
  restorePendingNavDocsFromStorage: ic,
  setLastTrustedAction: Bo,
  setLastTrustedActionIfAbsent: lc,
  shouldProcessRequestForTest: gf,
  snapshotInFlightForTab: mc,
  stampClass: Uo,
  stampEligible: Rf,
  startNetworkObservation: ac,
  stopNetworkObservation: cc,
  unregisterWebRequestListeners: Uf
}, Symbol.toStringTag, { value: "Module" })), Ff = 16, Kf = 3e4, ln = /* @__PURE__ */ new Map();
function ia(t, e) {
  if (ln.set(t, e), ln.size > Ff) {
    let n = null, r = 1 / 0;
    for (const [o, s] of ln)
      s.committedAt < r && (r = s.committedAt, n = o);
    n !== null && ln.delete(n);
  }
}
function Gf(t) {
  return !t || Date.now() - t.committedAt > Kf ? null : t;
}
function Hf(t) {
  const e = Gf(ln.get(t));
  return e && ln.delete(t), e;
}
function Zn(t) {
  if (!t) return null;
  let e;
  try {
    e = new URL(t);
  } catch {
    return null;
  }
  return e.protocol !== "http:" && e.protocol !== "https:" ? null : e.origin;
}
function vc(t) {
  const e = Zn(t.startUrl);
  if (e) return e;
  if (t.lastCommittedWebUrl) {
    const n = Zn(t.lastCommittedWebUrl);
    if (n) return n;
  }
  return null;
}
let oa = !1, yo = "", vo = "", It = null, Qr = null, Gt, Hn = null;
const zf = 200, zn = [];
function Wf(t) {
  zn.push(t), zn.length > zf && zn.shift();
}
async function nr() {
  if (!oa) {
    oa = !0;
    try {
      const { getBootRestorePromise: t } = await Promise.resolve().then(() => Xr);
      await t();
    } catch {
    }
    await Qa();
    try {
      const t = mn(), e = wn(), n = await e.rehydrate(t);
      n.attached.length > 0 && (e.acknowledgeAfterPersist(Ge()), console.info(
        `[AttributionLedger] boot reconciliation attached ${n.attached.length} request(s)`
      )), n.unresolved.length > 0 && console.info(
        `[AttributionLedger] ${n.unresolved.length} stored request(s) awaiting owning interaction`
      );
    } catch (t) {
      console.warn("[AttributionLedger] boot reconciliation failed:", t.message);
    }
  }
}
nr();
async function sa(t) {
  try {
    const e = await chrome.tabs.sendMessage(t, { type: "PING" });
    return e && e.type === "PONG" ? { alive: !0, recording: !!e.recording } : { alive: !1, recording: !1 };
  } catch {
    return { alive: !1, recording: !1 };
  }
}
async function Yf(t) {
  var e, n, r;
  try {
    const s = (r = (n = (e = chrome.runtime.getManifest().content_scripts) == null ? void 0 : e[0]) == null ? void 0 : n.js) == null ? void 0 : r[0];
    return s ? (await chrome.scripting.executeScript({
      target: { tabId: t, allFrames: !0 },
      files: [s]
    }), !0) : !1;
  } catch {
    return !1;
  }
}
async function wc(t) {
  const e = await sa(t);
  if (e.alive && e.recording)
    return !0;
  if (e.alive && !e.recording) {
    if (await yn())
      try {
        await chrome.tabs.sendMessage(t, { type: "START_RECORDING" });
      } catch {
      }
    return !0;
  }
  if (!await Yf(t))
    return !1;
  if (await new Promise((o) => setTimeout(o, 100)), await yn())
    try {
      await chrome.tabs.sendMessage(t, { type: "START_RECORDING" });
    } catch {
    }
  return (await sa(t)).alive;
}
const Xf = 3;
let Xi = 0;
async function bc() {
  const t = await Wn();
  if (!(t != null && t.id)) return;
  const e = await wc(t.id);
  e ? Xi = 0 : Xi++, (e || Xi >= Xf) && op({
    type: "CONTENT_SCRIPT_STATUS",
    tabId: t.id,
    alive: e,
    recording: await yn(),
    url: t.url ?? ""
  });
}
async function Wn() {
  try {
    return (await chrome.tabs.query({ active: !0, currentWindow: !0 }))[0] ?? null;
  } catch {
    return null;
  }
}
async function Qf() {
  await nr();
  const t = await Wn(), e = (t == null ? void 0 : t.url) ?? "", n = (t == null ? void 0 : t.title) ?? "";
  yo = e, vo = n, It = vc({ startUrl: e, lastCommittedWebUrl: null }), Qr = null, Gt = t != null && t.width && (t != null && t.height) ? { width: t.width, height: t.height } : void 0, Xa(), Wa(), await wn().clearAll().catch(() => {
  }), zn.length = 0;
  try {
    await chrome.storage.local.set({
      [ae.SESSION_CONTEXT]: {
        startUrl: e,
        startTitle: n,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
        // D9: content viewport for honest IR environment + config output
        ...Gt ? { viewport: Gt } : {}
      }
    });
  } catch {
  }
  Hn = null;
  try {
    if (It) {
      const { preloadPriorKnowledge: o } = await Promise.resolve().then(() => Vc);
      Hn = await o(It);
    }
  } catch (o) {
    console.warn("[M9] prior-knowledge preload failed:", o), Hn = null;
  }
  t != null && t.id && (await wc(t.id), ac(t.id));
  const r = {
    recordingState: ii.Recording,
    lastChanged: (/* @__PURE__ */ new Date()).toISOString()
  };
  await Be.setUIState(r), Ic({ type: "START_RECORDING" }), await bc();
}
async function Zf() {
  var h, m, g, I, b, O, q;
  await nr();
  const t = Ya(), e = tf(t), n = Jd(e);
  await Be.setRaw(ae.LIVE_INTERACTIONS, n);
  let r = [];
  try {
    const { getCompletedBySourceEventId: E } = await Promise.resolve().then(() => Xr), { drainNetworkEvidence: $ } = await Promise.resolve().then(() => Ca), V = [];
    for (const Y of n) {
      const K = (h = Y.behavioralEvidence) == null ? void 0 : h.sourceEventId;
      if (!K) continue;
      const H = (m = Y.metadata) == null ? void 0 : m.captureOrigin;
      for (const J of E(K, H))
        V.push({
          url: J.url,
          method: J.method,
          status: J.status,
          requestId: J.requestId,
          sourceEventId: J.sourceEventId,
          requestBody: J.requestBody,
          documentRequest: J.documentRequest,
          captureOrigin: typeof J.tabId == "number" ? { tabId: J.tabId, frameId: J.frameId ?? 0 } : void 0
        });
    }
    const { updatedInteractions: j, mergedRequestIds: F } = $(n, V);
    F.length > 0 && (console.info(
      `[NetworkDrain] recovered ${F.length} request(s) onto ${j.length} interaction(s) by sourceEventId`
    ), await Be.setRaw(ae.LIVE_INTERACTIONS, n));
    const P = wn(), L = P.attachToInteractions(n);
    L > 0 && (console.info(
      `[AttributionLedger] stop drain attached ${L} request(s)`
    ), await Be.setRaw(ae.LIVE_INTERACTIONS, n), P.acknowledgePersisted());
    try {
      const { enrichNetworkRowStatuses: Y } = await Promise.resolve().then(() => Ca), K = /* @__PURE__ */ new Set();
      for (const H of n)
        for (const J of ((I = (g = H.behavioralEvidence) == null ? void 0 : g.applicationEvidence) == null ? void 0 : I.networkActivity) ?? []) {
          const oe = J.requestId;
          oe && J.status == null && K.add(oe);
        }
      if (K.size > 0) {
        const { getCompletedByRequestIds: H } = await Promise.resolve().then(() => Xr), { enriched: J } = Y(n, {
          ledger: P.snapshotStamped(),
          ring: H(K)
        });
        J.length > 0 && (console.info(
          `[NetworkDrain] status-enriched ${J.length} row(s): ` + J.map((oe) => `${oe.requestId}→${oe.to}`).join(", ")
        ), await Be.setRaw(ae.LIVE_INTERACTIONS, n));
      }
    } catch (Y) {
      console.warn("[NetworkDrain] status enrichment failed:", Y.message);
    }
    r = P.snapshotStamped(), await P.clearAll().catch(() => {
    });
  } catch (E) {
    console.warn("[NetworkDrain] drain failed:", E.message);
  }
  let o = {
    sessionId: `session-${Date.now()}`,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    schemaVersion: 1
  }, s = [], c = /* @__PURE__ */ new Map(), l = "about:blank";
  try {
    if (n.length > 0) {
      const { runUnderstandingPipeline: E } = await Promise.resolve().then(() => Vc), { serializeStateTransitions: $ } = await Promise.resolve().then(() => yg), j = vc({
        startUrl: yo,
        lastCommittedWebUrl: Qr
      }) ?? It ?? "";
      j || console.warn("[7.0-KR] no web origin resolvable for this session — KR persistence skipped");
      const F = `session-${Date.now()}`, P = await E({
        interactions: n,
        origin: j,
        sessionId: F,
        // 7.0-KR AC-6: honest skip — pipeline must not mint app rows under a
        // garbage key when no web origin is resolvable.
        skipKnowledgePersistence: !j,
        seed: Hn,
        // CP5: composition-root clock + session capture artifacts for the
        // behavior model (Stage 3.5). stampedRequests were snapshotted
        // BEFORE the ledger's session-end clearAll (see RACE FIX block);
        // postNavRecords are the session-retained consumed records (R1).
        generatedAtMs: Date.now(),
        captureArtifacts: {
          stampedRequests: r,
          postNavRecords: [...zn]
        }
      });
      o = {
        sessionId: F,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        schemaVersion: 2,
        semanticKnowledge: P.semanticKnowledge ?? void 0,
        applicationKnowledge: P.applicationKnowledge ?? void 0,
        knowledgeWarnings: P.warnings.length > 0 ? P.warnings : void 0,
        // D12: carry pipeline artifacts that were previously dropped.
        // Serialize transitions to JSON-safe form (Maps → Records) so
        // chrome.storage, side-panel, export, and API consumers all work.
        outcomes: [...P.outcomes.values()],
        transitions: $(P.transitions),
        appId: P.appId,
        // CP5: application behavior model (optional field; whole + untransformed).
        behaviorModel: P.behaviorModel ?? void 0
      }, await Be.setRaw(ae.UNDERSTANDING_RESULT, o);
    }
  } catch (E) {
    console.warn("[M9] understanding pipeline failed:", E);
  } finally {
    Hn = null;
  }
  try {
    const { build: E } = await Promise.resolve().then(() => Aa), { buildResultingStateEnrichment: $ } = await Promise.resolve().then(() => _a), { PlaywrightCodeGenerator: V } = await Promise.resolve().then(() => rv), { harvestSessionElements: j } = await Promise.resolve().then(() => ka), F = await Wn(), P = yo || (F == null ? void 0 : F.url) || "about:blank";
    l = P;
    const L = j(n, P);
    s = L.freshElements, c = L.idByKey;
    const Y = E({
      interactions: n,
      recordingContext: {
        startUrl: P,
        title: vo || (F == null ? void 0 : F.title) || null,
        // D9: honest viewport from the tab's content box at recording start
        ...Gt ? { viewport: Gt } : {}
      },
      testCaseName: ((b = await Be.getTestCaseDraft()) == null ? void 0 : b.name) ?? "Recorded Test",
      ...c.size > 0 ? { elementIdByKey: c } : {},
      // Track 3 (INV-GEN-9: the service worker is the sole adapter site):
      // step-scoped SOFT assertions derived from each interaction's OWN
      // resulting-state evidence (Phase 4c-i, Option A — on by default).
      enrichment: $(n)
    });
    await Be.setRaw(ae.EXECUTION_IR_PLAN, Y), await chrome.storage.local.set({
      [ae.EXECUTION_IR_PLAN + "_generated_at"]: (/* @__PURE__ */ new Date()).toISOString()
    });
    const H = await new V().generate(Y, {
      language: "typescript",
      pattern: "flat",
      assertions: "expect"
    });
    await Be.setRaw(ae.GENERATED_FILES, H);
  } catch (E) {
    console.warn("[IR Bridge] error during unified generation:", E);
  }
  try {
    const { DexieUnitOfWorkFactory: E } = await Promise.resolve().then(() => ni), { persistSession: $ } = await Promise.resolve().then(() => Ra), j = (await chrome.storage.local.get(ae.EXECUTION_IR_PLAN))[ae.EXECUTION_IR_PLAN], F = await Be.getTestCaseDraft();
    if (j) {
      const P = new E(), L = await $(P, {
        understanding: o,
        events: [],
        interactions: n,
        url: ((O = await Wn()) == null ? void 0 : O.url) ?? "",
        irPlan: j,
        projectId: (F == null ? void 0 : F.projectId) ?? null,
        testCaseName: (F == null ? void 0 : F.name) ?? "Recorded Test"
      });
      await Be.setRaw(ae.REPOSITORY_SESSION_ID, L.sessionId);
      try {
        const { healFromRecording: Y } = await Promise.resolve().then(() => fu), { elementIdentityKey: K } = await Promise.resolve().then(() => ka), H = await Y(
          L.projectId,
          s,
          L.sessionId,
          P
        );
        if (H.details.length > 0) {
          const oe = await P.create().execute(
            async (fe) => fe.elements.getByProject(L.projectId)
          ), le = /* @__PURE__ */ new Map();
          for (const fe of s) {
            const be = K(fe.identity), me = oe.find(
              (we) => we.locatorStrategies.some((Ce) => Ce.value === fe.identity.cssSelector)
            );
            me && le.set(be, me.id);
          }
          if (le.size > 0) {
            const { build: fe } = await Promise.resolve().then(() => Aa), { buildResultingStateEnrichment: be } = await Promise.resolve().then(() => _a), me = fe({
              interactions: n,
              recordingContext: {
                // Same fallback tier as the first build above.
                startUrl: l,
                title: vo || null,
                ...Gt ? { viewport: Gt } : {}
              },
              testCaseName: ((q = await Be.getTestCaseDraft()) == null ? void 0 : q.name) ?? "Recorded Test",
              elementIdByKey: le,
              // Track 3 rebuild parity: the SAME enrichment derivation as the first
              // build, so repository-id mapping never drops derived assertions.
              enrichment: be(n)
            });
            await Be.setRaw(ae.EXECUTION_IR_PLAN, me), await chrome.storage.local.set({
              [ae.EXECUTION_IR_PLAN + "_generated_at"]: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
        }
        console.info(
          "[D3] session element healing:",
          JSON.stringify({
            examined: H.examined,
            healed: H.healed,
            created: H.created
          })
        );
      } catch (Y) {
        console.warn("[D3] element healing failed (non-fatal):", Y);
      }
      try {
        const {
          persistBehavioralEvidence: Y
        } = await Promise.resolve().then(() => Ra), {
          filterUnpersistedEvidence: K,
          markEvidencePersisted: H
        } = await Promise.resolve().then(() => Qd), J = K(n);
        J.length > 0 && (await Y(
          P,
          L.sessionId,
          J
        ), H(
          J.filter((oe) => oe.behavioralEvidence).map((oe) => oe.behavioralEvidence.windowId)
        ));
      } catch (Y) {
        console.warn("[Repository V2] error during evidence persistence:", Y);
      }
    }
  } catch (E) {
    console.warn("[Repository V2] error during session persistence:", E);
  }
  const f = {
    recordingState: ii.Stopped,
    lastChanged: (/* @__PURE__ */ new Date()).toISOString()
  };
  await Be.setUIState(f), Ic({ type: "STOP_RECORDING" }), cc(), await Wn().catch(() => null), Qr = null;
}
async function Jf(t) {
  await nr();
  const e = Lo(t);
  for (const n of e)
    chrome.runtime.sendMessage({
      type: "INTERACTION_CAPTURED",
      interaction: n
    }).catch(() => {
    });
}
function ep(t) {
  const e = $o(
    t.sourceEventId,
    t
  );
  if (e) {
    chrome.runtime.sendMessage({
      type: "INTERACTION_EVIDENCE_UPDATE",
      payload: { interactionId: e, evidence: t }
    }).catch(() => {
    });
    try {
      const n = wn(), r = mn();
      n.attachToInteractions(r) > 0 && n.acknowledgeAfterPersist(Ge());
    } catch {
    }
  } else
    za(t);
}
async function tp() {
  const t = performance.now(), e = await chrome.storage.local.get([
    ae.EXECUTION_IR_PLAN,
    ae.EXECUTION_IR_PLAN + "_generated_at"
  ]), n = e[ae.EXECUTION_IR_PLAN];
  if (!n) {
    aa("error", 0, 0, 0, 0);
    return;
  }
  let r = !1;
  try {
    const { checkStaleness: b } = await Promise.resolve().then(() => Yv), { DexieUnitOfWorkFactory: O } = await Promise.resolve().then(() => ni), E = new O().create(), $ = /* @__PURE__ */ new Set();
    for (const P of n.steps)
      P.target.kind === "element" && $.add(P.target.elementId);
    const V = [];
    if ($.size > 0) {
      const P = await E.execute(async (L) => {
        const Y = [];
        for (const K of $) {
          const H = await L.elements.getById(K);
          H && Y.push(H);
        }
        return Y;
      });
      V.push(...P);
    }
    const j = e[ae.EXECUTION_IR_PLAN + "_generated_at"] ?? (/* @__PURE__ */ new Date(0)).toISOString(), F = b(
      { id: "cached", testCaseVersionId: n.testCaseVersionId, plan: n, generatedAt: j, generatorVersion: "ir-bridge-1.0", renderings: {} },
      V,
      "ir-bridge-1.0"
    );
    F.status === "stale" && (r = !0, console.warn("[Execution] IR is stale:", F.reasons));
  } catch (b) {
    console.warn("[Execution] Staleness check failed:", b);
  }
  const { IRExecutorImpl: o } = await Promise.resolve().then(() => rw), { createExecutionDrain: s } = await Promise.resolve().then(() => Xr), c = s(), l = new o({ networkDrain: c });
  let f = 0;
  const h = await l.execute(n, {
    onStepComplete: (b, O) => {
      b.target.kind === "element" && O.status;
    }
  }).finally(() => c.dispose());
  let m = null;
  try {
    const { createExecutionRun: b } = await Promise.resolve().then(() => ow), { DexieUnitOfWorkFactory: O } = await Promise.resolve().then(() => ni), q = await Be.getTestCaseDraft(), E = b({
      testCaseId: n.testCaseId,
      testCaseVersionId: n.testCaseVersionId,
      projectId: (q == null ? void 0 : q.projectId) ?? "default",
      result: h,
      environment: {
        baseUrl: n.environment.baseUrl,
        browser: n.environment.browser,
        viewport: n.environment.viewport
      },
      healedElementIds: []
    });
    await new O().create().execute(async (j) => {
      await j.executionRuns.save(E);
    }), m = E.id, console.info("[Execution] ExecutionRun persisted:", m);
  } catch (b) {
    console.warn("[Execution] Failed to persist ExecutionRun:", b);
  }
  const g = {
    status: h.status,
    stepCount: h.stepResults.length,
    passedSteps: h.stepResults.filter((b) => b.status === "passed").length,
    failedSteps: h.stepResults.filter((b) => b.status === "failed").length,
    errorSteps: h.stepResults.filter((b) => b.status === "error").length,
    skippedSteps: h.stepResults.filter((b) => b.status === "skipped").length,
    durationMs: h.durationMs,
    startedAt: h.startedAt,
    completedAt: h.completedAt,
    stepResults: h.stepResults,
    executionRunId: m,
    // D2: honest staleness flag — the plan was stale when this run started
    // (an element changed after generation; runtime healing compensated).
    irStale: r
  };
  await Be.setRaw(ae.EXECUTION_RESULT, g);
  const I = performance.now() - t;
  aa(
    h.status,
    h.stepResults.length,
    h.stepResults.filter((b) => b.status === "passed").length,
    I,
    f,
    r
  );
}
function aa(t, e, n, r, o, s = !1) {
  const c = {
    type: "EXECUTION_RESULT",
    status: t,
    stepCount: e,
    passedSteps: n,
    durationMs: r,
    healedElements: o,
    ...s ? { irStale: !0 } : {}
  };
  chrome.runtime.sendMessage(c).catch(() => {
  });
}
const an = /* @__PURE__ */ new Map(), np = 50, ca = ["reload", "form_submit", "auto_toplevel", "auto_subframe", "link", "typed"];
chrome.webNavigation.onCommitted.addListener(async (t) => {
  if (t.frameId !== 0) return;
  const e = `nav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (ca.includes(t.transitionType) && ia(t.tabId, {
    navEventId: e,
    fromUrl: an.get(t.tabId) ?? "",
    toUrl: t.url,
    navType: t.transitionType,
    committedAt: Date.now()
  }), sc(t.tabId) && Zn(t.url) && (Qr = t.url, It === null && (It = Zn(t.url))), await nr(), mn().length === 0 && !await yn()) return;
  const o = an.get(t.tabId) ?? "";
  if (an.set(t.tabId, t.url), an.size > np) {
    const l = an.keys().next().value;
    l !== void 0 && an.delete(l);
  }
  let s = "";
  try {
    s = (await chrome.tabs.get(t.tabId)).title ?? "";
  } catch {
  }
  const c = {
    eventId: e,
    eventType: "navigation",
    timestamp: Date.now(),
    captureSeq: performance.now(),
    isTrusted: !0,
    target: {
      accessibleName: t.url,
      ariaRole: "document",
      ariaLabel: `Navigation to ${t.url}`,
      ariaLabelledBy: null,
      placeholder: null,
      tag: "HTML",
      className: null,
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: "html",
      xPath: "/html",
      inIframe: !1,
      shadowDom: !1,
      href: t.url,
      inputType: null,
      elementId: ""
    },
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: !1,
      disabled: !1,
      readOnly: !1,
      required: !1,
      ancestorRoles: [],
      ancestorClasses: [],
      tabIndex: null
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: !1,
    ctrlKey: !1,
    altKey: !1,
    metaKey: !1,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: t.url,
    pageTitle: s,
    // D1: stamp the synthetic navigation event with its capture origin so
    // downstream tab-scoping (episode builder, workflow subsumption) never
    // degrades to 'unknown-tab-resolution' for full-page navigations.
    captureOrigin: { tabId: t.tabId, frameId: 0 }
  };
  Lo(c), ca.includes(t.transitionType) && (mc(t.tabId, c.eventId), ip(c.eventId, t, o), e === c.eventId && ia(t.tabId, {
    navEventId: c.eventId,
    fromUrl: o,
    toUrl: t.url,
    navType: t.transitionType,
    committedAt: Date.now()
  }));
});
function rp(t, e) {
  try {
    const n = gc(t), r = hc(e.tabId), o = e.transitionType === "form_submit";
    if (r && o && !r.sourceEventId) {
      const l = fc(e.tabId);
      l && (r.sourceEventId = l);
    }
    const s = [], c = /* @__PURE__ */ new Set();
    r && (r.sourceEventId || o) && (c.add(r.requestId), s.push({
      url: r.originalUrl,
      method: r.method,
      // RACE FIX: use the stamped completion status when the race was
      // lost (onCompleted arrived first). undefined = still in flight.
      status: r.completionStatus ?? null,
      startRelativeToEvent: 0,
      endRelativeToEvent: null,
      durationMs: null,
      resourceType: "unknown",
      source: "webrequest",
      // G2: honest display — body rendered when Chrome parsed one, null
      // otherwise (GET submits / non-urlencoded encodings).
      requestBody: r.requestBody ?? void 0,
      // CER-4: exact-event join key for pipeline attribution
      sourceEventId: r.sourceEventId ?? void 0,
      // G5-D (INV-F6): carry the REAL Chrome requestId so every consumer
      // (ownership ledger, mergeNetworkActivity dedup, ring join) can
      // identify this exact request across capture paths.
      requestId: r.requestId
    }));
    for (const l of n) {
      if (c.has(l.requestId) || (c.add(l.requestId), l.documentRequest && !l.sourceEventId && !o) || /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff2?|ttf)(\?|$)/i.test(l.url) || /\/unagi|\/events\/|\/beacon|\/pixel|\/csm|\/aax2|\/impression|fls-|\/1\/batch\/|uedata/i.test(l.url)) continue;
      const f = l.status === -1 ? null : l.status;
      s.push({
        url: l.url,
        method: l.method,
        status: f,
        startRelativeToEvent: 0,
        endRelativeToEvent: null,
        durationMs: null,
        resourceType: "unknown",
        source: "webrequest",
        requestBody: l.requestBody,
        sourceEventId: l.sourceEventId ?? void 0,
        // G5-D (INV-F6): real requestId — one owning interaction per
        // requestId across all capture paths.
        requestId: l.requestId
      });
    }
    return s.slice(0, 20);
  } catch {
    return [];
  }
}
function ip(t, e, n = "") {
  var h;
  const r = rp(t, e), o = [];
  {
    const m = mn(), g = wn();
    for (const I of r) {
      const b = I.sourceEventId;
      if (!b) {
        o.push(I);
        continue;
      }
      const O = { tabId: e.tabId, frameId: 0 };
      m.some(
        (E) => {
          var $, V, j, F;
          return ((V = ($ = E.behavioralEvidence) == null ? void 0 : $.window) == null ? void 0 : V.endReason) !== "page-reload-synthetic" && (((j = E.triggerEvent) == null ? void 0 : j.eventId) === b || ((F = E.memberEvents) == null ? void 0 : F.some((P) => P.eventId === b))) && (() => {
            var L;
            const P = (L = E.metadata) == null ? void 0 : L.captureOrigin;
            return P ? P.tabId === O.tabId && P.frameId === O.frameId : !0;
          })();
        }
      ) ? g.attachStampedActivity({
        url: I.url,
        method: I.method,
        status: I.status ?? 0,
        requestId: I.requestId ?? `${I.method}:${I.url}:${b}`,
        sourceEventId: b,
        requestBody: I.requestBody,
        documentRequest: !0,
        // G4-B triple key: carry the commit's (tab, frame 0) origin so
        // the ledger join disambiguates cross-tab eventId collisions.
        captureOrigin: { tabId: e.tabId, frameId: 0 },
        // WARN-2 fix: every activity on this path IS a document request
        // (pendingDoc or ring document entry) — the flag must not depend
        // on resourceType ('unknown' here) or method, or a back-filled
        // GET form submit would enter the ledger as a non-mainFrame
        // entry and fall through the telemetry filter (INV-N4 breach).
        mainFrame: !0
      }, m).then((E) => {
        E && g.acknowledgeAfterPersist(Ge());
      }) : g.holdStampedActivity({
        url: I.url,
        method: I.method,
        status: I.status ?? 0,
        requestId: I.requestId ?? `${I.method}:${I.url}:${b}`,
        sourceEventId: b,
        requestBody: I.requestBody,
        documentRequest: !0,
        mainFrame: !0,
        captureOrigin: { tabId: e.tabId, frameId: 0 }
      });
    }
  }
  const l = {
    type: {
      link: "full-reload",
      typed: "full-reload",
      reload: "full-reload",
      form_submit: "full-reload",
      auto_toplevel: "full-reload",
      auto_subframe: "full-reload"
    }[e.transitionType] ?? "full-reload",
    // DDC-2: real previous committed URL (was '' — broke the view graph)
    fromUrl: n,
    toUrl: e.url,
    relativeTime: 0,
    batchIndex: null
  }, f = $o(t, {
    sourceEventId: t,
    sourceEventType: "navigation",
    windowId: `synthetic-nav-${t}`,
    frameId: "main",
    window: {
      openedAt: 0,
      closedAt: 0,
      durationMs: 0,
      endReason: "page-reload-synthetic",
      stabilityTrace: []
    },
    targetEvidence: {
      identity: {
        accessibleName: e.url,
        ariaRole: "document",
        ariaLabel: `Navigation to ${e.url}`,
        ariaLabelledBy: null,
        placeholder: null,
        tag: "HTML",
        className: null,
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        cssSelector: "html",
        xPath: "/html",
        inIframe: !1,
        shadowDom: !1,
        href: e.url,
        inputType: null,
        elementId: ""
      },
      identityCapturedAt: performance.now(),
      before: null,
      after: null,
      focusMovement: null
    },
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: !1,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [l],
      // INV-5: only unstamped/unresolved entries — stamped form-submit POSTs
      // were routed to their causal owner above; the nav records the link
      // via causedByInteractionId (stamped by the ledger on attach).
      networkActivity: o,
      performanceCondition: {
        mainThreadBlocked: !1,
        highChurnMode: !1,
        longestBatchMs: 0,
        totalBatches: 0
      }
    }
  });
  if (f) {
    const m = (h = mn().find((g) => g.interactionId === f)) == null ? void 0 : h.behavioralEvidence;
    m && chrome.runtime.sendMessage({
      type: "INTERACTION_EVIDENCE_UPDATE",
      payload: { interactionId: f, evidence: m }
    }).catch(() => {
    });
  }
}
async function yn() {
  try {
    return (await chrome.storage.local.get("cmdrunner_recording_active")).cmdrunner_recording_active === !0;
  } catch {
    return !1;
  }
}
chrome.runtime.onMessage.addListener((t, e, n) => {
  var o, s, c, l, f, h, m;
  if (!t || typeof t != "object") return;
  switch (t.type) {
    case "START_RECORDING":
      Qf();
      break;
    case "STOP_RECORDING":
      Zf();
      break;
    case "OPEN_SETTINGS":
      chrome.runtime.openOptionsPage();
      break;
    case "OPEN_REPOSITORY": {
      chrome.tabs.create({ url: chrome.runtime.getURL("src/repository/index.html") });
      break;
    }
    case "RUN_TEST": {
      tp().catch((g) => {
        console.warn("[Execution] error:", g), chrome.runtime.sendMessage({
          type: "EXECUTION_RESULT",
          status: "error",
          stepCount: 0,
          passedSteps: 0,
          durationMs: 0,
          healedElements: 0
        }).catch(() => {
        });
      });
      break;
    }
    case "PING":
      return yn().then((g) => {
        n({ type: "PONG", recording: g });
      }), !0;
    case "OBSERVED_EVENT": {
      const g = t;
      if ((o = g.payload) != null && o.isTrusted && ((s = e == null ? void 0 : e.tab) == null ? void 0 : s.id) != null) {
        const I = Uo(g.payload.eventType, g.payload.key);
        I === "primary" ? Bo(e.tab.id, e.frameId ?? 0, {
          eventId: g.payload.eventId,
          interactionId: ""
        }) : I === "secondary" && lc(e.tab.id, e.frameId ?? 0, {
          eventId: g.payload.eventId,
          interactionId: ""
        });
      }
      if (((c = e == null ? void 0 : e.tab) == null ? void 0 : c.id) != null && !g.payload.captureOrigin && (g.payload.captureOrigin = { tabId: e.tab.id, frameId: e.frameId ?? 0 }), ((l = e == null ? void 0 : e.tab) == null ? void 0 : l.id) != null && mo(e.tab.id), ((f = e == null ? void 0 : e.tab) == null ? void 0 : f.id) != null && It === null) {
        const I = e.tab.id;
        chrome.tabs.get(I).then((b) => {
          const O = b != null && b.url ? Zn(b.url) : null;
          O && It === null && (It = O);
        }).catch(() => {
        });
      }
      return Jf(g.payload), n({ ok: !0 }), !0;
    }
    case "BEHAVIORAL_EVIDENCE": {
      const g = t;
      return ((h = e == null ? void 0 : e.tab) == null ? void 0 : h.id) != null && mo(e.tab.id), ep(g.payload), n({ ok: !0 }), !0;
    }
    case "NAV_PENDING_REQUEST": {
      if (((m = e == null ? void 0 : e.tab) == null ? void 0 : m.id) == null)
        return n({ type: "NAV_PENDING_RESPONSE", payload: null }), !1;
      const g = Hf(e.tab.id);
      return g && Wf(g), n({ type: "NAV_PENDING_RESPONSE", payload: g }), !1;
    }
  }
  return !1;
});
async function Ic(t) {
  try {
    const e = await chrome.tabs.query({});
    for (const n of e)
      n.id && chrome.tabs.sendMessage(n.id, t).catch(() => {
      });
  } catch {
  }
}
function op(t) {
  chrome.runtime.sendMessage(t).catch(() => {
  });
}
chrome.runtime.onInstalled.addListener(() => {
  var t;
  (t = chrome.sidePanel) != null && t.setPanelBehavior && chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !0 }).catch(() => {
  });
});
const Ec = "cs-health-check";
chrome.alarms.create(Ec, { periodInMinutes: 0.08 });
chrome.alarms.onAlarm.addListener((t) => {
  t.name === Ec && yn().then((e) => {
    e && bc().catch(() => {
    });
  });
});
function Sc(t) {
  return typeof t == "number" && Number.isFinite(t);
}
function sp(t, e) {
  const n = [];
  t.triggerEvent && n.push({
    eventId: t.triggerEvent.eventId,
    timestamp: t.triggerEvent.timestamp
  });
  for (const r of t.memberEvents ?? [])
    n.push({ eventId: r.eventId, timestamp: r.timestamp });
  for (const r of n)
    if (r.eventId === e && Sc(r.timestamp))
      return r.timestamp;
  return null;
}
function ap(t) {
  return {
    requestId: t.requestId,
    url: t.url,
    method: t.method,
    status: t.status === 0 ? null : t.status,
    sourceEventId: t.sourceEventId,
    requestBody: t.requestBody
  };
}
function cp(t, e) {
  var r, o;
  const n = /* @__PURE__ */ new Map();
  for (const s of t) {
    const c = ((o = (r = s.behavioralEvidence) == null ? void 0 : r.applicationEvidence) == null ? void 0 : o.networkActivity) ?? [];
    for (const l of c)
      !l.requestId || !l.sourceEventId || n.has(l.requestId) || n.set(l.requestId, {
        requestId: l.requestId,
        url: l.url,
        method: l.method,
        status: l.status == null ? null : l.status,
        sourceEventId: l.sourceEventId,
        requestBody: l.requestBody
      });
  }
  for (const s of e) {
    if (!s.requestId) continue;
    const c = ap(s), l = n.get(s.requestId);
    l ? l.status == null && c.status != null && (l.status = c.status) : n.set(s.requestId, c);
  }
  return [...n.values()];
}
function up(t, e, n, r) {
  var f;
  const o = cp(
    t,
    (r == null ? void 0 : r.stampedRequests) ?? []
  ), s = ((r == null ? void 0 : r.postNavRecords) ?? []).map((h) => ({
    navEventId: h.navEventId,
    committedAt: h.committedAt,
    fromUrl: h.fromUrl,
    toUrl: h.toUrl
  })), c = [];
  for (const h of t) {
    const m = h.behavioralEvidence;
    if (!m || !m.sourceEventId) continue;
    const g = sp(h, m.sourceEventId);
    if (g === null) continue;
    const I = (f = m.window) == null ? void 0 : f.durationMs;
    Sc(I) && c.push({
      interactionId: h.interactionId,
      evidence: {
        windowId: m.windowId,
        sourceEventId: m.sourceEventId,
        openedAt: m.window.openedAt,
        domChangeCount: m.applicationEvidence.domChanges.length,
        domChangeOverflow: m.applicationEvidence.domChangeOverflow,
        newSurfaces: m.applicationEvidence.newSurfaces.map((b) => ({
          accessibleName: b.accessibleName ?? null
        })),
        removedSurfaces: m.applicationEvidence.removedSurfaces.map((b) => ({
          accessibleName: b.accessibleName ?? null
        })),
        visibilityChanges: m.applicationEvidence.visibilityChanges.length,
        navigation: m.applicationEvidence.navigation.map((b) => ({
          type: b.type,
          fromUrl: b.fromUrl ?? null,
          toUrl: b.toUrl ?? null
        })),
        synthesized: m.window.endReason === "page-reload-synthetic",
        endReason: m.window.endReason
      },
      windowOpenedEpochMs: g,
      windowClosedEpochMs: g + I
    });
  }
  const l = [];
  for (const [h, m] of n)
    l.push({ interactionId: h, outcome: m });
  return {
    // Read-only view cast: EpisodeBuilderInteraction is ComponentInteraction
    // with triggerEvent optional — structurally compatible, never mutated.
    interactions: t,
    networkRows: o,
    evidenceWindows: c,
    postNavRecords: s,
    actionOutcomes: l,
    stateTransitions: e
  };
}
function ua(t) {
  const e = /^int-(\d+)$/.exec(t);
  return e ? Number(e[1]) : null;
}
function st(t, e) {
  const n = ua(t), r = ua(e);
  return n !== null && r !== null && n !== r ? n - r : t < e ? -1 : t > e ? 1 : 0;
}
const lp = 3e4, dp = 3e4, fp = 500, pp = 3e3, hp = 5e3, mp = /* @__PURE__ */ new Set([
  "TextEntry",
  "Dropdown",
  "Checkbox",
  "RadioButton",
  "DatePicker",
  "FileUpload",
  "Slider",
  "ColorInput"
]);
function gp(t) {
  if (!t) return null;
  const e = /^evt-(.+)-\d+$/.exec(t);
  return e ? e[1] : null;
}
function yp(t) {
  var r, o, s, c;
  const e = (o = (r = t.triggerEvent) == null ? void 0 : r.captureOrigin) == null ? void 0 : o.tabId;
  if (typeof e == "number") return e;
  const n = (c = (s = t.metadata) == null ? void 0 : s.captureOrigin) == null ? void 0 : c.tabId;
  return typeof n == "number" ? n : null;
}
function vp(t) {
  const e = t.interactionId;
  if (typeof e != "string" || e.length === 0) return null;
  const n = t.triggerEvent, r = typeof (n == null ? void 0 : n.timestamp) == "number" && Number.isFinite(n.timestamp) ? n.timestamp : NaN, o = !n || !Number.isFinite(r), s = /* @__PURE__ */ new Set();
  n != null && n.eventId && s.add(n.eventId);
  for (const f of t.memberEvents ?? [])
    f != null && f.eventId && s.add(f.eventId);
  const c = Number.isFinite(t.startTime) ? t.startTime : Number.isFinite(r) ? r : 0, l = Number.isFinite(t.endTime) ? t.endTime : c;
  return {
    id: e,
    type: String(t.type ?? "Unclassified"),
    t0: r,
    startTime: c,
    endTime: l,
    lifecycleId: typeof t.lifecycleId == "string" ? t.lifecycleId : null,
    tabId: yp(t),
    pageId: gp(n == null ? void 0 : n.eventId),
    triggerEventType: (n == null ? void 0 : n.eventType) ?? null,
    eventIds: s,
    raw: t,
    malformed: o,
    effectiveEnd: l,
    assignedEpisodeId: null,
    assignedRole: null,
    parameterLink: null,
    degraded: o
  };
}
function Tc(t) {
  var o, s, c, l;
  const e = t.raw.trigger ?? ((o = t.raw.triggerEvent) == null ? void 0 : o.target), n = (e == null ? void 0 : e.tag) ?? null, r = ((s = t.raw.trigger) == null ? void 0 : s.inputType) ?? ((l = (c = t.raw.triggerEvent) == null ? void 0 : c.domContext) == null ? void 0 : l.inputType) ?? null;
  return n === "BUTTON" ? !0 : n === "INPUT" && typeof r == "string" ? r === "submit" || r === "button" || r === "image" : !1;
}
function wp(t) {
  var n, r, o, s, c;
  const e = ((n = t.raw.trigger) == null ? void 0 : n.accessibleName) ?? ((r = t.raw.metadata) == null ? void 0 : r.targetName) ?? ((s = (o = t.raw.triggerEvent) == null ? void 0 : o.target) == null ? void 0 : s.accessibleName) ?? null;
  return typeof e == "string" && e.length > 0 ? e : ((c = t.raw.trigger) == null ? void 0 : c.tag) ?? t.type;
}
function bp(t) {
  var O, q;
  const e = [], n = [], r = [];
  for (const E of t.interactions ?? []) {
    const $ = vp(E);
    if (!$) {
      e.push({
        code: "malformed-interaction-dropped",
        message: "Interaction record without a usable interactionId cannot be referenced by the model; retained as a warning only.",
        refs: [String(E.interactionId ?? "<missing>")]
      });
      continue;
    }
    r.push($);
  }
  const o = r.filter((E) => !E.malformed && E.triggerEventType !== null && ut.has(E.triggerEventType)).sort(Tp), s = r.filter((E) => !o.includes(E)), c = o.map((E) => ({
    episodeId: `ep-${E.id}`,
    anchor: E,
    members: [],
    tabId: E.tabId,
    usedNullTabFallback: E.tabId === null
  })), l = /* @__PURE__ */ new Map();
  for (const E of o) {
    const $ = l.get(E.tabId) ?? [];
    $.push(E.t0), l.set(E.tabId, $);
  }
  for (const E of l.values()) E.sort(($, V) => $ - V);
  function f(E, $) {
    const V = l.get(E);
    if (V) {
      for (const j of V) if (j > $) return j;
    }
  }
  const h = /* @__PURE__ */ new Set();
  {
    const E = r.filter(
      ($) => {
        var V;
        return $.type === "Navigation" && !$.malformed && ((V = $.raw.triggerEvent) == null ? void 0 : V.eventId);
      }
    );
    for (const $ of E) {
      const V = (O = t.postNavRecords) == null ? void 0 : O.find(
        (P) => {
          var L;
          return P.navEventId === ((L = $.raw.triggerEvent) == null ? void 0 : L.eventId);
        }
      ), j = V ? V.committedAt : $.t0;
      let F = null;
      for (const P of o)
        P.tabId === $.tabId && (P.t0 > j || (!F || P.t0 > F.t0) && (F = P));
      F && h.add(F.id);
    }
  }
  function m(E, $) {
    return f(E, $) ?? Number.POSITIVE_INFINITY;
  }
  function g(E, $) {
    let V = null;
    for (const j of c)
      j.tabId === E && ($ < j.anchor.t0 || $ >= m(E, j.anchor.t0) || (!V || j.anchor.t0 > V.anchor.t0) && (V = j));
    return V;
  }
  for (const E of s)
    if (!E.assignedEpisodeId) {
      if (E.type === "Navigation" && !E.malformed) {
        const $ = (q = t.postNavRecords) == null ? void 0 : q.find((F) => {
          var P;
          return F.navEventId === ((P = E.raw.triggerEvent) == null ? void 0 : P.eventId);
        }), V = $ ? $.committedAt : E.t0, j = g(E.tabId, V);
        if (j) {
          E.assignedEpisodeId = j.episodeId, E.assignedRole = "navigation", E.effectiveEnd = Math.max(E.endTime, V + pp), j.members.push(E);
          continue;
        }
        n.push(E.id);
        continue;
      }
      if (!E.malformed && mp.has(E.type)) {
        const $ = Ip(E, c, f, h);
        if ($) {
          E.assignedEpisodeId = $.skeleton.episodeId, E.assignedRole = "parameter", E.parameterLink = $.link, $.skeleton.members.push(E);
          continue;
        }
      }
      if (!E.malformed && E.lifecycleId !== null) {
        const $ = c.find(
          (V) => V.anchor.lifecycleId === E.lifecycleId && V.anchor.lifecycleId !== null
        );
        if ($) {
          E.assignedEpisodeId = $.episodeId, E.assignedRole = "companion", $.members.push(E);
          continue;
        }
      }
      if (E.triggerEventType === "submit" && !E.malformed) {
        let $ = null;
        for (const V of c)
          V.tabId === E.tabId && Tc(V.anchor) && (E.t0 < V.anchor.t0 || E.t0 - V.anchor.t0 > hp || E.t0 >= m(V.tabId, V.anchor.t0) || (!$ || V.anchor.t0 > $.anchor.t0) && ($ = V));
        if ($) {
          E.assignedEpisodeId = $.episodeId, E.assignedRole = "companion", $.members.push(E);
          continue;
        }
        n.push(E.id);
        continue;
      }
      if (E.malformed) {
        let $ = E.tabId === null ? null : g(E.tabId, E.startTime);
        if (!$ && E.tabId === null) {
          let V = null;
          for (const j of c)
            E.startTime < j.anchor.t0 || E.startTime >= m(j.tabId, j.anchor.t0) || (!V || j.anchor.t0 > V.anchor.t0) && (V = j);
          $ = V;
        }
        if ($) {
          E.assignedEpisodeId = $.episodeId, E.assignedRole = "unclassified", E.degraded = !0, $.members.push(E), e.push({
            code: "malformed-member-retained",
            message: `Interaction ${E.id} is malformed (missing/invalid triggerEvent) and retained as a degraded unclassified member of ${$.episodeId} by interval containment${E.tabId === null ? " (tab unknown; epoch-bracket fallback)" : ""}.`,
            refs: [E.id, $.episodeId]
          });
          continue;
        }
        e.push({
          code: "malformed-member-retained",
          message: `Malformed interaction ${E.id} lies outside every episode horizon; reported as unowned rather than guessed into an episode.`,
          refs: [E.id]
        }), n.push(E.id);
        continue;
      }
      n.push(E.id);
    }
  const I = o.map((E) => ({ tabId: E.tabId, t0: E.t0 })), b = c.map((E) => {
    const $ = Sp(E, I, t), V = {
      anchor: 0,
      parameter: 1,
      companion: 2,
      navigation: 3,
      unclassified: 4
    }, j = [
      {
        interactionId: E.anchor.id,
        role: "anchor",
        degraded: E.anchor.malformed ? !0 : void 0
      },
      ...E.members.slice().sort(
        (L, Y) => V[L.assignedRole ?? "unclassified"] - V[Y.assignedRole ?? "unclassified"] || L.startTime - Y.startTime || st(L.id, Y.id)
      ).map((L) => ({
        interactionId: L.id,
        role: L.assignedRole ?? "unclassified",
        degraded: L.degraded ? !0 : void 0
      }))
    ], F = E.members.filter((L) => L.assignedRole === "parameter").sort((L, Y) => L.endTime - Y.endTime || st(L.id, Y.id)).map((L) => {
      var Y, K, H, J;
      return {
        interactionId: L.id,
        label: ((Y = L.raw.metadata) == null ? void 0 : Y.targetName) ?? null,
        value: ((K = L.raw.metadata) == null ? void 0 : K.textValue) ?? // 6F-M1 B: DatePicker writes dateValue (never textValue — its
        // focus-triggered shape has no text); params were rendering null.
        ((H = L.raw.metadata) == null ? void 0 : H.dateValue) ?? ((J = L.raw.triggerEvent) == null ? void 0 : J.valueAfter) ?? null,
        link: L.parameterLink ?? "form-overlap"
      };
    }), P = {
      interactionId: E.anchor.id,
      actionType: E.anchor.raw.type,
      actionTarget: wp(E.anchor),
      triggerTimestamp: E.anchor.t0
    };
    return {
      id: E.episodeId,
      anchor: P,
      members: j,
      parameterInputs: F,
      edges: [],
      // CP3 — causal-graph
      provenanceLinks: [],
      // CP3
      unattributed: [],
      // CP3
      horizon: $,
      episodeOutcome: null,
      // CP4
      tabId: E.tabId
    };
  });
  return c.some((E) => E.usedNullTabFallback) && e.push({
    code: "unknown-tab-resolution",
    message: "One or more anchors carry no captureOrigin.tabId; they were grouped into the shared null-tab scope. Membership decisions involving them may be coarser than tab-scoped ones.",
    refs: c.filter((E) => E.usedNullTabFallback).map((E) => E.episodeId)
  }), {
    episodes: b,
    unownedInteractionIds: n.slice().sort(st),
    warnings: e
  };
}
function Ip(t, e, n, r) {
  var s;
  let o = null;
  for (const c of e) {
    if (t.lifecycleId !== null && c.anchor.lifecycleId === t.lifecycleId) {
      (!o || c.anchor.t0 > o.t0) && (o = { skeleton: c, link: "same-lifecycle", t0: c.anchor.t0 });
      continue;
    }
    const l = Tc(c.anchor), f = !l && r.has(c.anchor.id) && ((s = c.anchor.raw.trigger) == null ? void 0 : s.tag) !== "A";
    if (!l && !f || t.tabId !== c.tabId || t.pageId === null || c.anchor.pageId === null || t.pageId !== c.anchor.pageId || t.endTime > c.anchor.t0) continue;
    const h = f ? fp : dp;
    if (c.anchor.t0 - t.endTime > h) continue;
    const m = n(c.tabId, t.endTime);
    m !== void 0 && m < c.anchor.t0 || (!o || c.anchor.t0 > o.t0) && (o = { skeleton: c, link: "form-overlap", t0: c.anchor.t0 });
  }
  return o ? { skeleton: o.skeleton, link: o.link } : null;
}
function Ep(t, e) {
  let n;
  for (const r of e)
    r.tabId === t.tabId && (r.t0 <= t.anchor.t0 || (n === void 0 || r.t0 < n) && (n = r.t0));
  return n;
}
function Sp(t, e, n) {
  const r = t.anchor.t0;
  let c = [t.anchor.effectiveEnd, ...t.members.map((b) => b.effectiveEnd)].reduce((b, O) => O > b ? O : b, r), l = "stabilized";
  const f = Ep(t, e);
  f !== void 0 && f < c ? (c = f, l = "next-anchor") : n.recordingStopAtMs !== void 0 && n.recordingStopAtMs < c && (c = n.recordingStopAtMs, l = "recording-stop");
  const h = /* @__PURE__ */ new Set([
    ...t.anchor.eventIds,
    ...t.members.flatMap((b) => [...b.eventIds])
  ]);
  let m = null, g = null, I = [];
  if (n.networkRows) {
    const b = /* @__PURE__ */ new Set();
    for (const O of n.networkRows)
      !O.requestId || !O.sourceEventId || h.has(O.sourceEventId) && (O.status === null || O.status === void 0) && b.add(O.requestId);
    if (I = [...b].sort(), b.size === 0)
      m = c, g = "all-stamped-settled";
    else {
      const O = c + lp;
      n.recordingStopAtMs !== void 0 && n.recordingStopAtMs <= O ? (m = n.recordingStopAtMs, g = "recording-stop") : (m = O, g = "tail-capped");
    }
  }
  return {
    uiOwnership: {
      openedAtMs: r,
      closedAtMs: c,
      closeReason: l
    },
    attribution: {
      openedAtMs: r,
      closedAtMs: m,
      closeReason: g,
      pendingRequestIds: I
    }
  };
}
function Tp(t, e) {
  return t.t0 - e.t0 || st(t.id, e.id) || (t.id < e.id ? -1 : t.id > e.id ? 1 : 0);
}
function Zr(t) {
  switch (t.kind) {
    case "request":
      return `request:${t.requestId}`;
    case "event":
      return `event:${t.eventId}`;
    case "transition":
      return `transition:${t.transitionId}`;
    case "entity":
      return `entity:${t.entityId}@${t.interactionId}`;
    case "dom":
      return `dom:${t.windowId}#${t.sequence}`;
    case "nav":
      return `nav:${t.navEventId}`;
  }
}
const Cp = [
  "body-less-row",
  "synthesized-evidence",
  "capped-window",
  "missing-window",
  "malformed-trigger",
  "tail-capped"
], Qi = new Map(
  Cp.map((t, e) => [t, e])
);
function Fo(t) {
  if (!t || t.length === 0) return [];
  const e = /* @__PURE__ */ new Set();
  for (const n of t)
    Qi.has(n) && e.add(n);
  return [...e].sort(
    (n, r) => (Qi.get(n) ?? 0) - (Qi.get(r) ?? 0)
  );
}
function cn(t) {
  const e = Fo(t);
  return e.length > 0 ? e : void 0;
}
function Rt(t, e) {
  if (typeof t != "string" || t.length === 0)
    throw new Error(
      `EvidenceRef factory: ${e} must be a non-empty string (got ${JSON.stringify(t)})`
    );
}
const jt = {
  request(t, e) {
    return Rt(t, "requestId"), { kind: "request", requestId: t, degradation: cn(e) };
  },
  event(t, e) {
    return Rt(t, "eventId"), { kind: "event", eventId: t, degradation: cn(e) };
  },
  transition(t, e) {
    return Rt(t, "transitionId"), { kind: "transition", transitionId: t, degradation: cn(e) };
  },
  entity(t, e, n) {
    return Rt(t, "entityId"), Rt(e, "interactionId"), {
      kind: "entity",
      entityId: t,
      interactionId: e,
      degradation: cn(n)
    };
  },
  dom(t, e, n) {
    if (Rt(t, "windowId"), !Number.isInteger(e) || e < 0)
      throw new Error(
        `EvidenceRef factory: dom sequence must be a non-negative integer (got ${JSON.stringify(e)})`
      );
    return { kind: "dom", windowId: t, sequence: e, degradation: cn(n) };
  },
  nav(t, e) {
    return Rt(t, "navEventId"), { kind: "nav", navEventId: t, degradation: cn(e) };
  }
};
function kp(t) {
  const e = Zr(t), n = Fo(t.degradation);
  return n.length > 0 ? `${e} [${n.join(",")}]` : e;
}
function Ap() {
  const t = /* @__PURE__ */ new Map();
  return {
    tryClaim(e, n) {
      Rt(n, "ownerEdgeId");
      const r = Zr(e);
      return t.has(r) ? !1 : (t.set(r, n), !0);
    },
    ownerOf(e) {
      return t.get(Zr(e)) ?? null;
    },
    claimedKeys() {
      return [...t.keys()].sort();
    },
    get size() {
      return t.size;
    }
  };
}
const wt = {
  "T1-stamp": 0.9,
  "T2-lineage": 0.85,
  "T3-transition": 0.7,
  "T4-window": 0.6
}, _p = 0.5;
function Zi(t, e) {
  return t < e ? -1 : t > e ? 1 : 0;
}
function Rp(t) {
  var g, I, b, O, q, E, $, V, j, F, P;
  const e = Ap(), n = [], r = [], o = t.episodes.map((L) => ({
    ...L,
    edges: [],
    provenanceLinks: [],
    unattributed: []
  })), s = new Map(o.map((L) => [L.id, L])), c = new Map(t.interactions.map((L) => [L.interactionId, L])), l = /* @__PURE__ */ new Map(), f = /* @__PURE__ */ new Map();
  for (const L of o) {
    const Y = /* @__PURE__ */ new Map(), K = /* @__PURE__ */ new Map();
    for (const H of L.members) {
      K.set(H.interactionId, H.role);
      const J = c.get(H.interactionId), oe = (g = J == null ? void 0 : J.triggerEvent) == null ? void 0 : g.eventId;
      oe && Y.set(oe, { interactionId: H.interactionId, role: H.role });
      for (const le of (J == null ? void 0 : J.memberEvents) ?? [])
        le != null && le.eventId && Y.set(le.eventId, { interactionId: H.interactionId, role: H.role });
    }
    l.set(L.id, Y), f.set(L.id, K);
  }
  function h(L, Y) {
    const K = s.get(L);
    if (!K) return null;
    for (const oe of Y.evidenceRefs) {
      const le = e.ownerOf(oe);
      if (le !== null)
        return n.push({
          code: "ref-conflict-skipped",
          message: `Edge from ${Y.from.episodeId} (${Y.kind}) skipped: ref ${kp(oe)} already owned by ${le}.`,
          refs: [Y.from.episodeId, Zr(oe), le]
        }), null;
    }
    const H = `edge-${Y.from.episodeId}-${String(K.edges.length).padStart(3, "0")}`, J = { ...Y, id: H };
    for (const oe of J.evidenceRefs) e.tryClaim(oe, H);
    return K.edges.push(J), J;
  }
  const m = /* @__PURE__ */ new Map();
  for (const L of t.networkRows ?? [])
    if (!(!L.requestId || !L.sourceEventId))
      for (const Y of o) {
        const K = (I = l.get(Y.id)) == null ? void 0 : I.get(L.sourceEventId);
        if (!K) continue;
        const H = m.get(Y.id) ?? [];
        H.push({ row: L, carrier: K.interactionId }), m.set(Y.id, H);
      }
  for (const L of o) {
    const Y = (m.get(L.id) ?? []).sort(
      (K, H) => Zi(K.row.requestId ?? "", H.row.requestId ?? "")
    );
    for (const { row: K, carrier: H } of Y) {
      const J = Fo(K.degradation), oe = K.requestId;
      h(L.id, {
        from: { episodeId: L.id, interactionId: H },
        to: { type: "api", requestId: oe },
        kind: "api",
        tier: "T1-stamp",
        confidence: wt["T1-stamp"],
        latencyMs: null,
        // completion latency not derivable at emission time
        detail: `${K.method ?? "GET"} ${K.url ?? oe} initiated during ${L.id}`,
        evidenceRefs: [jt.request(oe, J)]
      });
    }
  }
  for (const L of o) {
    const Y = L.members.filter((K) => K.role === "navigation").sort((K, H) => st(K.interactionId, H.interactionId));
    for (const K of Y) {
      const H = c.get(K.interactionId), J = (b = H == null ? void 0 : H.triggerEvent) == null ? void 0 : b.eventId;
      if (!J) continue;
      const oe = (O = t.postNavRecords) == null ? void 0 : O.find((be) => be.navEventId === J), le = (oe == null ? void 0 : oe.toUrl) ?? ((q = H == null ? void 0 : H.triggerEvent) == null ? void 0 : q.pageUrl) ?? ((E = H == null ? void 0 : H.trigger) == null ? void 0 : E.href) ?? "", fe = le ? [] : ["missing-window"];
      h(L.id, {
        from: { episodeId: L.id, interactionId: K.interactionId },
        to: { type: "navigation", navEventId: J, toUrl: le },
        kind: "navigation",
        tier: "T2-lineage",
        confidence: wt["T2-lineage"],
        latencyMs: oe ? Math.max(0, oe.committedAt - L.anchor.triggerTimestamp) : null,
        detail: `navigation committed to ${le || "(url unknown)"}`,
        evidenceRefs: [jt.nav(J, fe)]
      });
    }
  }
  for (const L of o) {
    const Y = f.get(L.id);
    if (!Y) continue;
    const K = (t.stateTransitions ?? []).filter((H) => Y.has(H.interactionId)).sort((H, J) => st(H.interactionId, J.interactionId));
    for (const H of K) {
      const J = jt.transition(`st-${H.interactionId}`), oe = (($ = H.before.currentView) == null ? void 0 : $.id) ?? null, le = ((V = H.after.currentView) == null ? void 0 : V.id) ?? null;
      oe !== le && (oe !== null || le !== null) && h(L.id, {
        from: { episodeId: L.id, interactionId: H.interactionId },
        to: {
          type: "state",
          from: oe ?? "(none)",
          to: le ?? "(none)"
        },
        kind: "state",
        tier: "T3-transition",
        confidence: wt["T3-transition"],
        latencyMs: null,
        detail: `view ${oe ?? "(none)"} → ${le ?? "(none)"}`,
        evidenceRefs: [J]
      });
      const fe = [...H.after.entities.keys()].sort(Zi);
      for (const me of fe) {
        const we = H.after.entities.get(me);
        if (!we || we.firstSeenAt !== H.interactionId) continue;
        const Ce = H.changes.some(
          (Me) => Me.includes("from API") && (Me.includes(we.type) || Me.includes(me) || we.attributes.productId !== void 0 && Me.includes(String(we.attributes.productId)))
        ), xe = Ce && Np(L, H.interactionId) ? "T1-stamp" : "T3-transition", je = xe === "T1-stamp" ? wt["T1-stamp"] : wt["T3-transition"];
        h(L.id, {
          from: { episodeId: L.id, interactionId: H.interactionId },
          to: { type: "entity", entityId: me, operation: "create" },
          kind: "entity",
          tier: xe,
          confidence: je,
          latencyMs: null,
          detail: `entity ${me} (${we.type}) created${Ce ? " from API" : ""}`,
          evidenceRefs: [jt.entity(me, H.interactionId)]
        });
      }
      for (const me of H.after.notifications)
        me.appearedAt === H.interactionId && h(L.id, {
          from: { episodeId: L.id, interactionId: H.interactionId },
          to: { type: "ui", summary: `notification: ${me.text}` },
          kind: "notification",
          tier: "T3-transition",
          confidence: wt["T3-transition"],
          latencyMs: null,
          detail: `notification "${me.text}" (${me.severity}) appeared`,
          evidenceRefs: [jt.event(me.id)]
        });
      const be = [...H.after.counters.keys()].sort(Zi);
      for (const me of be) {
        const we = H.after.counters.get(me), Ce = we == null ? void 0 : we.values.find((Me) => Me.interactionId === H.interactionId);
        if (!Ce || Ce.delta === null || Ce.delta === 0) continue;
        const xe = Number(Ce.value), je = xe - Ce.delta;
        h(L.id, {
          from: { episodeId: L.id, interactionId: H.interactionId },
          to: { type: "state", from: `${me}=${je}`, to: `${me}=${xe}` },
          kind: "state",
          tier: "T3-transition",
          confidence: wt["T3-transition"],
          latencyMs: null,
          detail: `counter ${me} ${je} → ${xe}`,
          evidenceRefs: [J]
        });
      }
    }
  }
  for (const L of t.evidenceWindows ?? []) {
    const Y = ((P = (F = (j = c.get(L.interactionId)) == null ? void 0 : j.triggerEvent) == null ? void 0 : F.captureOrigin) == null ? void 0 : P.tabId) ?? null, K = o.filter((be) => {
      const me = be.horizon.uiOwnership, we = L.windowOpenedEpochMs < (me.closedAtMs ?? Number.POSITIVE_INFINITY) && L.windowClosedEpochMs >= me.openedAtMs, Ce = be.tabId === null || Y === null || be.tabId === Y;
      return we && Ce;
    });
    if (K.length === 0) {
      r.push({
        id: `unattr-ui-${L.interactionId}`,
        observedKind: "ui",
        evidenceRef: jt.dom(L.evidence.windowId, 0),
        reason: "no-live-horizon",
        observedAtMs: L.windowOpenedEpochMs,
        tabId: Y,
        detail: `evidence window ${L.evidence.windowId} lies outside every uiOwnership horizon`
      });
      continue;
    }
    K.sort(
      (be, me) => me.horizon.uiOwnership.openedAtMs - be.horizon.uiOwnership.openedAtMs || st(be.anchor.interactionId, me.anchor.interactionId)
    );
    const H = K[0], J = o.some(
      (be) => be.id !== H.id && be.anchor.triggerTimestamp <= L.windowOpenedEpochMs
    ), oe = H.edges.some(
      (be) => (be.tier === "T1-stamp" || be.tier === "T3-transition") && be.from.interactionId === L.interactionId
    ), le = J && !oe ? Math.min(wt["T4-window"], _p) : wt["T4-window"], fe = [];
    L.evidence.domChangeOverflow > 0 && fe.push("capped-window"), L.evidence.synthesized && fe.push("synthesized-evidence"), h(H.id, {
      from: { episodeId: H.id, interactionId: L.interactionId },
      to: { type: "ui", summary: la(L.evidence) },
      kind: "ui",
      tier: "T4-window",
      confidence: le,
      latencyMs: Math.max(0, L.windowOpenedEpochMs - H.anchor.triggerTimestamp),
      detail: `UI observations on ${L.interactionId}: ${la(L.evidence)}`,
      evidenceRefs: [jt.dom(L.evidence.windowId, 0, fe)]
    });
  }
  return {
    episodes: o,
    unattributed: r,
    provenanceLinks: [],
    warnings: n,
    claimedRefKeys: e.claimedKeys()
  };
}
function Np(t, e) {
  return t.edges.some((n) => n.tier === "T1-stamp" && n.from.interactionId === e);
}
function la(t) {
  const e = [`${t.domChangeCount} DOM changes`];
  return t.newSurfaces.length && e.push(`${t.newSurfaces.length} new surfaces`), t.removedSurfaces.length && e.push(`${t.removedSurfaces.length} removed surfaces`), t.visibilityChanges && e.push(`${t.visibilityChanges} visibility changes`), e.join(", ");
}
function Cc(t) {
  return t >= 0.85 ? "confirmed" : t >= 0.7 ? "likely" : t >= 0.5 ? "possible" : "inconclusive";
}
const Op = /* @__PURE__ */ new Set([
  "cart-confirmation",
  "order-confirmation",
  "checkout-confirmation",
  "payment-confirmation",
  "registration-confirmation",
  "login-success"
]);
function Pp(t) {
  return Math.round(t * 1e3) / 1e3;
}
function xp(t, e, n) {
  return n === 0 ? "incomplete" : t > 0 && e > 0 && Math.min(t, e) / Math.max(t, e) > 0.3 ? "ambiguous" : t > e ? "success" : e > t ? "failure" : "ambiguous";
}
function $p(t, e, n, r) {
  let o;
  switch (t) {
    case "success":
      o = e;
      break;
    case "failure":
      o = n;
      break;
    case "ambiguous":
      o = (e + n) * 0.5;
      break;
    default:
      o = 0;
  }
  const s = Math.min(1, o);
  return r ? s / 2 : s;
}
function Dp(t) {
  const { episode: e, memberOutcomes: n, degraded: r = !1 } = t, o = e.members.map((I) => I.interactionId).sort(st), s = [], c = /* @__PURE__ */ new Set();
  let l = !1;
  for (const I of o) {
    const b = n.get(I);
    if (b) {
      l = !0;
      for (const O of b.supportingEvidence)
        O.result !== "success" && O.result !== "failure" || (c.add(I), s.push({
          member: I,
          vote: { result: O.result, weight: O.weight, evidence: O }
        }));
    }
  }
  if (!l) return null;
  const f = s.filter((I) => I.vote.result === "success").reduce((I, b) => I + b.vote.weight, 0), h = s.filter((I) => I.vote.result === "failure").reduce((I, b) => I + b.vote.weight, 0), m = xp(f, h, s.length), g = $p(m, f, h, r);
  return {
    outcome: m,
    confidence: Pp(g),
    confidenceLevel: Cc(g),
    contributingMembers: [...c].sort(st),
    derivation: "derived-episode-outcome"
  };
}
function Lp(t) {
  var j;
  const {
    sessionId: e,
    generatedAtMs: n,
    actionOutcomes: r,
    stateTransitions: o,
    evidenceWindows: s,
    ...c
  } = t, l = bp(c), f = Rp({
    episodes: l.episodes,
    interactions: c.interactions,
    networkRows: c.networkRows,
    postNavRecords: c.postNavRecords,
    stateTransitions: o,
    evidenceWindows: s
  }), h = new Map(
    (r ?? []).map((F) => [F.interactionId, F.outcome])
  ), m = /* @__PURE__ */ new Map();
  for (const F of f.episodes)
    m.set(
      F.id,
      new Set(F.members.map((P) => P.interactionId))
    );
  const g = /* @__PURE__ */ new Set();
  for (const F of s ?? [])
    if (!((F.evidence.domChangeOverflow ?? 0) <= 0))
      for (const [P, L] of m)
        L.has(F.interactionId) && g.add(P);
  const I = f.episodes.map((F) => {
    const P = Dp({
      episode: F,
      memberOutcomes: h,
      degraded: g.has(F.id)
    });
    return { ...F, episodeOutcome: P };
  }), b = new Set(
    I.flatMap(
      (F) => F.members.filter((P) => P.role !== "anchor").map((P) => P.interactionId)
    )
  ), O = new Set(
    I.flatMap(
      (F) => F.edges.filter((P) => P.kind === "api" && P.to.type === "api").map((P) => P.to.requestId)
    )
  ), q = I.flatMap((F) => F.edges.filter((P) => P.kind === "ui")), E = {
    totalInteractions: c.interactions.length,
    anchoredInteractions: I.length,
    memberInteractions: b.size,
    malformedInteractions: I.flatMap((F) => F.members).filter((F) => F.degraded).length,
    totalNetworkRows: ((j = c.networkRows) == null ? void 0 : j.length) ?? 0,
    attributedNetworkRows: O.size,
    totalObservations: (s == null ? void 0 : s.length) ?? 0,
    attributedObservations: q.length,
    unattributedConsequences: f.unattributed.length,
    provenanceLinks: f.provenanceLinks.length
  }, $ = [...l.warnings, ...f.warnings];
  return {
    model: {
      id: `abm-${e}`,
      sessionId: e,
      episodes: I,
      unattributed: f.unattributed,
      provenanceLinks: f.provenanceLinks,
      generatedAtMs: n,
      coverage: E,
      warnings: $
    },
    unownedInteractionIds: l.unownedInteractionIds,
    warnings: $
  };
}
class Mp {
  constructor() {
    B(this, "extractors", []);
  }
  /**
   * Register a signal extractor. Extractors run in registration order.
   */
  register(e) {
    this.extractors.push(e);
  }
  /**
   * Extract all signals from a single interaction.
   * Returns an empty SignalSet if the interaction has no behavioral evidence.
   */
  extractFromInteraction(e) {
    const n = {
      interactionId: e.interactionId,
      viewChanges: [],
      apiOperations: [],
      notifications: [],
      counterChanges: [],
      listChanges: [],
      inputChanges: [],
      controlStateChanges: [],
      // DDC-6 — always present in coordinator output
      pageContent: null
    };
    if (!e.behavioralEvidence) return n;
    for (const r of this.extractors) {
      const o = r.extract(e);
      for (const s of o)
        switch (s.type) {
          case "view-change":
            n.viewChanges.push(s);
            break;
          case "api-operation":
            n.apiOperations.push(s);
            break;
          case "notification":
            n.notifications.push(s);
            break;
          case "counter-change":
            n.counterChanges.push(s);
            break;
          case "list-change":
            n.listChanges.push(s);
            break;
          case "input-value-change":
            n.inputChanges.push(s);
            break;
          case "control-state-change":
            (n.controlStateChanges ?? (n.controlStateChanges = [])).push(s);
            break;
          case "page-content":
            n.pageContent = s;
            break;
        }
    }
    return n;
  }
  /**
   * Extract signals from a batch of interactions.
   * Skips interactions without behavioral evidence (counted in skippedCount).
   */
  extract(e) {
    const n = /* @__PURE__ */ new Map();
    let r = 0;
    for (const o of e) {
      if (!o.behavioralEvidence) {
        r++;
        continue;
      }
      n.set(o.interactionId, this.extractFromInteraction(o));
    }
    return {
      signals: n,
      interactionCount: e.length,
      skippedCount: r
    };
  }
}
class Vp {
  constructor(e) {
    B(this, "name", "NavigationSignalExtractor");
    this.viewRegistry = e;
  }
  extract(e) {
    const n = e.behavioralEvidence;
    if (!n) return [];
    const r = n.applicationEvidence.navigation;
    if (!r || r.length === 0) return [];
    const o = [];
    for (const s of r) {
      const c = this.viewRegistry.match(s.toUrl);
      if (!c) continue;
      const l = this.viewRegistry.match(s.fromUrl) ?? null;
      o.push({
        type: "view-change",
        interactionId: e.interactionId,
        source: "navigation-url",
        confidence: c.confidence,
        toView: c,
        fromView: l,
        toUrl: s.toUrl,
        fromUrl: s.fromUrl,
        navigationType: s.type
      });
    }
    return o;
  }
}
const qp = [
  // ── Search autocomplete ──
  { operation: "search-autocomplete", pattern: "/suggest" },
  { operation: "search-autocomplete", pattern: "/autocomplete" },
  { operation: "search-autocomplete", pattern: "/typeahead" },
  // ── Search ──
  { operation: "search", pattern: "/search" },
  { operation: "search", pattern: "/query" },
  // ── Cart operations ──
  { operation: "add-to-cart", pattern: "/cart/add" },
  { operation: "add-to-cart", pattern: "/cart.*add" },
  { operation: "add-to-cart", pattern: "/addToCart" },
  { operation: "remove-from-cart", pattern: "/cart.*remove" },
  { operation: "remove-from-cart", pattern: "/removeFromCart" },
  { operation: "update-cart", pattern: "/cart.*update" },
  { operation: "update-cart", pattern: "/cart.*quantity" },
  // ── Checkout ──
  { operation: "checkout", pattern: "/checkout" },
  { operation: "checkout", pattern: "/payment" },
  // ── Authentication ──
  { operation: "login", pattern: "/login" },
  { operation: "login", pattern: "/signin" },
  { operation: "login", pattern: "/auth" },
  { operation: "logout", pattern: "/logout" },
  { operation: "logout", pattern: "/signout" },
  { operation: "register", pattern: "/register" },
  { operation: "register", pattern: "/signup" },
  // ── Form submission ──
  { operation: "submit-form", pattern: "/submit" },
  { operation: "submit-form", pattern: "/form" },
  // ── Analytics / telemetry (no semantic value for app understanding) ──
  { operation: "analytics", pattern: "/events/" },
  { operation: "analytics", pattern: "/batch/" },
  { operation: "analytics", pattern: "/uedata" },
  // Amazon analytics
  { operation: "analytics", pattern: "/unagi" },
  // Amazon telemetry
  { operation: "analytics", pattern: "/csm" },
  // Amazon metrics
  { operation: "analytics", pattern: "/safeframe" },
  { operation: "analytics", pattern: "/aax2" },
  { operation: "analytics", pattern: "/impression" },
  { operation: "analytics", pattern: "/pixel" },
  { operation: "analytics", pattern: "/beacon" },
  { operation: "analytics", pattern: "/track" }
], Up = [
  /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/i,
  /\.(css|js|mjs)(\?|$)/i,
  /\.(woff2?|ttf|eot)(\?|$)/i,
  /\.(mp4|webm|mp3)(\?|$)/i
];
function Bp(t) {
  return t === null ? null : t >= 200 && t < 300 ? { result: "success", weight: 0.3, detail: `HTTP ${t}` } : t >= 400 && t < 500 ? { result: "failure", weight: 0.4, detail: `HTTP ${t} (client error)` } : t >= 500 ? { result: "failure", weight: 0.5, detail: `HTTP ${t} (server error)` } : t >= 300 && t < 400 ? { result: "unknown", weight: 0.1, detail: `HTTP ${t} (redirect)` } : null;
}
function jp(t, e) {
  for (const n of Up)
    if (n.test(t)) return "resource";
  if (e && e.size > 0) {
    const n = e.classify(t);
    if (n) return n;
  }
  for (const n of qp)
    if (new RegExp(n.pattern, "i").test(t)) return n.operation;
  return "unknown";
}
const kc = [
  { field: /^asin(?:\.\d+)?$/i, hint: "product-id" },
  { field: /^product[_-]?id$/i, hint: "product-id" },
  { field: /^item[_-]?id$/i, hint: "product-id" },
  { field: /^sku$/i, hint: "product-id" },
  { field: /^quantity(?:\.\d+)?$/i, hint: "quantity" },
  { field: /^qty(?:\.\d+)?$/i, hint: "quantity" },
  { field: /^leave[_-]?type$/i, hint: "leave-type" },
  { field: /^employee[_-]?id$/i, hint: "employee-id" },
  { field: /^issue[_-]?id$/i, hint: "issue-id" },
  { field: /^user[_-]?id$/i, hint: "user-id" }
];
function Fp(t) {
  const e = [];
  for (const [n, r] of Object.entries(t))
    for (const o of kc)
      if (o.field.test(n)) {
        e.push({ field: n, value: r, hint: o.hint });
        break;
      }
  return e;
}
function Kp(t) {
  if (!t) return null;
  if (typeof t.operationName == "string" && t.operationName.length > 0)
    return `graphql:${t.operationName}`;
  const e = typeof t.query == "string" ? t.query : typeof t.operations == "string" ? t.operations : null;
  if (e) {
    const n = e.match(/\b(?:mutation|query|subscription)\s+([A-Za-z0-9_]+)/);
    return n ? `graphql:${n[1]}` : null;
  }
  return null;
}
function Gp(t) {
  if (!t) return [];
  const e = typeof t.variables == "string" ? t.variables : null;
  if (!e) return [];
  let n;
  try {
    n = JSON.parse(e);
  } catch {
    return [];
  }
  if (!n || typeof n != "object") return [];
  const r = [];
  for (const [o, s] of Object.entries(n))
    if (!(typeof s != "string" && typeof s != "number")) {
      for (const c of kc)
        if (c.field.test(o)) {
          r.push({ field: `variables.${o}`, value: String(s), hint: c.hint });
          break;
        }
    }
  return r;
}
class Hp {
  /**
   * @param domainPatternRegistry Optional M9.11 domain pattern registry.
   *   When provided, domain patterns are checked before built-in defaults.
   */
  constructor(e) {
    B(this, "name", "NetworkSignalExtractor");
    B(this, "domainPatternRegistry");
    this.domainPatternRegistry = e ?? null;
  }
  extract(e) {
    const n = e.behavioralEvidence;
    if (!n) return [];
    const r = n.applicationEvidence.networkActivity;
    if (!r || r.length === 0) return [];
    const o = [];
    for (const s of r) {
      let c = jp(s.url, this.domainPatternRegistry);
      const l = Kp(s.requestBody);
      if (l && (c = l), c === "analytics" || c === "resource") continue;
      const f = Bp(s.status);
      let h = s.requestBody ? Fp(s.requestBody) : [];
      h.length === 0 && s.requestBody && (h = Gp(s.requestBody)), o.push({
        type: "api-operation",
        interactionId: e.interactionId,
        source: s.status !== null ? "network-status" : "network-url",
        confidence: l ? 0.8 : c === "unknown" ? 0.2 : 0.7,
        operation: c,
        method: s.method,
        status: s.status,
        succeeded: s.status !== null ? s.status >= 200 && s.status < 300 : null,
        url: s.url,
        outcomeHint: f,
        requestBody: s.requestBody,
        entityHints: h.length > 0 ? h : void 0,
        sourceEventId: s.sourceEventId
      });
    }
    return o;
  }
}
const da = /* @__PURE__ */ new Set(["alert", "status", "log"]);
function fa(t, e) {
  return t === "alert" ? e && /error|fail|invalid|incorrect|required|unable/i.test(e) ? "error" : "warning" : t === "status" ? e && /success|added|removed|updated|complete|saved|done/i.test(e) ? "success" : "info" : t === "log" ? "info" : "unknown";
}
class zp {
  constructor() {
    B(this, "name", "NotificationSignalExtractor");
  }
  extract(e) {
    const n = e.behavioralEvidence;
    if (!n) return [];
    const r = n.applicationEvidence, o = [];
    for (const s of r.newSurfaces)
      s.ariaRole && da.has(s.ariaRole) && o.push({
        type: "notification",
        interactionId: e.interactionId,
        source: "surface",
        confidence: 0.8,
        text: s.accessibleName ?? "",
        severity: fa(s.ariaRole, s.accessibleName),
        elementPath: s.path,
        kind: "appeared"
      });
    for (const s of r.removedSurfaces)
      s.ariaRole && da.has(s.ariaRole) && o.push({
        type: "notification",
        interactionId: e.interactionId,
        source: "surface",
        confidence: 0.7,
        text: s.accessibleName ?? "",
        severity: fa(s.ariaRole, s.accessibleName),
        elementPath: s.path,
        kind: "disappeared"
      });
    return o;
  }
}
const Wp = 8;
function xr(t) {
  if (t === null) return null;
  const e = t.trim();
  if (e.length === 0 || e.length > Wp) return null;
  const n = e.replace(/^[(\[]|[\])]$/g, "").replace(/,/g, "").trim();
  if (n.length === 0) return null;
  const r = Number(n);
  return Number.isFinite(r) ? r : null;
}
const Ji = /cart|count|badge|total|qty|quantity|items?|results?|notification/i, Yp = /^(?:aria-valuenow|aria-valuetext|data-count|data-badge|data-quantity|data-total|data-num|data-value|data-progress)$/i;
class Xp {
  constructor() {
    B(this, "name", "CounterSignalExtractor");
  }
  extract(e) {
    const n = e.behavioralEvidence;
    if (!n) return [];
    const r = n.applicationEvidence.domChanges;
    if (!r || r.length === 0) return [];
    const o = [];
    for (const s of r) {
      const c = s.characterDataDelta;
      if (!c) {
        if (s.types.includes("attributes") && s.attributeDeltas)
          for (const [m, g] of Object.entries(s.attributeDeltas)) {
            if (!Yp.test(m)) continue;
            const I = xr(g.old), b = xr(g.new);
            if (I === null || b === null) continue;
            const O = Ji.test(s.targetPath) ? s.targetPath.split("/").pop() ?? null : null;
            o.push({
              type: "counter-change",
              interactionId: e.interactionId,
              source: "dom-mutation",
              confidence: 0.8,
              elementPath: s.targetPath,
              oldValue: g.old,
              newValue: g.new,
              numericDelta: b - I,
              label: O ?? m
            });
          }
        continue;
      }
      const l = xr(c.old), f = xr(c.new);
      if (l === null || f === null) continue;
      const h = Ji.test(s.targetPath) ? s.targetPath.split("/").pop() ?? null : null;
      o.push({
        type: "counter-change",
        interactionId: e.interactionId,
        source: "dom-mutation",
        confidence: Ji.test(s.targetPath) ? 0.8 : 0.5,
        elementPath: s.targetPath,
        oldValue: c.old,
        newValue: c.new,
        numericDelta: f - l,
        label: h
      });
    }
    return o;
  }
}
const Qp = /* @__PURE__ */ new Set(["UL", "OL", "TBODY", "TABLE", "SELECT", "DATALIST"]), Zp = /* @__PURE__ */ new Set(["list", "listbox", "tree", "treegrid", "grid", "table", "rowgroup"]), Jp = /^(?:aria-rowcount|aria-colcount|aria-setsize)$/i, eh = /(?:^|[.\s>#\[])(?:[a-z-]*grid[a-z-]*|results?-?(?:container|list|wrapper)?|items?-?(?:container|list|wrapper)?|rows?-?(?:container|list)?|data-table|virtual-list)(?:[.\s>#\[]|$)/i;
function th(t, e) {
  const n = t.toUpperCase();
  if (Qp.has(n)) return !0;
  const r = e.match(/\[role=([^\]]+)\]/i);
  return !!(r && Zp.has(r[1].toLowerCase()) || /data-testid=["']?[^"']*list|results?|items?|grid/i.test(e) || eh.test(e));
}
class nh {
  constructor() {
    B(this, "name", "ListSignalExtractor");
  }
  extract(e) {
    const n = e.behavioralEvidence;
    if (!n) return [];
    const r = n.applicationEvidence.domChanges;
    if (!r || r.length === 0) return [];
    const o = [];
    for (const s of r) {
      if (s.types.includes("childList")) {
        if (s.addedNodesCount === 0 && s.removedNodesCount === 0 || !th(s.targetTag, s.targetPath)) continue;
        o.push({
          type: "list-change",
          interactionId: e.interactionId,
          source: "dom-mutation",
          confidence: 0.7,
          containerPath: s.targetPath,
          containerTag: s.targetTag,
          addedCount: s.addedNodesCount,
          removedCount: s.removedNodesCount,
          netChange: s.addedNodesCount - s.removedNodesCount
        });
      }
      if (s.types.includes("attributes"))
        for (const c of s.changedAttributes) {
          if (!Jp.test(c)) continue;
          const l = s.attributeDeltas[c];
          if (!l || !l.old || !l.new) continue;
          const f = parseInt(l.old, 10), h = parseInt(l.new, 10);
          if (isNaN(f) || isNaN(h)) continue;
          const m = h - f;
          m !== 0 && o.push({
            type: "list-change",
            interactionId: e.interactionId,
            source: "dom-mutation",
            confidence: 0.8,
            containerPath: s.targetPath,
            containerTag: s.targetTag,
            addedCount: Math.max(0, m),
            removedCount: Math.max(0, -m),
            netChange: m
          });
        }
    }
    return o;
  }
}
class rh {
  constructor() {
    B(this, "name", "TargetStateSignalExtractor");
  }
  extract(e) {
    var g, I;
    const n = e.behavioralEvidence;
    if (!n) return [];
    const r = n.targetEvidence;
    if (!r || !r.before || !r.after) return [];
    const o = [], s = ((g = r.identity) == null ? void 0 : g.cssSelector) ?? ((I = r.identity) == null ? void 0 : I.elementId) ?? "unknown-field", c = r.identity ? r.identity.accessibleName ?? r.identity.tag ?? null : null, l = r.before.value, f = r.after.value;
    l !== f && o.push({
      type: "input-value-change",
      interactionId: e.interactionId,
      source: "target-state",
      confidence: 0.95,
      field: s,
      oldValue: l,
      newValue: f,
      elementLabel: c
    });
    const h = r.before, m = r.after;
    if ((h.checked !== null || m.checked !== null) && h.checked !== m.checked && o.push({
      type: "control-state-change",
      interactionId: e.interactionId,
      source: "target-state",
      confidence: 0.95,
      property: "checked",
      field: s,
      oldValue: h.checked === null ? null : String(h.checked),
      newValue: m.checked === null ? null : String(m.checked),
      elementLabel: c
    }), (h.ariaExpanded !== null || m.ariaExpanded !== null) && h.ariaExpanded !== m.ariaExpanded && o.push({
      type: "control-state-change",
      interactionId: e.interactionId,
      source: "target-state",
      confidence: 0.9,
      property: "expanded",
      field: s,
      oldValue: h.ariaExpanded === null ? null : String(h.ariaExpanded),
      newValue: m.ariaExpanded === null ? null : String(m.ariaExpanded),
      elementLabel: c
    }), (h.ariaChecked !== null || m.ariaChecked !== null) && h.ariaChecked !== m.ariaChecked && o.push({
      type: "control-state-change",
      interactionId: e.interactionId,
      source: "target-state",
      confidence: 0.9,
      property: "checked-aria",
      field: s,
      oldValue: h.ariaChecked === null ? null : String(h.ariaChecked),
      newValue: m.ariaChecked === null ? null : String(m.ariaChecked),
      elementLabel: c
    }), (h.ariaPressed !== null || m.ariaPressed !== null) && h.ariaPressed !== m.ariaPressed && o.push({
      type: "control-state-change",
      interactionId: e.interactionId,
      source: "target-state",
      confidence: 0.9,
      property: "pressed",
      field: s,
      oldValue: h.ariaPressed === null ? null : String(h.ariaPressed),
      newValue: m.ariaPressed === null ? null : String(m.ariaPressed),
      elementLabel: c
    }), h.selectedValues !== null || m.selectedValues !== null) {
      const b = h.selectedValues === null ? null : [...h.selectedValues].sort().join("|"), O = m.selectedValues === null ? null : [...m.selectedValues].sort().join("|");
      b !== O && o.push({
        type: "control-state-change",
        interactionId: e.interactionId,
        source: "target-state",
        confidence: 0.9,
        property: "selection",
        field: s,
        oldValue: b,
        newValue: O,
        elementLabel: c
      });
    }
    return (h.controlledValue !== null || m.controlledValue !== null) && h.controlledValue !== m.controlledValue && o.push({
      type: "control-state-change",
      interactionId: e.interactionId,
      source: "target-state",
      confidence: 0.85,
      property: "controlled-value",
      field: s,
      oldValue: h.controlledValue,
      newValue: m.controlledValue,
      elementLabel: c
    }), o;
  }
}
const ih = /* @__PURE__ */ new Set(["status", "alert", "log"]), oh = /* @__PURE__ */ new Set(["BADGE", "COUNTER"]);
function sh(t) {
  return {
    kind: t.kind,
    matchedSelector: t.matchedSelector,
    text: t.text,
    numericValue: t.numericValue,
    entityId: t.entityId,
    entityType: t.entityType,
    domPath: t.domPath,
    attributes: { ...t.attributes },
    visible: t.visible
  };
}
function eo(t, e) {
  return `${t}:${e}`;
}
function ah(t) {
  var c;
  const e = t.behavioralEvidence;
  if (!e) return { items: [], snapshot: null };
  const n = e.applicationEvidence, r = n.resultingState ?? null, o = [], s = /* @__PURE__ */ new Set();
  if (r && r.items.length > 0)
    for (const l of r.items) {
      const f = sh(l), h = eo(f.kind, f.domPath);
      s.has(h) || (s.add(h), o.push(f));
    }
  for (const l of n.newSurfaces) {
    const f = l.ariaRole, h = ((c = l.tagName) == null ? void 0 : c.toUpperCase()) ?? "", m = l.accessibleName ?? "", g = l.path;
    if (f && ih.has(f)) {
      const I = eo("status-badge", g);
      s.has(I) || (s.add(I), o.push({
        kind: "status-badge",
        matchedSelector: "aria-role",
        text: m,
        numericValue: null,
        entityId: null,
        entityType: null,
        domPath: g,
        attributes: { "aria-role": f },
        visible: !0
      }));
    }
    if (oh.has(h)) {
      const I = parseInt(m.replace(/[^0-9]/g, ""), 10);
      if (!isNaN(I)) {
        const b = eo("counter", g);
        s.has(b) || (s.add(b), o.push({
          kind: "counter",
          matchedSelector: "surface-tag",
          text: m,
          numericValue: I,
          entityId: null,
          entityType: null,
          domPath: g,
          attributes: { source: "surface" },
          visible: !0
        }));
      }
    }
  }
  return { items: o, snapshot: r };
}
class ch {
  constructor() {
    B(this, "name", "PageContentEvidenceExtractor");
  }
  extract(e) {
    const { items: n, snapshot: r } = ah(e);
    if (n.length === 0) return [];
    const o = n.filter((g) => g.kind === "entity"), s = n.filter((g) => g.kind === "counter"), c = n.filter((g) => g.kind === "collection"), l = n.filter((g) => g.kind === "notification"), f = n.filter((g) => g.kind === "status-badge"), h = r !== null && r.items.length > 0;
    return [{
      type: "page-content",
      source: "page-content",
      interactionId: e.interactionId,
      confidence: 0.7,
      snapshot: h ? {
        viewId: r.viewId,
        url: r.url,
        scannedAt: r.scannedAt,
        items: n,
        itemsOverflow: r.itemsOverflow,
        scanDurationMs: r.scanDurationMs
      } : {
        viewId: null,
        url: "",
        scannedAt: Date.now(),
        items: n,
        itemsOverflow: 0,
        scanDurationMs: 0
      },
      observedEntities: o,
      observedCounters: s,
      observedCollections: c,
      observedNotifications: l,
      observedStatusBadges: f
    }];
  }
}
class uh {
  constructor(e = []) {
    B(this, "patterns", []);
    this.patterns = [...e];
  }
  /**
   * Add a pattern to the registry. Patterns are tested in insertion order.
   */
  add(e) {
    this.patterns.push(e);
  }
  /**
   * Add multiple patterns.
   */
  addAll(e) {
    for (const n of e) this.patterns.push(n);
  }
  /**
   * Match a URL against registered patterns.
   * Returns the first matching ViewDescriptor, or null if no match.
   */
  match(e) {
    for (const n of this.patterns)
      if (new RegExp(n.pattern).test(e))
        return {
          id: n.viewId,
          label: n.viewLabel,
          detectedFrom: "url-pattern",
          confidence: n.confidence
        };
    return null;
  }
  /**
   * Number of registered patterns.
   */
  get size() {
    return this.patterns.length;
  }
}
const lh = [
  // ── E-commerce: Cart-specific patterns (must be before generic /cart) ──
  { viewId: "cart-confirmation", viewLabel: "Cart Confirmation", pattern: "/cart/add-to-cart", confidence: 0.9 },
  { viewId: "cart-confirmation", viewLabel: "Cart Confirmation", pattern: "/cart/add", confidence: 0.8 },
  { viewId: "cart", viewLabel: "Cart", pattern: "/cart", confidence: 0.9 },
  { viewId: "cart", viewLabel: "Cart", pattern: "/shopping-cart", confidence: 0.9 },
  { viewId: "cart", viewLabel: "Cart", pattern: "/basket", confidence: 0.85 },
  // ── E-commerce: Product detail ──
  // Amazon: /dp/ASIN, /product/ID
  { viewId: "product-detail", viewLabel: "Product Detail", pattern: "/dp/[A-Z0-9]", confidence: 0.9 },
  { viewId: "product-detail", viewLabel: "Product Detail", pattern: "/product/", confidence: 0.9 },
  { viewId: "product-detail", viewLabel: "Product Detail", pattern: "/products?/", confidence: 0.9 },
  { viewId: "product-detail", viewLabel: "Product Detail", pattern: "/item/", confidence: 0.85 },
  // ── E-commerce: Checkout ──
  { viewId: "checkout", viewLabel: "Checkout", pattern: "/checkout", confidence: 0.9 },
  { viewId: "checkout", viewLabel: "Checkout", pattern: "/pay$", confidence: 0.85 },
  // ── Search results ──
  // Amazon uses /s? and /s/ref= paths; general apps use /search?q=
  { viewId: "search-results", viewLabel: "Search Results", pattern: "/s\\?", confidence: 0.85 },
  { viewId: "search-results", viewLabel: "Search Results", pattern: "/s/ref=", confidence: 0.85 },
  { viewId: "search-results", viewLabel: "Search Results", pattern: "/search", confidence: 0.85 },
  { viewId: "search-results", viewLabel: "Search Results", pattern: "[?&](q|query|search|keywords|field-keywords)=", confidence: 0.8 },
  { viewId: "search-results", viewLabel: "Search Results", pattern: "/results", confidence: 0.75 },
  // ── Home / landing ──
  { viewId: "home", viewLabel: "Home", pattern: "^https?://[^/]+/?$", confidence: 0.7 },
  { viewId: "home", viewLabel: "Home", pattern: "/home", confidence: 0.7 },
  { viewId: "home", viewLabel: "Home", pattern: "/landing", confidence: 0.7 },
  // ── User account ──
  { viewId: "account", viewLabel: "Account", pattern: "/account", confidence: 0.85 },
  { viewId: "account", viewLabel: "Account", pattern: "/profile", confidence: 0.85 },
  { viewId: "account", viewLabel: "Account", pattern: "/dashboard", confidence: 0.8 },
  { viewId: "login", viewLabel: "Login", pattern: "/login", confidence: 0.9 },
  { viewId: "login", viewLabel: "Login", pattern: "/signin", confidence: 0.9 },
  { viewId: "register", viewLabel: "Register", pattern: "/register", confidence: 0.9 },
  { viewId: "register", viewLabel: "Register", pattern: "/signup", confidence: 0.9 },
  // ── Order history ──
  { viewId: "orders", viewLabel: "Orders", pattern: "/orders", confidence: 0.9 },
  { viewId: "orders", viewLabel: "Orders", pattern: "/order-history", confidence: 0.9 },
  // ── Wishlist / favorites ──
  { viewId: "wishlist", viewLabel: "Wishlist", pattern: "/wishlist", confidence: 0.9 },
  { viewId: "wishlist", viewLabel: "Wishlist", pattern: "/favorites", confidence: 0.85 }
];
function dh() {
  return new uh(lh);
}
class fh {
  constructor() {
    B(this, "entities", /* @__PURE__ */ new Map());
  }
  /**
   * Get an entity by ID.
   */
  get(e) {
    return this.entities.get(e);
  }
  /**
   * Get all entities of a specific type.
   */
  getByType(e) {
    return Array.from(this.entities.values()).filter((n) => n.type === e);
  }
  /**
   * Create or update an entity.
   */
  upsert(e) {
    const n = this.entities.get(e.id);
    if (n) {
      if (n.attributes = { ...n.attributes, ...e.attributes }, n.lastUpdated = e.lastUpdated, n.currentState !== void 0 && (n.currentState = n.currentState), n.stateHistory !== void 0 && (n.stateHistory = n.stateHistory), e.viewIds && e.viewIds.length > 0) {
        const r = new Set(n.viewIds ?? []);
        for (const o of e.viewIds) r.add(o);
        n.viewIds = Array.from(r);
      }
      return n;
    }
    return this.entities.set(e.id, e), e;
  }
  /**
   * All entities as a map (for ApplicationState snapshot).
   */
  snapshot() {
    return new Map(this.entities);
  }
  get size() {
    return this.entities.size;
  }
  clear() {
    this.entities.clear();
  }
}
class ph {
  constructor() {
    B(this, "collections", /* @__PURE__ */ new Map());
  }
  /**
   * Update a collection's size from a list-change signal.
   * Creates the collection if it doesn't exist.
   */
  update(e, n, r, o, s = "unknown", c) {
    const l = `collection:${e}`;
    let f = this.collections.get(l);
    if (!f)
      f = {
        id: l,
        entityType: s,
        count: null,
        containerPath: e,
        lastUpdated: o,
        viewIds: c ? [c] : void 0
      }, this.collections.set(l, f);
    else if (c) {
      const m = new Set(f.viewIds ?? []);
      m.add(c), f.viewIds = Array.from(m);
    }
    const h = f.count ?? 0;
    return f.count = Math.max(0, h + n - r), f.lastUpdated = o, f;
  }
  /**
   * Set the count directly (e.g., from a page content snapshot).
   */
  setCount(e, n, r, o) {
    const s = `collection:${e}`;
    let c = this.collections.get(s);
    if (!c)
      c = {
        id: s,
        entityType: "unknown",
        count: n,
        containerPath: e,
        lastUpdated: r,
        viewIds: o ? [o] : void 0
      }, this.collections.set(s, c);
    else if (o) {
      const l = new Set(c.viewIds ?? []);
      l.add(o), c.viewIds = Array.from(l);
    }
    c.count = n, c.lastUpdated = r;
  }
  /**
   * Get a collection by container path.
   */
  get(e) {
    return this.collections.get(`collection:${e}`);
  }
  /**
   * All collections as a map.
   */
  snapshot() {
    return new Map(this.collections);
  }
  get size() {
    return this.collections.size;
  }
  clear() {
    this.collections.clear();
  }
}
class hh {
  constructor() {
    B(this, "counters", /* @__PURE__ */ new Map());
  }
  /**
   * Record a counter value change.
   * Creates the counter if it doesn't exist.
   */
  record(e, n, r, o = null, s) {
    const c = `counter:${e}`;
    let l = this.counters.get(c);
    if (!l)
      l = {
        id: c,
        label: o ?? e,
        elementPath: e,
        values: [],
        viewIds: s ? [s] : void 0
      }, this.counters.set(c, l);
    else if (s) {
      const g = new Set(l.viewIds ?? []);
      g.add(s), l.viewIds = Array.from(g);
    }
    const f = l.values[l.values.length - 1];
    let h = null;
    if (f) {
      const g = Number(f.value), I = Number(n);
      Number.isFinite(g) && Number.isFinite(I) && (h = I - g);
    }
    const m = {
      value: n,
      interactionId: r,
      delta: h
    };
    return l.values.push(m), l;
  }
  /**
   * Get the latest value of a counter.
   */
  getLatest(e) {
    const n = this.counters.get(`counter:${e}`);
    return !n || n.values.length === 0 ? null : n.values[n.values.length - 1].value;
  }
  /**
   * Get a counter record by element path.
   */
  get(e) {
    return this.counters.get(`counter:${e}`);
  }
  /**
   * All counters as a map.
   */
  snapshot() {
    return new Map(this.counters);
  }
  get size() {
    return this.counters.size;
  }
  clear() {
    this.counters.clear();
  }
}
class mh {
  constructor() {
    B(this, "notifications", []);
    B(this, "nextId", 0);
  }
  /**
   * Record a notification appearance.
   */
  recordAppearance(e, n, r, o) {
    const s = this.notifications.find(
      (l) => l.elementPath === r && l.disappearedAt === null && l.text === e
    );
    if (s) return s;
    const c = {
      id: `notification-${this.nextId++}`,
      text: e,
      severity: n,
      elementPath: r,
      appearedAt: o,
      disappearedAt: null
    };
    return this.notifications.push(c), c;
  }
  /**
   * Record a notification disappearance.
   */
  recordDisappearance(e, n) {
    const r = this.notifications.find(
      (o) => o.elementPath === e && o.disappearedAt === null
    );
    r && (r.disappearedAt = n);
  }
  /**
   * Get all notifications.
   */
  getAll() {
    return [...this.notifications];
  }
  /**
   * Get active (not yet disappeared) notifications.
   */
  getActive() {
    return this.notifications.filter((e) => e.disappearedAt === null);
  }
  get size() {
    return this.notifications.length;
  }
  clear() {
    this.notifications = [], this.nextId = 0;
  }
}
class Ac {
  constructor() {
    B(this, "rules", []);
  }
  /**
   * Register a rule (or an array of rules).
   */
  register(e) {
    const n = Array.isArray(e) ? e : [e];
    return this.rules.push(...n), this;
  }
  /**
   * Get all registered rules.
   */
  getAll() {
    return [...this.rules];
  }
  /**
   * Clear all rules (test helper).
   */
  clear() {
    this.rules = [];
  }
  /**
   * Resolve the entity type for a page-content observation.
   * First rule (registration order) whose matchers all match wins.
   */
  resolveFromPageContent(e, n) {
    if (!e) return null;
    for (const r of this.rules)
      if (!(!r.pageContentKind || r.pageContentKind !== e) && !(r.viewId || r.urlPattern || r.apiOperation) && !r.dataAttribute)
        return r.entityType;
    return null;
  }
  /**
   * Resolve the entity type from a view change.
   */
  resolveFromView(e, n) {
    for (const r of this.rules)
      if (!(!r.viewId || r.viewId !== e)) {
        if (r.urlPattern) {
          const o = n.match(new RegExp(r.urlPattern));
          if (!o) continue;
          const s = o[1] ?? null;
          return { type: r.entityType, id: s };
        }
        return { type: r.entityType, id: null };
      }
    return null;
  }
  /**
   * Resolve the entity type from an API operation.
   */
  resolveFromApiOperation(e, n) {
    for (const r of this.rules)
      if (!(!r.apiOperation || r.apiOperation !== e) && !(r.viewId || r.urlPattern || r.pageContentKind))
        return {
          type: r.entityType,
          id: `${r.entityType}:${n}`
        };
    return null;
  }
  /**
   * Resolve the entity type from a form field name (D6).
   * Returns the entity type if a field-pattern rule matches, null otherwise.
   *
   * D6 fix: uses semantic word-boundary matching instead of bare substring
   * matching. A field named "hostname" must NOT match the "name" pattern,
   * and "filename" must NOT match the "name" pattern. Matching is based on
   * whether the pattern appears as a complete word/segment in the field name,
   * separated by non-alphanumeric boundaries (hyphens, underscores, dots,
   * camelCase transitions, start/end of string).
   */
  resolveFromFormField(e) {
    if (!e) return null;
    const n = vh(e), r = e.toLowerCase();
    for (const o of this.rules)
      if (!(!o.fieldPatterns || o.fieldPatterns.length === 0)) {
        for (const s of o.fieldPatterns)
          if (wh(s.toLowerCase(), r, n))
            return o.entityType;
      }
    return null;
  }
}
const gh = [
  // -- HR (OrangeHRM-style) --
  { entityType: "employee", pageContentKind: "employee" },
  { entityType: "leave-request", pageContentKind: "leave-request" },
  { entityType: "candidate", pageContentKind: "candidate" },
  { entityType: "leave-request", viewId: "leave-detail", urlPattern: "/leave/(\\d+)" },
  // -- Developer tools (GitHub-style) --
  { entityType: "issue", viewId: "issue-detail", urlPattern: "/issues/(\\d+)" },
  { entityType: "pull-request", viewId: "pr-detail", urlPattern: "/pull/(\\d+)" },
  { entityType: "commit", pageContentKind: "commit" },
  { entityType: "comment", pageContentKind: "comment" },
  // -- CI (GitHub-style) --
  { entityType: "build", pageContentKind: "build" }
], yh = [
  // -- HR (OrangeHRM-style) --
  {
    entityType: "employee",
    fieldPatterns: [
      "employee",
      "employeename",
      "employee-name",
      "empname",
      "emp-name",
      "firstname",
      "first-name",
      "lastname",
      "last-name",
      "fullname",
      "full-name"
    ]
  },
  {
    entityType: "leave-request",
    fieldPatterns: [
      "leavetype",
      "leave-type",
      "leavetype-id",
      "leave-balance",
      "leaveperiod",
      "leave-period"
    ]
  },
  {
    entityType: "candidate",
    fieldPatterns: ["candidate", "applicant", "applicantname", "applicant-name"]
  },
  // -- Authentication --
  {
    entityType: "user",
    fieldPatterns: ["username", "user-name", "email", "password", "login", "signin"]
  },
  // -- Developer tools (GitHub-style) --
  {
    entityType: "issue",
    fieldPatterns: [
      "issuetitle",
      "issue-title",
      "issuebody",
      "issue-body",
      "issuesummary",
      "issue-summary"
    ]
  },
  {
    entityType: "pull-request",
    fieldPatterns: [
      "prtitle",
      "pr-title",
      "pulltitle",
      "pull-request-title",
      "prdescription",
      "pr-description",
      "reviewtitle",
      "review-title"
    ]
  },
  // -- Generic form fields --
  {
    entityType: "form-entry",
    fieldPatterns: ["title", "name", "description", "comment", "message", "note"]
  }
];
function _c(t = !0) {
  const e = new Ac();
  return t && (e.register([...gh]), e.register([...yh])), e;
}
function vh(t) {
  const e = t.split(/[-_.\s]+/).filter(Boolean), n = [];
  for (const r of e) {
    const o = r.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean), s = o.length > 1;
    o.forEach((c) => {
      n.push({
        token: c.toLowerCase(),
        fromSeparator: s ? !1 : t !== r
      });
    });
  }
  return n;
}
function wh(t, e, n) {
  if (e === t) return !0;
  const r = t.split(/[-_.\s]+/).filter(Boolean);
  if (r.length === 1) {
    const o = r[0], s = n.map((c) => c.token);
    return !!(s.includes(o) && (n.find((l) => l.token === o).fromSeparator || n.length === 1) || s.length > 1 && s.join("") === o);
  }
  if (r.length > 1) {
    const o = n.map((s) => s.token);
    return r.every((s) => o.includes(s));
  }
  return !1;
}
const $r = {
  // Approval / review lifecycles
  pending: "pending",
  "awaiting approval": "pending",
  "awaiting review": "pending",
  approved: "approved",
  rejected: "rejected",
  declined: "rejected",
  cancelled: "cancelled",
  canceled: "cancelled",
  confirmed: "confirmed",
  completed: "completed",
  complete: "completed",
  done: "completed",
  draft: "draft",
  submitted: "submitted",
  // Issue / PR lifecycles
  open: "open",
  closed: "closed",
  merged: "merged",
  "in review": "in-review",
  "changes requested": "changes-requested",
  "in progress": "in-progress",
  todo: "todo",
  blocked: "blocked",
  archived: "archived",
  // E-commerce / order lifecycles
  active: "active",
  inactive: "inactive",
  disabled: "disabled",
  enabled: "enabled",
  expired: "expired",
  refunded: "refunded",
  shipped: "shipped",
  delivered: "delivered",
  returned: "returned",
  // HR / hiring lifecycles
  shortlisted: "shortlisted",
  interviewed: "interviewed",
  hired: "hired",
  "on hold": "on-hold"
};
function Rc(t, e) {
  const n = t.trim().toLowerCase();
  if (!n) return null;
  if (e && e.size > 0) {
    const o = e.resolve(t);
    if (o) return o;
  }
  if ($r[n]) return $r[n];
  const r = Object.keys($r).sort((o, s) => s.length - o.length);
  for (const o of r)
    if (new RegExp(`(^|[^a-z])${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(n))
      return $r[o];
  return null;
}
function bh(t, e) {
  const n = Rc(t, e);
  if (n) return n;
  const r = {
    saved: "saved",
    created: "created",
    updated: "updated",
    deleted: "deleted",
    removed: "removed",
    added: "added"
  }, o = t.toLowerCase();
  for (const [s, c] of Object.entries(r))
    if (new RegExp(`\\b${s}\\b`, "i").test(o)) return c;
  return null;
}
class Ih {
  constructor() {
    B(this, "histories", /* @__PURE__ */ new Map());
    B(this, "current", /* @__PURE__ */ new Map());
  }
  /**
   * Apply a state observation to an entity.
   * Only records a transition when the state actually changes.
   */
  observe(e, n, r, o) {
    const s = this.current.get(e) ?? null;
    if (s === n) return !1;
    const c = { from: s, to: n, changedAt: r, evidence: o }, l = this.histories.get(e) ?? [];
    return l.push(c), this.histories.set(e, l), this.current.set(e, n), !0;
  }
  /**
   * Get the current state of an entity (null = never observed).
   */
  getState(e) {
    return this.current.get(e) ?? null;
  }
  /**
   * Get the state history for an entity (may be empty).
   */
  getHistory(e) {
    return this.histories.get(e) ?? [];
  }
  /**
   * Apply tracked state to an entity snapshot map (M9.2 ApplicationState).
   */
  applyToEntities(e) {
    for (const [n, r] of this.current) {
      const o = e.get(n);
      o && (o.currentState = r);
    }
    for (const [n, r] of this.histories) {
      const o = e.get(n);
      o && (o.stateHistory = r);
    }
  }
  clear() {
    this.histories.clear(), this.current.clear();
  }
}
class Eh {
  /**
   * @param entityTypeRegistry Optional registry for custom entity types.
   *   If omitted, a default-seeded registry is created. Pass `false` to
   *   create a builder with no registry (legacy behavior, no custom types).
   * @param stateVocabRegistry Optional registry for domain-specific state
   *   keywords (M9.11). When provided, badge/notification state detection
   *   checks domain vocabulary before built-in keywords.
   */
  constructor(e, n) {
    B(this, "currentView", null);
    B(this, "currentUrl", null);
    B(this, "entityTracker", new fh());
    B(this, "collectionTracker", new ph());
    B(this, "counterTracker", new hh());
    B(this, "notificationTracker", new mh());
    B(this, "stateTracker", new Ih());
    B(this, "interactionCount", 0);
    B(this, "lastInteractionId", null);
    B(this, "entityTypeRegistry");
    B(this, "stateVocabularyRegistry");
    /**
     * DDC-5: evidence-quality flags set by the pipeline for the NEXT
     * processSignals call (read from the interaction's behavioral evidence).
     */
    B(this, "pendingEvidenceQuality", null);
    this.entityTypeRegistry = e === !1 ? new Ac() : e ?? _c(!0), this.stateVocabularyRegistry = n ?? null;
  }
  /**
   * DDC-5: set evidence-quality flags for the next processSignals call.
   */
  setEvidenceQuality(e) {
    this.pendingEvidenceQuality = e;
  }
  /**
   * Process one interaction's signals and produce a state transition.
   */
  processSignals(e) {
    var l, f, h;
    const n = this.getCurrentState(), r = [];
    if (this.pendingEvidenceQuality) {
      const m = this.pendingEvidenceQuality;
      m.mainThreadBlocked && r.push("evidence-degraded: main-thread-blocked"), m.domChangeOverflow > 0 && r.push(`evidence-degraded: dom-change-overflow (${m.domChangeOverflow})`), m.coarseMode && r.push("evidence-degraded: coarse-mode"), this.pendingEvidenceQuality = null;
    }
    for (const m of e.viewChanges)
      this.currentView = m.toView, this.currentUrl = m.toUrl, r.push(`view → ${m.toView.id}`), this.deriveEntitiesFromView(m, r);
    for (const m of e.apiOperations)
      this.deriveEntitiesFromApiOp(m, r);
    const o = new Set(
      e.counterChanges.map((m) => m.elementPath)
    ), s = new Set(
      e.listChanges.map((m) => m.containerPath)
    );
    e.pageContent && this.processPageContent(
      e.pageContent,
      r,
      o,
      s
    );
    for (const m of e.notifications)
      m.kind === "appeared" ? (this.notificationTracker.recordAppearance(
        m.text,
        m.severity,
        m.elementPath,
        e.interactionId
      ), r.push(`notification: "${m.text.substring(0, 50)}" (${m.severity})`), this.detectStateFromNotification(m.text, e.interactionId)) : this.notificationTracker.recordDisappearance(m.elementPath, e.interactionId);
    for (const m of e.counterChanges) {
      this.counterTracker.record(
        m.elementPath,
        m.newValue,
        e.interactionId,
        m.label,
        (l = this.currentView) == null ? void 0 : l.id
      );
      const g = m.numericDelta !== null ? ` (Δ${m.numericDelta > 0 ? "+" : ""}${m.numericDelta})` : "";
      r.push(`counter: ${m.oldValue ?? "?"} → ${m.newValue}${g}`);
    }
    for (const m of e.listChanges)
      this.collectionTracker.update(
        m.containerPath,
        m.addedCount,
        m.removedCount,
        e.interactionId,
        "unknown",
        (f = this.currentView) == null ? void 0 : f.id
      ), r.push(`list: ${m.containerPath} (${m.netChange >= 0 ? "+" : ""}${m.netChange} items)`);
    for (const m of e.inputChanges) {
      const g = m.field.toLowerCase(), I = this.entityTypeRegistry.resolveFromFormField(m.field);
      if (g.includes("search") || g.includes("query")) {
        if (m.newValue && m.newValue.trim().length > 0) {
          const b = {
            id: `search-query:${m.newValue}`,
            type: "search-query",
            attributes: {
              term: m.newValue,
              field: m.field
            },
            source: "target-derived",
            firstSeenAt: e.interactionId,
            lastUpdated: e.interactionId,
            viewIds: this.currentView ? [this.currentView.id] : void 0
          };
          this.entityTracker.upsert(b), r.push(`search query: "${m.newValue}"`);
        }
      } else if (I && m.newValue && m.newValue.trim().length > 0) {
        const b = {
          id: `${I}:${m.newValue}`,
          type: I,
          attributes: {
            value: m.newValue,
            field: m.field
          },
          source: "target-derived",
          firstSeenAt: e.interactionId,
          lastUpdated: e.interactionId,
          viewIds: this.currentView ? [this.currentView.id] : void 0
        };
        this.entityTracker.upsert(b), r.push(`form field entity (${I}): "${m.newValue}"`);
      }
    }
    for (const m of e.controlStateChanges ?? []) {
      const g = m.elementLabel ? `${m.elementLabel} (${m.property})` : m.property;
      r.push(`control: ${g} ${m.oldValue ?? "∅"} → ${m.newValue ?? "∅"}`);
      const I = `control.${m.property}`;
      for (const [b, O] of this.entityTracker.snapshot())
        O.attributes && (O.attributes.field === m.field || (h = O.attributes.field) != null && h.includes(m.field)) && (this.entityTracker.upsert({
          ...O,
          attributes: { ...O.attributes, [I]: m.newValue ?? "" },
          lastUpdated: e.interactionId
        }), r.push(`entity attribute: ${b} ${I}=${m.newValue}`));
    }
    this.interactionCount++, this.lastInteractionId = e.interactionId;
    const c = this.getCurrentState();
    return { interactionId: e.interactionId, before: n, after: c, changes: r };
  }
  /**
   * Derive entities from a view change.
   * E.g., navigating to /dp/ASIN creates a Product entity.
   */
  deriveEntitiesFromView(e, n) {
    if (e.toView.id === "product-detail") {
      const o = e.toUrl.match(/\/dp\/([A-Z0-9]{10})/);
      if (o) {
        const s = o[1], c = {
          id: `product:${s}`,
          type: "product",
          attributes: {
            asin: s,
            url: e.toUrl
          },
          source: "view-derived",
          firstSeenAt: e.interactionId,
          lastUpdated: e.interactionId,
          viewIds: [e.toView.id]
        };
        this.entityTracker.upsert(c), n.push(`product entity: ${s}`);
      }
    }
    if (e.toView.id === "search-results" && (!e.fromView || e.fromView.id !== e.toView.id)) {
      const o = e.toUrl.match(/[?&](?:field-keywords|q|query|search|keywords|k)=([^&]+)/i);
      if (o) {
        const s = decodeURIComponent(o[1].replace(/\+/g, " ")), c = {
          id: `search-query:${s}`,
          type: "search-query",
          attributes: {
            term: s,
            url: e.toUrl
          },
          source: "view-derived",
          firstSeenAt: e.interactionId,
          lastUpdated: e.interactionId,
          viewIds: [e.toView.id]
        };
        this.entityTracker.upsert(c), n.push(`search query (from URL): "${s}"`);
      }
    }
    const r = this.entityTypeRegistry.resolveFromView(
      e.toView.id,
      e.toUrl
    );
    if (r) {
      const o = r.id ? `${r.type}:${r.id}` : `${r.type}:${e.interactionId}`;
      if (!this.entityTracker.get(o)) {
        const s = {
          id: o,
          type: r.type,
          attributes: {
            url: e.toUrl,
            ...r.id ? { id: r.id } : {}
          },
          source: "view-derived",
          firstSeenAt: e.interactionId,
          lastUpdated: e.interactionId,
          viewIds: [e.toView.id]
        };
        this.entityTracker.upsert(s), n.push(`${r.type} entity (from registry)`);
      }
    }
  }
  /**
   * Derive entities from API operations.
   * E.g., add-to-cart creates a cart-item entity.
   *
   * Network Hardening: When the request body contains product identifiers
   * (ASIN, productId), the cart-item entity is linked to the product
   * entity via attributes.productId.
   */
  deriveEntitiesFromApiOp(e, n) {
    var r, o;
    if (e.operation === "add-to-cart" && e.succeeded !== !1) {
      const s = (r = e.entityHints) == null ? void 0 : r.find((f) => f.hint === "product-id"), c = (o = e.entityHints) == null ? void 0 : o.find((f) => f.hint === "quantity"), l = {
        id: s ? `cart-item:${s.value}` : `cart-item:${e.interactionId}`,
        type: "cart-item",
        attributes: {
          addedAt: e.interactionId,
          via: e.url,
          ...s ? { productId: s.value } : {},
          ...c ? { quantity: c.value } : {}
        },
        source: "inferred",
        firstSeenAt: e.interactionId,
        lastUpdated: e.interactionId,
        viewIds: this.currentView ? [this.currentView.id] : void 0
      };
      this.entityTracker.upsert(l), n.push(`cart-item entity (from API${s ? ", productId=" + s.value : ""})`);
    }
    if (e.operation !== "add-to-cart") {
      const s = this.entityTypeRegistry.resolveFromApiOperation(
        e.operation,
        e.interactionId
      );
      if (s && !this.entityTracker.get(s.id)) {
        const c = {
          id: s.id,
          type: s.type,
          attributes: {
            via: e.url,
            operation: e.operation
          },
          source: "inferred",
          firstSeenAt: e.interactionId,
          lastUpdated: e.interactionId,
          viewIds: this.currentView ? [this.currentView.id] : void 0
        };
        this.entityTracker.upsert(c), n.push(`${s.type} entity (from API registry)`);
      }
    }
  }
  /**
   * Process a page-content snapshot (M9.4) into the state model:
   * entities, collections, counters, notifications.
   *
   * D2/dup fix: counterPaths and collectionPaths contain DOM paths that
   * CounterSignalExtractor / ListSignalExtractor already handle for this
   * interaction. We skip those paths here to prevent double-recording.
   */
  processPageContent(e, n, r, o) {
    var c, l, f;
    const s = e.interactionId;
    for (const h of e.observedEntities) {
      if (!h.entityId) continue;
      const g = this.entityTypeRegistry.resolveFromPageContent(
        h.entityType,
        h.entityId
      ) ?? h.entityType ?? "unknown", I = ((c = this.currentView) == null ? void 0 : c.id) ?? e.snapshot.viewId ?? void 0, b = e.snapshot.url !== "";
      this.entityTracker.upsert({
        id: `${g}:${h.entityId}`,
        type: g,
        attributes: {
          ...h.attributes,
          ...h.numericValue !== null ? { count: h.numericValue } : {},
          ...Sh(h.text) ? { title: h.text } : {}
        },
        source: b ? "content-observed" : "view-derived",
        firstSeenAt: s,
        lastUpdated: s,
        viewIds: I ? [I] : void 0
      }), n.push(`page-content entity: ${g}:${h.entityId}`);
    }
    for (const h of e.observedCounters) {
      if (h.numericValue === null || r != null && r.has(h.domPath)) continue;
      const m = ((l = this.currentView) == null ? void 0 : l.id) ?? e.snapshot.viewId ?? void 0;
      this.counterTracker.record(
        h.domPath,
        String(h.numericValue),
        s,
        h.attributes["aria-label"] ?? null,
        m
      ), n.push(`page-content counter: ${h.domPath} = ${h.numericValue}`);
    }
    for (const h of e.observedCollections) {
      if (h.numericValue === null || o != null && o.has(h.domPath)) continue;
      const m = ((f = this.currentView) == null ? void 0 : f.id) ?? e.snapshot.viewId ?? void 0;
      this.collectionTracker.setCount(h.domPath, h.numericValue, s, m), n.push(`page-content collection: ${h.domPath} = ${h.numericValue} items`);
    }
    for (const h of e.observedNotifications)
      h.text && (this.notificationTracker.recordAppearance(
        h.text,
        Th(h.text),
        h.domPath,
        s
      ), n.push(`page-content notification: "${h.text.substring(0, 40)}"`));
    for (const h of e.observedStatusBadges)
      this.processStatusBadge(h, s, n);
  }
  // ── M9.9: Entity State Detection ──────────────────────────────────────
  /**
   * M9.9: Process a status badge observation into an entity state change.
   */
  processStatusBadge(e, n, r) {
    const o = Rc(e.text, this.stateVocabularyRegistry ?? void 0);
    if (!o) return;
    if (e.entityId) {
      const f = this.resolveEntityId(e.entityId, e.entityType);
      f && this.stateTracker.observe(
        f,
        o,
        n,
        `status-badge "${e.text}" (${e.domPath})`
      ) && r.push(`state: ${f} → "${o}"`);
      return;
    }
    const s = this.entityTracker.snapshot();
    if (s.size === 0) return;
    if (s.size === 1) {
      const [f] = [...s.keys()];
      this.stateTracker.observe(
        f,
        o,
        n,
        `status-badge "${e.text}" (${e.domPath}, sole entity)`
      ) && r.push(`state: ${f} → "${o}"`);
      return;
    }
    if (e.entityType) {
      const f = [...s.entries()].filter(([, h]) => h.type === e.entityType);
      if (f.length >= 1) {
        for (const [h] of f)
          this.stateTracker.observe(
            h,
            o,
            n,
            `status-badge "${e.text}" (${e.domPath}, type match)`
          ) && r.push(`state: ${h} → "${o}"`);
        return;
      }
    }
    let c = null, l = null;
    for (const [f, h] of s)
      (l === null || st(String(h.lastUpdated), l) > 0) && (l = String(h.lastUpdated), c = f);
    c && this.stateTracker.observe(
      c,
      o,
      n,
      `status-badge "${e.text}" (${e.domPath}, most-recent entity)`
    ) && r.push(`state: ${c} → "${o}"`);
  }
  /**
   * M9.9: Resolve a badge's entity reference to an actual tracked entity ID.
   */
  resolveEntityId(e, n) {
    if (this.entityTracker.get(e)) return e;
    if (n) {
      const r = `${n}:${e}`;
      if (this.entityTracker.get(r)) return r;
    }
    for (const r of this.entityTracker.snapshot().keys())
      if (r.endsWith(`:${e}`)) return r;
    return null;
  }
  /**
   * M9.9: Notification text may indicate a state transition.
   * E.g., "Leave request approved" → state "approved".
   *
   * Association: if only one entity exists, apply to it. Otherwise pick the
   * most-recently-updated entity (deterministic tie-break).
   */
  detectStateFromNotification(e, n) {
    const r = bh(e, this.stateVocabularyRegistry ?? void 0);
    if (!r) return;
    const o = this.entityTracker.snapshot();
    if (o.size === 0) return;
    if (o.size === 1) {
      const [l] = [...o.keys()];
      this.stateTracker.observe(
        l,
        r,
        n,
        `notification "${e.substring(0, 60)}"`
      );
      return;
    }
    let s = null, c = null;
    for (const [l, f] of o)
      (c === null || st(String(f.lastUpdated), c) > 0) && (c = String(f.lastUpdated), s = l);
    s && this.stateTracker.observe(
      s,
      r,
      n,
      `notification "${e.substring(0, 60)}" (most-recent entity)`
    );
  }
  /**
   * Get the current application state snapshot.
   */
  getCurrentState() {
    const e = this.entityTracker.snapshot();
    return this.stateTracker.applyToEntities(e), {
      currentView: this.currentView ? { ...this.currentView } : null,
      currentUrl: this.currentUrl,
      entities: e,
      collections: this.collectionTracker.snapshot(),
      counters: this.counterTracker.snapshot(),
      notifications: this.notificationTracker.getAll(),
      lastInteractionId: this.lastInteractionId,
      interactionCount: this.interactionCount
    };
  }
  /**
   * Reset the builder to initial state (for testing or new recording session).
   */
  reset() {
    this.currentView = null, this.currentUrl = null, this.entityTracker.clear(), this.collectionTracker.clear(), this.counterTracker.clear(), this.notificationTracker.clear(), this.stateTracker.clear(), this.interactionCount = 0, this.lastInteractionId = null;
  }
  /**
   * D3: Load a prior-knowledge seed (from M9.6 KnowledgePreloader).
   *
   * Pre-populates entity, view, and counter trackers with cross-session
   * knowledge so the builder recognizes previously-seen entities from
   * the first interaction of the new session.
   */
  loadSeed(e) {
    for (const [, n] of e.entities)
      this.entityTracker.upsert({
        id: n.id,
        type: n.type,
        attributes: n.attributes,
        source: "inferred",
        // prior-session knowledge
        firstSeenAt: "prior-session",
        lastUpdated: "prior-session",
        viewIds: n.viewIds
      });
  }
}
function Sh(t) {
  return t.length >= 3 && !/^\d+$/.test(t);
}
function Th(t) {
  const e = t.toLowerCase();
  return e.includes("error") || e.includes("failed") || e.includes("invalid") ? "error" : e.includes("success") || e.includes("added") || e.includes("complete") || e.includes("confirmed") ? "success" : e.includes("warning") || e.includes("caution") || e.includes("attention") ? "warning" : "info";
}
const Ae = {
  apiSuccess: 0.4,
  apiFailure: 0.5,
  notificationSuccess: 0.3,
  notificationError: 0.4,
  notificationWarning: 0.15,
  counterPositive: 0.2,
  counterNegative: 0.2,
  viewConfirmation: 0.25,
  listGrowth: 0.15,
  pageContentEntity: 0.15,
  pageContentCounter: 0.2,
  pageContentNotification: 0.2
};
class Ch {
  /**
   * @param extraConfirmationViews Optional set of additional view IDs that
   *   indicate successful confirmation (e.g., domain-specific views from
   *   a DomainPack). M9.11.
   */
  constructor(e) {
    /**
     * Optional additional confirmation view IDs from domain packs (M9.11).
     * Checked in addition to the built-in CONFIRMATION_VIEWS set.
     */
    B(this, "extraConfirmationViews");
    this.extraConfirmationViews = e ?? /* @__PURE__ */ new Set();
  }
  /**
   * Determine the outcome for a single interaction.
   *
   * Steps:
   * 1. Collect weighted votes from all signals + state transition delta.
   * 2. Sum success votes and failure votes.
   * 3. If both sides have votes -> ambiguous.
   * 4. If neither side has votes -> incomplete.
   * 5. Otherwise -> the winning side, with confidence = total weight.
   */
  determine(e) {
    const n = this.collectVotes(e), r = this.extractStateChanges(e), o = this.extractResultingEntities(e), s = this.categorize(n, r), c = this.isDegraded(e), l = this.computeConfidence(s, c);
    return {
      interactionId: e.interactionId,
      actionType: e.actionType,
      actionTarget: e.actionTarget,
      outcome: s.outcome,
      confidence: l,
      confidenceLevel: Cc(l),
      supportingEvidence: n.map((f) => f.evidence),
      resultingEntities: o,
      stateChanges: r
    };
  }
  // ── Evidence Quality (DDC-5) ──────────────────────────────────────────
  /**
   * Whether the evidence window was degraded. Degraded windows may have
   * silently truncated DOM evidence — recorded in stateChanges so the
   * degradation marker persists into the outcomes/stateTransitions rows.
   */
  isDegraded(e) {
    const n = e.evidenceQuality;
    return n ? n.mainThreadBlocked || n.domChangeOverflow > 0 || n.coarseMode : !1;
  }
  // ── Vote Collection ───────────────────────────────────────────────────
  /**
   * Collect all weighted votes from signals and state transition.
   */
  collectVotes(e) {
    const n = [], { signals: r } = e;
    for (const s of r.apiOperations)
      s.operation === "analytics" || s.operation === "resource" || s.operation !== "unknown" && (s.succeeded === !0 ? n.push({
        result: "success",
        weight: Ae.apiSuccess,
        evidence: {
          kind: "api-operation",
          result: "success",
          weight: Ae.apiSuccess,
          detail: `${s.operation} API ${s.method} ${s.url} -> ${s.status}`,
          interactionId: e.interactionId
        }
      }) : s.succeeded === !1 && n.push({
        result: "failure",
        weight: Ae.apiFailure,
        evidence: {
          kind: "api-operation",
          result: "failure",
          weight: Ae.apiFailure,
          detail: `${s.operation} API ${s.method} ${s.url} -> ${s.status}`,
          interactionId: e.interactionId
        }
      }));
    for (const s of r.notifications)
      s.kind === "appeared" && (s.severity === "success" ? n.push({
        result: "success",
        weight: Ae.notificationSuccess,
        evidence: {
          kind: "notification",
          result: "success",
          weight: Ae.notificationSuccess,
          detail: `Notification: "${s.text}" (success)`,
          interactionId: e.interactionId
        }
      }) : s.severity === "error" ? n.push({
        result: "failure",
        weight: Ae.notificationError,
        evidence: {
          kind: "notification",
          result: "failure",
          weight: Ae.notificationError,
          detail: `Notification: "${s.text}" (error)`,
          interactionId: e.interactionId
        }
      }) : s.severity === "warning" && n.push({
        result: "failure",
        weight: Ae.notificationWarning,
        evidence: {
          kind: "notification",
          result: "failure",
          weight: Ae.notificationWarning,
          detail: `Notification: "${s.text}" (warning)`,
          interactionId: e.interactionId
        }
      }));
    for (const s of r.counterChanges)
      s.numericDelta !== null && (s.numericDelta > 0 ? n.push({
        result: "success",
        weight: Ae.counterPositive,
        evidence: {
          kind: "counter-change",
          result: "success",
          weight: Ae.counterPositive,
          detail: `Counter ${s.elementPath}: ${s.oldValue} -> ${s.newValue} (+${s.numericDelta})`,
          interactionId: e.interactionId
        }
      }) : s.numericDelta < 0 && n.push({
        result: "failure",
        weight: Ae.counterNegative,
        evidence: {
          kind: "counter-change",
          result: "failure",
          weight: Ae.counterNegative,
          detail: `Counter ${s.elementPath}: ${s.oldValue} -> ${s.newValue} (${s.numericDelta})`,
          interactionId: e.interactionId
        }
      }));
    for (const s of r.viewChanges)
      (Op.has(s.toView.id) || this.extraConfirmationViews.has(s.toView.id)) && n.push({
        result: "success",
        weight: Ae.viewConfirmation,
        evidence: {
          kind: "view-change",
          result: "success",
          weight: Ae.viewConfirmation,
          detail: `Navigated to confirmation view: ${s.toView.id}`,
          interactionId: e.interactionId
        }
      });
    for (const s of r.listChanges)
      s.netChange > 0 && n.push({
        result: "success",
        weight: Ae.listGrowth,
        evidence: {
          kind: "list-change",
          result: "success",
          weight: Ae.listGrowth,
          detail: `List ${s.containerPath}: +${s.netChange} items`,
          interactionId: e.interactionId
        }
      });
    const o = e.signals.pageContent;
    if (o) {
      for (const s of o.observedEntities)
        n.push({
          result: "success",
          weight: Ae.pageContentEntity,
          evidence: {
            kind: "page-content",
            result: "success",
            weight: Ae.pageContentEntity,
            detail: `Page content entity: ${s.entityType}:${s.entityId ?? s.text.substring(0, 40)}`,
            interactionId: e.interactionId
          }
        });
      for (const s of o.observedCounters)
        s.numericValue !== null && s.numericValue > 0 && n.push({
          result: "success",
          weight: Ae.pageContentCounter,
          evidence: {
            kind: "page-content",
            result: "success",
            weight: Ae.pageContentCounter,
            detail: `Page content counter: ${s.domPath} = ${s.numericValue}`,
            interactionId: e.interactionId
          }
        });
      for (const s of o.observedNotifications) {
        if (!s.text) continue;
        const c = s.text.toLowerCase(), l = c.includes("error") || c.includes("failed") || c.includes("invalid");
        n.push({
          result: l ? "failure" : "success",
          weight: Ae.pageContentNotification,
          evidence: {
            kind: "page-content",
            result: l ? "failure" : "success",
            weight: Ae.pageContentNotification,
            detail: `Page content notification: "${s.text.substring(0, 40)}"`,
            interactionId: e.interactionId
          }
        });
      }
    }
    return n;
  }
  // ── Categorization ────────────────────────────────────────────────────
  /**
   * Categorize the outcome based on collected votes.
   */
  categorize(e, n) {
    const r = e.filter((l) => l.result === "success"), o = e.filter((l) => l.result === "failure"), s = r.reduce((l, f) => l + f.weight, 0), c = o.reduce((l, f) => l + f.weight, 0);
    return e.length === 0 && n.length === 0 ? { outcome: "incomplete", successSum: 0, failureSum: 0 } : s > 0 && c > 0 && Math.min(s, c) / Math.max(s, c) > 0.3 ? { outcome: "ambiguous", successSum: s, failureSum: c } : s > c ? { outcome: "success", successSum: s, failureSum: c } : c > s ? { outcome: "failure", successSum: s, failureSum: c } : e.length > 0 ? { outcome: "ambiguous", successSum: s, failureSum: c } : { outcome: "incomplete", successSum: s, failureSum: c };
  }
  // ── Confidence ────────────────────────────────────────────────────────
  /**
   * Compute confidence score based on outcome and total evidence weight.
   * DDC-5: degraded evidence windows halve the confidence — the recorded
   * number must reflect that DOM evidence may have been truncated.
   */
  computeConfidence(e, n = !1) {
    let r;
    if (e.outcome === "incomplete")
      r = 0;
    else if (e.outcome === "ambiguous") {
      const o = e.successSum + e.failureSum;
      r = Math.min(1, o * 0.5);
    } else {
      const o = e.outcome === "success" ? e.successSum : e.failureSum;
      r = Math.min(1, o);
    }
    return n && r > 0 && (r = r * 0.5), r;
  }
  // ── State Change Extraction ───────────────────────────────────────────
  /**
   * Extract human-readable state changes from the transition.
   */
  extractStateChanges(e) {
    return e.transition ? [...e.transition.changes] : [];
  }
  /**
   * Extract entity IDs that were created/updated in this interaction.
   */
  extractResultingEntities(e) {
    var s;
    if (!e.transition) return [];
    const n = e.transition.before, r = e.transition.after, o = [];
    for (const [c, l] of r.entities)
      (!n.entities.has(c) || ((s = n.entities.get(c)) == null ? void 0 : s.lastUpdated) !== l.lastUpdated) && o.push(c);
    return o;
  }
}
var pa = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {};
function kh(t) {
  return t && t.__esModule && Object.prototype.hasOwnProperty.call(t, "default") ? t.default : t;
}
var Nc = { exports: {} };
(function(t, e) {
  ((n, r) => {
    t.exports = r();
  })(pa, function() {
    var n = function(i, a) {
      return (n = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array ? function(u, d) {
        u.__proto__ = d;
      } : function(u, d) {
        for (var p in d) Object.prototype.hasOwnProperty.call(d, p) && (u[p] = d[p]);
      }))(i, a);
    }, r = function() {
      return (r = Object.assign || function(i) {
        for (var a, u = 1, d = arguments.length; u < d; u++) for (var p in a = arguments[u]) Object.prototype.hasOwnProperty.call(a, p) && (i[p] = a[p]);
        return i;
      }).apply(this, arguments);
    };
    function o(i, a, u) {
      for (var d, p = 0, y = a.length; p < y; p++) !d && p in a || ((d = d || Array.prototype.slice.call(a, 0, p))[p] = a[p]);
      return i.concat(d || Array.prototype.slice.call(a));
    }
    var s = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : pa, c = Object.keys, l = Array.isArray;
    function f(i, a) {
      return typeof a == "object" && c(a).forEach(function(u) {
        i[u] = a[u];
      }), i;
    }
    typeof Promise > "u" || s.Promise || (s.Promise = Promise);
    var h = Object.getPrototypeOf, m = {}.hasOwnProperty;
    function g(i, a) {
      return m.call(i, a);
    }
    function I(i, a) {
      typeof a == "function" && (a = a(h(i))), (typeof Reflect > "u" ? c : Reflect.ownKeys)(a).forEach(function(u) {
        O(i, u, a[u]);
      });
    }
    var b = Object.defineProperty;
    function O(i, a, u, d) {
      b(i, a, f(u && g(u, "get") && typeof u.get == "function" ? { get: u.get, set: u.set, configurable: !0 } : { value: u, configurable: !0, writable: !0 }, d));
    }
    function q(i) {
      return { from: function(a) {
        return i.prototype = Object.create(a.prototype), O(i.prototype, "constructor", i), { extend: I.bind(null, i.prototype) };
      } };
    }
    var E = Object.getOwnPropertyDescriptor, $ = [].slice;
    function V(i, a, u) {
      return $.call(i, a, u);
    }
    function j(i, a) {
      return a(i);
    }
    function F(i) {
      if (!i) throw new Error("Assertion Failed");
    }
    function P(i) {
      s.setImmediate ? setImmediate(i) : setTimeout(i, 0);
    }
    function L(i, a) {
      if (typeof a == "string" && g(i, a)) return i[a];
      if (!a) return i;
      if (typeof a != "string") {
        for (var u = [], d = 0, p = a.length; d < p; ++d) {
          var y = L(i, a[d]);
          u.push(y);
        }
        return u;
      }
      var v, w = a.indexOf(".");
      return w === -1 || (v = i[a.substr(0, w)]) == null ? void 0 : L(v, a.substr(w + 1));
    }
    function Y(i, a, u) {
      if (i && a !== void 0 && !("isFrozen" in Object && Object.isFrozen(i))) if (typeof a != "string" && "length" in a) {
        F(typeof u != "string" && "length" in u);
        for (var d = 0, p = a.length; d < p; ++d) Y(i, a[d], u[d]);
      } else {
        var y = a.indexOf(".");
        if (y !== -1) {
          var v = a.substr(0, y), y = a.substr(y + 1);
          if (y === "") u === void 0 ? l(i) && !isNaN(parseInt(v)) ? i.splice(v, 1) : delete i[v] : i[v] = u;
          else {
            var w = i[v];
            if (!w || !g(i, v)) {
              if (u === void 0) return;
              w = i[v] = {};
            }
            Y(w, y, u);
          }
        } else u === void 0 ? l(i) && !isNaN(parseInt(a)) ? i.splice(a, 1) : delete i[a] : i[a] = u;
      }
    }
    function K(i) {
      var a, u = {};
      for (a in i) g(i, a) && (u[a] = i[a]);
      return u;
    }
    var H = [].concat;
    function J(i) {
      return H.apply([], i);
    }
    var ht = "BigUint64Array,BigInt64Array,Array,Boolean,String,Date,RegExp,Blob,File,FileList,FileSystemFileHandle,FileSystemDirectoryHandle,ArrayBuffer,DataView,Uint8ClampedArray,ImageBitmap,ImageData,Map,Set,CryptoKey".split(",").concat(J([8, 16, 32, 64].map(function(i) {
      return ["Int", "Uint", "Float"].map(function(a) {
        return a + i + "Array";
      });
    }))).filter(function(i) {
      return s[i];
    }), oe = new Set(ht.map(function(i) {
      return s[i];
    })), le = null;
    function fe(i) {
      return le = /* @__PURE__ */ new WeakMap(), i = function a(u) {
        if (!u || typeof u != "object") return u;
        var d = le.get(u);
        if (d) return d;
        if (l(u)) {
          d = [], le.set(u, d);
          for (var p = 0, y = u.length; p < y; ++p) d.push(a(u[p]));
        } else if (oe.has(u.constructor)) d = u;
        else {
          var v, w = h(u);
          for (v in d = w === Object.prototype ? {} : Object.create(w), le.set(u, d), u) g(u, v) && (d[v] = a(u[v]));
        }
        return d;
      }(i), le = null, i;
    }
    var be = {}.toString;
    function me(i) {
      return be.call(i).slice(8, -1);
    }
    var we = typeof Symbol < "u" ? Symbol.iterator : "@@iterator", Ce = typeof we == "symbol" ? function(i) {
      var a;
      return i != null && (a = i[we]) && a.apply(i);
    } : function() {
      return null;
    };
    function xe(i, a) {
      a = i.indexOf(a), 0 <= a && i.splice(a, 1);
    }
    var je = {};
    function Me(i) {
      var a, u, d, p;
      if (arguments.length === 1) {
        if (l(i)) return i.slice();
        if (this === je && typeof i == "string") return [i];
        if (p = Ce(i)) for (u = []; !(d = p.next()).done; ) u.push(d.value);
        else {
          if (i == null) return [i];
          if (typeof (a = i.length) != "number") return [i];
          for (u = new Array(a); a--; ) u[a] = i[a];
        }
      } else for (a = arguments.length, u = new Array(a); a--; ) u[a] = arguments[a];
      return u;
    }
    var li = typeof Symbol < "u" ? function(i) {
      return i[Symbol.toStringTag] === "AsyncFunction";
    } : function() {
      return !1;
    }, ht = ["Unknown", "Constraint", "Data", "TransactionInactive", "ReadOnly", "Version", "NotFound", "InvalidState", "InvalidAccess", "Abort", "Timeout", "QuotaExceeded", "Syntax", "DataClone"], Ye = ["Modify", "Bulk", "OpenFailed", "VersionChange", "Schema", "Upgrade", "InvalidTable", "MissingAPI", "NoSuchDatabase", "InvalidArgument", "SubTransaction", "Unsupported", "Internal", "DatabaseClosed", "PrematureCommit", "ForeignAwait"].concat(ht), pu = { VersionChanged: "Database version changed by other database connection", DatabaseClosed: "Database has been closed", Abort: "Transaction aborted", TransactionInactive: "Transaction has already completed or failed", MissingAPI: "IndexedDB API missing. Please visit https://tinyurl.com/y2uuvskb" };
    function Yt(i, a) {
      this.name = i, this.message = a;
    }
    function ss(i, a) {
      return i + ". Errors: " + Object.keys(a).map(function(u) {
        return a[u].toString();
      }).filter(function(u, d, p) {
        return p.indexOf(u) === d;
      }).join(`
`);
    }
    function rr(i, a, u, d) {
      this.failures = a, this.failedKeys = d, this.successCount = u, this.message = ss(i, a);
    }
    function Xt(i, a) {
      this.name = "BulkError", this.failures = Object.keys(a).map(function(u) {
        return a[u];
      }), this.failuresByPos = a, this.message = ss(i, this.failures);
    }
    q(Yt).from(Error).extend({ toString: function() {
      return this.name + ": " + this.message;
    } }), q(rr).from(Yt), q(Xt).from(Yt);
    var di = Ye.reduce(function(i, a) {
      return i[a] = a + "Error", i;
    }, {}), hu = Yt, se = Ye.reduce(function(i, a) {
      var u = a + "Error";
      function d(p, y) {
        this.name = u, p ? typeof p == "string" ? (this.message = "".concat(p).concat(y ? `
 ` + y : ""), this.inner = y || null) : typeof p == "object" && (this.message = "".concat(p.name, " ").concat(p.message), this.inner = p) : (this.message = pu[a] || u, this.inner = null);
      }
      return q(d).from(hu), i[a] = d, i;
    }, {}), as = (se.Syntax = SyntaxError, se.Type = TypeError, se.Range = RangeError, ht.reduce(function(i, a) {
      return i[a + "Error"] = se[a], i;
    }, {}));
    ht = Ye.reduce(function(i, a) {
      return ["Syntax", "Type", "Range"].indexOf(a) === -1 && (i[a + "Error"] = se[a]), i;
    }, {});
    function Ie() {
    }
    function En(i) {
      return i;
    }
    function mu(i, a) {
      return i == null || i === En ? a : function(u) {
        return a(i(u));
      };
    }
    function Ot(i, a) {
      return function() {
        i.apply(this, arguments), a.apply(this, arguments);
      };
    }
    function gu(i, a) {
      return i === Ie ? a : function() {
        var u = i.apply(this, arguments), d = (u !== void 0 && (arguments[0] = u), this.onsuccess), p = this.onerror, y = (this.onsuccess = null, this.onerror = null, a.apply(this, arguments));
        return d && (this.onsuccess = this.onsuccess ? Ot(d, this.onsuccess) : d), p && (this.onerror = this.onerror ? Ot(p, this.onerror) : p), y !== void 0 ? y : u;
      };
    }
    function yu(i, a) {
      return i === Ie ? a : function() {
        i.apply(this, arguments);
        var u = this.onsuccess, d = this.onerror;
        this.onsuccess = this.onerror = null, a.apply(this, arguments), u && (this.onsuccess = this.onsuccess ? Ot(u, this.onsuccess) : u), d && (this.onerror = this.onerror ? Ot(d, this.onerror) : d);
      };
    }
    function vu(i, a) {
      return i === Ie ? a : function(p) {
        var d = i.apply(this, arguments), p = (f(p, d), this.onsuccess), y = this.onerror, v = (this.onsuccess = null, this.onerror = null, a.apply(this, arguments));
        return p && (this.onsuccess = this.onsuccess ? Ot(p, this.onsuccess) : p), y && (this.onerror = this.onerror ? Ot(y, this.onerror) : y), d === void 0 ? v === void 0 ? void 0 : v : f(d, v);
      };
    }
    function wu(i, a) {
      return i === Ie ? a : function() {
        return a.apply(this, arguments) !== !1 && i.apply(this, arguments);
      };
    }
    function fi(i, a) {
      return i === Ie ? a : function() {
        var u = i.apply(this, arguments);
        if (u && typeof u.then == "function") {
          for (var d = this, p = arguments.length, y = new Array(p); p--; ) y[p] = arguments[p];
          return u.then(function() {
            return a.apply(d, y);
          });
        }
        return a.apply(this, arguments);
      };
    }
    ht.ModifyError = rr, ht.DexieError = Yt, ht.BulkError = Xt;
    var at = typeof location < "u" && /^(http|https):\/\/(localhost|127\.0\.0\.1)/.test(location.href);
    function cs(i) {
      at = i;
    }
    var Sn = {}, us = 100, Tn = typeof Promise > "u" ? [] : (Ye = Promise.resolve(), typeof crypto < "u" && crypto.subtle ? [Tn = crypto.subtle.digest("SHA-512", new Uint8Array([0])), h(Tn), Ye] : [Ye, h(Ye), Ye]), Ye = Tn[0], rn = Tn[1], rn = rn && rn.then, Pt = Ye && Ye.constructor, pi = !!Tn[2], Cn = function(i, a) {
      kn.push([i, a]), ir && (queueMicrotask(Iu), ir = !1);
    }, hi = !0, ir = !0, xt = [], or = [], mi = En, mt = { id: "global", global: !0, ref: 0, unhandleds: [], onunhandled: Ie, pgp: !1, env: {}, finalize: Ie }, ie = mt, kn = [], $t = 0, sr = [];
    function ee(i) {
      if (typeof this != "object") throw new TypeError("Promises must be constructed via new");
      this._listeners = [], this._lib = !1;
      var a = this._PSD = ie;
      if (typeof i != "function") {
        if (i !== Sn) throw new TypeError("Not a function");
        this._state = arguments[1], this._value = arguments[2], this._state === !1 && yi(this, this._value);
      } else this._state = null, this._value = null, ++a.ref, function u(d, p) {
        try {
          p(function(y) {
            if (d._state === null) {
              if (y === d) throw new TypeError("A promise cannot be resolved with itself.");
              var v = d._lib && Qt();
              y && typeof y.then == "function" ? u(d, function(w, T) {
                y instanceof ee ? y._then(w, T) : y.then(w, T);
              }) : (d._state = !0, d._value = y, ds(d)), v && Zt();
            }
          }, yi.bind(null, d));
        } catch (y) {
          yi(d, y);
        }
      }(this, i);
    }
    var gi = { get: function() {
      var i = ie, a = lr;
      function u(d, p) {
        var y = this, v = !i.global && (i !== ie || a !== lr), w = v && !St(), T = new ee(function(x, k) {
          vi(y, new ls(ps(d, i, v, w), ps(p, i, v, w), x, k, i));
        });
        return this._consoleTask && (T._consoleTask = this._consoleTask), T;
      }
      return u.prototype = Sn, u;
    }, set: function(i) {
      O(this, "then", i && i.prototype === Sn ? gi : { get: function() {
        return i;
      }, set: gi.set });
    } };
    function ls(i, a, u, d, p) {
      this.onFulfilled = typeof i == "function" ? i : null, this.onRejected = typeof a == "function" ? a : null, this.resolve = u, this.reject = d, this.psd = p;
    }
    function yi(i, a) {
      var u, d;
      or.push(a), i._state === null && (u = i._lib && Qt(), a = mi(a), i._state = !1, i._value = a, d = i, xt.some(function(p) {
        return p._value === d._value;
      }) || xt.push(d), ds(i), u) && Zt();
    }
    function ds(i) {
      var a = i._listeners;
      i._listeners = [];
      for (var u = 0, d = a.length; u < d; ++u) vi(i, a[u]);
      var p = i._PSD;
      --p.ref || p.finalize(), $t === 0 && (++$t, Cn(function() {
        --$t == 0 && wi();
      }, []));
    }
    function vi(i, a) {
      if (i._state === null) i._listeners.push(a);
      else {
        var u = i._state ? a.onFulfilled : a.onRejected;
        if (u === null) return (i._state ? a.resolve : a.reject)(i._value);
        ++a.psd.ref, ++$t, Cn(bu, [u, i, a]);
      }
    }
    function bu(i, a, u) {
      try {
        var d, p = a._value;
        !a._state && or.length && (or = []), d = at && a._consoleTask ? a._consoleTask.run(function() {
          return i(p);
        }) : i(p), a._state || or.indexOf(p) !== -1 || ((y) => {
          for (var v = xt.length; v; ) if (xt[--v]._value === y._value) return xt.splice(v, 1);
        })(a), u.resolve(d);
      } catch (y) {
        u.reject(y);
      } finally {
        --$t == 0 && wi(), --u.psd.ref || u.psd.finalize();
      }
    }
    function Iu() {
      Dt(mt, function() {
        Qt() && Zt();
      });
    }
    function Qt() {
      var i = hi;
      return ir = hi = !1, i;
    }
    function Zt() {
      var i, a, u;
      do
        for (; 0 < kn.length; ) for (i = kn, kn = [], u = i.length, a = 0; a < u; ++a) {
          var d = i[a];
          d[0].apply(null, d[1]);
        }
      while (0 < kn.length);
      ir = hi = !0;
    }
    function wi() {
      for (var i = xt, a = (xt = [], i.forEach(function(d) {
        d._PSD.onunhandled.call(null, d._value, d);
      }), sr.slice(0)), u = a.length; u; ) a[--u]();
    }
    function ar(i) {
      return new ee(Sn, !1, i);
    }
    function ke(i, a) {
      var u = ie;
      return function() {
        var d = Qt(), p = ie;
        try {
          return Tt(u, !0), i.apply(this, arguments);
        } catch (y) {
          a && a(y);
        } finally {
          Tt(p, !1), d && Zt();
        }
      };
    }
    I(ee.prototype, { then: gi, _then: function(i, a) {
      vi(this, new ls(null, null, i, a, ie));
    }, catch: function(i) {
      var a, u;
      return arguments.length === 1 ? this.then(null, i) : (a = i, u = arguments[1], typeof a == "function" ? this.then(null, function(d) {
        return (d instanceof a ? u : ar)(d);
      }) : this.then(null, function(d) {
        return (d && d.name === a ? u : ar)(d);
      }));
    }, finally: function(i) {
      return this.then(function(a) {
        return ee.resolve(i()).then(function() {
          return a;
        });
      }, function(a) {
        return ee.resolve(i()).then(function() {
          return ar(a);
        });
      });
    }, timeout: function(i, a) {
      var u = this;
      return i < 1 / 0 ? new ee(function(d, p) {
        var y = setTimeout(function() {
          return p(new se.Timeout(a));
        }, i);
        u.then(d, p).finally(clearTimeout.bind(null, y));
      }) : this;
    } }), typeof Symbol < "u" && Symbol.toStringTag && O(ee.prototype, Symbol.toStringTag, "Dexie.Promise"), mt.env = fs(), I(ee, { all: function() {
      var i = Me.apply(null, arguments).map(dr);
      return new ee(function(a, u) {
        i.length === 0 && a([]);
        var d = i.length;
        i.forEach(function(p, y) {
          return ee.resolve(p).then(function(v) {
            i[y] = v, --d || a(i);
          }, u);
        });
      });
    }, resolve: function(i) {
      return i instanceof ee ? i : i && typeof i.then == "function" ? new ee(function(a, u) {
        i.then(a, u);
      }) : new ee(Sn, !0, i);
    }, reject: ar, race: function() {
      var i = Me.apply(null, arguments).map(dr);
      return new ee(function(a, u) {
        i.map(function(d) {
          return ee.resolve(d).then(a, u);
        });
      });
    }, PSD: { get: function() {
      return ie;
    }, set: function(i) {
      return ie = i;
    } }, totalEchoes: { get: function() {
      return lr;
    } }, newPSD: Et, usePSD: Dt, scheduler: { get: function() {
      return Cn;
    }, set: function(i) {
      Cn = i;
    } }, rejectionMapper: { get: function() {
      return mi;
    }, set: function(i) {
      mi = i;
    } }, follow: function(i, a) {
      return new ee(function(u, d) {
        return Et(function(p, y) {
          var v = ie;
          v.unhandleds = [], v.onunhandled = y, v.finalize = Ot(function() {
            var w, T = this;
            w = function() {
              T.unhandleds.length === 0 ? p() : y(T.unhandleds[0]);
            }, sr.push(function x() {
              w(), sr.splice(sr.indexOf(x), 1);
            }), ++$t, Cn(function() {
              --$t == 0 && wi();
            }, []);
          }, v.finalize), i();
        }, a, u, d);
      });
    } }), Pt && (Pt.allSettled && O(ee, "allSettled", function() {
      var i = Me.apply(null, arguments).map(dr);
      return new ee(function(a) {
        i.length === 0 && a([]);
        var u = i.length, d = new Array(u);
        i.forEach(function(p, y) {
          return ee.resolve(p).then(function(v) {
            return d[y] = { status: "fulfilled", value: v };
          }, function(v) {
            return d[y] = { status: "rejected", reason: v };
          }).then(function() {
            return --u || a(d);
          });
        });
      });
    }), Pt.any && typeof AggregateError < "u" && O(ee, "any", function() {
      var i = Me.apply(null, arguments).map(dr);
      return new ee(function(a, u) {
        i.length === 0 && u(new AggregateError([]));
        var d = i.length, p = new Array(d);
        i.forEach(function(y, v) {
          return ee.resolve(y).then(function(w) {
            return a(w);
          }, function(w) {
            p[v] = w, --d || u(new AggregateError(p));
          });
        });
      });
    }), Pt.withResolvers) && (ee.withResolvers = Pt.withResolvers);
    var $e = { awaits: 0, echoes: 0, id: 0 }, Eu = 0, cr = [], ur = 0, lr = 0, Su = 0;
    function Et(i, v, u, d) {
      var p = ie, y = Object.create(p), v = (y.parent = p, y.ref = 0, y.global = !1, y.id = ++Su, mt.env, y.env = pi ? { Promise: ee, PromiseProp: { value: ee, configurable: !0, writable: !0 }, all: ee.all, race: ee.race, allSettled: ee.allSettled, any: ee.any, resolve: ee.resolve, reject: ee.reject } : {}, v && f(y, v), ++p.ref, y.finalize = function() {
        --this.parent.ref || this.parent.finalize();
      }, Dt(y, i, u, d));
      return y.ref === 0 && y.finalize(), v;
    }
    function Jt() {
      return $e.id || ($e.id = ++Eu), ++$e.awaits, $e.echoes += us, $e.id;
    }
    function St() {
      return !!$e.awaits && (--$e.awaits == 0 && ($e.id = 0), $e.echoes = $e.awaits * us, !0);
    }
    function dr(i) {
      return $e.echoes && i && i.constructor === Pt ? (Jt(), i.then(function(a) {
        return St(), a;
      }, function(a) {
        return St(), Re(a);
      })) : i;
    }
    function Tu() {
      var i = cr[cr.length - 1];
      cr.pop(), Tt(i, !1);
    }
    function Tt(i, a) {
      var u, d, p = ie;
      (a ? !$e.echoes || ur++ && i === ie : !ur || --ur && i === ie) || queueMicrotask(a ? (function(y) {
        ++lr, $e.echoes && --$e.echoes != 0 || ($e.echoes = $e.awaits = $e.id = 0), cr.push(ie), Tt(y, !0);
      }).bind(null, i) : Tu), i !== ie && (ie = i, p === mt && (mt.env = fs()), pi) && (u = mt.env.Promise, d = i.env, p.global || i.global) && (Object.defineProperty(s, "Promise", d.PromiseProp), u.all = d.all, u.race = d.race, u.resolve = d.resolve, u.reject = d.reject, d.allSettled && (u.allSettled = d.allSettled), d.any) && (u.any = d.any);
    }
    function fs() {
      var i = s.Promise;
      return pi ? { Promise: i, PromiseProp: Object.getOwnPropertyDescriptor(s, "Promise"), all: i.all, race: i.race, allSettled: i.allSettled, any: i.any, resolve: i.resolve, reject: i.reject } : {};
    }
    function Dt(i, a, u, d, p) {
      var y = ie;
      try {
        return Tt(i, !0), a(u, d, p);
      } finally {
        Tt(y, !1);
      }
    }
    function ps(i, a, u, d) {
      return typeof i != "function" ? i : function() {
        var p = ie;
        u && Jt(), Tt(a, !0);
        try {
          return i.apply(this, arguments);
        } finally {
          Tt(p, !1), d && queueMicrotask(St);
        }
      };
    }
    function bi(i) {
      Promise === Pt && $e.echoes === 0 ? ur === 0 ? i() : enqueueNativeMicroTask(i) : setTimeout(i, 0);
    }
    ("" + rn).indexOf("[native code]") === -1 && (Jt = St = Ie);
    var Re = ee.reject, Lt = "￿", gt = "Invalid key provided. Keys must be of type string, number, Date or Array<string | number | Date>.", hs = "String expected.", fr = "__dbnames", Ii = "readonly", Ei = "readwrite";
    function Mt(i, a) {
      return i ? a ? function() {
        return i.apply(this, arguments) && a.apply(this, arguments);
      } : i : a;
    }
    var ms = { type: 3, lower: -1 / 0, lowerOpen: !1, upper: [[]], upperOpen: !1 };
    function pr(i) {
      return typeof i != "string" || /\./.test(i) ? function(a) {
        return a;
      } : function(a) {
        return a[i] === void 0 && i in a && delete (a = fe(a))[i], a;
      };
    }
    function gs() {
      throw se.Type("Entity instances must never be new:ed. Instances are generated by the framework bypassing the constructor.");
    }
    function ye(i, a) {
      try {
        var u = ys(i), d = ys(a);
        if (u !== d) return u === "Array" ? 1 : d === "Array" ? -1 : u === "binary" ? 1 : d === "binary" ? -1 : u === "string" ? 1 : d === "string" ? -1 : u === "Date" ? 1 : d !== "Date" ? NaN : -1;
        switch (u) {
          case "number":
          case "Date":
          case "string":
            return a < i ? 1 : i < a ? -1 : 0;
          case "binary":
            for (var p = vs(i), y = vs(a), v = p.length, w = y.length, T = v < w ? v : w, x = 0; x < T; ++x) if (p[x] !== y[x]) return p[x] < y[x] ? -1 : 1;
            return v === w ? 0 : v < w ? -1 : 1;
          case "Array":
            for (var k = i, S = a, C = k.length, N = S.length, _ = C < N ? C : N, A = 0; A < _; ++A) {
              var R = ye(k[A], S[A]);
              if (R !== 0) return R;
            }
            return C === N ? 0 : C < N ? -1 : 1;
        }
      } catch {
      }
      return NaN;
    }
    function ys(i) {
      var a = typeof i;
      return a == "object" && (ArrayBuffer.isView(i) || (a = me(i)) === "ArrayBuffer") ? "binary" : a;
    }
    function vs(i) {
      return i instanceof Uint8Array ? i : ArrayBuffer.isView(i) ? new Uint8Array(i.buffer, i.byteOffset, i.byteLength) : new Uint8Array(i);
    }
    function hr(i, a, u) {
      var d = i.schema.yProps;
      return d ? (a && 0 < u.numFailures && (a = a.filter(function(p, y) {
        return !u.failures[y];
      })), Promise.all(d.map(function(p) {
        return p = p.updatesTable, a ? i.db.table(p).where("k").anyOf(a).delete() : i.db.table(p).clear();
      })).then(function() {
        return u;
      })) : u;
    }
    ws.prototype.execute = function(i) {
      var a = this["@@propmod"];
      if (a.add !== void 0) {
        var u = a.add;
        if (l(u)) return o(o([], l(i) ? i : [], !0), u).sort();
        if (typeof u == "number") return (Number(i) || 0) + u;
        if (typeof u == "bigint") try {
          return BigInt(i) + u;
        } catch {
          return BigInt(0) + u;
        }
        throw new TypeError("Invalid term ".concat(u));
      }
      if (a.remove !== void 0) {
        var d = a.remove;
        if (l(d)) return l(i) ? i.filter(function(p) {
          return !d.includes(p);
        }).sort() : [];
        if (typeof d == "number") return Number(i) - d;
        if (typeof d == "bigint") try {
          return BigInt(i) - d;
        } catch {
          return BigInt(0) - d;
        }
        throw new TypeError("Invalid subtrahend ".concat(d));
      }
      return u = (u = a.replacePrefix) == null ? void 0 : u[0], u && typeof i == "string" && i.startsWith(u) ? a.replacePrefix[1] + i.substring(u.length) : i;
    };
    var An = ws;
    function ws(i) {
      this["@@propmod"] = i;
    }
    function bs(i, a) {
      for (var u = c(a), d = u.length, p = !1, y = 0; y < d; ++y) {
        var v = u[y], w = a[v], T = L(i, v);
        w instanceof An ? (Y(i, v, w.execute(T)), p = !0) : T !== w && (Y(i, v, w), p = !0);
      }
      return p;
    }
    Ee.prototype._trans = function(i, a, u) {
      var d = this._tx || ie.trans, p = this.name, y = at && typeof console < "u" && console.createTask && console.createTask("Dexie: ".concat(i === "readonly" ? "read" : "write", " ").concat(this.name));
      function v(x, k, S) {
        if (S.schema[p]) return a(S.idbtrans, S);
        throw new se.NotFound("Table " + p + " not part of transaction");
      }
      var w = Qt();
      try {
        var T = d && d.db._novip === this.db._novip ? d === ie.trans ? d._promise(i, v, u) : Et(function() {
          return d._promise(i, v, u);
        }, { trans: d, transless: ie.transless || ie }) : function x(k, S, C, N) {
          if (k.idbdb && (k._state.openComplete || ie.letThrough || k._vip)) {
            var _ = k._createTransaction(S, C, k._dbSchema);
            try {
              _.create(), k._state.PR1398_maxLoop = 3;
            } catch (A) {
              return A.name === di.InvalidState && k.isOpen() && 0 < --k._state.PR1398_maxLoop ? (console.warn("Dexie: Need to reopen db"), k.close({ disableAutoOpen: !1 }), k.open().then(function() {
                return x(k, S, C, N);
              })) : Re(A);
            }
            return _._promise(S, function(A, R) {
              return Et(function() {
                return ie.trans = _, N(A, R, _);
              });
            }).then(function(A) {
              if (S === "readwrite") try {
                _.idbtrans.commit();
              } catch {
              }
              return S === "readonly" ? A : _._completion.then(function() {
                return A;
              });
            });
          }
          if (k._state.openComplete) return Re(new se.DatabaseClosed(k._state.dbOpenError));
          if (!k._state.isBeingOpened) {
            if (!k._state.autoOpen) return Re(new se.DatabaseClosed());
            k.open().catch(Ie);
          }
          return k._state.dbReadyPromise.then(function() {
            return x(k, S, C, N);
          });
        }(this.db, i, [this.name], v);
        return y && (T._consoleTask = y, T = T.catch(function(x) {
          return console.trace(x), Re(x);
        })), T;
      } finally {
        w && Zt();
      }
    }, Ee.prototype.get = function(i, a) {
      var u = this;
      return i && i.constructor === Object ? this.where(i).first(a) : i == null ? Re(new se.Type("Invalid argument to Table.get()")) : this._trans("readonly", function(d) {
        return u.core.get({ trans: d, key: i }).then(function(p) {
          return u.hook.reading.fire(p);
        });
      }).then(a);
    }, Ee.prototype.where = function(i) {
      if (typeof i == "string") return new this.db.WhereClause(this, i);
      if (l(i)) return new this.db.WhereClause(this, "[".concat(i.join("+"), "]"));
      var a = c(i);
      if (a.length === 1) return this.where(a[0]).equals(i[a[0]]);
      var u = this.schema.indexes.concat(this.schema.primKey).filter(function(w) {
        if (w.compound && a.every(function(x) {
          return 0 <= w.keyPath.indexOf(x);
        })) {
          for (var T = 0; T < a.length; ++T) if (a.indexOf(w.keyPath[T]) === -1) return !1;
          return !0;
        }
        return !1;
      }).sort(function(w, T) {
        return w.keyPath.length - T.keyPath.length;
      })[0];
      if (u && this.db._maxKey !== Lt) return v = u.keyPath.slice(0, a.length), this.where(v).equals(v.map(function(w) {
        return i[w];
      }));
      !u && at && console.warn("The query ".concat(JSON.stringify(i), " on ").concat(this.name, " would benefit from a ") + "compound index [".concat(a.join("+"), "]"));
      var d = this.schema.idxByName;
      function p(w, T) {
        return ye(w, T) === 0;
      }
      var v = a.reduce(function(k, T) {
        var x = k[0], k = k[1], S = d[T], C = i[T];
        return [x || S, x || !S ? Mt(k, S && S.multi ? function(N) {
          return N = L(N, T), l(N) && N.some(function(_) {
            return p(C, _);
          });
        } : function(N) {
          return p(C, L(N, T));
        }) : k];
      }, [null, null]), y = v[0], v = v[1];
      return y ? this.where(y.name).equals(i[y.keyPath]).filter(v) : u ? this.filter(v) : this.where(a).equals("");
    }, Ee.prototype.filter = function(i) {
      return this.toCollection().and(i);
    }, Ee.prototype.count = function(i) {
      return this.toCollection().count(i);
    }, Ee.prototype.offset = function(i) {
      return this.toCollection().offset(i);
    }, Ee.prototype.limit = function(i) {
      return this.toCollection().limit(i);
    }, Ee.prototype.each = function(i) {
      return this.toCollection().each(i);
    }, Ee.prototype.toArray = function(i) {
      return this.toCollection().toArray(i);
    }, Ee.prototype.toCollection = function() {
      return new this.db.Collection(new this.db.WhereClause(this));
    }, Ee.prototype.orderBy = function(i) {
      return new this.db.Collection(new this.db.WhereClause(this, l(i) ? "[".concat(i.join("+"), "]") : i));
    }, Ee.prototype.reverse = function() {
      return this.toCollection().reverse();
    }, Ee.prototype.mapToClass = function(i) {
      for (var a = this.db, u = this.name, d = ((this.schema.mappedClass = i).prototype instanceof gs && (i = ((v) => {
        var w = k, T = v;
        if (typeof T != "function" && T !== null) throw new TypeError("Class extends value " + String(T) + " is not a constructor or null");
        function x() {
          this.constructor = w;
        }
        function k() {
          return v !== null && v.apply(this, arguments) || this;
        }
        return n(w, T), w.prototype = T === null ? Object.create(T) : (x.prototype = T.prototype, new x()), Object.defineProperty(k.prototype, "db", { get: function() {
          return a;
        }, enumerable: !1, configurable: !0 }), k.prototype.table = function() {
          return u;
        }, k;
      })(i)), /* @__PURE__ */ new Set()), p = i.prototype; p; p = h(p)) Object.getOwnPropertyNames(p).forEach(function(v) {
        return d.add(v);
      });
      function y(v) {
        if (!v) return v;
        var w, T = Object.create(i.prototype);
        for (w in v) if (!d.has(w)) try {
          T[w] = v[w];
        } catch {
        }
        return T;
      }
      return this.schema.readHook && this.hook.reading.unsubscribe(this.schema.readHook), this.schema.readHook = y, this.hook("reading", y), i;
    }, Ee.prototype.defineClass = function() {
      return this.mapToClass(function(i) {
        f(this, i);
      });
    }, Ee.prototype.add = function(i, a) {
      var u = this, d = this.schema.primKey, p = d.auto, y = d.keyPath, v = i;
      return y && p && (v = pr(y)(i)), this._trans("readwrite", function(w) {
        return u.core.mutate({ trans: w, type: "add", keys: a != null ? [a] : null, values: [v] });
      }).then(function(w) {
        return w.numFailures ? ee.reject(w.failures[0]) : w.lastResult;
      }).then(function(w) {
        if (y) try {
          Y(i, y, w);
        } catch {
        }
        return w;
      });
    }, Ee.prototype.upsert = function(i, a) {
      var u = this, d = this.schema.primKey.keyPath;
      return this._trans("readwrite", function(p) {
        return u.core.get({ trans: p, key: i }).then(function(y) {
          var v = y ?? {};
          return bs(v, a), d && Y(v, d, i), u.core.mutate({ trans: p, type: "put", values: [v], keys: [i], upsert: !0, updates: { keys: [i], changeSpecs: [a] } }).then(function(w) {
            return w.numFailures ? ee.reject(w.failures[0]) : !!y;
          });
        });
      });
    }, Ee.prototype.update = function(i, a) {
      return typeof i != "object" || l(i) ? this.where(":id").equals(i).modify(a) : (i = L(i, this.schema.primKey.keyPath)) === void 0 ? Re(new se.InvalidArgument("Given object does not contain its primary key")) : this.where(":id").equals(i).modify(a);
    }, Ee.prototype.put = function(i, a) {
      var u = this, d = this.schema.primKey, p = d.auto, y = d.keyPath, v = i;
      return y && p && (v = pr(y)(i)), this._trans("readwrite", function(w) {
        return u.core.mutate({ trans: w, type: "put", values: [v], keys: a != null ? [a] : null });
      }).then(function(w) {
        return w.numFailures ? ee.reject(w.failures[0]) : w.lastResult;
      }).then(function(w) {
        if (y) try {
          Y(i, y, w);
        } catch {
        }
        return w;
      });
    }, Ee.prototype.delete = function(i) {
      var a = this;
      return this._trans("readwrite", function(u) {
        return a.core.mutate({ trans: u, type: "delete", keys: [i] }).then(function(d) {
          return hr(a, [i], d);
        }).then(function(d) {
          return d.numFailures ? ee.reject(d.failures[0]) : void 0;
        });
      });
    }, Ee.prototype.clear = function() {
      var i = this;
      return this._trans("readwrite", function(a) {
        return i.core.mutate({ trans: a, type: "deleteRange", range: ms }).then(function(u) {
          return hr(i, null, u);
        });
      }).then(function(a) {
        return a.numFailures ? ee.reject(a.failures[0]) : void 0;
      });
    }, Ee.prototype.bulkGet = function(i) {
      var a = this;
      return this._trans("readonly", function(u) {
        return a.core.getMany({ keys: i, trans: u }).then(function(d) {
          return d.map(function(p) {
            return a.hook.reading.fire(p);
          });
        });
      });
    }, Ee.prototype.bulkAdd = function(i, a, u) {
      var d = this, p = Array.isArray(a) ? a : void 0, y = (u = u || (p ? void 0 : a)) ? u.allKeys : void 0;
      return this._trans("readwrite", function(v) {
        var w = d.schema.primKey, x = w.auto, w = w.keyPath;
        if (w && p) throw new se.InvalidArgument("bulkAdd(): keys argument invalid on tables with inbound keys");
        if (p && p.length !== i.length) throw new se.InvalidArgument("Arguments objects and keys must have the same length");
        var T = i.length, x = w && x ? i.map(pr(w)) : i;
        return d.core.mutate({ trans: v, type: "add", keys: p, values: x, wantResults: y }).then(function(k) {
          var S = k.numFailures, C = k.failures;
          if (S === 0) return y ? k.results : k.lastResult;
          throw new Xt("".concat(d.name, ".bulkAdd(): ").concat(S, " of ").concat(T, " operations failed"), C);
        });
      });
    }, Ee.prototype.bulkPut = function(i, a, u) {
      var d = this, p = Array.isArray(a) ? a : void 0, y = (u = u || (p ? void 0 : a)) ? u.allKeys : void 0;
      return this._trans("readwrite", function(v) {
        var w = d.schema.primKey, x = w.auto, w = w.keyPath;
        if (w && p) throw new se.InvalidArgument("bulkPut(): keys argument invalid on tables with inbound keys");
        if (p && p.length !== i.length) throw new se.InvalidArgument("Arguments objects and keys must have the same length");
        var T = i.length, x = w && x ? i.map(pr(w)) : i;
        return d.core.mutate({ trans: v, type: "put", keys: p, values: x, wantResults: y }).then(function(k) {
          var S = k.numFailures, C = k.failures;
          if (S === 0) return y ? k.results : k.lastResult;
          throw new Xt("".concat(d.name, ".bulkPut(): ").concat(S, " of ").concat(T, " operations failed"), C);
        });
      });
    }, Ee.prototype.bulkUpdate = function(i) {
      var a = this, u = this.core, d = i.map(function(v) {
        return v.key;
      }), p = i.map(function(v) {
        return v.changes;
      }), y = [];
      return this._trans("readwrite", function(v) {
        return u.getMany({ trans: v, keys: d, cache: "clone" }).then(function(w) {
          var T = [], x = [], k = (i.forEach(function(S, C) {
            var N = S.key, _ = S.changes, A = w[C];
            if (A) {
              for (var R = 0, M = Object.keys(_); R < M.length; R++) {
                var D = M[R], U = _[D];
                if (D === a.schema.primKey.keyPath) {
                  if (ye(U, N) !== 0) throw new se.Constraint("Cannot update primary key in bulkUpdate()");
                } else Y(A, D, U);
              }
              y.push(C), T.push(N), x.push(A);
            }
          }), T.length);
          return u.mutate({ trans: v, type: "put", keys: T, values: x, updates: { keys: d, changeSpecs: p } }).then(function(S) {
            var C = S.numFailures, N = S.failures;
            if (C === 0) return k;
            for (var _ = 0, A = Object.keys(N); _ < A.length; _++) {
              var R, M = A[_], D = y[Number(M)];
              D != null && (R = N[M], delete N[M], N[D] = R);
            }
            throw new Xt("".concat(a.name, ".bulkUpdate(): ").concat(C, " of ").concat(k, " operations failed"), N);
          });
        });
      });
    }, Ee.prototype.bulkDelete = function(i) {
      var a = this, u = i.length;
      return this._trans("readwrite", function(d) {
        return a.core.mutate({ trans: d, type: "delete", keys: i }).then(function(p) {
          return hr(a, i, p);
        });
      }).then(function(d) {
        var p = d.numFailures, y = d.failures;
        if (p === 0) return d.lastResult;
        throw new Xt("".concat(a.name, ".bulkDelete(): ").concat(p, " of ").concat(u, " operations failed"), y);
      });
    };
    var Is = Ee;
    function Ee() {
    }
    function _n(i) {
      function a(v, w) {
        if (w) {
          for (var T = arguments.length, x = new Array(T - 1); --T; ) x[T - 1] = arguments[T];
          return u[v].subscribe.apply(null, x), i;
        }
        if (typeof v == "string") return u[v];
      }
      var u = {};
      a.addEventType = y;
      for (var d = 1, p = arguments.length; d < p; ++d) y(arguments[d]);
      return a;
      function y(v, w, T) {
        var x, k;
        if (typeof v != "object") return w = w || wu, k = { subscribers: [], fire: T = T || Ie, subscribe: function(S) {
          k.subscribers.indexOf(S) === -1 && (k.subscribers.push(S), k.fire = w(k.fire, S));
        }, unsubscribe: function(S) {
          k.subscribers = k.subscribers.filter(function(C) {
            return C !== S;
          }), k.fire = k.subscribers.reduce(w, T);
        } }, u[v] = a[v] = k;
        c(x = v).forEach(function(S) {
          var C = x[S];
          if (l(C)) y(S, x[S][0], x[S][1]);
          else {
            if (C !== "asap") throw new se.InvalidArgument("Invalid event config");
            var N = y(S, En, function() {
              for (var _ = arguments.length, A = new Array(_); _--; ) A[_] = arguments[_];
              N.subscribers.forEach(function(R) {
                P(function() {
                  R.apply(null, A);
                });
              });
            });
          }
        });
      }
    }
    function Rn(i, a) {
      return q(a).from({ prototype: i }), a;
    }
    function en(i, a) {
      return !(i.filter || i.algorithm || i.or) && (a ? i.justLimit : !i.replayFilter);
    }
    function Si(i, a) {
      i.filter = Mt(i.filter, a);
    }
    function Ti(i, a, u) {
      var d = i.replayFilter;
      i.replayFilter = d ? function() {
        return Mt(d(), a());
      } : a, i.justLimit = u && !d;
    }
    function mr(i, a) {
      if (i.isPrimKey) return a.primaryKey;
      var u = a.getIndexByKeyPath(i.index);
      if (u) return u;
      throw new se.Schema("KeyPath " + i.index + " on object store " + a.name + " is not indexed");
    }
    function Es(i, a, u) {
      var d = mr(i, a.schema);
      return a.openCursor({ trans: u, values: !i.keysOnly, reverse: i.dir === "prev", unique: !!i.unique, query: { index: d, range: i.range } });
    }
    function gr(i, a, u, d) {
      var p, y, v = i.replayFilter ? Mt(i.filter, i.replayFilter()) : i.filter;
      return i.or ? (p = {}, y = function(w, T, x) {
        var k, S;
        v && !v(T, x, function(C) {
          return T.stop(C);
        }, function(C) {
          return T.fail(C);
        }) || ((S = "" + (k = T.primaryKey)) == "[object ArrayBuffer]" && (S = "" + new Uint8Array(k)), g(p, S)) || (p[S] = !0, a(w, T, x));
      }, Promise.all([i.or._iterate(y, u), Ss(Es(i, d, u), i.algorithm, y, !i.keysOnly && i.valueMapper)])) : Ss(Es(i, d, u), Mt(i.algorithm, v), a, !i.keysOnly && i.valueMapper);
    }
    function Ss(i, a, u, d) {
      var p = ke(d ? function(y, v, w) {
        return u(d(y), v, w);
      } : u);
      return i.then(function(y) {
        if (y) return y.start(function() {
          var v = function() {
            return y.continue();
          };
          a && !a(y, function(w) {
            return v = w;
          }, function(w) {
            y.stop(w), v = Ie;
          }, function(w) {
            y.fail(w), v = Ie;
          }) || p(y.value, y, function(w) {
            return v = w;
          }), v();
        });
      });
    }
    ve.prototype._read = function(i, a) {
      var u = this._ctx;
      return u.error ? u.table._trans(null, Re.bind(null, u.error)) : u.table._trans("readonly", i).then(a);
    }, ve.prototype._write = function(i) {
      var a = this._ctx;
      return a.error ? a.table._trans(null, Re.bind(null, a.error)) : a.table._trans("readwrite", i, "locked");
    }, ve.prototype._addAlgorithm = function(i) {
      var a = this._ctx;
      a.algorithm = Mt(a.algorithm, i);
    }, ve.prototype._iterate = function(i, a) {
      return gr(this._ctx, i, a, this._ctx.table.core);
    }, ve.prototype.clone = function(i) {
      var a = Object.create(this.constructor.prototype), u = Object.create(this._ctx);
      return i && f(u, i), a._ctx = u, a;
    }, ve.prototype.raw = function() {
      return this._ctx.valueMapper = null, this;
    }, ve.prototype.each = function(i) {
      var a = this._ctx;
      return this._read(function(u) {
        return gr(a, i, u, a.table.core);
      });
    }, ve.prototype.count = function(i) {
      var a = this;
      return this._read(function(u) {
        var d, p = a._ctx, y = p.table.core;
        return en(p, !0) ? y.count({ trans: u, query: { index: mr(p, y.schema), range: p.range } }).then(function(v) {
          return Math.min(v, p.limit);
        }) : (d = 0, gr(p, function() {
          return ++d, !1;
        }, u, y).then(function() {
          return d;
        }));
      }).then(i);
    }, ve.prototype.sortBy = function(i, a) {
      var u = i.split(".").reverse(), d = u[0], p = u.length - 1;
      function y(T, x) {
        return x ? y(T[u[x]], x - 1) : T[d];
      }
      var v = this._ctx.dir === "next" ? 1 : -1;
      function w(T, x) {
        return ye(y(T, p), y(x, p)) * v;
      }
      return this.toArray(function(T) {
        return T.slice().sort(w);
      }).then(a);
    }, ve.prototype.toArray = function(i) {
      var a = this;
      return this._read(function(u) {
        var d, p, y, v = a._ctx;
        return en(v, !0) && 0 < v.limit ? (d = v.valueMapper, p = mr(v, v.table.core.schema), v.table.core.query({ trans: u, limit: v.limit, values: !0, direction: v.dir === "prev" ? "prev" : void 0, query: { index: p, range: v.range } }).then(function(w) {
          return w = w.result, d ? w.map(d) : w;
        })) : (y = [], gr(v, function(w) {
          return y.push(w);
        }, u, v.table.core).then(function() {
          return y;
        }));
      }, i);
    }, ve.prototype.offset = function(i) {
      var a = this._ctx;
      return i <= 0 || (a.offset += i, en(a) ? Ti(a, function() {
        var u = i;
        return function(d, p) {
          return u === 0 || (u === 1 ? --u : p(function() {
            d.advance(u), u = 0;
          }), !1);
        };
      }) : Ti(a, function() {
        var u = i;
        return function() {
          return --u < 0;
        };
      })), this;
    }, ve.prototype.limit = function(i) {
      return this._ctx.limit = Math.min(this._ctx.limit, i), Ti(this._ctx, function() {
        var a = i;
        return function(u, d, p) {
          return --a <= 0 && d(p), 0 <= a;
        };
      }, !0), this;
    }, ve.prototype.until = function(i, a) {
      return Si(this._ctx, function(u, d, p) {
        return !i(u.value) || (d(p), a);
      }), this;
    }, ve.prototype.first = function(i) {
      return this.limit(1).toArray(function(a) {
        return a[0];
      }).then(i);
    }, ve.prototype.last = function(i) {
      return this.reverse().first(i);
    }, ve.prototype.filter = function(i) {
      var a;
      return Si(this._ctx, function(u) {
        return i(u.value);
      }), (a = this._ctx).isMatch = Mt(a.isMatch, i), this;
    }, ve.prototype.and = function(i) {
      return this.filter(i);
    }, ve.prototype.or = function(i) {
      return new this.db.WhereClause(this._ctx.table, i, this);
    }, ve.prototype.reverse = function() {
      return this._ctx.dir = this._ctx.dir === "prev" ? "next" : "prev", this._ondirectionchange && this._ondirectionchange(this._ctx.dir), this;
    }, ve.prototype.desc = function() {
      return this.reverse();
    }, ve.prototype.eachKey = function(i) {
      var a = this._ctx;
      return a.keysOnly = !a.isMatch, this.each(function(u, d) {
        i(d.key, d);
      });
    }, ve.prototype.eachUniqueKey = function(i) {
      return this._ctx.unique = "unique", this.eachKey(i);
    }, ve.prototype.eachPrimaryKey = function(i) {
      var a = this._ctx;
      return a.keysOnly = !a.isMatch, this.each(function(u, d) {
        i(d.primaryKey, d);
      });
    }, ve.prototype.keys = function(i) {
      var a = this._ctx, u = (a.keysOnly = !a.isMatch, []);
      return this.each(function(d, p) {
        u.push(p.key);
      }).then(function() {
        return u;
      }).then(i);
    }, ve.prototype.primaryKeys = function(i) {
      var a = this._ctx;
      if (en(a, !0) && 0 < a.limit) return this._read(function(d) {
        var p = mr(a, a.table.core.schema);
        return a.table.core.query({ trans: d, values: !1, limit: a.limit, direction: a.dir === "prev" ? "prev" : void 0, query: { index: p, range: a.range } });
      }).then(function(d) {
        return d.result;
      }).then(i);
      a.keysOnly = !a.isMatch;
      var u = [];
      return this.each(function(d, p) {
        u.push(p.primaryKey);
      }).then(function() {
        return u;
      }).then(i);
    }, ve.prototype.uniqueKeys = function(i) {
      return this._ctx.unique = "unique", this.keys(i);
    }, ve.prototype.firstKey = function(i) {
      return this.limit(1).keys(function(a) {
        return a[0];
      }).then(i);
    }, ve.prototype.lastKey = function(i) {
      return this.reverse().firstKey(i);
    }, ve.prototype.distinct = function() {
      var i, a = this._ctx, a = a.index && a.table.schema.idxByName[a.index];
      return a && a.multi && (i = {}, Si(this._ctx, function(d) {
        var d = d.primaryKey.toString(), p = g(i, d);
        return i[d] = !0, !p;
      })), this;
    }, ve.prototype.modify = function(i) {
      var a = this, u = this._ctx;
      return this._write(function(d) {
        function p(A, R) {
          var M = R.failures;
          C += A - R.numFailures;
          for (var D = 0, U = c(M); D < U.length; D++) {
            var G = U[D];
            S.push(M[G]);
          }
        }
        var y = typeof i == "function" ? i : function(A) {
          return bs(A, i);
        }, v = u.table.core, k = v.schema.primaryKey, w = k.outbound, T = k.extractKey, x = 200, k = a.db._options.modifyChunkSize, S = (k && (x = typeof k == "object" ? k[v.name] || k["*"] || 200 : k), []), C = 0, N = [], _ = i === Ts;
        return a.clone().primaryKeys().then(function(A) {
          function R(D) {
            var U = Math.min(x, A.length - D), G = A.slice(D, D + U);
            return (_ ? Promise.resolve([]) : v.getMany({ trans: d, keys: G, cache: "immutable" })).then(function(W) {
              var Z = [], X = [], te = w ? [] : null, Q = _ ? G : [];
              if (!_) for (var ne = 0; ne < U; ++ne) {
                var z = W[ne], ce = { value: fe(z), primKey: A[D + ne] };
                y.call(ce, ce.value, ce) !== !1 && (ce.value == null ? Q.push(A[D + ne]) : w || ye(T(z), T(ce.value)) === 0 ? (X.push(ce.value), w && te.push(A[D + ne])) : (Q.push(A[D + ne]), Z.push(ce.value)));
              }
              return Promise.resolve(0 < Z.length && v.mutate({ trans: d, type: "add", values: Z }).then(function(ue) {
                for (var pe in ue.failures) Q.splice(parseInt(pe), 1);
                p(Z.length, ue);
              })).then(function() {
                return (0 < X.length || M && typeof i == "object") && v.mutate({ trans: d, type: "put", keys: te, values: X, criteria: M, changeSpec: typeof i != "function" && i, isAdditionalChunk: 0 < D }).then(function(ue) {
                  return p(X.length, ue);
                });
              }).then(function() {
                return (0 < Q.length || M && _) && v.mutate({ trans: d, type: "delete", keys: Q, criteria: M, isAdditionalChunk: 0 < D }).then(function(ue) {
                  return hr(u.table, Q, ue);
                }).then(function(ue) {
                  return p(Q.length, ue);
                });
              }).then(function() {
                return A.length > D + U && R(D + x);
              });
            });
          }
          var M = en(u) && u.limit === 1 / 0 && (typeof i != "function" || _) && { index: u.index, range: u.range };
          return R(0).then(function() {
            if (0 < S.length) throw new rr("Error modifying one or more objects", S, C, N);
            return A.length;
          });
        });
      });
    }, ve.prototype.delete = function() {
      var i = this._ctx, a = i.range;
      return !en(i) || i.table.schema.yProps || !i.isPrimKey && a.type !== 3 ? this.modify(Ts) : this._write(function(u) {
        var d = i.table.core.schema.primaryKey, p = a;
        return i.table.core.count({ trans: u, query: { index: d, range: p } }).then(function(y) {
          return i.table.core.mutate({ trans: u, type: "deleteRange", range: p }).then(function(T) {
            var w = T.failures, T = T.numFailures;
            if (T) throw new rr("Could not delete some values", Object.keys(w).map(function(x) {
              return w[x];
            }), y - T);
            return y - T;
          });
        });
      });
    };
    var Cu = ve;
    function ve() {
    }
    var Ts = function(i, a) {
      return a.value = null;
    };
    function ku(i, a) {
      return i < a ? -1 : i === a ? 0 : 1;
    }
    function Au(i, a) {
      return a < i ? -1 : i === a ? 0 : 1;
    }
    function Xe(i, a, u) {
      return i = i instanceof ks ? new i.Collection(i) : i, i._ctx.error = new (u || TypeError)(a), i;
    }
    function tn(i) {
      return new i.Collection(i, function() {
        return Cs("");
      }).limit(0);
    }
    function yr(N, a, u, d) {
      var p, y, v, w, T, x, k, S = u.length;
      if (!u.every(function(A) {
        return typeof A == "string";
      })) return Xe(N, hs);
      function C(A) {
        p = A === "next" ? function(M) {
          return M.toUpperCase();
        } : function(M) {
          return M.toLowerCase();
        }, y = A === "next" ? function(M) {
          return M.toLowerCase();
        } : function(M) {
          return M.toUpperCase();
        }, v = A === "next" ? ku : Au;
        var R = u.map(function(M) {
          return { lower: y(M), upper: p(M) };
        }).sort(function(M, D) {
          return v(M.lower, D.lower);
        });
        w = R.map(function(M) {
          return M.upper;
        }), T = R.map(function(M) {
          return M.lower;
        }), k = (x = A) === "next" ? "" : d;
      }
      C("next");
      var N = new N.Collection(N, function() {
        return Ct(w[0], T[S - 1] + d);
      }), _ = (N._ondirectionchange = function(A) {
        C(A);
      }, 0);
      return N._addAlgorithm(function(A, R, M) {
        var D = A.key;
        if (typeof D == "string") {
          var U = y(D);
          if (a(U, T, _)) return !0;
          for (var G = null, W = _; W < S; ++W) {
            var Z = ((X, te, Q, ne, z, ce) => {
              for (var ue = Math.min(X.length, ne.length), pe = -1, ge = 0; ge < ue; ++ge) {
                var Qe = te[ge];
                if (Qe !== ne[ge]) return z(X[ge], Q[ge]) < 0 ? X.substr(0, ge) + Q[ge] + Q.substr(ge + 1) : z(X[ge], ne[ge]) < 0 ? X.substr(0, ge) + ne[ge] + Q.substr(ge + 1) : 0 <= pe ? X.substr(0, pe) + te[pe] + Q.substr(pe + 1) : null;
                z(X[ge], Qe) < 0 && (pe = ge);
              }
              return ue < ne.length && ce === "next" ? X + Q.substr(X.length) : ue < X.length && ce === "prev" ? X.substr(0, Q.length) : pe < 0 ? null : X.substr(0, pe) + ne[pe] + Q.substr(pe + 1);
            })(D, U, w[W], T[W], v, x);
            Z === null && G === null ? _ = W + 1 : (G === null || 0 < v(G, Z)) && (G = Z);
          }
          R(G !== null ? function() {
            A.continue(G + k);
          } : M);
        }
        return !1;
      }), N;
    }
    function Ct(i, a, u, d) {
      return { type: 2, lower: i, upper: a, lowerOpen: u, upperOpen: d };
    }
    function Cs(i) {
      return { type: 1, lower: i, upper: i };
    }
    Object.defineProperty(De.prototype, "Collection", { get: function() {
      return this._ctx.table.db.Collection;
    }, enumerable: !1, configurable: !0 }), De.prototype.between = function(i, a, u, d) {
      u = u !== !1, d = d === !0;
      try {
        return 0 < this._cmp(i, a) || this._cmp(i, a) === 0 && (u || d) && (!u || !d) ? tn(this) : new this.Collection(this, function() {
          return Ct(i, a, !u, !d);
        });
      } catch {
        return Xe(this, gt);
      }
    }, De.prototype.equals = function(i) {
      return i == null ? Xe(this, gt) : new this.Collection(this, function() {
        return Cs(i);
      });
    }, De.prototype.above = function(i) {
      return i == null ? Xe(this, gt) : new this.Collection(this, function() {
        return Ct(i, void 0, !0);
      });
    }, De.prototype.aboveOrEqual = function(i) {
      return i == null ? Xe(this, gt) : new this.Collection(this, function() {
        return Ct(i, void 0, !1);
      });
    }, De.prototype.below = function(i) {
      return i == null ? Xe(this, gt) : new this.Collection(this, function() {
        return Ct(void 0, i, !1, !0);
      });
    }, De.prototype.belowOrEqual = function(i) {
      return i == null ? Xe(this, gt) : new this.Collection(this, function() {
        return Ct(void 0, i);
      });
    }, De.prototype.startsWith = function(i) {
      return typeof i != "string" ? Xe(this, hs) : this.between(i, i + Lt, !0, !0);
    }, De.prototype.startsWithIgnoreCase = function(i) {
      return i === "" ? this.startsWith(i) : yr(this, function(a, u) {
        return a.indexOf(u[0]) === 0;
      }, [i], Lt);
    }, De.prototype.equalsIgnoreCase = function(i) {
      return yr(this, function(a, u) {
        return a === u[0];
      }, [i], "");
    }, De.prototype.anyOfIgnoreCase = function() {
      var i = Me.apply(je, arguments);
      return i.length === 0 ? tn(this) : yr(this, function(a, u) {
        return u.indexOf(a) !== -1;
      }, i, "");
    }, De.prototype.startsWithAnyOfIgnoreCase = function() {
      var i = Me.apply(je, arguments);
      return i.length === 0 ? tn(this) : yr(this, function(a, u) {
        return u.some(function(d) {
          return a.indexOf(d) === 0;
        });
      }, i, Lt);
    }, De.prototype.anyOf = function() {
      var i, a, u = this, d = Me.apply(je, arguments), p = this._cmp;
      try {
        d.sort(p);
      } catch {
        return Xe(this, gt);
      }
      return d.length === 0 ? tn(this) : ((i = new this.Collection(this, function() {
        return Ct(d[0], d[d.length - 1]);
      }))._ondirectionchange = function(y) {
        p = y === "next" ? u._ascending : u._descending, d.sort(p);
      }, a = 0, i._addAlgorithm(function(y, v, w) {
        for (var T = y.key; 0 < p(T, d[a]); ) if (++a === d.length) return v(w), !1;
        return p(T, d[a]) === 0 || (v(function() {
          y.continue(d[a]);
        }), !1);
      }), i);
    }, De.prototype.notEqual = function(i) {
      return this.inAnyRange([[-1 / 0, i], [i, this.db._maxKey]], { includeLowers: !1, includeUppers: !1 });
    }, De.prototype.noneOf = function() {
      var i = Me.apply(je, arguments);
      if (i.length === 0) return new this.Collection(this);
      try {
        i.sort(this._ascending);
      } catch {
        return Xe(this, gt);
      }
      var a = i.reduce(function(u, d) {
        return u ? u.concat([[u[u.length - 1][1], d]]) : [[-1 / 0, d]];
      }, null);
      return a.push([i[i.length - 1], this.db._maxKey]), this.inAnyRange(a, { includeLowers: !1, includeUppers: !1 });
    }, De.prototype.inAnyRange = function(i, M) {
      var u = this, d = this._cmp, p = this._ascending, y = this._descending, v = this._min, w = this._max;
      if (i.length === 0) return tn(this);
      if (!i.every(function(D) {
        return D[0] !== void 0 && D[1] !== void 0 && p(D[0], D[1]) <= 0;
      })) return Xe(this, "First argument to inAnyRange() must be an Array of two-value Arrays [lower,upper] where upper must not be lower than lower", se.InvalidArgument);
      var T = !M || M.includeLowers !== !1, x = M && M.includeUppers === !0, k, S = p;
      function C(D, U) {
        return S(D[0], U[0]);
      }
      try {
        (k = i.reduce(function(D, U) {
          for (var G = 0, W = D.length; G < W; ++G) {
            var Z = D[G];
            if (d(U[0], Z[1]) < 0 && 0 < d(U[1], Z[0])) {
              Z[0] = v(Z[0], U[0]), Z[1] = w(Z[1], U[1]);
              break;
            }
          }
          return G === W && D.push(U), D;
        }, [])).sort(C);
      } catch {
        return Xe(this, gt);
      }
      var N = 0, _ = x ? function(D) {
        return 0 < p(D, k[N][1]);
      } : function(D) {
        return 0 <= p(D, k[N][1]);
      }, A = T ? function(D) {
        return 0 < y(D, k[N][0]);
      } : function(D) {
        return 0 <= y(D, k[N][0]);
      }, R = _, M = new this.Collection(this, function() {
        return Ct(k[0][0], k[k.length - 1][1], !T, !x);
      });
      return M._ondirectionchange = function(D) {
        S = D === "next" ? (R = _, p) : (R = A, y), k.sort(C);
      }, M._addAlgorithm(function(D, U, G) {
        for (var W, Z = D.key; R(Z); ) if (++N === k.length) return U(G), !1;
        return !_(W = Z) && !A(W) || (u._cmp(Z, k[N][1]) === 0 || u._cmp(Z, k[N][0]) === 0 || U(function() {
          S === p ? D.continue(k[N][0]) : D.continue(k[N][1]);
        }), !1);
      }), M;
    }, De.prototype.startsWithAnyOf = function() {
      var i = Me.apply(je, arguments);
      return i.every(function(a) {
        return typeof a == "string";
      }) ? i.length === 0 ? tn(this) : this.inAnyRange(i.map(function(a) {
        return [a, a + Lt];
      })) : Xe(this, "startsWithAnyOf() only works with strings");
    };
    var ks = De;
    function De() {
    }
    function tt(i) {
      return ke(function(a) {
        return Nn(a), i(a.target.error), !1;
      });
    }
    function Nn(i) {
      i.stopPropagation && i.stopPropagation(), i.preventDefault && i.preventDefault();
    }
    var vr = "storagemutated", Ci = "x-storagemutated-1", kt = _n(null, vr), _u = (ct.prototype._lock = function() {
      return F(!ie.global), ++this._reculock, this._reculock !== 1 || ie.global || (ie.lockOwnerFor = this), this;
    }, ct.prototype._unlock = function() {
      if (F(!ie.global), --this._reculock == 0) for (ie.global || (ie.lockOwnerFor = null); 0 < this._blockedFuncs.length && !this._locked(); ) {
        var i = this._blockedFuncs.shift();
        try {
          Dt(i[1], i[0]);
        } catch {
        }
      }
      return this;
    }, ct.prototype._locked = function() {
      return this._reculock && ie.lockOwnerFor !== this;
    }, ct.prototype.create = function(i) {
      var a = this;
      if (this.mode) {
        var u = this.db.idbdb, d = this.db._state.dbOpenError;
        if (F(!this.idbtrans), !i && !u) switch (d && d.name) {
          case "DatabaseClosedError":
            throw new se.DatabaseClosed(d);
          case "MissingAPIError":
            throw new se.MissingAPI(d.message, d);
          default:
            throw new se.OpenFailed(d);
        }
        if (!this.active) throw new se.TransactionInactive();
        F(this._completion._state === null), (i = this.idbtrans = i || (this.db.core || u).transaction(this.storeNames, this.mode, { durability: this.chromeTransactionDurability })).onerror = ke(function(p) {
          Nn(p), a._reject(i.error);
        }), i.onabort = ke(function(p) {
          Nn(p), a.active && a._reject(new se.Abort(i.error)), a.active = !1, a.on("abort").fire(p);
        }), i.oncomplete = ke(function() {
          a.active = !1, a._resolve(), "mutatedParts" in i && kt.storagemutated.fire(i.mutatedParts);
        });
      }
      return this;
    }, ct.prototype._promise = function(i, a, u) {
      var d, p = this;
      return i === "readwrite" && this.mode !== "readwrite" ? Re(new se.ReadOnly("Transaction is readonly")) : this.active ? this._locked() ? new ee(function(y, v) {
        p._blockedFuncs.push([function() {
          p._promise(i, a, u).then(y, v);
        }, ie]);
      }) : u ? Et(function() {
        var y = new ee(function(v, w) {
          p._lock();
          var T = a(v, w, p);
          T && T.then && T.then(v, w);
        });
        return y.finally(function() {
          return p._unlock();
        }), y._lib = !0, y;
      }) : ((d = new ee(function(y, v) {
        var w = a(y, v, p);
        w && w.then && w.then(y, v);
      }))._lib = !0, d) : Re(new se.TransactionInactive());
    }, ct.prototype._root = function() {
      return this.parent ? this.parent._root() : this;
    }, ct.prototype.waitFor = function(i) {
      var a, u = this._root(), d = ee.resolve(i), p = (u._waitingFor ? u._waitingFor = u._waitingFor.then(function() {
        return d;
      }) : (u._waitingFor = d, u._waitingQueue = [], a = u.idbtrans.objectStore(u.storeNames[0]), function y() {
        for (++u._spinCount; u._waitingQueue.length; ) u._waitingQueue.shift()();
        u._waitingFor && (a.get(-1 / 0).onsuccess = y);
      }()), u._waitingFor);
      return new ee(function(y, v) {
        d.then(function(w) {
          return u._waitingQueue.push(ke(y.bind(null, w)));
        }, function(w) {
          return u._waitingQueue.push(ke(v.bind(null, w)));
        }).finally(function() {
          u._waitingFor === p && (u._waitingFor = null);
        });
      });
    }, ct.prototype.abort = function() {
      this.active && (this.active = !1, this.idbtrans && this.idbtrans.abort(), this._reject(new se.Abort()));
    }, ct.prototype.table = function(i) {
      var a = this._memoizedTables || (this._memoizedTables = {});
      if (g(a, i)) return a[i];
      var u = this.schema[i];
      if (u) return (u = new this.db.Table(i, u, this)).core = this.db.core.table(i), a[i] = u;
      throw new se.NotFound("Table " + i + " not part of transaction");
    }, ct);
    function ct() {
    }
    function ki(i, a, u, d, p, y, v, w) {
      return { name: i, keyPath: a, unique: u, multi: d, auto: p, compound: y, src: (u && !v ? "&" : "") + (d ? "*" : "") + (p ? "++" : "") + As(a), type: w };
    }
    function As(i) {
      return typeof i == "string" ? i : i ? "[" + [].join.call(i, "+") + "]" : "";
    }
    function Ai(i, a, u) {
      return { name: i, primKey: a, indexes: u, mappedClass: null, idxByName: (d = function(p) {
        return [p.name, p];
      }, u.reduce(function(p, y, v) {
        return y = d(y, v), y && (p[y[0]] = y[1]), p;
      }, {})) };
      var d;
    }
    var On = function(i) {
      try {
        return i.only([[]]), On = function() {
          return [[]];
        }, [[]];
      } catch {
        return On = function() {
          return Lt;
        }, Lt;
      }
    };
    function _i(i) {
      return i == null ? function() {
      } : typeof i == "string" ? (a = i).split(".").length === 1 ? function(u) {
        return u[a];
      } : function(u) {
        return L(u, a);
      } : function(u) {
        return L(u, i);
      };
      var a;
    }
    function _s(i) {
      return [].slice.call(i);
    }
    var Ru = 0;
    function Pn(i) {
      return i == null ? ":id" : typeof i == "string" ? i : "[".concat(i.join("+"), "]");
    }
    function Nu(i, a, v) {
      function d(R) {
        if (R.type === 3) return null;
        if (R.type === 4) throw new Error("Cannot convert never type to IDBKeyRange");
        var N = R.lower, _ = R.upper, A = R.lowerOpen, R = R.upperOpen;
        return N === void 0 ? _ === void 0 ? null : a.upperBound(_, !!R) : _ === void 0 ? a.lowerBound(N, !!A) : a.bound(N, _, !!A, !!R);
      }
      function p(C) {
        var N, _, A = C.name;
        return { name: A, schema: C, mutate: function(R) {
          var M = R.trans, D = R.type, U = R.keys, G = R.values, W = R.range;
          return new Promise(function(Z, X) {
            Z = ke(Z);
            var te = M.objectStore(A), Q = te.keyPath == null, ne = D === "put" || D === "add";
            if (!ne && D !== "delete" && D !== "deleteRange") throw new Error("Invalid operation type: " + D);
            var z, ce = (U || G || { length: 1 }).length;
            if (U && G && U.length !== G.length) throw new Error("Given keys array must have same length as given values array.");
            if (ce === 0) return Z({ numFailures: 0, failures: {}, results: [], lastResult: void 0 });
            function ue(Fe) {
              ++Qe, Nn(Fe);
            }
            var pe = [], ge = [], Qe = 0;
            if (D === "deleteRange") {
              if (W.type === 4) return Z({ numFailures: Qe, failures: ge, results: [], lastResult: void 0 });
              W.type === 3 ? pe.push(z = te.clear()) : pe.push(z = te.delete(d(W)));
            } else {
              var Q = ne ? Q ? [G, U] : [G, null] : [U, null], de = Q[0], qe = Q[1];
              if (ne) for (var Ue = 0; Ue < ce; ++Ue) pe.push(z = qe && qe[Ue] !== void 0 ? te[D](de[Ue], qe[Ue]) : te[D](de[Ue])), z.onerror = ue;
              else for (Ue = 0; Ue < ce; ++Ue) pe.push(z = te[D](de[Ue])), z.onerror = ue;
            }
            function Nr(Fe) {
              Fe = Fe.target.result, pe.forEach(function(Ut, Hi) {
                return Ut.error != null && (ge[Hi] = Ut.error);
              }), Z({ numFailures: Qe, failures: ge, results: D === "delete" ? U : pe.map(function(Ut) {
                return Ut.result;
              }), lastResult: Fe });
            }
            z.onerror = function(Fe) {
              ue(Fe), Nr(Fe);
            }, z.onsuccess = Nr;
          });
        }, getMany: function(R) {
          var M = R.trans, D = R.keys;
          return new Promise(function(U, G) {
            U = ke(U);
            for (var W, Z = M.objectStore(A), X = D.length, te = new Array(X), Q = 0, ne = 0, z = function(pe) {
              pe = pe.target, te[pe._pos] = pe.result, ++ne === Q && U(te);
            }, ce = tt(G), ue = 0; ue < X; ++ue) D[ue] != null && ((W = Z.get(D[ue]))._pos = ue, W.onsuccess = z, W.onerror = ce, ++Q);
            Q === 0 && U(te);
          });
        }, get: function(R) {
          var M = R.trans, D = R.key;
          return new Promise(function(U, G) {
            U = ke(U);
            var W = M.objectStore(A).get(D);
            W.onsuccess = function(Z) {
              return U(Z.target.result);
            }, W.onerror = tt(G);
          });
        }, query: (N = T, _ = x, function(R) {
          return new Promise(function(M, D) {
            M = ke(M);
            var U, G, W, Z, ce = R.trans, X = R.values, te = R.limit, z = R.query, Q = (Q = R.direction) != null ? Q : "next", ne = te === 1 / 0 ? void 0 : te, ue = z.index, z = z.range, ce = ce.objectStore(A), ce = ue.isPrimaryKey ? ce : ce.index(ue.name), ue = d(z);
            if (te === 0) return M({ result: [] });
            _ ? (z = { query: ue, count: ne, direction: Q }, (U = X ? ce.getAll(z) : ce.getAllKeys(z)).onsuccess = function(pe) {
              return M({ result: pe.target.result });
            }, U.onerror = tt(D)) : N && Q === "next" ? ((U = X ? ce.getAll(ue, ne) : ce.getAllKeys(ue, ne)).onsuccess = function(pe) {
              return M({ result: pe.target.result });
            }, U.onerror = tt(D)) : (G = 0, W = !X && "openKeyCursor" in ce ? ce.openKeyCursor(ue, Q) : ce.openCursor(ue, Q), Z = [], W.onsuccess = function() {
              var pe = W.result;
              return !pe || (Z.push(X ? pe.value : pe.primaryKey), ++G === te) ? M({ result: Z }) : void pe.continue();
            }, W.onerror = tt(D));
          });
        }), openCursor: function(R) {
          var M = R.trans, D = R.values, U = R.query, G = R.reverse, W = R.unique;
          return new Promise(function(Z, X) {
            Z = ke(Z);
            var ne = U.index, te = U.range, Q = M.objectStore(A), Q = ne.isPrimaryKey ? Q : Q.index(ne.name), ne = G ? W ? "prevunique" : "prev" : W ? "nextunique" : "next", z = !D && "openKeyCursor" in Q ? Q.openKeyCursor(d(te), ne) : Q.openCursor(d(te), ne);
            z.onerror = tt(X), z.onsuccess = ke(function(ce) {
              var ue, pe, ge, Qe, de = z.result;
              de ? (de.___id = ++Ru, de.done = !1, ue = de.continue.bind(de), pe = (pe = de.continuePrimaryKey) && pe.bind(de), ge = de.advance.bind(de), Qe = function() {
                throw new Error("Cursor not stopped");
              }, de.trans = M, de.stop = de.continue = de.continuePrimaryKey = de.advance = function() {
                throw new Error("Cursor not started");
              }, de.fail = ke(X), de.next = function() {
                var qe = this, Ue = 1;
                return this.start(function() {
                  return Ue-- ? qe.continue() : qe.stop();
                }).then(function() {
                  return qe;
                });
              }, de.start = function(qe) {
                function Ue() {
                  if (z.result) try {
                    qe();
                  } catch (Fe) {
                    de.fail(Fe);
                  }
                  else de.done = !0, de.start = function() {
                    throw new Error("Cursor behind last entry");
                  }, de.stop();
                }
                var Nr = new Promise(function(Fe, Ut) {
                  Fe = ke(Fe), z.onerror = tt(Ut), de.fail = Ut, de.stop = function(Hi) {
                    de.stop = de.continue = de.continuePrimaryKey = de.advance = Qe, Fe(Hi);
                  };
                });
                return z.onsuccess = ke(function(Fe) {
                  z.onsuccess = Ue, Ue();
                }), de.continue = ue, de.continuePrimaryKey = pe, de.advance = ge, Ue(), Nr;
              }, Z(de)) : Z(null);
            }, X);
          });
        }, count: function(R) {
          var M = R.query, D = R.trans, U = M.index, G = M.range;
          return new Promise(function(W, Z) {
            var X = D.objectStore(A), X = U.isPrimaryKey ? X : X.index(U.name), te = d(G), te = te ? X.count(te) : X.count();
            te.onsuccess = ke(function(Q) {
              return W(Q.target.result);
            }), te.onerror = tt(Z);
          });
        } };
      }
      y = v, w = _s((v = i).objectStoreNames), k = 0 < w.length ? y.objectStore(w[0]) : {};
      var y, v = { schema: { name: v.name, tables: w.map(function(C) {
        return y.objectStore(C);
      }).map(function(C) {
        var N = C.keyPath, _ = C.autoIncrement, R = l(N), A = {}, R = { name: C.name, primaryKey: { name: null, isPrimaryKey: !0, outbound: N == null, compound: R, keyPath: N, autoIncrement: _, unique: !0, extractKey: _i(N) }, indexes: _s(C.indexNames).map(function(M) {
          return C.index(M);
        }).map(function(G) {
          var W = G.name, D = G.unique, U = G.multiEntry, G = G.keyPath, W = { name: W, compound: l(G), keyPath: G, unique: D, multiEntry: U, extractKey: _i(G) };
          return A[Pn(G)] = W;
        }), getIndexByKeyPath: function(M) {
          return A[Pn(M)];
        } };
        return A[":id"] = R.primaryKey, N != null && (A[Pn(N)] = R.primaryKey), R;
      }) }, hasGetAll: 0 < w.length && "getAll" in k && !(typeof navigator < "u" && /Safari/.test(navigator.userAgent) && !/(Chrome\/|Edge\/)/.test(navigator.userAgent) && [].concat(navigator.userAgent.match(/Safari\/(\d*)/))[1] < 604), hasIdb3Features: "getAllRecords" in k }, w = v.schema, T = v.hasGetAll, x = v.hasIdb3Features, k = w.tables.map(p), S = {};
      return k.forEach(function(C) {
        return S[C.name] = C;
      }), { stack: "dbcore", transaction: i.transaction.bind(i), table: function(C) {
        if (S[C]) return S[C];
        throw new Error("Table '".concat(C, "' not found"));
      }, MIN_KEY: -1 / 0, MAX_KEY: On(a), schema: w };
    }
    function Ou(i, a, u, d) {
      return u = u.IDBKeyRange, a = Nu(a, u, d), { dbcore: i.dbcore.reduce(function(p, y) {
        return y = y.create, r(r({}, p), y(p));
      }, a) };
    }
    function wr(i, a) {
      var u = a.db, u = Ou(i._middlewares, u, i._deps, a);
      i.core = u.dbcore, i.tables.forEach(function(d) {
        var p = d.name;
        i.core.schema.tables.some(function(y) {
          return y.name === p;
        }) && (d.core = i.core.table(p), i[p] instanceof i.Table) && (i[p].core = d.core);
      });
    }
    function br(i, a, u, d) {
      u.forEach(function(p) {
        var y = d[p];
        a.forEach(function(v) {
          var w = function T(x, k) {
            return E(x, k) || (x = h(x)) && T(x, k);
          }(v, p);
          (!w || "value" in w && w.value === void 0) && (v === i.Transaction.prototype || v instanceof i.Transaction ? O(v, p, { get: function() {
            return this.table(p);
          }, set: function(T) {
            b(this, p, { value: T, writable: !0, configurable: !0, enumerable: !0 });
          } }) : v[p] = new i.Table(p, y));
        });
      });
    }
    function Ri(i, a) {
      a.forEach(function(u) {
        for (var d in u) u[d] instanceof i.Table && delete u[d];
      });
    }
    function Pu(i, a) {
      return i._cfg.version - a._cfg.version;
    }
    function xu(i, a, u, d) {
      var p = i._dbSchema, y = (u.objectStoreNames.contains("$meta") && !p.$meta && (p.$meta = Ai("$meta", Ns("")[0], []), i._storeNames.push("$meta")), i._createTransaction("readwrite", i._storeNames, p)), v = (y.create(u), y._completion.catch(d), y._reject.bind(y)), w = ie.transless || ie;
      Et(function() {
        if (ie.trans = y, ie.transless = w, a !== 0) return wr(i, u), x = a, ((T = y).storeNames.includes("$meta") ? T.table("$meta").get("version").then(function(k) {
          return k ?? x;
        }) : ee.resolve(x)).then(function(R) {
          var S = i, C = R, N = y, _ = u, A = [], R = S._versions, M = S._dbSchema = Er(0, S.idbdb, _);
          return (R = R.filter(function(D) {
            return D._cfg.version >= C;
          })).length === 0 ? ee.resolve() : (R.forEach(function(D) {
            A.push(function() {
              var U, G, W, Z = M, X = D._cfg.dbschema, te = (Sr(S, Z, _), Sr(S, X, _), M = S._dbSchema = X, Ni(Z, X)), Q = (te.add.forEach(function(ne) {
                Oi(_, ne[0], ne[1].primKey, ne[1].indexes);
              }), te.change.forEach(function(ne) {
                if (ne.recreate) throw new se.Upgrade("Not yet support for changing primary key");
                var z = _.objectStore(ne.name);
                ne.add.forEach(function(ce) {
                  return Ir(z, ce);
                }), ne.change.forEach(function(ce) {
                  z.deleteIndex(ce.name), Ir(z, ce);
                }), ne.del.forEach(function(ce) {
                  return z.deleteIndex(ce);
                });
              }), D._cfg.contentUpgrade);
              if (Q && D._cfg.version > C) return wr(S, _), N._memoizedTables = {}, U = K(X), te.del.forEach(function(ne) {
                U[ne] = Z[ne];
              }), Ri(S, [S.Transaction.prototype]), br(S, [S.Transaction.prototype], c(U), U), N.schema = U, (G = li(Q)) && Jt(), X = ee.follow(function() {
                var ne;
                (W = Q(N)) && G && (ne = St.bind(null, null), W.then(ne, ne));
              }), W && typeof W.then == "function" ? ee.resolve(W) : X.then(function() {
                return W;
              });
            }), A.push(function(U) {
              var G, W, Z = D._cfg.dbschema;
              G = Z, W = U, [].slice.call(W.db.objectStoreNames).forEach(function(X) {
                return G[X] == null && W.db.deleteObjectStore(X);
              }), Ri(S, [S.Transaction.prototype]), br(S, [S.Transaction.prototype], S._storeNames, S._dbSchema), N.schema = S._dbSchema;
            }), A.push(function(U) {
              S.idbdb.objectStoreNames.contains("$meta") && (Math.ceil(S.idbdb.version / 10) === D._cfg.version ? (S.idbdb.deleteObjectStore("$meta"), delete S._dbSchema.$meta, S._storeNames = S._storeNames.filter(function(G) {
                return G !== "$meta";
              })) : U.objectStore("$meta").put(D._cfg.version, "version"));
            });
          }), function D() {
            return A.length ? ee.resolve(A.shift()(N.idbtrans)).then(D) : ee.resolve();
          }().then(function() {
            Rs(M, _);
          }));
        }).catch(v);
        var T, x;
        c(p).forEach(function(k) {
          Oi(u, k, p[k].primKey, p[k].indexes);
        }), wr(i, u), ee.follow(function() {
          return i.on.populate.fire(y);
        }).catch(v);
      });
    }
    function $u(i, a) {
      Rs(i._dbSchema, a), a.db.version % 10 != 0 || a.objectStoreNames.contains("$meta") || a.db.createObjectStore("$meta").add(Math.ceil(a.db.version / 10 - 1), "version");
      var u = Er(0, i.idbdb, a);
      Sr(i, i._dbSchema, a);
      for (var d = 0, p = Ni(u, i._dbSchema).change; d < p.length; d++) {
        var y = ((v) => {
          if (v.change.length || v.recreate) return console.warn("Unable to patch indexes of table ".concat(v.name, " because it has changes on the type of index or primary key.")), { value: void 0 };
          var w = a.objectStore(v.name);
          v.add.forEach(function(T) {
            at && console.debug("Dexie upgrade patch: Creating missing index ".concat(v.name, ".").concat(T.src)), Ir(w, T);
          });
        })(p[d]);
        if (typeof y == "object") return y.value;
      }
    }
    function Ni(i, a) {
      var u, d = { del: [], add: [], change: [] };
      for (u in i) a[u] || d.del.push(u);
      for (u in a) {
        var p = i[u], y = a[u];
        if (p) {
          var v = { name: u, def: y, recreate: !1, del: [], add: [], change: [] };
          if ("" + (p.primKey.keyPath || "") != "" + (y.primKey.keyPath || "") || p.primKey.auto !== y.primKey.auto) v.recreate = !0, d.change.push(v);
          else {
            var w = p.idxByName, T = y.idxByName, x = void 0;
            for (x in w) T[x] || v.del.push(x);
            for (x in T) {
              var k = w[x], S = T[x];
              k ? k.src !== S.src && v.change.push(S) : v.add.push(S);
            }
            (0 < v.del.length || 0 < v.add.length || 0 < v.change.length) && d.change.push(v);
          }
        } else d.add.push([u, y]);
      }
      return d;
    }
    function Oi(i, a, u, d) {
      var p = i.db.createObjectStore(a, u.keyPath ? { keyPath: u.keyPath, autoIncrement: u.auto } : { autoIncrement: u.auto });
      d.forEach(function(y) {
        return Ir(p, y);
      });
    }
    function Rs(i, a) {
      c(i).forEach(function(u) {
        a.db.objectStoreNames.contains(u) || (at && console.debug("Dexie: Creating missing table", u), Oi(a, u, i[u].primKey, i[u].indexes));
      });
    }
    function Ir(i, a) {
      i.createIndex(a.name, a.keyPath, { unique: a.unique, multiEntry: a.multi });
    }
    function Er(i, a, u) {
      var d = {};
      return V(a.objectStoreNames, 0).forEach(function(p) {
        for (var y = u.objectStore(p), v = ki(As(x = y.keyPath), x || "", !0, !1, !!y.autoIncrement, x && typeof x != "string", !0), w = [], T = 0; T < y.indexNames.length; ++T) {
          var k = y.index(y.indexNames[T]), x = k.keyPath, k = ki(k.name, x, !!k.unique, !!k.multiEntry, !1, x && typeof x != "string", !1);
          w.push(k);
        }
        d[p] = Ai(p, v, w);
      }), d;
    }
    function Sr(i, a, u) {
      for (var d = u.db.objectStoreNames, p = 0; p < d.length; ++p) {
        var y = d[p], v = u.objectStore(y);
        i._hasGetAll = "getAll" in v;
        for (var w = 0; w < v.indexNames.length; ++w) {
          var T, x = v.indexNames[w], k = v.index(x).keyPath, k = typeof k == "string" ? k : "[" + V(k).join("+") + "]";
          a[y] && (T = a[y].idxByName[k]) && (T.name = x, delete a[y].idxByName[k], a[y].idxByName[x] = T);
        }
      }
      typeof navigator < "u" && /Safari/.test(navigator.userAgent) && !/(Chrome\/|Edge\/)/.test(navigator.userAgent) && s.WorkerGlobalScope && s instanceof s.WorkerGlobalScope && [].concat(navigator.userAgent.match(/Safari\/(\d*)/))[1] < 604 && (i._hasGetAll = !1);
    }
    function Ns(i) {
      return i.split(",").map(function(a, u) {
        var p = a.split(":"), d = (d = p[1]) == null ? void 0 : d.trim(), p = (a = p[0].trim()).replace(/([&*]|\+\+)/g, ""), y = /^\[/.test(p) ? p.match(/^\[(.*)\]$/)[1].split("+") : p;
        return ki(p, y || null, /\&/.test(a), /\*/.test(a), /\+\+/.test(a), l(y), u === 0, d);
      });
    }
    nn.prototype._createTableSchema = Ai, nn.prototype._parseIndexSyntax = Ns, nn.prototype._parseStoresSpec = function(i, a) {
      var u = this;
      c(i).forEach(function(d) {
        if (i[d] !== null) {
          var p = u._parseIndexSyntax(i[d]), y = p.shift();
          if (!y) throw new se.Schema("Invalid schema for table " + d + ": " + i[d]);
          if (y.unique = !0, y.multi) throw new se.Schema("Primary key cannot be multiEntry*");
          p.forEach(function(v) {
            if (v.auto) throw new se.Schema("Only primary key can be marked as autoIncrement (++)");
            if (!v.keyPath) throw new se.Schema("Index must have a name and cannot be an empty string");
          }), y = u._createTableSchema(d, y, p), a[d] = y;
        }
      });
    }, nn.prototype.stores = function(u) {
      var a = this.db, u = (this._cfg.storesSource = this._cfg.storesSource ? f(this._cfg.storesSource, u) : u, a._versions), d = {}, p = {};
      return u.forEach(function(y) {
        f(d, y._cfg.storesSource), p = y._cfg.dbschema = {}, y._parseStoresSpec(d, p);
      }), a._dbSchema = p, Ri(a, [a._allTables, a, a.Transaction.prototype]), br(a, [a._allTables, a, a.Transaction.prototype, this._cfg.tables], c(p), p), a._storeNames = c(p), this;
    }, nn.prototype.upgrade = function(i) {
      return this._cfg.contentUpgrade = fi(this._cfg.contentUpgrade || Ie, i), this;
    };
    var Du = nn;
    function nn() {
    }
    var xn = (() => {
      var i, a, u;
      return typeof FinalizationRegistry < "u" && typeof WeakRef < "u" ? (i = /* @__PURE__ */ new Set(), a = new FinalizationRegistry(function(d) {
        i.delete(d);
      }), { toArray: function() {
        return Array.from(i).map(function(d) {
          return d.deref();
        }).filter(function(d) {
          return d !== void 0;
        });
      }, add: function(d) {
        var p = new WeakRef(d._novip);
        i.add(p), a.register(d._novip, p, p), i.size > d._options.maxConnections && (p = i.values().next().value, i.delete(p), a.unregister(p));
      }, remove: function(d) {
        if (d) for (var p = i.values(), y = p.next(); !y.done; ) {
          var v = y.value;
          if (v.deref() === d._novip) return i.delete(v), void a.unregister(v);
          y = p.next();
        }
      } }) : (u = [], { toArray: function() {
        return u;
      }, add: function(d) {
        u.push(d._novip);
      }, remove: function(d) {
        d && (d = u.indexOf(d._novip)) !== -1 && u.splice(d, 1);
      } });
    })();
    function Pi(i, a) {
      var u = i._dbNamesDB;
      return u || (u = i._dbNamesDB = new yt(fr, { addons: [], indexedDB: i, IDBKeyRange: a })).version(1).stores({ dbnames: "name" }), u.table("dbnames");
    }
    function xi(i) {
      return i && typeof i.databases == "function";
    }
    function $i(i) {
      return Et(function() {
        return ie.letThrough = !0, i();
      });
    }
    function Di(i) {
      return !("from" in i);
    }
    var Ve = function(i, a) {
      var u;
      if (!this) return u = new Ve(), i && "d" in i && f(u, i), u;
      f(this, arguments.length ? { d: 1, from: i, to: 1 < arguments.length ? a : i } : { d: 0 });
    };
    function $n(i, a, u) {
      var d = ye(a, u);
      if (!isNaN(d)) {
        if (0 < d) throw RangeError();
        if (Di(i)) return f(i, { from: a, to: u, d: 1 });
        var d = i.l, p = i.r;
        if (ye(u, i.from) < 0) return d ? $n(d, a, u) : i.l = { from: a, to: u, d: 1, l: null, r: null }, Ps(i);
        if (0 < ye(a, i.to)) return p ? $n(p, a, u) : i.r = { from: a, to: u, d: 1, l: null, r: null }, Ps(i);
        ye(a, i.from) < 0 && (i.from = a, i.l = null, i.d = p ? p.d + 1 : 1), 0 < ye(u, i.to) && (i.to = u, i.r = null, i.d = i.l ? i.l.d + 1 : 1), a = !i.r, d && !i.l && Dn(i, d), p && a && Dn(i, p);
      }
    }
    function Dn(i, a) {
      Di(a) || function u(d, p) {
        var y = p.from, v = p.l, w = p.r;
        $n(d, y, p.to), v && u(d, v), w && u(d, w);
      }(i, a);
    }
    function Os(i, a) {
      var u = Tr(a), d = u.next();
      if (!d.done) for (var p = d.value, y = Tr(i), v = y.next(p.from), w = v.value; !d.done && !v.done; ) {
        if (ye(w.from, p.to) <= 0 && 0 <= ye(w.to, p.from)) return !0;
        ye(p.from, w.from) < 0 ? p = (d = u.next(w.from)).value : w = (v = y.next(p.from)).value;
      }
      return !1;
    }
    function Tr(i) {
      var a = Di(i) ? null : { s: 0, n: i };
      return { next: function(u) {
        for (var d = 0 < arguments.length; a; ) switch (a.s) {
          case 0:
            if (a.s = 1, d) for (; a.n.l && ye(u, a.n.from) < 0; ) a = { up: a, n: a.n.l, s: 1 };
            else for (; a.n.l; ) a = { up: a, n: a.n.l, s: 1 };
          case 1:
            if (a.s = 2, !d || ye(u, a.n.to) <= 0) return { value: a.n, done: !1 };
          case 2:
            if (a.n.r) {
              a.s = 3, a = { up: a, n: a.n.r, s: 0 };
              continue;
            }
          case 3:
            a = a.up;
        }
        return { done: !0 };
      } };
    }
    function Ps(i) {
      var a, u, d, p = (((p = i.r) == null ? void 0 : p.d) || 0) - (((p = i.l) == null ? void 0 : p.d) || 0), p = 1 < p ? "r" : p < -1 ? "l" : "";
      p && (a = p == "r" ? "l" : "r", u = r({}, i), d = i[p], i.from = d.from, i.to = d.to, i[p] = d[p], u[p] = d[a], (i[a] = u).d = xs(u)), i.d = xs(i);
    }
    function xs(u) {
      var a = u.r, u = u.l;
      return (a ? u ? Math.max(a.d, u.d) : a.d : u ? u.d : 0) + 1;
    }
    function Cr(i, a) {
      return c(a).forEach(function(u) {
        i[u] ? Dn(i[u], a[u]) : i[u] = function d(p) {
          var y, v, w = {};
          for (y in p) g(p, y) && (v = p[y], w[y] = !v || typeof v != "object" || oe.has(v.constructor) ? v : d(v));
          return w;
        }(a[u]);
      }), i;
    }
    function Li(i, a) {
      return i.all || a.all || Object.keys(i).some(function(u) {
        return a[u] && Os(a[u], i[u]);
      });
    }
    I(Ve.prototype, ((Ye = { add: function(i) {
      return Dn(this, i), this;
    }, addKey: function(i) {
      return $n(this, i, i), this;
    }, addKeys: function(i) {
      var a = this;
      return i.forEach(function(u) {
        return $n(a, u, u);
      }), this;
    }, hasKey: function(i) {
      var a = Tr(this).next(i).value;
      return a && ye(a.from, i) <= 0 && 0 <= ye(a.to, i);
    } })[we] = function() {
      return Tr(this);
    }, Ye));
    var Vt = {}, Mi = {}, Vi = !1;
    function kr(i) {
      Cr(Mi, i), Vi || (Vi = !0, setTimeout(function() {
        Vi = !1, qi(Mi, !(Mi = {}));
      }, 0));
    }
    function qi(i, a) {
      a === void 0 && (a = !1);
      var u = /* @__PURE__ */ new Set();
      if (i.all) for (var d = 0, p = Object.values(Vt); d < p.length; d++) $s(w = p[d], i, u, a);
      else for (var y in i) {
        var v, w, y = /^idb\:\/\/(.*)\/(.*)\//.exec(y);
        y && (v = y[1], y = y[2], w = Vt["idb://".concat(v, "/").concat(y)]) && $s(w, i, u, a);
      }
      u.forEach(function(T) {
        return T();
      });
    }
    function $s(i, a, u, d) {
      for (var p = [], y = 0, v = Object.entries(i.queries.query); y < v.length; y++) {
        for (var w = v[y], T = w[0], x = [], k = 0, S = w[1]; k < S.length; k++) {
          var C = S[k];
          Li(a, C.obsSet) ? C.subscribers.forEach(function(R) {
            return u.add(R);
          }) : d && x.push(C);
        }
        d && p.push([T, x]);
      }
      if (d) for (var N = 0, _ = p; N < _.length; N++) {
        var A = _[N], T = A[0], x = A[1];
        i.queries.query[T] = x;
      }
    }
    function Lu(i) {
      var a = i._state, u = i._deps.indexedDB;
      if (a.isBeingOpened || i.idbdb) return a.dbReadyPromise.then(function() {
        return a.dbOpenError ? Re(a.dbOpenError) : i;
      });
      a.isBeingOpened = !0, a.dbOpenError = null, a.openComplete = !1;
      var d = a.openCanceller, p = Math.round(10 * i.verno), y = !1;
      function v() {
        if (a.openCanceller !== d) throw new se.DatabaseClosed("db.open() was cancelled");
      }
      function w() {
        return new ee(function(C, N) {
          if (v(), !u) throw new se.MissingAPI();
          var _ = i.name, A = a.autoSchema || !p ? u.open(_) : u.open(_, p);
          if (!A) throw new se.MissingAPI();
          A.onerror = tt(N), A.onblocked = ke(i._fireOnBlocked), A.onupgradeneeded = ke(function(R) {
            var M;
            k = A.transaction, a.autoSchema && !i._options.allowEmptyDB ? (A.onerror = Nn, k.abort(), A.result.close(), (M = u.deleteDatabase(_)).onsuccess = M.onerror = ke(function() {
              N(new se.NoSuchDatabase("Database ".concat(_, " doesnt exist")));
            })) : (k.onerror = tt(N), M = R.oldVersion > Math.pow(2, 62) ? 0 : R.oldVersion, S = M < 1, i.idbdb = A.result, y && $u(i, k), xu(i, M / 10, k, N));
          }, N), A.onsuccess = ke(function() {
            k = null;
            var R, M, D, U, G, W, Z = i.idbdb = A.result, X = V(Z.objectStoreNames);
            if (0 < X.length) try {
              var te = Z.transaction((G = X).length === 1 ? G[0] : G, "readonly");
              if (a.autoSchema) W = Z, U = te, (D = i).verno = W.version / 10, U = D._dbSchema = Er(0, W, U), D._storeNames = V(W.objectStoreNames, 0), br(D, [D._allTables], c(U), U);
              else if (Sr(i, i._dbSchema, te), M = te, ((M = Ni(Er(0, (R = i).idbdb, M), R._dbSchema)).add.length || M.change.some(function(Q) {
                return Q.add.length || Q.change.length;
              })) && !y) return console.warn("Dexie SchemaDiff: Schema was extended without increasing the number passed to db.version(). Dexie will add missing parts and increment native version number to workaround this."), Z.close(), p = Z.version + 1, y = !0, C(w());
              wr(i, te);
            } catch {
            }
            xn.add(i), Z.onversionchange = ke(function(Q) {
              a.vcFired = !0, i.on("versionchange").fire(Q);
            }), Z.onclose = ke(function() {
              i.close({ disableAutoOpen: !1 });
            }), S && (X = i._deps, G = _, xi(W = X.indexedDB) || G === fr || Pi(W, X.IDBKeyRange).put({ name: G }).catch(Ie)), C();
          }, N);
        }).catch(function(C) {
          switch (C == null ? void 0 : C.name) {
            case "UnknownError":
              if (0 < a.PR1398_maxLoop) return a.PR1398_maxLoop--, console.warn("Dexie: Workaround for Chrome UnknownError on open()"), w();
              break;
            case "VersionError":
              if (0 < p) return p = 0, w();
          }
          return ee.reject(C);
        });
      }
      var T, x = a.dbReadyResolve, k = null, S = !1;
      return ee.race([d, (typeof navigator > "u" ? ee.resolve() : !navigator.userAgentData && /Safari\//.test(navigator.userAgent) && !/Chrom(e|ium)\//.test(navigator.userAgent) && indexedDB.databases ? new Promise(function(C) {
        function N() {
          return indexedDB.databases().finally(C);
        }
        T = setInterval(N, 100), N();
      }).finally(function() {
        return clearInterval(T);
      }) : Promise.resolve()).then(w)]).then(function() {
        return v(), a.onReadyBeingFired = [], ee.resolve($i(function() {
          return i.on.ready.fire(i.vip);
        })).then(function C() {
          var N;
          if (0 < a.onReadyBeingFired.length) return N = a.onReadyBeingFired.reduce(fi, Ie), a.onReadyBeingFired = [], ee.resolve($i(function() {
            return N(i.vip);
          })).then(C);
        });
      }).finally(function() {
        a.openCanceller === d && (a.onReadyBeingFired = null, a.isBeingOpened = !1);
      }).catch(function(C) {
        a.dbOpenError = C;
        try {
          k && k.abort();
        } catch {
        }
        return d === a.openCanceller && i._close(), Re(C);
      }).finally(function() {
        a.openComplete = !0, x();
      }).then(function() {
        var C;
        return S && (C = {}, i.tables.forEach(function(N) {
          N.schema.indexes.forEach(function(_) {
            _.name && (C["idb://".concat(i.name, "/").concat(N.name, "/").concat(_.name)] = new Ve(-1 / 0, [[[]]]));
          }), C["idb://".concat(i.name, "/").concat(N.name, "/")] = C["idb://".concat(i.name, "/").concat(N.name, "/:dels")] = new Ve(-1 / 0, [[[]]]);
        }), kt(vr).fire(C), qi(C, !0)), i;
      });
    }
    function Ui(i) {
      function a(y) {
        return i.next(y);
      }
      var u = p(a), d = p(function(y) {
        return i.throw(y);
      });
      function p(y) {
        return function(w) {
          var w = y(w), T = w.value;
          return w.done ? T : T && typeof T.then == "function" ? T.then(u, d) : l(T) ? Promise.all(T).then(u, d) : u(T);
        };
      }
      return p(a)();
    }
    function Ar(i, a, u) {
      for (var d = l(i) ? i.slice() : [i], p = 0; p < u; ++p) d.push(a);
      return d;
    }
    var Mu = { stack: "dbcore", name: "VirtualIndexMiddleware", level: 1, create: function(i) {
      return r(r({}, i), { table: function(d) {
        var u = i.table(d), d = u.schema, p = {}, y = [];
        function v(C, N, _) {
          var D = Pn(C), A = p[D] = p[D] || [], R = C == null ? 0 : typeof C == "string" ? 1 : C.length, M = 0 < N, D = r(r({}, _), { name: M ? "".concat(D, "(virtual-from:").concat(_.name, ")") : _.name, lowLevelIndex: _, isVirtual: M, keyTail: N, keyLength: R, extractKey: _i(C), unique: !M && _.unique });
          return A.push(D), D.isPrimaryKey || y.push(D), 1 < R && v(R === 2 ? C[0] : C.slice(0, R - 1), N + 1, _), A.sort(function(U, G) {
            return U.keyTail - G.keyTail;
          }), D;
        }
        var w = v(d.primaryKey.keyPath, 0, d.primaryKey);
        p[":id"] = [w];
        for (var T = 0, x = d.indexes; T < x.length; T++) {
          var k = x[T];
          v(k.keyPath, 0, k);
        }
        function S(C) {
          var N, _ = C.query.index;
          return _.isVirtual ? r(r({}, C), { query: { index: _.lowLevelIndex, range: (N = C.query.range, _ = _.keyTail, { type: N.type === 1 ? 2 : N.type, lower: Ar(N.lower, N.lowerOpen ? i.MAX_KEY : i.MIN_KEY, _), lowerOpen: !0, upper: Ar(N.upper, N.upperOpen ? i.MIN_KEY : i.MAX_KEY, _), upperOpen: !0 }) } }) : C;
        }
        return r(r({}, u), { schema: r(r({}, d), { primaryKey: w, indexes: y, getIndexByKeyPath: function(C) {
          return (C = p[Pn(C)]) && C[0];
        } }), count: function(C) {
          return u.count(S(C));
        }, query: function(C) {
          return u.query(S(C));
        }, openCursor: function(C) {
          var N = C.query.index, _ = N.keyTail, A = N.keyLength;
          return N.isVirtual ? u.openCursor(S(C)).then(function(M) {
            return M && R(M);
          }) : u.openCursor(C);
          function R(M) {
            return Object.create(M, { continue: { value: function(D) {
              D != null ? M.continue(Ar(D, C.reverse ? i.MAX_KEY : i.MIN_KEY, _)) : C.unique ? M.continue(M.key.slice(0, A).concat(C.reverse ? i.MIN_KEY : i.MAX_KEY, _)) : M.continue();
            } }, continuePrimaryKey: { value: function(D, U) {
              M.continuePrimaryKey(Ar(D, i.MAX_KEY, _), U);
            } }, primaryKey: { get: function() {
              return M.primaryKey;
            } }, key: { get: function() {
              var D = M.key;
              return A === 1 ? D[0] : D.slice(0, A);
            } }, value: { get: function() {
              return M.value;
            } } });
          }
        } });
      } });
    } };
    function Bi(i, a, u, d) {
      return u = u || {}, d = d || "", c(i).forEach(function(p) {
        var y, v, w;
        g(a, p) ? (y = i[p], v = a[p], typeof y == "object" && typeof v == "object" && y && v ? (w = me(y)) !== me(v) ? u[d + p] = a[p] : w === "Object" ? Bi(y, v, u, d + p + ".") : y !== v && (u[d + p] = a[p]) : y !== v && (u[d + p] = a[p])) : u[d + p] = void 0;
      }), c(a).forEach(function(p) {
        g(i, p) || (u[d + p] = a[p]);
      }), u;
    }
    function ji(i, a) {
      return a.type === "delete" ? a.keys : a.keys || a.values.map(i.extractKey);
    }
    var Vu = { stack: "dbcore", name: "HooksMiddleware", level: 2, create: function(i) {
      return r(r({}, i), { table: function(a) {
        var u = i.table(a), d = u.schema.primaryKey;
        return r(r({}, u), { mutate: function(p) {
          var y = ie.trans, v = y.table(a).hook, w = v.deleting, T = v.creating, x = v.updating;
          switch (p.type) {
            case "add":
              if (T.fire === Ie) break;
              return y._promise("readwrite", function() {
                return k(p);
              }, !0);
            case "put":
              if (T.fire === Ie && x.fire === Ie) break;
              return y._promise("readwrite", function() {
                return k(p);
              }, !0);
            case "delete":
              if (w.fire === Ie) break;
              return y._promise("readwrite", function() {
                return k(p);
              }, !0);
            case "deleteRange":
              if (w.fire === Ie) break;
              return y._promise("readwrite", function() {
                return function S(C, N, _) {
                  return u.query({ trans: C, values: !1, query: { index: d, range: N }, limit: _ }).then(function(A) {
                    var R = A.result;
                    return k({ type: "delete", keys: R, trans: C }).then(function(M) {
                      return 0 < M.numFailures ? Promise.reject(M.failures[0]) : R.length < _ ? { failures: [], numFailures: 0, lastResult: void 0 } : S(C, r(r({}, N), { lower: R[R.length - 1], lowerOpen: !0 }), _);
                    });
                  });
                }(p.trans, p.range, 1e4);
              }, !0);
          }
          return u.mutate(p);
          function k(S) {
            var C, N, _, A = ie.trans, R = S.keys || ji(d, S);
            if (R) return (S = S.type === "add" || S.type === "put" ? r(r({}, S), { keys: R }) : r({}, S)).type !== "delete" && (S.values = o([], S.values)), S.keys && (S.keys = o([], S.keys)), C = u, _ = R, ((N = S).type === "add" ? Promise.resolve([]) : C.getMany({ trans: N.trans, keys: _, cache: "immutable" })).then(function(M) {
              var D = R.map(function(U, G) {
                var W, Z, X, te = M[G], Q = { onerror: null, onsuccess: null };
                return S.type === "delete" ? w.fire.call(Q, U, te, A) : S.type === "add" || te === void 0 ? (W = T.fire.call(Q, U, S.values[G], A), U == null && W != null && (S.keys[G] = U = W, d.outbound || Y(S.values[G], d.keyPath, U))) : (W = Bi(te, S.values[G]), (Z = x.fire.call(Q, W, U, te, A)) && (X = S.values[G], Object.keys(Z).forEach(function(ne) {
                  g(X, ne) ? X[ne] = Z[ne] : Y(X, ne, Z[ne]);
                }))), Q;
              });
              return u.mutate(S).then(function(U) {
                for (var G = U.failures, W = U.results, Z = U.numFailures, U = U.lastResult, X = 0; X < R.length; ++X) {
                  var te = (W || R)[X], Q = D[X];
                  te == null ? Q.onerror && Q.onerror(G[X]) : Q.onsuccess && Q.onsuccess(S.type === "put" && M[X] ? S.values[X] : te);
                }
                return { failures: G, results: W, numFailures: Z, lastResult: U };
              }).catch(function(U) {
                return D.forEach(function(G) {
                  return G.onerror && G.onerror(U);
                }), Promise.reject(U);
              });
            });
            throw new Error("Keys missing");
          }
        } });
      } });
    } };
    function Ds(i, a, u) {
      try {
        if (!a || a.keys.length < i.length) return null;
        for (var d = [], p = 0, y = 0; p < a.keys.length && y < i.length; ++p) ye(a.keys[p], i[y]) === 0 && (d.push(u ? fe(a.values[p]) : a.values[p]), ++y);
        return d.length === i.length ? d : null;
      } catch {
        return null;
      }
    }
    var qu = { stack: "dbcore", level: -1, create: function(i) {
      return { table: function(a) {
        var u = i.table(a);
        return r(r({}, u), { getMany: function(d) {
          var p;
          return d.cache ? (p = Ds(d.keys, d.trans._cache, d.cache === "clone")) ? ee.resolve(p) : u.getMany(d).then(function(y) {
            return d.trans._cache = { keys: d.keys, values: d.cache === "clone" ? fe(y) : y }, y;
          }) : u.getMany(d);
        }, mutate: function(d) {
          return d.type !== "add" && (d.trans._cache = null), u.mutate(d);
        } });
      } };
    } };
    function Ls(i, a) {
      return i.trans.mode === "readonly" && !!i.subscr && !i.trans.explicit && i.trans.db._options.cache !== "disabled" && !a.schema.primaryKey.outbound;
    }
    function Ms(i, a) {
      switch (i) {
        case "query":
          return a.values && !a.unique;
        case "get":
        case "getMany":
        case "count":
        case "openCursor":
          return !1;
      }
    }
    var Uu = { stack: "dbcore", level: 0, name: "Observability", create: function(i) {
      var a = i.schema.name, u = new Ve(i.MIN_KEY, i.MAX_KEY);
      return r(r({}, i), { transaction: function(d, p, y) {
        if (ie.subscr && p !== "readonly") throw new se.ReadOnly("Readwrite transaction in liveQuery context. Querier source: ".concat(ie.querier));
        return i.transaction(d, p, y);
      }, table: function(d) {
        function p(R) {
          var A, R = R.query;
          return [A = R.index, new Ve((A = (R = R.range).lower) != null ? A : i.MIN_KEY, (A = R.upper) != null ? A : i.MAX_KEY)];
        }
        var y = i.table(d), v = y.schema, w = v.primaryKey, T = v.indexes, x = w.extractKey, k = w.outbound, S = w.autoIncrement && T.filter(function(_) {
          return _.compound && _.keyPath.includes(w.keyPath);
        }), C = r(r({}, y), { mutate: function(_) {
          function A(z) {
            return z = "idb://".concat(a, "/").concat(d, "/").concat(z), G[z] || (G[z] = new Ve());
          }
          var R, M, D, U = _.trans, G = _.mutatedParts || (_.mutatedParts = {}), W = A(""), Z = A(":dels"), X = _.type, Q = _.type === "deleteRange" ? [_.range] : _.type === "delete" ? [_.keys] : _.values.length < 50 ? [ji(w, _).filter(function(z) {
            return z;
          }), _.values] : [], te = Q[0], Q = Q[1], ne = _.trans._cache;
          return l(te) ? (W.addKeys(te), (X = X === "delete" || te.length === Q.length ? Ds(te, ne) : null) || Z.addKeys(te), (X || Q) && (R = A, M = X, D = Q, v.indexes.forEach(function(z) {
            var ce = R(z.name || "");
            function ue(ge) {
              return ge != null ? z.extractKey(ge) : null;
            }
            function pe(ge) {
              z.multiEntry && l(ge) ? ge.forEach(function(Qe) {
                return ce.addKey(Qe);
              }) : ce.addKey(ge);
            }
            (M || D).forEach(function(ge, qe) {
              var de = M && ue(M[qe]), qe = D && ue(D[qe]);
              ye(de, qe) !== 0 && (de != null && pe(de), qe != null) && pe(qe);
            });
          }))) : te ? (Q = { from: (ne = te.lower) != null ? ne : i.MIN_KEY, to: (X = te.upper) != null ? X : i.MAX_KEY }, Z.add(Q), W.add(Q)) : (W.add(u), Z.add(u), v.indexes.forEach(function(z) {
            return A(z.name).add(u);
          })), y.mutate(_).then(function(z) {
            return !te || _.type !== "add" && _.type !== "put" || (W.addKeys(z.results), S && S.forEach(function(ce) {
              for (var ue = _.values.map(function(de) {
                return ce.extractKey(de);
              }), pe = ce.keyPath.findIndex(function(de) {
                return de === w.keyPath;
              }), ge = 0, Qe = z.results.length; ge < Qe; ++ge) ue[ge][pe] = z.results[ge];
              A(ce.name).addKeys(ue);
            })), U.mutatedParts = Cr(U.mutatedParts || {}, G), z;
          });
        } }), N = { get: function(_) {
          return [w, new Ve(_.key)];
        }, getMany: function(_) {
          return [w, new Ve().addKeys(_.keys)];
        }, count: p, query: p, openCursor: p };
        return c(N).forEach(function(_) {
          C[_] = function(A) {
            var R = ie.subscr, M = !!R, D = Ls(ie, y) && Ms(_, A) ? A.obsSet = {} : R;
            if (M) {
              var U, R = function(Q) {
                return Q = "idb://".concat(a, "/").concat(d, "/").concat(Q), D[Q] || (D[Q] = new Ve());
              }, G = R(""), W = R(":dels"), M = N[_](A), Z = M[0], M = M[1];
              if ((_ === "query" && Z.isPrimaryKey && !A.values ? W : R(Z.name || "")).add(M), !Z.isPrimaryKey) {
                if (_ !== "count") return U = _ === "query" && k && A.values && y.query(r(r({}, A), { values: !1 })), y[_].apply(this, arguments).then(function(Q) {
                  if (_ === "query") {
                    if (k && A.values) return U.then(function(ue) {
                      return ue = ue.result, G.addKeys(ue), Q;
                    });
                    var ne = A.values ? Q.result.map(x) : Q.result;
                    (A.values ? G : W).addKeys(ne);
                  } else {
                    var z, ce;
                    if (_ === "openCursor") return ce = A.values, (z = Q) && Object.create(z, { key: { get: function() {
                      return W.addKey(z.primaryKey), z.key;
                    } }, primaryKey: { get: function() {
                      var ue = z.primaryKey;
                      return W.addKey(ue), ue;
                    } }, value: { get: function() {
                      return ce && G.addKey(z.primaryKey), z.value;
                    } } });
                  }
                  return Q;
                });
                W.add(u);
              }
            }
            return y[_].apply(this, arguments);
          };
        }), C;
      } });
    } };
    function Vs(i, a, u) {
      var d;
      return u.numFailures === 0 ? a : a.type === "deleteRange" || (d = a.keys ? a.keys.length : "values" in a && a.values ? a.values.length : 1, u.numFailures === d) ? null : (d = r({}, a), l(d.keys) && (d.keys = d.keys.filter(function(p, y) {
        return !(y in u.failures);
      })), "values" in d && l(d.values) && (d.values = d.values.filter(function(p, y) {
        return !(y in u.failures);
      })), d);
    }
    function Fi(i, a) {
      return u = i, ((d = a).lower === void 0 || (d.lowerOpen ? 0 < ye(u, d.lower) : 0 <= ye(u, d.lower))) && (u = i, (d = a).upper === void 0 || (d.upperOpen ? ye(u, d.upper) < 0 : ye(u, d.upper) <= 0));
      var u, d;
    }
    function qs(i, a, u, d, p, y) {
      var v, w, T, x, k, S, C;
      return !u || u.length === 0 || (v = a.query.index, w = v.multiEntry, T = a.query.range, x = d.schema.primaryKey.extractKey, k = v.extractKey, S = (v.lowLevelIndex || v).extractKey, (d = u.reduce(function(N, _) {
        var A = N, R = [];
        if (_.type === "add" || _.type === "put") for (var M = new Ve(), D = _.values.length - 1; 0 <= D; --D) {
          var U, G = _.values[D], W = x(G);
          !M.hasKey(W) && (U = k(G), w && l(U) ? U.some(function(ne) {
            return Fi(ne, T);
          }) : Fi(U, T)) && (M.addKey(W), R.push(G));
        }
        switch (_.type) {
          case "add":
            var Z = new Ve().addKeys(a.values ? N.map(function(z) {
              return x(z);
            }) : N), A = N.concat(a.values ? R.filter(function(z) {
              return z = x(z), !Z.hasKey(z) && (Z.addKey(z), !0);
            }) : R.map(function(z) {
              return x(z);
            }).filter(function(z) {
              return !Z.hasKey(z) && (Z.addKey(z), !0);
            }));
            break;
          case "put":
            var X = new Ve().addKeys(_.values.map(function(z) {
              return x(z);
            }));
            A = N.filter(function(z) {
              return !X.hasKey(a.values ? x(z) : z);
            }).concat(a.values ? R : R.map(function(z) {
              return x(z);
            }));
            break;
          case "delete":
            var te = new Ve().addKeys(_.keys);
            A = N.filter(function(z) {
              return !te.hasKey(a.values ? x(z) : z);
            });
            break;
          case "deleteRange":
            var Q = _.range;
            A = N.filter(function(z) {
              return !Fi(x(z), Q);
            });
        }
        return A;
      }, i)) === i) ? i : (C = function(N, _) {
        return ye(S(N), S(_)) || ye(x(N), x(_));
      }, d.sort(a.direction === "prev" || a.direction === "prevunique" ? function(N, _) {
        return C(_, N);
      } : C), a.limit && a.limit < 1 / 0 && (d.length > a.limit ? d.length = a.limit : i.length === a.limit && d.length < a.limit && (p.dirty = !0)), y ? Object.freeze(d) : d);
    }
    function Us(i, a) {
      return ye(i.lower, a.lower) === 0 && ye(i.upper, a.upper) === 0 && !!i.lowerOpen == !!a.lowerOpen && !!i.upperOpen == !!a.upperOpen;
    }
    function Bu(i, a) {
      return ((u, d, p, y) => {
        if (u === void 0) return d !== void 0 ? -1 : 0;
        if (d === void 0) return 1;
        if ((u = ye(u, d)) === 0) {
          if (p && y) return 0;
          if (p) return 1;
          if (y) return -1;
        }
        return u;
      })(i.lower, a.lower, i.lowerOpen, a.lowerOpen) <= 0 && 0 <= ((u, d, p, y) => {
        if (u === void 0) return d !== void 0 ? 1 : 0;
        if (d === void 0) return -1;
        if ((u = ye(u, d)) === 0) {
          if (p && y) return 0;
          if (p) return -1;
          if (y) return 1;
        }
        return u;
      })(i.upper, a.upper, i.upperOpen, a.upperOpen);
    }
    function ju(i, a, u, d) {
      i.subscribers.add(u), d.addEventListener("abort", function() {
        var p, y;
        i.subscribers.delete(u), i.subscribers.size === 0 && (p = i, y = a, setTimeout(function() {
          p.subscribers.size === 0 && xe(y, p);
        }, 3e3));
      });
    }
    var Fu = { stack: "dbcore", level: 0, name: "Cache", create: function(i) {
      var a = i.schema.name;
      return r(r({}, i), { transaction: function(u, d, p) {
        var y, v, w = i.transaction(u, d, p);
        return d === "readwrite" && (p = (y = new AbortController()).signal, w.addEventListener("abort", (v = function(T) {
          return function() {
            if (y.abort(), d === "readwrite") {
              for (var x = /* @__PURE__ */ new Set(), k = 0, S = u; k < S.length; k++) {
                var C = S[k], N = Vt["idb://".concat(a, "/").concat(C)];
                if (N) {
                  var _ = i.table(C), A = N.optimisticOps.filter(function(z) {
                    return z.trans === w;
                  });
                  if (w._explicit && T && w.mutatedParts) for (var R = 0, M = Object.values(N.queries.query); R < M.length; R++) for (var D = 0, U = (Z = M[R]).slice(); D < U.length; D++) Li((X = U[D]).obsSet, w.mutatedParts) && (xe(Z, X), X.subscribers.forEach(function(z) {
                    return x.add(z);
                  }));
                  else if (0 < A.length) {
                    N.optimisticOps = N.optimisticOps.filter(function(z) {
                      return z.trans !== w;
                    });
                    for (var G = 0, W = Object.values(N.queries.query); G < W.length; G++) for (var Z, X, te, Q = 0, ne = (Z = W[G]).slice(); Q < ne.length; Q++) (X = ne[Q]).res != null && w.mutatedParts && (T && !X.dirty ? (te = Object.isFrozen(X.res), te = qs(X.res, X.req, A, _, X, te), X.dirty ? (xe(Z, X), X.subscribers.forEach(function(z) {
                      return x.add(z);
                    })) : te !== X.res && (X.res = te, X.promise = ee.resolve({ result: te }))) : (X.dirty && xe(Z, X), X.subscribers.forEach(function(z) {
                      return x.add(z);
                    })));
                  }
                }
              }
              x.forEach(function(z) {
                return z();
              });
            }
          };
        })(!1), { signal: p }), w.addEventListener("error", v(!1), { signal: p }), w.addEventListener("complete", v(!0), { signal: p })), w;
      }, table: function(u) {
        var d = i.table(u), p = d.schema.primaryKey;
        return r(r({}, d), { mutate: function(y) {
          var v, w = ie.trans;
          return !p.outbound && w.db._options.cache !== "disabled" && !w.explicit && w.idbtrans.mode === "readwrite" && (v = Vt["idb://".concat(a, "/").concat(u)]) ? (w = d.mutate(y), y.type !== "add" && y.type !== "put" || !(50 <= y.values.length || ji(p, y).some(function(T) {
            return T == null;
          })) ? (v.optimisticOps.push(y), y.mutatedParts && kr(y.mutatedParts), w.then(function(T) {
            0 < T.numFailures && (xe(v.optimisticOps, y), (T = Vs(0, y, T)) && v.optimisticOps.push(T), y.mutatedParts) && kr(y.mutatedParts);
          }), w.catch(function() {
            xe(v.optimisticOps, y), y.mutatedParts && kr(y.mutatedParts);
          })) : w.then(function(T) {
            var x = Vs(0, r(r({}, y), { values: y.values.map(function(k, S) {
              var C;
              return T.failures[S] ? k : (Y(C = (C = p.keyPath) != null && C.includes(".") ? fe(k) : r({}, k), p.keyPath, T.results[S]), C);
            }) }), T);
            v.optimisticOps.push(x), queueMicrotask(function() {
              return y.mutatedParts && kr(y.mutatedParts);
            });
          }), w) : d.mutate(y);
        }, query: function(y) {
          var v, w, T, x, k, S, C;
          return Ls(ie, d) && Ms("query", y) ? (v = ((T = ie.trans) == null ? void 0 : T.db._options.cache) === "immutable", w = (T = ie).requery, T = T.signal, S = ((N, _, A, R) => {
            var M = Vt["idb://".concat(N, "/").concat(_)];
            if (!M) return [];
            if (!(N = M.queries[A])) return [null, !1, M, null];
            var D = N[(R.query ? R.query.index.name : null) || ""];
            if (!D) return [null, !1, M, null];
            switch (A) {
              case "query":
                var U = (G = R.direction) != null ? G : "next", G = D.find(function(W) {
                  var Z;
                  return W.req.limit === R.limit && W.req.values === R.values && ((Z = W.req.direction) != null ? Z : "next") === U && Us(W.req.query.range, R.query.range);
                });
                return G ? [G, !0, M, D] : [D.find(function(W) {
                  var Z;
                  return ("limit" in W.req ? W.req.limit : 1 / 0) >= R.limit && ((Z = W.req.direction) != null ? Z : "next") === U && (!R.values || W.req.values) && Bu(W.req.query.range, R.query.range);
                }), !1, M, D];
              case "count":
                return G = D.find(function(W) {
                  return Us(W.req.query.range, R.query.range);
                }), [G, !!G, M, D];
            }
          })(a, u, "query", y), C = S[0], x = S[2], k = S[3], C && S[1] ? C.obsSet = y.obsSet : (S = d.query(y).then(function(N) {
            var _ = N.result;
            if (C && (C.res = _), v) {
              for (var A = 0, R = _.length; A < R; ++A) Object.freeze(_[A]);
              Object.freeze(_);
            }
            return N;
          }).catch(function(N) {
            return k && C && xe(k, C), Promise.reject(N);
          }), C = { obsSet: y.obsSet, promise: S, subscribers: /* @__PURE__ */ new Set(), type: "query", req: y, dirty: !1 }, k ? k.push(C) : (k = [C], (x = x || (Vt["idb://".concat(a, "/").concat(u)] = { queries: { query: {}, count: {} }, objs: /* @__PURE__ */ new Map(), optimisticOps: [], unsignaledParts: {} })).queries.query[y.query.index.name || ""] = k)), ju(C, k, w, T), C.promise.then(function(N) {
            return N = qs(N.result, y, x == null ? void 0 : x.optimisticOps, d, C, v), { result: v ? N : fe(N) };
          })) : d.query(y);
        } });
      } });
    } };
    function _r(i, a) {
      return new Proxy(i, { get: function(u, d, p) {
        return d === "db" ? a : Reflect.get(u, d, p);
      } });
    }
    Ne.prototype.version = function(i) {
      if (isNaN(i) || i < 0.1) throw new se.Type("Given version is not a positive number");
      if (i = Math.round(10 * i) / 10, this.idbdb || this._state.isBeingOpened) throw new se.Schema("Cannot add version when database is open");
      this.verno = Math.max(this.verno, i);
      var a = this._versions, u = a.filter(function(d) {
        return d._cfg.version === i;
      })[0];
      return u || (u = new this.Version(i), a.push(u), a.sort(Pu), u.stores({}), this._state.autoSchema = !1), u;
    }, Ne.prototype._whenReady = function(i) {
      var a = this;
      return this.idbdb && (this._state.openComplete || ie.letThrough || this._vip) ? i() : new ee(function(u, d) {
        if (a._state.openComplete) return d(new se.DatabaseClosed(a._state.dbOpenError));
        if (!a._state.isBeingOpened) {
          if (!a._state.autoOpen) return void d(new se.DatabaseClosed());
          a.open().catch(Ie);
        }
        a._state.dbReadyPromise.then(u, d);
      }).then(i);
    }, Ne.prototype.use = function(p) {
      var a = p.stack, u = p.create, d = p.level, p = p.name, y = (p && this.unuse({ stack: a, name: p }), this._middlewares[a] || (this._middlewares[a] = []));
      return y.push({ stack: a, create: u, level: d ?? 10, name: p }), y.sort(function(v, w) {
        return v.level - w.level;
      }), this;
    }, Ne.prototype.unuse = function(i) {
      var a = i.stack, u = i.name, d = i.create;
      return a && this._middlewares[a] && (this._middlewares[a] = this._middlewares[a].filter(function(p) {
        return d ? p.create !== d : !!u && p.name !== u;
      })), this;
    }, Ne.prototype.open = function() {
      var i = this;
      return Dt(mt, function() {
        return Lu(i);
      });
    }, Ne.prototype._close = function() {
      this.on.close.fire(new CustomEvent("close"));
      var i = this._state;
      if (xn.remove(this), this.idbdb) {
        try {
          this.idbdb.close();
        } catch {
        }
        this.idbdb = null;
      }
      i.isBeingOpened || (i.dbReadyPromise = new ee(function(a) {
        i.dbReadyResolve = a;
      }), i.openCanceller = new ee(function(a, u) {
        i.cancelOpen = u;
      }));
    }, Ne.prototype.close = function(a) {
      var a = (a === void 0 ? { disableAutoOpen: !0 } : a).disableAutoOpen, u = this._state;
      a ? (u.isBeingOpened && u.cancelOpen(new se.DatabaseClosed()), this._close(), u.autoOpen = !1, u.dbOpenError = new se.DatabaseClosed()) : (this._close(), u.autoOpen = this._options.autoOpen || u.isBeingOpened, u.openComplete = !1, u.dbOpenError = null);
    }, Ne.prototype.delete = function(i) {
      var a = this, u = (i === void 0 && (i = { disableAutoOpen: !0 }), 0 < arguments.length && typeof arguments[0] != "object"), d = this._state;
      return new ee(function(p, y) {
        function v() {
          a.close(i);
          var w = a._deps.indexedDB.deleteDatabase(a.name);
          w.onsuccess = ke(function() {
            var T, x, k;
            T = a._deps, x = a.name, xi(k = T.indexedDB) || x === fr || Pi(k, T.IDBKeyRange).delete(x).catch(Ie), p();
          }), w.onerror = tt(y), w.onblocked = a._fireOnBlocked;
        }
        if (u) throw new se.InvalidArgument("Invalid closeOptions argument to db.delete()");
        d.isBeingOpened ? d.dbReadyPromise.then(v) : v();
      });
    }, Ne.prototype.backendDB = function() {
      return this.idbdb;
    }, Ne.prototype.isOpen = function() {
      return this.idbdb !== null;
    }, Ne.prototype.hasBeenClosed = function() {
      var i = this._state.dbOpenError;
      return i && i.name === "DatabaseClosed";
    }, Ne.prototype.hasFailed = function() {
      return this._state.dbOpenError !== null;
    }, Ne.prototype.dynamicallyOpened = function() {
      return this._state.autoSchema;
    }, Object.defineProperty(Ne.prototype, "tables", { get: function() {
      var i = this;
      return c(this._allTables).map(function(a) {
        return i._allTables[a];
      });
    }, enumerable: !1, configurable: !0 }), Ne.prototype.transaction = function() {
      var i = (function(a, u, d) {
        var p = arguments.length;
        if (p < 2) throw new se.InvalidArgument("Too few arguments");
        for (var y = new Array(p - 1); --p; ) y[p - 1] = arguments[p];
        return d = y.pop(), [a, J(y), d];
      }).apply(this, arguments);
      return this._transaction.apply(this, i);
    }, Ne.prototype._transaction = function(i, a, u) {
      var d, p, y = this, v = ie.trans, w = (v && v.db === this && i.indexOf("!") === -1 || (v = null), i.indexOf("?") !== -1);
      i = i.replace("!", "").replace("?", "");
      try {
        if (p = a.map(function(x) {
          if (x = x instanceof y.Table ? x.name : x, typeof x != "string") throw new TypeError("Invalid table argument to Dexie.transaction(). Only Table or String are allowed");
          return x;
        }), i == "r" || i === Ii) d = Ii;
        else {
          if (i != "rw" && i != Ei) throw new se.InvalidArgument("Invalid transaction mode: " + i);
          d = Ei;
        }
        if (v) {
          if (v.mode === Ii && d === Ei) {
            if (!w) throw new se.SubTransaction("Cannot enter a sub-transaction with READWRITE mode when parent transaction is READONLY");
            v = null;
          }
          v && p.forEach(function(x) {
            if (v && v.storeNames.indexOf(x) === -1) {
              if (!w) throw new se.SubTransaction("Table " + x + " not included in parent transaction.");
              v = null;
            }
          }), w && v && !v.active && (v = null);
        }
      } catch (x) {
        return v ? v._promise(null, function(k, S) {
          S(x);
        }) : Re(x);
      }
      var T = (function x(k, S, C, N, _) {
        return ee.resolve().then(function() {
          var D = ie.transless || ie, A = k._createTransaction(S, C, k._dbSchema, N), D = (A.explicit = !0, { trans: A, transless: D });
          if (N) A.idbtrans = N.idbtrans;
          else try {
            A.create(), A.idbtrans._explicit = !0, k._state.PR1398_maxLoop = 3;
          } catch (U) {
            return U.name === di.InvalidState && k.isOpen() && 0 < --k._state.PR1398_maxLoop ? (console.warn("Dexie: Need to reopen db"), k.close({ disableAutoOpen: !1 }), k.open().then(function() {
              return x(k, S, C, null, _);
            })) : Re(U);
          }
          var R, M = li(_), D = (M && Jt(), ee.follow(function() {
            var U;
            (R = _.call(A, A)) && (M ? (U = St.bind(null, null), R.then(U, U)) : typeof R.next == "function" && typeof R.throw == "function" && (R = Ui(R)));
          }, D));
          return (R && typeof R.then == "function" ? ee.resolve(R).then(function(U) {
            return A.active ? U : Re(new se.PrematureCommit("Transaction committed too early. See http://bit.ly/2kdckMn"));
          }) : D.then(function() {
            return R;
          })).then(function(U) {
            return N && A._resolve(), A._completion.then(function() {
              return U;
            });
          }).catch(function(U) {
            return A._reject(U), Re(U);
          });
        });
      }).bind(null, this, d, p, v, u);
      return v ? v._promise(d, T, "lock") : ie.trans ? Dt(ie.transless, function() {
        return y._whenReady(T);
      }) : this._whenReady(T);
    }, Ne.prototype.table = function(i) {
      if (g(this._allTables, i)) return this._allTables[i];
      throw new se.InvalidTable("Table ".concat(i, " does not exist"));
    };
    var yt = Ne;
    function Ne(i, a) {
      var u, d, p, y, v, w = this, T = (this._middlewares = {}, this.verno = 0, Ne.dependencies), T = (this._options = a = r({ addons: Ne.addons, autoOpen: !0, indexedDB: T.indexedDB, IDBKeyRange: T.IDBKeyRange, cache: "cloned", maxConnections: 1e3 }, a), this._deps = { indexedDB: a.indexedDB, IDBKeyRange: a.IDBKeyRange }, a.addons), x = (this._dbSchema = {}, this._versions = [], this._storeNames = [], this._allTables = {}, this.idbdb = null, this._novip = this, { dbOpenError: null, isBeingOpened: !1, onReadyBeingFired: null, openComplete: !1, dbReadyResolve: Ie, dbReadyPromise: null, cancelOpen: Ie, openCanceller: null, autoSchema: !0, PR1398_maxLoop: 3, autoOpen: a.autoOpen }), k = (x.dbReadyPromise = new ee(function(S) {
        x.dbReadyResolve = S;
      }), x.openCanceller = new ee(function(S, C) {
        x.cancelOpen = C;
      }), this._state = x, this.name = i, this.on = _n(this, "populate", "blocked", "versionchange", "close", { ready: [fi, Ie] }), this.once = function(S, C) {
        var N = function() {
          for (var _ = [], A = 0; A < arguments.length; A++) _[A] = arguments[A];
          w.on(S).unsubscribe(N), C.apply(w, _);
        };
        return w.on(S, N);
      }, this.on.ready.subscribe = j(this.on.ready.subscribe, function(S) {
        return function(C, N) {
          Ne.vip(function() {
            var _, A = w._state;
            A.openComplete ? (A.dbOpenError || ee.resolve().then(C), N && S(C)) : A.onReadyBeingFired ? (A.onReadyBeingFired.push(C), N && S(C)) : (S(C), _ = w, N || S(function R() {
              _.on.ready.unsubscribe(C), _.on.ready.unsubscribe(R);
            }));
          });
        };
      }), this.Collection = (u = this, Rn(Cu.prototype, function(R, A) {
        this.db = u;
        var N = ms, _ = null;
        if (A) try {
          N = A();
        } catch (D) {
          _ = D;
        }
        var A = R._ctx, R = A.table, M = R.hook.reading.fire;
        this._ctx = { table: R, index: A.index, isPrimKey: !A.index || R.schema.primKey.keyPath && A.index === R.schema.primKey.name, range: N, keysOnly: !1, dir: "next", unique: "", algorithm: null, filter: null, replayFilter: null, justLimit: !0, isMatch: null, offset: 0, limit: 1 / 0, error: _, or: A.or, valueMapper: M !== En ? M : null };
      })), this.Table = (d = this, Rn(Is.prototype, function(S, C, N) {
        this.db = d, this._tx = N, this.name = S, this.schema = C, this.hook = d._allTables[S] ? d._allTables[S].hook : _n(null, { creating: [gu, Ie], reading: [mu, En], updating: [vu, Ie], deleting: [yu, Ie] });
      })), this.Transaction = (p = this, Rn(_u.prototype, function(S, C, N, _, A) {
        var R = this;
        S !== "readonly" && C.forEach(function(M) {
          M = (M = N[M]) == null ? void 0 : M.yProps, M && (C = C.concat(M.map(function(D) {
            return D.updatesTable;
          })));
        }), this.db = p, this.mode = S, this.storeNames = C, this.schema = N, this.chromeTransactionDurability = _, this.idbtrans = null, this.on = _n(this, "complete", "error", "abort"), this.parent = A || null, this.active = !0, this._reculock = 0, this._blockedFuncs = [], this._resolve = null, this._reject = null, this._waitingFor = null, this._waitingQueue = null, this._spinCount = 0, this._completion = new ee(function(M, D) {
          R._resolve = M, R._reject = D;
        }), this._completion.then(function() {
          R.active = !1, R.on.complete.fire();
        }, function(M) {
          var D = R.active;
          return R.active = !1, R.on.error.fire(M), R.parent ? R.parent._reject(M) : D && R.idbtrans && R.idbtrans.abort(), Re(M);
        });
      })), this.Version = (y = this, Rn(Du.prototype, function(S) {
        this.db = y, this._cfg = { version: S, storesSource: null, dbschema: {}, tables: {}, contentUpgrade: null };
      })), this.WhereClause = (v = this, Rn(ks.prototype, function(S, C, N) {
        if (this.db = v, this._ctx = { table: S, index: C === ":id" ? null : C, or: N }, this._cmp = this._ascending = ye, this._descending = function(_, A) {
          return ye(A, _);
        }, this._max = function(_, A) {
          return 0 < ye(_, A) ? _ : A;
        }, this._min = function(_, A) {
          return ye(_, A) < 0 ? _ : A;
        }, this._IDBKeyRange = v._deps.IDBKeyRange, !this._IDBKeyRange) throw new se.MissingAPI();
      })), this.on("versionchange", function(S) {
        0 < S.newVersion ? console.warn("Another connection wants to upgrade database '".concat(w.name, "'. Closing db now to resume the upgrade.")) : console.warn("Another connection wants to delete database '".concat(w.name, "'. Closing db now to resume the delete request.")), w.close({ disableAutoOpen: !1 });
      }), this.on("blocked", function(S) {
        !S.newVersion || S.newVersion < S.oldVersion ? console.warn("Dexie.delete('".concat(w.name, "') was blocked")) : console.warn("Upgrade '".concat(w.name, "' blocked by other connection holding version ").concat(S.oldVersion / 10));
      }), this._maxKey = On(a.IDBKeyRange), this._createTransaction = function(S, C, N, _) {
        return new w.Transaction(S, C, N, w._options.chromeTransactionDurability, _);
      }, this._fireOnBlocked = function(S) {
        w.on("blocked").fire(S), xn.toArray().filter(function(C) {
          return C.name === w.name && C !== w && !C._state.vcFired;
        }).map(function(C) {
          return C.on("versionchange").fire(S);
        });
      }, this.use(qu), this.use(Fu), this.use(Uu), this.use(Mu), this.use(Vu), new Proxy(this, { get: function(S, C, N) {
        var _;
        return C === "_vip" || (C === "table" ? function(A) {
          return _r(w.table(A), k);
        } : (_ = Reflect.get(S, C, N)) instanceof Is ? _r(_, k) : C === "tables" ? _.map(function(A) {
          return _r(A, k);
        }) : C === "_createTransaction" ? function() {
          return _r(_.apply(this, arguments), k);
        } : _);
      } }));
      this.vip = k, T.forEach(function(S) {
        return S(w);
      });
    }
    var Rr, rn = typeof Symbol < "u" && "observable" in Symbol ? Symbol.observable : "@@observable", Ku = (Ki.prototype.subscribe = function(i, a, u) {
      return this._subscribe(i && typeof i != "function" ? i : { next: i, error: a, complete: u });
    }, Ki.prototype[rn] = function() {
      return this;
    }, Ki);
    function Ki(i) {
      this._subscribe = i;
    }
    try {
      Rr = { indexedDB: s.indexedDB || s.mozIndexedDB || s.webkitIndexedDB || s.msIndexedDB, IDBKeyRange: s.IDBKeyRange || s.webkitIDBKeyRange };
    } catch {
      Rr = { indexedDB: null, IDBKeyRange: null };
    }
    function Bs(i) {
      var a, u = !1, d = new Ku(function(p) {
        var y = li(i), v, w = !1, T = {}, x = {}, k = { get closed() {
          return w;
        }, unsubscribe: function() {
          w || (w = !0, v && v.abort(), S && kt.storagemutated.unsubscribe(_));
        } }, S = (p.start && p.start(k), !1), C = function() {
          return bi(A);
        };
        function N() {
          return Li(x, T);
        }
        var _ = function(R) {
          Cr(T, R), N() && C();
        }, A = function() {
          var R, M, D;
          !w && Rr.indexedDB && (T = {}, R = {}, v && v.abort(), v = new AbortController(), D = ((U) => {
            var G = Qt();
            try {
              y && Jt();
              var W = Et(i, U);
              return W = y ? W.finally(St) : W;
            } finally {
              G && Zt();
            }
          })(M = { subscr: R, signal: v.signal, requery: C, querier: i, trans: null }), S || (kt.storagemutated.subscribe(_), S = !0), Promise.resolve(D).then(function(U) {
            u = !0, a = U, w || M.signal.aborted || (N() || (x = R, N()) ? C() : (T = {}, bi(function() {
              return !w && p.next && p.next(U);
            })));
          }, function(U) {
            u = !1, ["DatabaseClosedError", "AbortError"].includes(U == null ? void 0 : U.name) || w || bi(function() {
              w || p.error && p.error(U);
            });
          }));
        };
        return setTimeout(C, 0), k;
      });
      return d.hasValue = function() {
        return u;
      }, d.getValue = function() {
        return a;
      }, d;
    }
    var qt = yt;
    function Gi(i) {
      var a = At;
      try {
        At = !0, kt.storagemutated.fire(i), qi(i, !0);
      } finally {
        At = a;
      }
    }
    I(qt, r(r({}, ht), { delete: function(i) {
      return new qt(i, { addons: [] }).delete();
    }, exists: function(i) {
      return new qt(i, { addons: [] }).open().then(function(a) {
        return a.close(), !0;
      }).catch("NoSuchDatabaseError", function() {
        return !1;
      });
    }, getDatabaseNames: function(i) {
      try {
        return a = qt.dependencies, u = a.indexedDB, a = a.IDBKeyRange, (xi(u) ? Promise.resolve(u.databases()).then(function(d) {
          return d.map(function(p) {
            return p.name;
          }).filter(function(p) {
            return p !== fr;
          });
        }) : Pi(u, a).toCollection().primaryKeys()).then(i);
      } catch {
        return Re(new se.MissingAPI());
      }
      var a, u;
    }, defineClass: function() {
      return function(i) {
        f(this, i);
      };
    }, ignoreTransaction: function(i) {
      return ie.trans ? Dt(ie.transless || mt, i) : i();
    }, vip: $i, async: function(i) {
      return function() {
        try {
          var a = Ui(i.apply(this, arguments));
          return a && typeof a.then == "function" ? a : ee.resolve(a);
        } catch (u) {
          return Re(u);
        }
      };
    }, spawn: function(i, a, u) {
      try {
        var d = Ui(i.apply(u, a || []));
        return d && typeof d.then == "function" ? d : ee.resolve(d);
      } catch (p) {
        return Re(p);
      }
    }, currentTransaction: { get: function() {
      return ie.trans || null;
    } }, waitFor: function(i, a) {
      return i = ee.resolve(typeof i == "function" ? qt.ignoreTransaction(i) : i).timeout(a || 6e4), ie.trans ? ie.trans.waitFor(i) : i;
    }, Promise: ee, debug: { get: function() {
      return at;
    }, set: function(i) {
      cs(i);
    } }, derive: q, extend: f, props: I, override: j, Events: _n, on: kt, liveQuery: Bs, extendObservabilitySet: Cr, getByKeyPath: L, setByKeyPath: Y, delByKeyPath: function(i, a) {
      typeof a == "string" ? Y(i, a, void 0) : "length" in a && [].map.call(a, function(u) {
        Y(i, u, void 0);
      });
    }, shallowClone: K, deepClone: fe, getObjectDiff: Bi, cmp: ye, asap: P, minKey: -1 / 0, addons: [], connections: { get: xn.toArray }, errnames: di, dependencies: Rr, cache: Vt, semVer: "4.4.4", version: "4.4.4".split(".").map(function(i) {
      return parseInt(i);
    }).reduce(function(i, a, u) {
      return i + a / Math.pow(10, 2 * u);
    }) })), qt.maxKey = On(qt.dependencies.IDBKeyRange), typeof dispatchEvent < "u" && typeof addEventListener < "u" && (kt(vr, function(i) {
      At || (i = new CustomEvent(Ci, { detail: i }), At = !0, dispatchEvent(i), At = !1);
    }), addEventListener(Ci, function(i) {
      i = i.detail, At || Gi(i);
    }));
    var on, At = !1, js = function() {
    };
    return typeof BroadcastChannel < "u" && ((js = function() {
      (on = new BroadcastChannel(Ci)).onmessage = function(i) {
        return i.data && Gi(i.data);
      };
    })(), typeof on.unref == "function" && on.unref(), kt(vr, function(i) {
      At || on.postMessage(i);
    })), typeof addEventListener < "u" && (addEventListener("pagehide", function(i) {
      if (!yt.disableBfCache && i.persisted) {
        at && console.debug("Dexie: handling persisted pagehide"), on != null && on.close();
        for (var a = 0, u = xn.toArray(); a < u.length; a++) u[a].close({ disableAutoOpen: !1 });
      }
    }), addEventListener("pageshow", function(i) {
      !yt.disableBfCache && i.persisted && (at && console.debug("Dexie: handling persisted pageshow"), js(), Gi({ all: new Ve(-1 / 0, [[]]) }));
    })), ee.rejectionMapper = function(i, a) {
      return !i || i instanceof Yt || i instanceof TypeError || i instanceof SyntaxError || !i.name || !as[i.name] ? i : (a = new as[i.name](a || i.message, i), "stack" in i && O(a, "stack", { get: function() {
        return this.inner.stack;
      } }), a);
    }, cs(at), r(yt, Object.freeze({ __proto__: null, DEFAULT_MAX_CONNECTIONS: 1e3, Dexie: yt, Entity: gs, PropModification: An, RangeSet: Ve, add: function(i) {
      return new An({ add: i });
    }, cmp: ye, default: yt, liveQuery: Bs, mergeRanges: Dn, rangesOverlap: Os, remove: function(i) {
      return new An({ remove: i });
    }, replacePrefix: function(i, a) {
      return new An({ replacePrefix: [i, a] });
    } }), { default: yt }), yt;
  });
})(Nc);
var Ah = Nc.exports;
const wo = /* @__PURE__ */ kh(Ah), ha = Symbol.for("Dexie"), Wt = globalThis[ha] || (globalThis[ha] = wo);
if (wo.semVer !== Wt.semVer)
  throw new Error(`Two different versions of Dexie loaded in the same app: ${wo.semVer} and ${Wt.semVer}`);
const {
  liveQuery: aw,
  mergeRanges: cw,
  rangesOverlap: uw,
  RangeSet: lw,
  cmp: dw,
  Entity: fw,
  PropModification: pw,
  replacePrefix: hw,
  add: mw,
  remove: gw,
  DexieYProvider: yw
} = Wt, _h = "cmdrunner_knowledge";
class Rh extends Wt {
  constructor() {
    super(_h);
    B(this, "applications");
    B(this, "knowledgeEntities");
    B(this, "knowledgeViews");
    B(this, "knowledgeViewTransitions");
    B(this, "knowledgeCollections");
    B(this, "knowledgeCounters");
    B(this, "knowledgeNotifications");
    B(this, "knowledgeOutcomes");
    B(this, "knowledgeStateTransitions");
    B(this, "knowledgeRecordedWorkflows");
    B(this, "knowledgeBehaviorSessions");
    B(this, "knowledgeEpisodes");
    B(this, "knowledgeEdges");
    B(this, "knowledgeGaps");
    B(this, "knowledgeSignatures");
    this.version(1).stores({
      applications: "appId, origin",
      knowledgeEntities: "key, appId, [appId+type], lastSeenAt",
      knowledgeViews: "key, appId, [appId+lastSeenAt]",
      knowledgeViewTransitions: "key, appId, lastSeenAt",
      knowledgeCollections: "key, appId, [appId+entityType]",
      knowledgeCounters: "key, appId",
      knowledgeNotifications: "key, appId, [appId+severity]",
      knowledgeOutcomes: "key, appId, [appId+outcome]",
      knowledgeStateTransitions: "key, appId, sessionId"
    }), this.version(2).stores({
      knowledgeRecordedWorkflows: "key, appId, patternId, lastSeenAt"
    }), this.version(3).stores({
      // sessionId indexed for deleteBySession cascade lookups.
      knowledgeBehaviorSessions: "key, appId, sessionId, [appId+seq]",
      knowledgeEpisodes: "key, appId, [appId+sessionId], [appId+signatureKey]",
      knowledgeEdges: "key, appId, [appId+sessionId], [appId+tier], [appId+signatureKey]",
      knowledgeGaps: "key, appId, [appId+sessionId], [appId+reason]",
      knowledgeSignatures: "key, appId, [appId+actionType], [appId+status], lastSeenAtSession"
    });
  }
}
function Nh() {
  return new Rh();
}
const ma = 100, ga = 500, ya = 500, Oh = 50, va = 48, wa = 5, Oc = 10, Ph = 3;
function to(t, e) {
  const n = Math.min(t / 5, 1), r = e === 0 ? 1 : Math.max(1 - 0.15 * e, 0.1);
  return xh((n + r) / 2);
}
function xh(t) {
  return Math.round(t * 1e3) / 1e3;
}
function ba(t) {
  return t >= Ph ? "diverged" : t > 0 ? "stale" : "active";
}
function $h(t, e) {
  if (t.some((r) => r.sessionId === e.sessionId))
    return t;
  const n = [...t, e];
  return n.length > wa ? n.slice(n.length - wa) : n;
}
function Ia(t, e, n, r, o) {
  const s = new Map(t.map((g) => [g.identity, g])), c = [], l = /* @__PURE__ */ new Set();
  for (const g of e)
    l.has(g.identity) || (l.add(g.identity), c.push(g));
  const f = new Set(c.map((g) => g.identity)), h = t.map((g) => {
    if (!f.has(g.identity)) {
      if (!o) return g;
      const q = g.missedObservations + 1;
      return {
        ...g,
        missedObservations: q,
        confidence: to(g.hitCount, q),
        status: ba(q)
      };
    }
    const b = g.lastSeenAtSession === n, O = 0;
    return {
      ...g,
      occurrenceCount: g.occurrenceCount + 1,
      hitCount: b ? g.hitCount : g.hitCount + 1,
      missedObservations: O,
      firstSeenAtSession: g.firstSeenAtSession,
      lastSeenAtSession: n,
      lastSeenSeq: r,
      confidence: to(
        b ? g.hitCount : g.hitCount + 1,
        O
      ),
      status: ba(O),
      // observedVia: keep first observation (stable provenance label)
      evidenceSamples: $h(g.evidenceSamples, m(g.identity))
    };
  });
  for (const g of c)
    s.has(g.identity) || h.push({
      identity: g.identity,
      tier: g.tier,
      kind: g.kind,
      targetIdentity: g.targetIdentity,
      occurrenceCount: 1,
      hitCount: 1,
      missedObservations: 0,
      firstSeenAtSession: n,
      lastSeenAtSession: n,
      lastSeenSeq: r,
      confidence: to(1, 0),
      status: "active",
      evidenceSamples: [{ sessionId: n, edgeKey: g.edgeKey }],
      observedVia: g.observedVia
    });
  return h;
  function m(g) {
    const I = c.find((b) => b.identity === g);
    return { sessionId: n, edgeKey: (I == null ? void 0 : I.edgeKey) ?? "" };
  }
}
function Dh(t) {
  if (t.length <= va) return t;
  const e = t.filter(
    (s) => s.status === "diverged" || s.status === "stale"
  ), n = t.filter((s) => s.status === "active").sort(
    (s, c) => c.occurrenceCount - s.occurrenceCount || (s.identity < c.identity ? -1 : 1)
  ), r = Math.max(0, va - e.length), o = new Set(
    n.slice(r).map((s) => s.identity)
  );
  return t.filter(
    (s) => !o.has(s.identity) || s.status !== "active"
  );
}
function Lh(t, e) {
  if (!t)
    return {
      key: e.key,
      appId: e.appId,
      actionType: e.actionType,
      normalizedTarget: e.normalizedTarget,
      anchorViewId: e.anchorViewId,
      firstSeenAtSession: e.sessionId,
      lastSeenAtSession: e.sessionId,
      firstSeenSeq: e.sessionSeq,
      lastSeenSeq: e.sessionSeq,
      firstSeenAtMs: e.generatedAtMs,
      lastSeenAtMs: e.generatedAtMs,
      occurrenceCount: 1,
      sessionsSinceSeen: 0,
      status: "active",
      source: "behavior",
      consequenceProfile: Ia(
        [],
        e.consequences,
        e.sessionId,
        e.sessionSeq,
        !0
      ),
      divergenceFlags: []
    };
  const n = t.lastSeenAtSession !== e.sessionId, r = Ia(
    t.consequenceProfile,
    e.consequences,
    e.sessionId,
    e.sessionSeq,
    n
  );
  return {
    ...t,
    lastSeenSeq: e.sessionSeq,
    lastSeenAtMs: e.generatedAtMs,
    lastSeenAtSession: e.sessionId,
    occurrenceCount: n ? t.occurrenceCount + 1 : t.occurrenceCount,
    sessionsSinceSeen: 0,
    status: "active",
    consequenceProfile: Dh(r),
    divergenceFlags: r.filter((o) => o.status === "diverged").map((o) => o.identity)
  };
}
const Mh = [
  {
    intent: "Add to cart",
    matchers: [
      { field: "label", pattern: "add\\s*(to)?\\s*cart" },
      { field: "label", pattern: "\\badd\\b.*\\bcart\\b" },
      { field: "className", pattern: "\\b(add|cart)\\b" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Remove from cart",
    matchers: [
      { field: "label", pattern: "remove\\s*(from)?\\s*cart" },
      { field: "label", pattern: "\\bremove\\b.*\\bcart\\b" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Proceed to checkout",
    matchers: [
      { field: "label", pattern: "checkout" },
      { field: "label", pattern: "proceed\\s*to\\s*(checkout|payment)" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Search products",
    matchers: [
      { field: "label", pattern: "search" },
      { field: "className", pattern: "\\bsearch\\b" }
    ],
    baseConfidence: 0.8
  },
  {
    intent: "Apply coupon",
    matchers: [
      { field: "label", pattern: "(apply|redeem)\\s*(coupon|code|promo)" },
      { field: "label", pattern: "coupon" }
    ],
    baseConfidence: 0.75
  }
], Vh = [
  {
    intent: "Sign in",
    matchers: [
      { field: "label", pattern: "(sign|log)\\s*in" },
      { field: "label", pattern: "login" }
    ],
    baseConfidence: 0.9
  },
  {
    intent: "Sign out",
    matchers: [
      { field: "label", pattern: "(sign|log)\\s*out" },
      { field: "label", pattern: "logout" }
    ],
    baseConfidence: 0.9
  },
  {
    intent: "Register",
    matchers: [
      { field: "label", pattern: "(sign\\s*up|register|create\\s*account)" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Reset password",
    matchers: [
      { field: "label", pattern: "(forgot|reset)\\s*(password|pwd)" }
    ],
    baseConfidence: 0.85
  }
], qh = [
  {
    intent: "Submit form",
    matchers: [
      { field: "label", pattern: "(submit|save|continue|next)" }
    ],
    baseConfidence: 0.5
  },
  {
    intent: "Cancel",
    matchers: [
      { field: "label", pattern: "\\b(cancel|close|dismiss)\\b" }
    ],
    baseConfidence: 0.7
  },
  {
    intent: "Delete",
    matchers: [
      { field: "label", pattern: "\\b(delete|remove|trash)\\b" }
    ],
    baseConfidence: 0.7
  },
  {
    intent: "Edit",
    matchers: [
      { field: "label", pattern: "\\b(edit|modify|update)\\b" }
    ],
    baseConfidence: 0.7
  },
  {
    intent: "Filter",
    matchers: [
      { field: "label", pattern: "\\b(filter|refine|narrow)\\b" },
      { field: "className", pattern: "\\bfilter\\b" }
    ],
    baseConfidence: 0.65
  },
  {
    intent: "Sort",
    matchers: [
      { field: "label", pattern: "\\b(sort|order\\s*by)\\b" }
    ],
    baseConfidence: 0.65
  },
  {
    intent: "Navigate",
    matchers: [
      { field: "tag", pattern: "^a$" }
    ],
    baseConfidence: 0.4
  },
  {
    intent: "Search",
    matchers: [
      { field: "inputType", pattern: "search" },
      { field: "label", pattern: "search" }
    ],
    baseConfidence: 0.8
  },
  {
    intent: "Expand/collapse",
    matchers: [
      { field: "label", pattern: "(expand|collapse|show\\s*more|show\\s*less)" },
      { field: "className", pattern: "(accordion|collaps|expand)" }
    ],
    baseConfidence: 0.6
  },
  {
    intent: "Toggle",
    matchers: [
      { field: "className", pattern: "(toggle|switch)" }
    ],
    baseConfidence: 0.6
  },
  {
    intent: "Refresh data",
    matchers: [
      { field: "label", pattern: "(refresh|reload)" }
    ],
    baseConfidence: 0.6
  }
];
function Uh() {
  return [
    ...Mh,
    ...Vh,
    ...qh
  ];
}
const Bh = /* @__PURE__ */ new Set([
  "Fetch data",
  "Submit form",
  "Update resource",
  "Delete resource"
]);
function jh(t, e, n) {
  if (e) {
    const s = Gh(t, e);
    if (s) return s;
  }
  const r = n ? zh(t, n) : null;
  if (r) return r;
  const o = Hh(t);
  return o || Wh(t);
}
function Fh(t, e, n) {
  const r = /* @__PURE__ */ new Map();
  for (const o of t) {
    const s = e.get(o.interactionId);
    r.set(o.interactionId, jh(o, s, n));
  }
  return r;
}
function Kh(t, e) {
  var r, o;
  const n = (o = (r = t.behavioralEvidence) == null ? void 0 : r.applicationEvidence) == null ? void 0 : o.navigation;
  if (!n || n.length === 0) return !1;
  for (const s of n)
    if (s.toUrl && e.includes(s.toUrl.toLowerCase()))
      return !0;
  return !1;
}
function Gh(t, e) {
  const n = e.supportingEvidence.find(
    (s) => s.kind === "api-operation" && !Kh(t, (s.detail ?? "").toLowerCase())
  );
  if (!n) return null;
  const r = n.detail.toLowerCase(), o = {
    post: "Submit form",
    put: "Update resource",
    patch: "Update resource",
    delete: "Delete resource",
    get: "Fetch data"
  };
  for (const [s, c] of Object.entries(o))
    if (r.includes(s))
      return {
        interactionId: t.interactionId,
        intent: c,
        resolutionPath: "api-operation",
        confidence: 0.75
      };
  return {
    interactionId: t.interactionId,
    intent: "Submit form",
    resolutionPath: "api-operation",
    confidence: 0.6
  };
}
function Hh(t) {
  const e = Uh(), n = t.trigger;
  for (const r of e)
    if (Pc(n, r))
      return {
        interactionId: t.interactionId,
        intent: r.intent,
        resolutionPath: "button-text",
        // vocabulary match is text-based
        confidence: r.baseConfidence
      };
  return null;
}
function zh(t, e) {
  const n = e.getAll(), r = t.trigger;
  for (const o of n)
    if (Pc(r, o))
      return {
        interactionId: t.interactionId,
        intent: o.intent,
        resolutionPath: "button-text",
        // domain vocabulary match (text-based)
        confidence: o.baseConfidence
      };
  return null;
}
function Wh(t) {
  const e = t.trigger.accessibleName ?? t.trigger.placeholder ?? t.trigger.ariaLabel ?? "";
  return {
    interactionId: t.interactionId,
    intent: e || t.type,
    resolutionPath: "context",
    confidence: 0.3
  };
}
function Pc(t, e) {
  for (const n of e.matchers) {
    const r = Yh(t, n.field);
    if (r !== null)
      try {
        if (new RegExp(n.pattern, "i").test(r)) return !0;
      } catch {
      }
  }
  return !1;
}
function Yh(t, e) {
  switch (e) {
    case "label":
      return t.accessibleName ?? "";
    case "className":
      return t.className;
    case "tag":
      return t.tag ?? "";
    case "inputType":
      return t.inputType;
    case "href":
      return t.href;
    default:
      return null;
  }
}
function bo(t) {
  const e = [];
  for (const n of t) {
    if (!n || Bh.has(n)) continue;
    let r = String(n).replace(/\s+/g, " ").trim().toLowerCase();
    if (r) {
      if (/^https?:\/\//i.test(r))
        try {
          const o = new URL(r);
          r = (o.pathname || "/") + (o.search || "");
        } catch {
        }
      e.length > 0 && e[e.length - 1] === r || e.push(r);
    }
  }
  return e;
}
function xc(t, e = [], n) {
  const r = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Map(), s = (c) => {
    if (!n) return [];
    const l = /* @__PURE__ */ new Set();
    for (const f of c) {
      const h = n.get(f);
      h && l.add(h);
    }
    return [...l].sort();
  };
  for (const c of e) {
    const l = Jr(c.canonicalSteps), f = r.get(l);
    if (f)
      f.sessionIds = [.../* @__PURE__ */ new Set([...f.sessionIds, ...c.sessionIds])], f.instances = Zh(f.instances, c.instances), f.occurrenceCount += c.occurrenceCount, no(o, l, [
        ...c.signatureIds ?? [],
        ...f.signatureIds ?? []
      ]), f.signatureIds = o.get(l) ?? [], f.linkageState = Dr(f.signatureIds), Qh(f, c.instanceSignatureIds ?? {});
    else {
      no(o, l, c.signatureIds ?? []);
      const h = [...c.instances];
      r.set(l, {
        ...c,
        patternId: l,
        // D7: store canonical identity steps (legacy rows re-canonicalize
        // here so re-persisted patterns converge on the canonical form).
        canonicalSteps: bo(c.canonicalSteps),
        instances: h,
        sessionIds: [...c.sessionIds],
        signatureIds: o.get(l) ?? [],
        linkageState: Dr(o.get(l) ?? []),
        // D6: exhaustive per-instance map over the prior's own instances
        // ([] = no signature keys recorded for that instance).
        instanceSignatureIds: Xh(c.instanceSignatureIds, h)
      });
    }
  }
  for (const c of t) {
    const l = Jr(c.stepIntents), f = s(c.stepIds), h = r.get(l);
    h ? (h.sessionIds.includes(c.sessionId) || h.sessionIds.push(c.sessionId), h.instances.push(c.workflowId), h.occurrenceCount++, no(o, l, f), h.signatureIds = o.get(l) ?? [], h.linkageState = Dr(h.signatureIds), h.instanceSignatureIds = {
      ...h.instanceSignatureIds ?? {},
      [c.workflowId]: f
    }) : (o.set(l, f), r.set(l, {
      patternId: l,
      label: c.label,
      // D7: persist the canonical identity sequence; raw session steps
      // stay untouched on the SemanticWorkflow itself (stepIntents).
      canonicalSteps: bo(c.stepIntents),
      viewSequence: [...c.viewIds],
      sessionIds: [c.sessionId],
      occurrenceCount: 1,
      instances: [c.workflowId],
      signatureIds: f,
      linkageState: Dr(f),
      instanceSignatureIds: { [c.workflowId]: f }
    }));
  }
  return [...r.values()].sort((c, l) => l.occurrenceCount - c.occurrenceCount);
}
function Dr(t) {
  return t.length > 0 ? "linked" : "linkage-pending";
}
function Xh(t, e) {
  const n = {};
  for (const r of e)
    n[r] = [...new Set((t == null ? void 0 : t[r]) ?? [])].sort();
  return n;
}
function no(t, e, n) {
  const r = t.get(e) ?? [];
  t.set(e, [.../* @__PURE__ */ new Set([...r, ...n])].sort());
}
function Qh(t, e) {
  const n = { ...t.instanceSignatureIds ?? {} };
  for (const [r, o] of Object.entries(e)) {
    const s = n[r] ?? [];
    n[r] = [.../* @__PURE__ */ new Set([...s, ...o])].sort();
  }
  t.instanceSignatureIds = n;
}
function Zh(t, e) {
  const n = /* @__PURE__ */ new Set(), r = [];
  for (const o of [...t, ...e])
    n.has(o) || (n.add(o), r.push(o));
  return r.slice(-50);
}
function Jh(t) {
  return t.filter((e) => e.occurrenceCount >= 2);
}
function Jr(t) {
  const e = bo(t).join("→");
  let n = 5381;
  for (let r = 0; r < e.length; r++)
    n = (n << 5) + n + e.charCodeAt(r), n = n & 4294967295;
  return `wf-pattern-${(n >>> 0).toString(16)}`;
}
function em(...t) {
  return t.join(":");
}
const ri = class ri {
  constructor(e) {
    this.db = e;
  }
  // -- Applications --
  /**
   * Upsert application. Session-guarded: re-persist of the SAME session
   * does not increment sessionCount.
   */
  async upsertApplication(e) {
    const n = await this.db.applications.get(e.appId);
    if (n) {
      const r = n.lastSessionId === e.lastSessionId;
      await this.db.applications.put({
        ...n,
        lastActiveAt: e.lastActiveAt,
        lastSessionId: e.lastSessionId,
        sessionCount: r ? n.sessionCount : n.sessionCount + 1
      });
    } else
      await this.db.applications.put({
        ...e,
        sessionCount: 1
      });
  }
  async getApplication(e) {
    return this.db.applications.get(e);
  }
  /**
   * CP8 — list all known applications (contract app discovery).
   * Deterministic order: appId asc. Additive read-only method.
   */
  async listApplications() {
    return (await this.db.applications.toArray()).sort((n, r) => n.appId < r.appId ? -1 : 1);
  }
  async getApplicationByOrigin(e) {
    return this.db.applications.where("origin").equals(e).first();
  }
  // -- Entities --
  /**
   * Upsert entity: merge attributes, bump revision, update lastSeenAt.
   * Session-guarded: re-persist of the SAME session never re-merges.
   */
  async upsertEntity(e) {
    const n = await this.db.knowledgeEntities.get(e.key);
    if (n) {
      const r = n.lastSessionId === e.lastSessionId;
      await this.db.knowledgeEntities.put({
        ...n,
        attributes: r ? n.attributes : { ...n.attributes, ...e.attributes },
        lastSeenAt: r ? n.lastSeenAt : e.lastSeenAt,
        lastSessionId: e.lastSessionId,
        revision: r ? n.revision : n.revision + 1,
        // M9.9: carry through lifecycle state from the new observation.
        // When sameSession, keep the existing state (already current for this session).
        // Otherwise take the new entity's state if provided.
        currentState: r ? n.currentState : e.currentState ?? n.currentState,
        stateHistory: r ? n.stateHistory : tm(n.stateHistory, e.stateHistory),
        // D5: merge viewIds across sessions
        viewIds: r ? n.viewIds : nm(n.viewIds, e.viewIds)
      });
    } else
      await this.db.knowledgeEntities.put(e);
  }
  async getEntities(e) {
    return this.db.knowledgeEntities.where("appId").equals(e).toArray();
  }
  async getEntitiesByType(e, n) {
    return this.db.knowledgeEntities.where("[appId+type]").equals([e, n]).toArray();
  }
  // -- Views --
  async upsertView(e) {
    const n = await this.db.knowledgeViews.get(e.key);
    if (n) {
      const r = n.lastSessionId === e.lastSessionId;
      await this.db.knowledgeViews.put({
        ...n,
        visitCount: r ? n.visitCount : n.visitCount + 1,
        lastSeenAt: e.lastSeenAt,
        lastSessionId: e.lastSessionId
      });
    } else
      await this.db.knowledgeViews.put(e);
  }
  async getViews(e) {
    return this.db.knowledgeViews.where("appId").equals(e).toArray();
  }
  // -- View Transitions --
  async upsertViewTransition(e) {
    const n = await this.db.knowledgeViewTransitions.get(e.key);
    if (n) {
      const r = n.lastSessionId === e.lastSessionId;
      await this.db.knowledgeViewTransitions.put({
        ...n,
        count: r ? n.count : n.count + 1,
        lastSeenAt: e.lastSeenAt,
        lastSessionId: e.lastSessionId
      });
    } else
      await this.db.knowledgeViewTransitions.put(e);
  }
  async getViewTransitions(e) {
    return this.db.knowledgeViewTransitions.where("appId").equals(e).toArray();
  }
  // -- Collections --
  async upsertCollection(e) {
    const n = await this.db.knowledgeCollections.get(e.key);
    n ? await this.db.knowledgeCollections.put({
      ...n,
      currentCount: e.currentCount,
      maxCount: Math.max(n.maxCount, e.currentCount),
      lastUpdated: e.lastUpdated,
      lastSessionId: e.lastSessionId
    }) : await this.db.knowledgeCollections.put(e);
  }
  async getCollections(e) {
    return this.db.knowledgeCollections.where("appId").equals(e).toArray();
  }
  // -- Counters --
  /**
   * Append a counter observation to its history.
   * Bounded: keep last MAX_COUNTER_HISTORY values.
   * Session-guarded: re-persist of the SAME session-value never duplicates.
   */
  async appendCounter(e, n, r, o, s) {
    const c = em(e, n), l = await this.db.knowledgeCounters.get(c);
    if (l && l.lastSessionId === s.sessionId && l.currentValue === s.value)
      return;
    const f = l ? [...l.history] : [];
    f.some(
      (m) => m.sessionId === s.sessionId && m.value === s.value
    ) || (f.push(s), f.length > ma && f.splice(0, f.length - ma)), await this.db.knowledgeCounters.put({
      key: c,
      appId: e,
      counterId: n,
      label: r,
      elementPath: o,
      currentValue: s.value,
      history: f,
      lastUpdated: s.observedAt,
      lastSessionId: s.sessionId
    });
  }
  async getCounters(e) {
    return this.db.knowledgeCounters.where("appId").equals(e).toArray();
  }
  // -- Notifications --
  /**
   * Add a notification if not already present (dedup by hash).
   * Bounded: cap at MAX_NOTIFICATIONS_PER_APP per app.
   */
  async addNotification(e) {
    if (await this.db.knowledgeNotifications.get(e.key)) return;
    const r = await this.db.knowledgeNotifications.where("appId").equals(e.appId).toArray();
    if (r.length >= ga) {
      r.sort((s, c) => s.appearedAt - c.appearedAt);
      const o = r.slice(0, r.length - ga + 1);
      await this.db.knowledgeNotifications.bulkDelete(o.map((s) => s.key));
    }
    await this.db.knowledgeNotifications.put(e);
  }
  async getNotifications(e) {
    return this.db.knowledgeNotifications.where("appId").equals(e).toArray();
  }
  // -- Outcomes --
  /**
   * Put an outcome. Idempotent by (sessionId:interactionId) key.
   * Recompute replaces the previous outcome for that interaction.
   */
  async putOutcome(e) {
    await this.db.knowledgeOutcomes.put(e);
  }
  async getOutcomes(e) {
    return (await this.db.knowledgeOutcomes.toArray()).filter((r) => r.sessionId === e);
  }
  async getOutcomesByApp(e) {
    return this.db.knowledgeOutcomes.where("appId").equals(e).toArray();
  }
  // -- State Transitions --
  /**
   * Add a state transition. Bounded: keep last MAX_TRANSITIONS_PER_SESSION.
   */
  async addStateTransition(e) {
    const n = await this.db.knowledgeStateTransitions.where("sessionId").equals(e.sessionId).toArray();
    if (n.length >= ya) {
      n.sort((o, s) => o.timestamp - s.timestamp);
      const r = n.slice(0, n.length - ya + 1);
      await this.db.knowledgeStateTransitions.bulkDelete(r.map((o) => o.key));
    }
    await this.db.knowledgeStateTransitions.put(e);
  }
  async getStateTransitions(e) {
    return this.db.knowledgeStateTransitions.where("sessionId").equals(e).toArray();
  }
  // -- Recorded Workflows (DDC-4) --
  /**
   * Upsert a recorded workflow pattern (merge by patternId).
   * Merge semantics: union sessionIds, union instances (bounded),
   * occurrenceCount = existing + new occurrences observed THIS call
   * (row.occurrenceCount counts THIS call's observations), keep newer
   * label/steps.
   */
  async upsertRecordedWorkflow(e) {
    let n = await this.db.knowledgeRecordedWorkflows.get(e.key);
    if (!n) {
      const r = await this.findLegacyPatternRow(e);
      r && (await this.db.knowledgeRecordedWorkflows.delete(r.key), n = r);
    }
    if (n) {
      const r = [.../* @__PURE__ */ new Set([...n.sessionIds, ...e.sessionIds])], o = [...n.instances, ...e.instances].filter((h, m, g) => g.indexOf(h) === m).slice(-200), s = {
        ...n.instanceSignatureIds ?? {}
      };
      for (const [h, m] of Object.entries(e.instanceSignatureIds ?? {})) {
        const g = s[h] ?? [];
        s[h] = [.../* @__PURE__ */ new Set([...g, ...m])].sort();
      }
      const c = {};
      for (const h of o)
        c[h] = s[h] ?? [];
      const l = [.../* @__PURE__ */ new Set([
        ...n.signatureIds ?? [],
        ...e.signatureIds ?? []
      ])].sort(), f = l.length > 0 ? "linked" : "linkage-pending";
      await this.db.knowledgeRecordedWorkflows.put({
        ...n,
        // D7: the canonical key wins so the row converges on the new id.
        key: e.key,
        patternId: e.patternId,
        label: e.label || n.label,
        canonicalSteps: e.canonicalSteps.length > 0 ? e.canonicalSteps : n.canonicalSteps,
        viewSequence: e.viewSequence.length > 0 ? e.viewSequence : n.viewSequence,
        sessionIds: r,
        occurrenceCount: n.occurrenceCount + e.occurrenceCount,
        instances: o,
        signatureIds: l,
        linkageState: f,
        instanceSignatureIds: c,
        lastSeenAt: Math.max(n.lastSeenAt, e.lastSeenAt)
      });
    } else
      await this.db.knowledgeRecordedWorkflows.put({
        ...e,
        instances: [...new Set(e.instances)].slice(-200),
        signatureIds: [...new Set(e.signatureIds ?? [])].sort(),
        linkageState: (e.signatureIds ?? []).length > 0 ? "linked" : "linkage-pending",
        instanceSignatureIds: ri.exhaustiveInstanceLinkage(
          e.instanceSignatureIds ?? {},
          [...new Set(e.instances)].slice(-200)
        )
      });
  }
  /**
   * D7 identity migration: find a same-app row whose stored canonicalSteps
   * re-hash (current canonicalization) to the incoming patternId but whose
   * key differs — i.e. the same physical workflow recorded before the
   * canonicalization change. Returns undefined when no such row exists.
   */
  async findLegacyPatternRow(e) {
    const n = await this.db.knowledgeRecordedWorkflows.where("appId").equals(e.appId).toArray();
    for (const r of n) {
      if (r.key === e.key) continue;
      if (Jr(r.canonicalSteps) === e.patternId || r.patternId === e.patternId)
        return r;
    }
  }
  async getRecordedWorkflows(e) {
    return this.db.knowledgeRecordedWorkflows.where("appId").equals(e).toArray();
  }
  // -- Cleanup --
  /**
   * Delete all outcomes and state transitions for a session.
   * Accumulated knowledge (entities, views, counters) SURVIVES.
   */
  async deleteBySession(e) {
    const r = (await this.db.knowledgeOutcomes.toArray()).filter((c) => c.sessionId === e);
    await this.db.knowledgeOutcomes.bulkDelete(r.map((c) => c.key));
    const o = await this.db.knowledgeStateTransitions.where("sessionId").equals(e).toArray();
    await this.db.knowledgeStateTransitions.bulkDelete(o.map((c) => c.key));
    const s = await this.db.knowledgeBehaviorSessions.where("sessionId").equals(e).toArray();
    for (const c of s)
      await this.deleteBehaviorSession(c.appId, c.sessionId);
  }
  /**
   * Delete ALL knowledge for an app (full teardown).
   */
  async deleteByApp(e) {
    await Promise.all([
      this.db.knowledgeEntities.where("appId").equals(e).delete(),
      this.db.knowledgeViews.where("appId").equals(e).delete(),
      this.db.knowledgeViewTransitions.where("appId").equals(e).delete(),
      this.db.knowledgeCollections.where("appId").equals(e).delete(),
      this.db.knowledgeCounters.where("appId").equals(e).delete(),
      this.db.knowledgeNotifications.where("appId").equals(e).delete(),
      this.db.knowledgeOutcomes.where("appId").equals(e).delete(),
      this.db.knowledgeStateTransitions.where("appId").equals(e).delete(),
      this.db.knowledgeRecordedWorkflows.where("appId").equals(e).delete(),
      // CP6: behavior-knowledge stores (full teardown includes signatures).
      this.db.knowledgeBehaviorSessions.where("appId").equals(e).delete(),
      this.db.knowledgeEpisodes.where("appId").equals(e).delete(),
      this.db.knowledgeEdges.where("appId").equals(e).delete(),
      this.db.knowledgeGaps.where("appId").equals(e).delete(),
      this.db.knowledgeSignatures.where("appId").equals(e).delete(),
      this.db.applications.where("appId").equals(e).delete()
    ]);
  }
  /**
   * Get a summary of stored knowledge for an app.
   */
  async getAppSummary(e) {
    const [n, r, o, s, c, l, f] = await Promise.all([
      this.db.knowledgeEntities.where("appId").equals(e).count(),
      this.db.knowledgeViews.where("appId").equals(e).count(),
      this.db.knowledgeViewTransitions.where("appId").equals(e).count(),
      this.db.knowledgeCollections.where("appId").equals(e).count(),
      this.db.knowledgeCounters.where("appId").equals(e).count(),
      this.db.knowledgeNotifications.where("appId").equals(e).count(),
      this.db.knowledgeOutcomes.where("appId").equals(e).count()
    ]);
    return { entities: n, views: r, transitions: o, collections: s, counters: c, notifications: l, outcomes: f };
  }
  // ── CP6: Behavior knowledge stores (Dexie v3) ─────────────────────────
  /**
   * CP6 — write one session's mapped behavior knowledge atomically.
   *
   * CP6 — write one session's mapped behavior knowledge atomically.
   *
   * ONE rw transaction over exactly the five new stores:
   *   1. Manifest idempotency gate — if this sessionId already exists,
   *      the write is a full NO-OP (replay-safe by construction).
   *   2. seq assignment INSIDE the transaction ([appId+seq].last() + 1).
   *   3. put manifest; bulkPut stratum-1 rows.
   *   4. Load touched signature rows → pure mergeSignature folds, in
   *      deterministic episode order → bulkPut.
   *   5. FIFO eviction beyond MAX_BEHAVIOR_SESSIONS_PER_APP (cascade).
   *
   * Failure of this transaction cannot roll back persist() steps 1–10
   * (they run in their own implicit transactions, exactly as today).
   */
  async upsertBehaviorKnowledge(e, n) {
    await this.db.transaction(
      "rw",
      [
        this.db.knowledgeBehaviorSessions,
        this.db.knowledgeEpisodes,
        this.db.knowledgeEdges,
        this.db.knowledgeGaps,
        this.db.knowledgeSignatures
      ],
      async () => {
        const { session: r, episodes: o, edges: s, gaps: c, signatureInputs: l } = e;
        if (await this.db.knowledgeBehaviorSessions.get(r.key)) return;
        const m = (await this.db.knowledgeBehaviorSessions.where("[appId+seq]").between([r.appId, Wt.minKey], [r.appId, Wt.maxKey]).toArray()).reduce((b, O) => Math.max(b, O.seq), 0) + 1, g = { ...r, seq: m, generatedAtMs: n };
        await this.db.knowledgeBehaviorSessions.put(g), await this.db.knowledgeEpisodes.bulkPut(o), await this.db.knowledgeEdges.bulkPut(s), await this.db.knowledgeGaps.bulkPut(c);
        const I = /* @__PURE__ */ new Map();
        for (const b of l) {
          const O = I.get(b.key) ?? await this.db.knowledgeSignatures.get(b.key), q = Lh(O, {
            ...b,
            sessionSeq: m,
            generatedAtMs: n
          });
          I.set(b.key, q);
        }
        await this.db.knowledgeSignatures.bulkPut([...I.values()]), await this.evictOldestBehaviorSessions(r.appId);
      }
    );
  }
  /** CP6 — read one behavior session manifest. */
  async getBehaviorSession(e, n) {
    return this.db.knowledgeBehaviorSessions.get(`${e}:${n}`);
  }
  /** CP6 — recent behavior sessions, newest seq first. */
  async getRecentBehaviorSessions(e, n = 10) {
    return (await this.db.knowledgeBehaviorSessions.where("appId").equals(e).toArray()).sort((o, s) => s.seq - o.seq).slice(0, n);
  }
  /** CP6 — episodes of one session. */
  async getEpisodesBySession(e, n) {
    return this.db.knowledgeEpisodes.where("[appId+sessionId]").equals([e, n]).toArray();
  }
  /** CP6 — edges of one session. */
  async getEdgesBySession(e, n) {
    return this.db.knowledgeEdges.where("[appId+sessionId]").equals([e, n]).toArray();
  }
  /** CP6 — gaps, optionally filtered by session and/or reason. */
  async getGaps(e, n = {}) {
    if (n.sessionId) {
      const o = await this.db.knowledgeGaps.where("[appId+sessionId]").equals([e, n.sessionId]).toArray();
      return n.reason ? o.filter((s) => s.reason === n.reason) : o;
    }
    return n.reason ? this.db.knowledgeGaps.where("[appId+reason]").equals([e, n.reason]).toArray() : (await this.db.knowledgeGaps.where("appId").equals(e).toArray()).sort((o, s) => o.observedAtMs - s.observedAtMs);
  }
  /** CP6 — one signature row. */
  async getSignature(e) {
    return this.db.knowledgeSignatures.get(e);
  }
  /** CP6 — all signatures for an app, most recently seen first. */
  async getSignatures(e) {
    return (await this.db.knowledgeSignatures.where("appId").equals(e).toArray()).sort(
      (r, o) => o.lastSeenSeq - r.lastSeenSeq || (r.key < o.key ? -1 : r.key > o.key ? 1 : 0)
    );
  }
  /**
   * CP6 — signature search (index + in-memory filter; documented R5 — no
   * substring index in Dexie, fine at knowledge-layer scale).
   *
   * `status` semantics (CP7 P1): the stored `status`/`sessionsSinceSeen`
   * mean "as of LAST observation" — a merge always writes 'active' because
   * the folding session observed the signature. The EFFECTIVE status is
   * relative to the app's current seq (which advances via other
   * signatures' sessions) and is therefore computed read-time, using the
   * loader's exact formula. Stored status is never trusted here.
   *
   * Seq monotonicity: eviction is FIFO (oldest first), so the max-seq
   * manifest is never evicted while newer ones exist — the in-transaction
   * `max+1` assignment can never reuse a seq.
   */
  async searchSignatures(e, n) {
    let r;
    n.actionType ? r = await this.db.knowledgeSignatures.where("[appId+actionType]").equals([e, n.actionType]).toArray() : r = await this.db.knowledgeSignatures.where("appId").equals(e).toArray();
    let o = r;
    if (n.status) {
      const s = await this.db.knowledgeBehaviorSessions.where("appId").equals(e).toArray();
      if (s.length === 0) return [];
      const c = Math.max(...s.map((l) => l.seq));
      o = o.filter((l) => (c - l.lastSeenSeq > Oc ? "stale" : "active") === n.status);
    }
    if (n.targetIncludes) {
      const s = n.targetIncludes.toLowerCase();
      o = o.filter((c) => c.normalizedTarget.includes(s));
    }
    return o.sort(
      (s, c) => c.lastSeenSeq - s.lastSeenSeq || (s.key < c.key ? -1 : s.key > c.key ? 1 : 0)
    );
  }
  /**
   * CP6 — FIFO eviction with cascade: delete the oldest session's manifest +
   * episodes + edges + gaps. Signatures are NEVER deleted (knowledge is
   * demoted, not destroyed); evicted sessions' evidence samples degrade at
   * read time (R7).
   */
  async evictOldestBehaviorSessions(e, n = Oh) {
    const r = await this.db.knowledgeBehaviorSessions.where("appId").equals(e).toArray(), o = r.sort((s, c) => s.seq - c.seq).slice(0, Math.max(0, r.length - n));
    for (const s of o)
      await this.db.knowledgeBehaviorSessions.delete(s.key), await this.db.knowledgeEpisodes.where("[appId+sessionId]").equals([s.appId, s.sessionId]).delete(), await this.db.knowledgeEdges.where("[appId+sessionId]").equals([s.appId, s.sessionId]).delete(), await this.db.knowledgeGaps.where("[appId+sessionId]").equals([s.appId, s.sessionId]).delete();
  }
  /**
   * CP6 — read-repair: delete stratum-1 rows whose session manifest is
   * missing (orphaned writes from a torn transaction). Bounded query.
   * Signatures untouched — knowledge outlives its evidence (R7).
   */
  async sweepOrphans(e) {
    const n = await this.db.knowledgeBehaviorSessions.where("appId").equals(e).toArray(), r = new Set(n.map((s) => s.sessionId));
    let o = 0;
    for (const s of [
      this.db.knowledgeEpisodes,
      this.db.knowledgeEdges,
      this.db.knowledgeGaps
    ]) {
      const l = (await s.where("appId").equals(e).toArray()).filter((f) => !r.has(f.sessionId));
      for (const f of l)
        await s.delete(f.key), o++;
    }
    return o;
  }
  /**
   * CP6 — cascade session delete: remove manifest + episodes + edges + gaps
   * for one session. Signatures survive (accumulated knowledge, R2).
   */
  async deleteBehaviorSession(e, n) {
    await this.db.knowledgeBehaviorSessions.delete(`${e}:${n}`), await this.db.knowledgeEpisodes.where("[appId+sessionId]").equals([e, n]).delete(), await this.db.knowledgeEdges.where("[appId+sessionId]").equals([e, n]).delete(), await this.db.knowledgeGaps.where("[appId+sessionId]").equals([e, n]).delete();
  }
};
// -- D6 helpers --
/**
 * Normalize a per-instance linkage map to EXACTLY the given instance ids
 * (exhaustive): every retained instance gets an entry ([] = no signature
 * keys recorded for that instance); ids outside the bound are dropped.
 */
B(ri, "exhaustiveInstanceLinkage", (e, n) => {
  const r = {};
  for (const o of n)
    r[o] = [...new Set(e[o] ?? [])].sort();
  return r;
});
let Io = ri;
function tm(t, e) {
  if (!e || e.length === 0) return t;
  if (!t || t.length === 0) return e;
  const n = [...t];
  for (const r of e) {
    const o = n[n.length - 1];
    o && o.to === r.to && o.from === r.from || n.push(r);
  }
  return n;
}
function nm(t, e) {
  if (!e || e.length === 0) return t;
  if (!t || t.length === 0) return e;
  const n = /* @__PURE__ */ new Set([...t, ...e]);
  return Array.from(n);
}
function ei(t) {
  let e = 2166136261;
  for (let n = 0; n < t.length; n++)
    e ^= t.charCodeAt(n), e = Math.imul(e, 16777619);
  return (e >>> 0).toString(16).padStart(8, "0");
}
function Eo(t) {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}
function $c(t, e, n, r) {
  return `${t}:sig:${ei(
    `${t}|${e}|${n}|${r ?? "∅"}`
  )}`;
}
function Ea(t) {
  const e = t.to;
  switch (e.type) {
    case "api":
      return rm(t);
    case "entity":
      return `${e.entityId.includes(":") ? e.entityId.split(":")[0] : "unknown"}:${e.operation}`;
    case "navigation":
      return `to:${om(e.toUrl)}`;
    case "state":
      return `${e.from ?? "∅"}→${e.to ?? "∅"}`;
    case "ui":
      return t.confidence < 0.6 ? "post-anchor" : "anchor-window";
    case "member":
      return `member:${e.interactionId}`;
    default:
      return "unknown";
  }
}
function rm(t) {
  const e = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+?)(?: |$)/.exec(t.detail);
  if (e)
    try {
      const n = new URL(e[2]);
      return `${e[1]} ${n.pathname}`;
    } catch {
      return `${e[1]} ${e[2]}`;
    }
  return `api:unparsed:${ei(im(t.detail))}`;
}
function im(t) {
  return t.replace(/\s+initiated during \S+\s*$/, "");
}
function om(t) {
  try {
    return new URL(t).pathname;
  } catch {
    return t;
  }
}
function sm(t) {
  const e = new Set(t.map((n) => n.kind));
  return e.has("request") ? "behavior/webrequest" : e.has("nav") ? "behavior/nav-lineage" : e.has("transition") ? "behavior/state-transition" : e.has("event") ? "behavior/observed-event" : e.has("entity") ? "behavior/entity-derivation" : e.has("dom") ? "behavior/dom-window" : "behavior/unknown";
}
function am(t) {
  var q, E, $, V, j, F;
  const { appId: e, sessionId: n, model: r, transitions: o } = t;
  if (!r || r.episodes.length === 0)
    throw new Error("mapBehaviorModel: model with zero episodes cannot be mapped");
  const s = /* @__PURE__ */ new Map();
  for (const P of o) s.set(P.interactionId, P);
  const c = /* @__PURE__ */ new Map();
  for (const P of r.episodes) {
    const L = s.get(P.anchor.interactionId);
    c.set(
      P.id,
      ((E = (q = L == null ? void 0 : L.before) == null ? void 0 : q.currentView) == null ? void 0 : E.id) ?? null
    );
  }
  const l = [], f = [], h = [], m = [];
  for (const P of r.episodes) {
    const L = $c(
      e,
      P.anchor.actionType,
      Eo(P.anchor.actionTarget),
      c.get(P.id) ?? null
    );
    l.push({
      key: `${e}:${n}:${P.id}`,
      appId: e,
      sessionId: n,
      episodeId: P.id,
      anchor: {
        interactionId: P.anchor.interactionId,
        actionType: P.anchor.actionType,
        actionTarget: P.anchor.actionTarget,
        triggerTimestamp: P.anchor.triggerTimestamp
      },
      members: P.members.map((K) => ({
        interactionId: K.interactionId,
        role: K.role,
        ...K.degraded ? { degraded: !0 } : {}
      })),
      horizonAttribution: {
        openedAtMs: P.horizon.attribution.openedAtMs,
        closedAtMs: P.horizon.attribution.closedAtMs,
        closeReason: P.horizon.attribution.closeReason
      },
      horizonUiOwnership: {
        openedAtMs: P.horizon.uiOwnership.openedAtMs,
        closedAtMs: P.horizon.uiOwnership.closedAtMs,
        closeReason: P.horizon.uiOwnership.closeReason
      },
      parameterInputs: P.parameterInputs.map((K) => ({
        interactionId: K.interactionId,
        label: K.label,
        value: K.value,
        link: K.link
      })),
      episodeOutcome: P.episodeOutcome ? {
        outcome: P.episodeOutcome.outcome,
        confidence: P.episodeOutcome.confidence,
        confidenceLevel: P.episodeOutcome.confidenceLevel,
        derivation: P.episodeOutcome.derivation
      } : null,
      tabId: P.tabId,
      signatureKey: L
    });
    let Y = 0;
    for (const K of P.edges)
      f.push({
        key: `${e}:${n}:${K.id}`,
        appId: e,
        sessionId: n,
        episodeId: P.id,
        edgeId: K.id,
        edgeSeq: Y,
        tier: K.tier,
        kind: K.kind,
        detail: K.detail,
        confidence: K.confidence,
        latencyMs: K.latencyMs,
        fromEpisodeId: K.from.episodeId,
        fromInteractionId: K.from.interactionId,
        to: K.to,
        refJson: JSON.stringify(K.evidenceRefs),
        signatureKey: L
      }), Y++;
    m.push({
      key: L,
      appId: e,
      actionType: P.anchor.actionType,
      normalizedTarget: Eo(P.anchor.actionTarget),
      anchorViewId: c.get(P.id) ?? null,
      sessionSeq: 0,
      // assigned by the repository INSIDE the write transaction
      sessionId: n,
      generatedAtMs: r.generatedAtMs,
      consequences: P.edges.map((K) => ({
        identity: `${K.tier}|${K.kind}|${Ea(K)}`,
        tier: K.tier,
        kind: K.kind,
        targetIdentity: Ea(K),
        observedVia: sm(K.evidenceRefs),
        edgeKey: `${e}:${n}:${K.id}`
      }))
    });
  }
  for (const P of r.unattributed)
    h.push({
      key: `${e}:${n}:${P.id}`,
      appId: e,
      sessionId: n,
      gapId: P.id,
      observedKind: P.observedKind,
      reason: P.reason,
      detail: P.detail,
      observedAtMs: P.observedAtMs,
      tabId: P.tabId,
      windowRefJson: JSON.stringify(P.evidenceRef)
    });
  const g = /* @__PURE__ */ new Set();
  for (const P of o)
    (V = ($ = P.before) == null ? void 0 : $.currentView) != null && V.id && g.add(P.before.currentView.id), (F = (j = P.after) == null ? void 0 : j.currentView) != null && F.id && g.add(P.after.currentView.id);
  const I = ei([...g].sort().join(",")), b = ei(
    m.map((P) => P.key).sort().join(",")
  );
  return { session: {
    key: `${e}:${n}`,
    appId: e,
    sessionId: n,
    seq: 0,
    // assigned by the repository INSIDE the write transaction
    generatedAtMs: r.generatedAtMs,
    episodeCount: r.episodes.length,
    edgeCount: f.length,
    gapCount: h.length,
    coverage: { ...r.coverage },
    viewSetHash: I,
    signatureSetHash: b,
    warnings: r.warnings.map((P) => ({
      code: P.code,
      message: P.message,
      refs: [...P.refs]
    }))
  }, episodes: l, edges: f, gaps: h, signatureInputs: m };
}
function So(t) {
  let e = 0;
  for (let n = 0; n < t.length; n++)
    e = (e << 5) - e + t.charCodeAt(n) | 0;
  return `app-${Math.abs(e).toString(36)}`;
}
class cm {
  constructor(e) {
    /** Transitions from the current persist() call — available to helper methods. */
    B(this, "sessionTransitions", []);
    this.repo = e;
  }
  /**
   * Persist all knowledge from a recording session.
   * This is the main entry point, called at stopRecording.
   */
  async persist(e) {
    const n = So(e.origin), r = Date.now();
    if (this.sessionTransitions = e.transitions, await this.upsertApplication(n, e.origin, e.recordingSessionId, r), await this.persistViews(n, e.applicationState, e.recordingSessionId, r), await this.persistViewTransitions(n, e.transitions, e.recordingSessionId, r), await this.persistEntities(n, e.applicationState, e.recordingSessionId, r), await this.persistCollections(n, e.applicationState, e.recordingSessionId, r), await this.persistCounters(n, e.applicationState, e.recordingSessionId, r), await this.persistNotifications(n, e.applicationState, e.recordingSessionId, r), await this.persistOutcomes(n, e.outcomes, e.recordingSessionId, r), await this.persistStateTransitions(n, e.transitions, e.recordingSessionId, r), e.recordedWorkflows && e.recordedWorkflows.length > 0 && await this.persistRecordedWorkflows(n, e.recordedWorkflows, r), e.behaviorModel && e.behaviorModel.episodes.length > 0)
      try {
        const o = am({
          appId: n,
          sessionId: e.recordingSessionId,
          model: e.behaviorModel,
          transitions: e.transitions
        });
        await this.repo.upsertBehaviorKnowledge(o, r);
      } catch (o) {
        throw new Error(
          `behavior-knowledge-persist: ${o.message}`
        );
      }
  }
  // -- Application --
  async upsertApplication(e, n, r, o) {
    const s = await this.repo.getApplication(e), c = n.replace(/^https?:\/\//, "").split("/")[0];
    await this.repo.upsertApplication({
      appId: e,
      origin: n,
      label: c,
      firstSeenAt: (s == null ? void 0 : s.firstSeenAt) ?? o,
      lastActiveAt: o,
      sessionCount: 0,
      lastSessionId: r
    });
  }
  // -- Views --
  async persistViews(e, n, r, o) {
    const s = /* @__PURE__ */ new Map();
    n.currentView && s.set(n.currentView.id, {
      id: n.currentView.id,
      label: n.currentView.label,
      detectedFrom: n.currentView.detectedFrom
    });
    for (const c of this.sessionTransitions)
      for (const l of [c.before.currentView, c.after.currentView])
        l && !s.has(l.id) && s.set(l.id, { id: l.id, label: l.label, detectedFrom: l.detectedFrom });
    for (const c of s.values())
      await this.repo.upsertView({
        key: `${e}:${c.id}`,
        appId: e,
        viewId: c.id,
        label: c.label,
        detectedFrom: c.detectedFrom,
        firstSeenAt: o,
        lastSeenAt: o,
        visitCount: 1,
        lastSessionId: r
      });
  }
  // -- View Transitions --
  async persistViewTransitions(e, n, r, o) {
    var s, c;
    for (const l of n) {
      const f = (s = l.before.currentView) == null ? void 0 : s.id, h = (c = l.after.currentView) == null ? void 0 : c.id;
      !f || !h || f === h || await this.repo.upsertViewTransition({
        key: `${e}:${f}->${h}`,
        appId: e,
        fromViewId: f,
        toViewId: h,
        count: 1,
        firstSeenAt: o,
        lastSeenAt: o,
        lastSessionId: r
      });
    }
  }
  // -- Entities --
  async persistEntities(e, n, r, o) {
    var s;
    for (const c of n.entities.values())
      await this.repo.upsertEntity({
        key: `${e}:${c.id}`,
        appId: e,
        entityId: c.id,
        type: c.type,
        attributes: { ...c.attributes },
        source: c.source,
        firstSeenAt: o,
        lastSeenAt: o,
        revision: 1,
        lastSessionId: r,
        currentState: c.currentState,
        stateHistory: (s = c.stateHistory) == null ? void 0 : s.map((l) => ({
          from: l.from,
          to: l.to,
          changedAt: l.changedAt,
          evidence: l.evidence
        })),
        viewIds: c.viewIds
      });
  }
  // -- Collections --
  async persistCollections(e, n, r, o) {
    for (const s of n.collections.values()) {
      const c = s.count ?? 0;
      await this.repo.upsertCollection({
        key: `${e}:${s.id}`,
        appId: e,
        collectionId: s.id,
        entityType: s.entityType,
        currentCount: c,
        maxCount: c,
        lastUpdated: o,
        lastSessionId: r
      });
    }
  }
  // -- Counters --
  async persistCounters(e, n, r, o) {
    for (const s of n.counters.values())
      for (const c of s.values) {
        const l = {
          value: c.value,
          observedAt: o,
          sessionId: r,
          delta: c.delta
        };
        await this.repo.appendCounter(
          e,
          s.id,
          s.label,
          s.elementPath,
          l
        );
      }
  }
  // -- Notifications --
  async persistNotifications(e, n, r, o) {
    for (const s of n.notifications) {
      const c = `${e}:${s.id}`;
      await this.repo.addNotification({
        key: c,
        appId: e,
        text: s.text,
        severity: s.severity,
        elementPath: s.elementPath,
        appearedAt: o,
        sessionId: r
      });
    }
  }
  // -- Outcomes --
  async persistOutcomes(e, n, r, o) {
    for (const s of n)
      await this.repo.putOutcome({
        key: `${r}:${s.interactionId}`,
        appId: e,
        sessionId: r,
        interactionId: s.interactionId,
        actionType: s.actionType,
        actionTarget: s.actionTarget,
        outcome: s.outcome,
        confidence: s.confidence,
        confidenceLevel: s.confidenceLevel,
        evidence: s.supportingEvidence.map((c) => ({
          kind: c.kind,
          result: c.result,
          weight: c.weight,
          detail: c.detail
        })),
        resultingEntities: s.resultingEntities,
        persistedAt: o
      });
  }
  // -- State Transitions --
  async persistStateTransitions(e, n, r, o) {
    var s, c, l;
    for (const f of n) {
      const h = [];
      for (const [m, g] of f.after.entities)
        f.before.entities.has(m) ? ((s = f.before.entities.get(m)) == null ? void 0 : s.lastUpdated) !== g.lastUpdated && h.push(m) : h.push(m);
      await this.repo.addStateTransition({
        key: `${r}:${f.interactionId}`,
        appId: e,
        sessionId: r,
        interactionId: f.interactionId,
        changes: [...f.changes],
        fromViewId: ((c = f.before.currentView) == null ? void 0 : c.id) ?? null,
        toViewId: ((l = f.after.currentView) == null ? void 0 : l.id) ?? null,
        affectedEntities: h,
        timestamp: o
      });
    }
  }
  // -- Recorded Workflows (DDC-4) --
  async persistRecordedWorkflows(e, n, r) {
    for (const o of n) {
      const s = Jr(o.canonicalSteps);
      await this.repo.upsertRecordedWorkflow({
        key: `${e}:${s}`,
        appId: e,
        patternId: s,
        label: o.label,
        canonicalSteps: [...o.canonicalSteps],
        viewSequence: [...o.viewSequence],
        sessionIds: [...o.sessionIds],
        occurrenceCount: o.occurrenceCount,
        instances: [...o.instances],
        // D6: linkage fields pass through (optional; absent when Stage 7
        // had no behavior model — repository treats that as pending).
        ...o.signatureIds !== void 0 ? { signatureIds: [...o.signatureIds] } : {},
        ...o.linkageState !== void 0 ? { linkageState: o.linkageState } : {},
        ...o.instanceSignatureIds !== void 0 ? { instanceSignatureIds: { ...o.instanceSignatureIds } } : {},
        firstSeenAt: r,
        lastSeenAt: r
      });
    }
  }
}
const um = 50, Dc = {
  saturationCount: 5,
  recencyDecay: 0.15,
  minRecency: 0.1,
  maxSources: 4
};
function Sa(t, e, n, r = Dc) {
  const o = Math.min(t / r.saturationCount, 1), s = Math.max(
    1 - e * r.recencyDecay,
    r.minRecency
  ), c = Math.min(n / r.maxSources, 1), l = (o + s + c) / 3;
  return {
    score: Lr(l),
    observationScore: Lr(o),
    recencyScore: Lr(s),
    sourceScore: Lr(c),
    level: lm(l)
  };
}
function lm(t) {
  return t >= 0.75 ? "very-high" : t >= 0.55 ? "high" : t >= 0.35 ? "medium" : "low";
}
function Lr(t) {
  return Math.round(t * 1e3) / 1e3;
}
class dm {
  constructor(e, n = Dc) {
    this.repo = e, this.config = n;
  }
  /**
   * DDC-4: Load persisted recorded-workflow patterns for an app.
   * Returns [] when the app has never recorded workflows.
   */
  async loadRecordedWorkflows(e) {
    try {
      return (await this.repo.getRecordedWorkflows(e)).map((r) => ({
        patternId: r.patternId,
        label: r.label,
        canonicalSteps: [...r.canonicalSteps],
        viewSequence: [...r.viewSequence],
        sessionIds: [...r.sessionIds],
        occurrenceCount: r.occurrenceCount,
        instances: [...r.instances]
      }));
    } catch {
      return [];
    }
  }
  /**
   * CP6 — load the Behavior Knowledge read model for an app.
   *
   * Read-only join over Stratum 2 (signatures) + Stratum 1 (sessions):
   * - behaviorVersion derived from signatureSetHash changes over seq
   * - consequence evidence samples get a read-time existence check (R7)
   * - deterministic ordering throughout
   * Returns null when the app has no behavior sessions.
   */
  async loadBehaviorKnowledge(e) {
    try {
      const [n, r, o] = await Promise.all([
        this.repo.getRecentBehaviorSessions(e, um),
        this.repo.getSignatures(e),
        this.repo.getGaps(e)
      ]);
      if (n.length === 0) return null;
      const s = [...n].sort((b, O) => b.seq - O.seq), c = s[s.length - 1].seq;
      let l = 1;
      for (let b = 1; b < s.length; b++)
        s[b].signatureSetHash !== s[b - 1].signatureSetHash && l++;
      const f = new Set(s.map((b) => b.sessionId)), h = r.map((b) => ({
        key: b.key,
        appId: b.appId,
        actionType: b.actionType,
        normalizedTarget: b.normalizedTarget,
        anchorViewId: b.anchorViewId,
        occurrenceCount: b.occurrenceCount,
        sessionsSinceSeen: Math.max(0, c - b.lastSeenSeq),
        status: c - b.lastSeenSeq > Oc ? "stale" : "active",
        firstSeenAtSession: b.firstSeenAtSession,
        lastSeenAtSession: b.lastSeenAtSession,
        lastSeenSeq: b.lastSeenSeq,
        consequenceProfile: b.consequenceProfile.map((O) => ({
          ...O,
          evidenceSamples: O.evidenceSamples.map((q) => ({
            sessionId: q.sessionId,
            edgeKey: q.edgeKey,
            resolvable: f.has(q.sessionId)
          }))
        })),
        divergenceFlags: [...b.divergenceFlags]
      })), m = /* @__PURE__ */ new Map();
      for (const b of o)
        m.set(b.reason, (m.get(b.reason) ?? 0) + 1);
      const g = [...m.entries()].map(([b, O]) => ({ reason: b, count: O })).sort((b, O) => O.count - b.count || (b.reason < O.reason ? -1 : 1)), I = [...o].sort((b, O) => O.observedAtMs - b.observedAtMs).slice(0, 10).map((b) => ({
        sessionId: b.sessionId,
        gapId: b.gapId,
        observedKind: b.observedKind,
        reason: b.reason,
        detail: b.detail,
        observedAtMs: b.observedAtMs
      }));
      return {
        appId: e,
        behaviorVersion: l,
        currentSeq: c,
        sessions: s.map((b) => ({
          sessionId: b.sessionId,
          seq: b.seq,
          generatedAtMs: b.generatedAtMs,
          episodeCount: b.episodeCount,
          edgeCount: b.edgeCount,
          gapCount: b.gapCount,
          signatureSetHash: b.signatureSetHash,
          viewSetHash: b.viewSetHash
        })),
        signatures: h,
        gapSummary: { total: o.length, byReason: g, recent: I }
      };
    } catch {
      return null;
    }
  }
  /**
   * Load and consolidate all knowledge for an app.
   * Returns null if the app has never been recorded.
   */
  async load(e) {
    const n = await this.repo.getApplication(e);
    if (!n) return null;
    const [r, o, s, c, l, f, h, m] = await Promise.all([
      this.repo.getEntities(e),
      this.repo.getViews(e),
      this.repo.getViewTransitions(e),
      this.repo.getCollections(e),
      this.repo.getCounters(e),
      this.repo.getNotifications(e),
      this.repo.getOutcomesByApp(e),
      this.getStateTransitionsByApp(e)
    ]), g = fm(
      r,
      h,
      m
    ), I = this.consolidateEntities(r, g, n.lastActiveAt), b = this.consolidateViews(o), O = hm(b, s), q = mm(c), E = gm(l), $ = ym(f), V = vm(h);
    return {
      appId: n.appId,
      origin: n.origin,
      label: n.label,
      sessionCount: n.sessionCount,
      firstSeenAt: n.firstSeenAt,
      lastActiveAt: n.lastActiveAt,
      entities: I,
      views: b,
      viewGraph: O,
      collections: q,
      counters: E,
      notifications: $,
      outcomePattern: V,
      totalRows: r.length + o.length + s.length + c.length + l.length + f.length + h.length + m.length
    };
  }
  /**
   * KnowledgeRepository exposes state transitions by sessionId only.
   * For by-app reads we scan sessions observed in outcomes, which is
   * the authoritative session list.
   */
  async getStateTransitionsByApp(e) {
    const n = await this.repo.getOutcomesByApp(e), r = [...new Set(n.map((s) => s.sessionId))];
    return (await Promise.all(
      r.map((s) => this.repo.getStateTransitions(s))
    )).flat();
  }
  consolidateEntities(e, n, r) {
    return e.map((o) => {
      const s = [o.lastSessionId], c = 24 * 60 * 60 * 1e3, l = Math.max(0, Math.floor((r - o.lastSeenAt) / c)), f = Math.min(l, 100);
      return {
        entityId: o.entityId,
        type: o.type,
        attributes: o.attributes,
        source: o.source,
        revision: o.revision,
        confidence: Sa(
          o.revision,
          f,
          1,
          this.config
        ),
        firstSeenAt: o.firstSeenAt,
        lastSeenAt: o.lastSeenAt,
        observedInSessions: s,
        currentState: o.currentState,
        stateHistory: o.stateHistory,
        viewIds: o.viewIds
      };
    });
  }
  consolidateViews(e) {
    const n = e.reduce((r, o) => Math.max(r, o.lastSeenAt), 0);
    return e.map((r) => {
      const o = Sa(
        r.visitCount,
        pm(r.lastSeenAt, n),
        1,
        // Views saturate source at 1 → scale maxSources accordingly
        { ...this.config, maxSources: 1 }
      );
      return {
        viewId: r.viewId,
        label: r.label,
        detectedFrom: r.detectedFrom,
        visitCount: r.visitCount,
        confidence: o,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt
      };
    });
  }
}
function fm(t, e, n) {
  const r = /* @__PURE__ */ new Set();
  for (const o of t) r.add(o.lastSessionId);
  for (const o of e) r.add(o.sessionId);
  for (const o of n) r.add(o.sessionId);
  return [...r];
}
function pm(t, e, n) {
  if (e <= 0) return 0;
  const r = 24 * 60 * 60 * 1e3, o = Math.floor((e - t) / r);
  return Math.min(Math.floor(o / 7), 10);
}
function hm(t, e) {
  return {
    nodes: t,
    edges: e.map((n) => ({
      fromViewId: n.fromViewId,
      toViewId: n.toViewId,
      count: n.count
    }))
  };
}
function mm(t) {
  return t.map((e) => ({
    collectionId: e.collectionId,
    entityType: e.entityType,
    currentCount: e.currentCount,
    maxCount: e.maxCount,
    lastUpdated: e.lastUpdated
  }));
}
function gm(t) {
  return t.map((e) => ({
    counterId: e.counterId,
    label: e.label,
    elementPath: e.elementPath,
    currentValue: e.currentValue,
    historyLength: e.history.length,
    lastUpdated: e.lastUpdated
  }));
}
function ym(t) {
  const e = /* @__PURE__ */ new Map();
  for (const n of t) {
    const r = `${n.severity}::${n.text}`, o = e.get(r);
    o ? o.count++ : e.set(r, { text: n.text, severity: n.severity, count: 1 });
  }
  return [...e.values()];
}
function vm(t) {
  const e = {
    totalActions: t.length,
    successCount: 0,
    failureCount: 0,
    ambiguousCount: 0,
    incompleteCount: 0,
    topActionTypes: []
  }, n = /* @__PURE__ */ new Map();
  for (const r of t)
    r.outcome === "success" ? e.successCount++ : r.outcome === "failure" ? e.failureCount++ : r.outcome === "ambiguous" ? e.ambiguousCount++ : r.outcome === "incomplete" && e.incompleteCount++, n.set(r.actionType, (n.get(r.actionType) ?? 0) + 1);
  return e.topActionTypes = [...n.entries()].map(([r, o]) => ({ actionType: r, count: o })).sort((r, o) => o.count - r.count).slice(0, 5), e;
}
class wm {
  constructor(e) {
    this.loader = e;
  }
  /**
   * Build a seed from prior-session knowledge for an app.
   * Returns an empty seed (hasPriorKnowledge=false) if no prior knowledge exists.
   *
   * Only high-confidence entities/views are preloaded to avoid seeding
   * stale or tentative knowledge.
   */
  async buildSeed(e) {
    const n = await this.loader.load(e);
    if (!n || n.entities.length === 0 && n.views.length === 0)
      return {
        entities: /* @__PURE__ */ new Map(),
        views: /* @__PURE__ */ new Map(),
        counters: /* @__PURE__ */ new Map(),
        hasPriorKnowledge: !1
      };
    const r = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new Map();
    for (const c of n.entities)
      c.confidence.level !== "low" && r.set(c.entityId, {
        id: c.entityId,
        type: c.type,
        attributes: { ...c.attributes },
        source: c.source,
        provenance: "prior-session",
        viewIds: c.viewIds
      });
    for (const c of n.views)
      o.set(c.viewId, {
        id: c.viewId,
        label: c.label,
        detectedFrom: c.detectedFrom,
        provenance: "prior-session"
      });
    for (const c of n.counters)
      s.set(c.counterId, {
        id: c.counterId,
        label: c.label,
        elementPath: c.elementPath,
        lastKnownValue: c.currentValue,
        provenance: "prior-session"
      });
    return {
      entities: r,
      views: o,
      counters: s,
      hasPriorKnowledge: r.size > 0 || o.size > 0 || s.size > 0
    };
  }
}
const bm = {
  domain: "e-commerce",
  viewWeights: {
    cart: 2,
    "cart-confirmation": 3,
    checkout: 3,
    "product-detail": 3,
    "search-results": 2,
    wishlist: 2,
    orders: 2
  },
  entityWeights: {
    product: 3,
    "cart-item": 3,
    order: 2,
    "search-query": 1
  },
  apiOperationWeights: {
    "add-to-cart": 3,
    "remove-from-cart": 2,
    "update-cart": 2,
    checkout: 3,
    search: 1,
    "search-autocomplete": 1
  },
  notificationKeywords: {
    cart: 2,
    order: 2,
    purchase: 2,
    checkout: 2,
    shipped: 2,
    delivered: 2,
    refund: 2,
    discount: 1,
    coupon: 1
  },
  urlFragments: {
    "/cart": 2,
    "/checkout": 3,
    "/product": 2,
    "/shop": 1,
    "/wishlist": 2,
    "/orders": 2
  }
}, Im = {
  domain: "authentication",
  viewWeights: {
    login: 3,
    register: 3,
    account: 1
  },
  entityWeights: {
    user: 2
  },
  apiOperationWeights: {
    login: 3,
    logout: 2,
    register: 3
  },
  notificationKeywords: {
    "sign in": 2,
    "sign out": 2,
    "log in": 2,
    "log out": 2,
    password: 2,
    welcome: 1,
    account: 1,
    verif: 1
  },
  urlFragments: {
    "/login": 3,
    "/signin": 3,
    "/signup": 2,
    "/register": 3,
    "/auth": 2,
    "/account": 1
  }
}, Em = {
  domain: "admin-crm",
  viewWeights: {
    account: 1,
    orders: 1
  },
  entityWeights: {
    user: 2,
    order: 1,
    filter: 1
  },
  apiOperationWeights: {
    "submit-form": 1,
    search: 1
  },
  notificationKeywords: {
    saved: 1,
    created: 1,
    updated: 1,
    deleted: 1,
    approved: 1,
    rejected: 1,
    assigned: 1
  },
  urlFragments: {
    "/admin": 3,
    "/dashboard": 2,
    "/crm": 3,
    "/manage": 2,
    "/users": 2,
    "/reports": 1
  }
}, Sm = {
  domain: "content",
  viewWeights: {
    home: 1,
    "search-results": 1
  },
  entityWeights: {
    "search-query": 2,
    "page-content": 1
  },
  apiOperationWeights: {
    search: 2,
    resource: 1
  },
  notificationKeywords: {
    published: 2,
    article: 2,
    post: 2,
    comment: 2,
    subscribe: 1
  },
  urlFragments: {
    "/blog": 3,
    "/news": 2,
    "/article": 2,
    "/post": 2,
    "/content": 2
  }
}, Fr = [
  bm,
  Im,
  Em,
  Sm
];
function Tm(t) {
  const e = Fr.findIndex((n) => n.domain === t.domain);
  e >= 0 ? Fr[e] = t : Fr.push(t);
}
function Cm() {
  return [...Fr];
}
function km(t) {
  const e = Cm(), n = [];
  for (const l of e) {
    const f = Am(t, l);
    n.push({ domain: l.domain, ...f });
  }
  n.sort(
    (l, f) => f.rawScore / Math.max(f.maxScore, 1) - l.rawScore / Math.max(l.maxScore, 1)
  );
  const r = n[0], o = n.length > 1 ? n[1] : null, s = Math.min(r.rawScore / Math.max(r.maxScore, 1), 1), c = o ? Math.min(o.rawScore / Math.max(o.maxScore, 1), 1) : 0;
  return {
    domain: r.rawScore > 0 ? r.domain : "unknown",
    confidence: Math.round(s * 1e3) / 1e3,
    evidence: r.evidence,
    alternative: o && o.rawScore > 0 ? o.domain : null,
    margin: Math.round((s - c) * 1e3) / 1e3
  };
}
function Am(t, e) {
  let n = 0, r = 0, o = 0, s = 0, c = 0;
  const l = [];
  for (const m of t.views)
    e.viewWeights[m.viewId] && (n += e.viewWeights[m.viewId], l.push(`view:${m.viewId}`));
  for (const m of t.entities)
    e.entityWeights[m.type] && (r += e.entityWeights[m.type], l.push(`entity:${m.type}`));
  for (const m of t.outcomePattern.topActionTypes) {
    const g = m.actionType;
    e.apiOperationWeights[g] && (o += e.apiOperationWeights[g], l.push(`api:${g}`));
  }
  for (const m of t.notifications) {
    const g = m.text.toLowerCase();
    for (const [I, b] of Object.entries(e.notificationKeywords))
      g.includes(I) && (s += b * m.count, l.push(`notif:${I}`));
  }
  const f = t.origin.toLowerCase();
  for (const [m, g] of Object.entries(e.urlFragments))
    f.includes(m) && (c += g, l.push(`url:${m}`));
  const h = Vn(e.viewWeights) + Vn(e.entityWeights) + Vn(e.apiOperationWeights) + Vn(e.notificationKeywords) + Vn(e.urlFragments);
  return {
    rawScore: n + r + o + s + c,
    maxScore: h,
    evidence: {
      viewPatternScore: n,
      entityTypeScore: r,
      apiOperationScore: o,
      notificationKeywordScore: s,
      urlStructureScore: c,
      matchedSignals: [...new Set(l)]
    }
  };
}
function Vn(t) {
  return Object.values(t).reduce((e, n) => e + n, 0);
}
function _m(t, e, n) {
  const r = t.trigger, o = r.ariaRole ?? Om(r.tag), s = r.accessibleName ?? r.placeholder ?? r.ariaLabel ?? "";
  if (t.componentType)
    return {
      interactionId: t.interactionId,
      componentType: t.componentType,
      componentFramework: t.componentFramework ?? null,
      businessMeaning: t.businessMeaning ?? null,
      detectedBy: "enrichment",
      ariaRole: o,
      label: s,
      viewId: n ?? null
    };
  const c = Rm(t, e), l = c.method.startsWith("aria") ? "tier1-aria" : "tier2-behavioral";
  return {
    interactionId: t.interactionId,
    componentType: c.type,
    componentFramework: null,
    businessMeaning: null,
    detectedBy: l,
    ariaRole: o,
    label: s,
    viewId: n ?? null
  };
}
function Rm(t, e) {
  var m;
  const n = t.trigger, r = ((m = n.tag) == null ? void 0 : m.toLowerCase()) ?? "", o = n.ariaRole ?? "", s = n.inputType ?? "", c = n.className ?? "", f = ((e == null ? void 0 : e.stateChanges) ?? []).some(
    (g) => g.includes("view-change") || g.includes("navigation") || g.includes("Navigation")
  );
  if (o === "combobox") return { type: "select", method: "aria-role" };
  if (o === "checkbox") return { type: "checkbox", method: "aria-role" };
  if (o === "radio") return { type: "radio", method: "aria-role" };
  if (o === "button")
    return f ? { type: "link", method: "aria-role+behavior" } : { type: "button", method: "aria-role" };
  if (o === "link") return { type: "link", method: "aria-role" };
  if (o === "textbox") return { type: "text-input", method: "aria-role" };
  if (o === "searchbox") return { type: "search-input", method: "aria-role" };
  if (o === "menuitem") return { type: "menu-item", method: "aria-role" };
  if (o === "tab") return { type: "tab", method: "aria-role" };
  if (o === "switch") return { type: "toggle", method: "aria-role" };
  if (o === "slider") return { type: "slider", method: "aria-role" };
  if (r === "button")
    return f ? { type: "link", method: "tag+behavior" } : { type: "button", method: "tag" };
  if (r === "a") return { type: "link", method: "tag" };
  if (r === "select") return { type: "select", method: "tag" };
  if (r === "option") return { type: "option", method: "tag" };
  if (r === "input")
    return Nm(s, c);
  if (r === "textarea") return { type: "text-area", method: "tag" };
  const h = c.toLowerCase();
  return /\b(btn|button)\b/.test(h) ? { type: "button", method: "class-pattern" } : /\b(dropdown|select|combo)\b/.test(h) ? { type: "select", method: "class-pattern" } : /\btab\b/.test(h) && !/\b(table|tabbed)\b/.test(h) ? { type: "tab", method: "class-pattern" } : /\b(toggle|switch)\b/.test(h) ? { type: "toggle", method: "class-pattern" } : f ? { type: "link", method: "behavior-nav" } : { type: "unknown", method: "fallback" };
}
function Nm(t, e, n) {
  const r = e.toLowerCase();
  switch (t) {
    case "checkbox":
      return { type: "checkbox", method: "tag+attr" };
    case "radio":
      return { type: "radio", method: "tag+attr" };
    case "search":
      return { type: "search-input", method: "tag+attr" };
    case "email":
      return { type: "email-input", method: "tag+attr" };
    case "password":
      return { type: "password-input", method: "tag+attr" };
    case "number":
      return { type: "number-input", method: "tag+attr" };
    case "range":
      return { type: "slider", method: "tag+attr" };
    case "date":
    case "datetime-local":
      return { type: "date-input", method: "tag+attr" };
    case "submit":
      return { type: "button", method: "tag+attr" };
    case "image":
      return { type: "button", method: "tag+attr" };
    case "text":
    case "":
      return /\b(search|lookup|query)\b/.test(r) ? { type: "search-input", method: "class-pattern" } : { type: "text-input", method: "tag+attr" };
    default:
      return { type: "text-input", method: "tag+attr" };
  }
}
function Om(t) {
  switch (t == null ? void 0 : t.toLowerCase()) {
    case "button":
      return "button";
    case "a":
      return "link";
    case "select":
      return "combobox";
    case "option":
      return "option";
    case "textarea":
      return "textbox";
    case "input":
      return "textbox";
    default:
      return null;
  }
}
function Pm(t) {
  var g, I;
  const e = t.trigger, n = (g = t.behavioralEvidence) == null ? void 0 : g.targetEvidence, r = (n == null ? void 0 : n.after) ?? null, o = ((I = t.triggerEvent) == null ? void 0 : I.domContext) ?? null, s = (r == null ? void 0 : r.disabled) ?? (o == null ? void 0 : o.disabled) ?? !1, c = (r == null ? void 0 : r.checked) ?? (r == null ? void 0 : r.ariaChecked) ?? null, l = (r == null ? void 0 : r.ariaExpanded) ?? (o == null ? void 0 : o.ariaExpanded) ?? null, f = o ? o.required : Dm(e), m = (e.tag ?? "").toLowerCase() === "select" && (r == null ? void 0 : r.childCount) != null ? r.childCount : null;
  return {
    interactionId: t.interactionId,
    label: e.accessibleName ?? e.placeholder ?? e.ariaLabel ?? "",
    tag: e.tag ?? "",
    elementType: xm(e),
    inputType: e.inputType,
    format: $m(e),
    disabled: s,
    checked: c,
    expanded: l,
    required: f,
    placeholder: e.placeholder,
    optionCount: m,
    elementPath: e.xPath ?? e.cssSelector ?? ""
  };
}
function xm(t) {
  const e = (t.tag ?? "").toLowerCase(), n = (t.inputType ?? "").toLowerCase();
  if (e === "textarea") return "textarea";
  if (e === "button") return "button";
  if (e === "a") return "link";
  if (e === "select") return "select";
  if (e === "input")
    switch (n) {
      case "email":
        return "email-input";
      case "password":
        return "password-input";
      case "number":
        return "number-input";
      case "date":
      case "datetime-local":
        return "date-input";
      case "range":
        return "slider";
      case "file":
        return "file-input";
      case "checkbox":
        return "checkbox";
      case "radio":
        return "radio";
      case "text":
        return "text-input";
      default:
        return "text-input";
    }
  return "other";
}
function $m(t) {
  const e = (t.inputType ?? "").toLowerCase();
  return {
    email: "email",
    url: "url",
    tel: "tel",
    number: "number",
    date: "date",
    time: "time",
    "datetime-local": "datetime",
    month: "month",
    week: "week",
    password: "password",
    color: "color",
    search: "search",
    text: "text"
  }[e] ?? null;
}
function Dm(t) {
  if ((t.accessibleName ?? "").toLowerCase().includes("required")) return !0;
  const n = (t.className ?? "").toLowerCase();
  return /\brequired\b/.test(n) ? !0 : null;
}
const Lm = 6e4;
function Mm(t, e, n, r, o) {
  if (t.length === 0) return [];
  const s = [...t].sort((h, m) => h.startTime - m.startTime), c = new Map(n.map((h) => [h.interactionId, h])), l = [];
  let f = [s[0]];
  for (let h = 1; h < s.length; h++) {
    const m = s[h - 1], g = s[h], I = g.startTime - m.endTime, b = c.get(m.interactionId), O = b && b.changes.some(
      (E) => E.includes("view") || E.includes("View")
    );
    I > Lm || O && f.length >= 1 && Vm(b) ? (l.push(f), f = [g]) : f.push(g);
  }
  return l.push(f), l.filter((h) => h.length > 0).map(
    (h, m) => qm(h, m, e, c, r, o)
  );
}
function Vm(t) {
  var r, o;
  if (!t) return !1;
  const e = ((r = t.before.currentView) == null ? void 0 : r.id) ?? "", n = ((o = t.after.currentView) == null ? void 0 : o.id) ?? "";
  return !e || !n ? !1 : e !== n;
}
function qm(t, e, n, r, o, s) {
  var I, b;
  const c = t.map((O) => O.interactionId), l = c.map(
    (O) => {
      var q;
      return ((q = o.get(O)) == null ? void 0 : q.intent) ?? "Unknown";
    }
  ), f = [];
  for (const O of t) {
    const q = r.get(O.interactionId), E = (I = q == null ? void 0 : q.before.currentView) == null ? void 0 : I.id, $ = (b = q == null ? void 0 : q.after.currentView) == null ? void 0 : b.id;
    E && !f.includes(E) && f.push(E), $ && !f.includes($) && f.push($);
  }
  const h = Um(t, n, r), m = Bm(t, n), g = jm(l);
  return {
    workflowId: `wf-${s}-${e}`,
    sessionId: s,
    label: g,
    stepIds: c,
    stepIntents: l,
    viewIds: f,
    overallOutcome: m,
    effects: h
  };
}
function Um(t, e, n) {
  var h, m;
  const r = [], o = [], s = [], c = [], l = [], f = [];
  for (const g of t) {
    const I = e.get(g.interactionId), b = n.get(g.interactionId);
    if (I != null && I.resultingEntities)
      for (const L of I.resultingEntities)
        r.includes(L) || r.push(L);
    if (!b) continue;
    const O = b.before.counters, q = b.after.counters;
    for (const [L, Y] of q) {
      const K = O.get(L), H = Y.values, J = (K == null ? void 0 : K.values) ?? [];
      if (H.length === 0) continue;
      const oe = Number(H[H.length - 1].value), le = J.length > 0 ? Number(J[J.length - 1].value) : NaN;
      if (!Number.isFinite(oe)) continue;
      const fe = Number.isFinite(le) ? oe - le : oe;
      fe === 0 && J.length > 0 || s.push({ counterId: L, delta: fe });
    }
    const E = b.before.collections, $ = b.after.collections;
    for (const [L, Y] of $) {
      const K = E.get(L), H = Y.count ?? 0, J = (K == null ? void 0 : K.count) ?? null;
      if (!K || J !== H) {
        const oe = J !== null ? H - J : H;
        (oe !== 0 || !K) && c.push({ collectionId: L, netChange: oe });
      }
    }
    const V = b.before.entities, j = b.after.entities;
    for (const [L, Y] of j) {
      const K = V.get(L);
      if (!K) continue;
      const H = Object.keys(K.attributes), J = Object.keys(Y.attributes), oe = H.length !== J.length || H.some((fe) => K.attributes[fe] !== Y.attributes[fe]), le = K.currentState !== Y.currentState;
      (oe || le) && (o.includes(L) || o.push(L));
    }
    const F = (h = b.before.currentView) == null ? void 0 : h.id, P = (m = b.after.currentView) == null ? void 0 : m.id;
    F && P && F !== P && (f.some(
      (Y) => Y.from === F && Y.to === P
    ) || f.push({ from: F, to: P }));
    for (const L of b.after.notifications)
      L.appearedAt === g.interactionId && l.push({
        text: L.text,
        severity: L.severity
      });
  }
  return {
    entitiesCreated: r,
    entitiesModified: o,
    counterDeltas: s,
    collectionChanges: c,
    notificationsEmitted: l,
    viewTransitions: f
  };
}
function Bm(t, e) {
  let n = !1, r = !1;
  for (const o of t) {
    const s = e.get(o.interactionId);
    s && (s.outcome === "success" && (n = !0), s.outcome === "failure" && (r = !0));
  }
  return n && !r ? "success" : r && !n ? "failure" : n && r ? "mixed" : "unknown";
}
function jm(t) {
  if (t.length === 0) return "Empty workflow";
  const e = /* @__PURE__ */ new Set(["Unknown", "Navigate", "Submit form"]), n = t.filter((r) => !e.has(r));
  if (n.length > 0) {
    const r = /* @__PURE__ */ new Map();
    for (const c of n)
      r.set(c, (r.get(c) ?? 0) + 1);
    let o = n[0], s = 0;
    for (const [c, l] of r)
      l > s && (o = c, s = l);
    return o;
  }
  return t[0];
}
function Fm(t, e, n, r, o, s) {
  var m, g, I, b, O, q, E, $;
  const c = /* @__PURE__ */ new Map(), l = [];
  for (const V of s) {
    const j = (m = V.before.currentView) == null ? void 0 : m.id, F = (g = V.after.currentView) == null ? void 0 : g.id;
    j && (c.has(j) || c.set(j, ro(j, ((I = V.before.currentView) == null ? void 0 : I.label) ?? j))), F && (c.has(F) || c.set(F, ro(F, ((b = V.after.currentView) == null ? void 0 : b.label) ?? F))), j && F && j !== F && Lc(l, j, F);
  }
  if (t != null && t.currentView) {
    const V = t.currentView.id;
    c.has(V) || c.set(V, ro(V, t.currentView.label));
  }
  for (const V of e) {
    const j = s.find(
      (P) => P.interactionId === V.interactionId
    ), F = ((O = j == null ? void 0 : j.after.currentView) == null ? void 0 : O.id) ?? ((q = t == null ? void 0 : t.currentView) == null ? void 0 : q.id);
    if (F) {
      const P = c.get(F);
      if (P) {
        const L = o.get(V.interactionId);
        L && P.capabilities.push(L.intent);
      }
    }
  }
  const f = Hm(n, (V) => V.viewId), h = new Map(r.map((V) => [V.interactionId, V]));
  for (const [V, j] of f) {
    const F = c.get(V);
    F && F.components.push(...j);
  }
  for (const V of e) {
    const j = s.find(
      (P) => P.interactionId === V.interactionId
    ), F = ((E = j == null ? void 0 : j.after.currentView) == null ? void 0 : E.id) ?? (($ = t == null ? void 0 : t.currentView) == null ? void 0 : $.id);
    if (F) {
      const P = c.get(F), L = h.get(V.interactionId);
      P && L && P.inputs.push(L);
    }
  }
  if (t) {
    for (const V of t.entities.values()) {
      const j = V.viewIds && V.viewIds.length > 0 ? V.viewIds : [...c.keys()];
      for (const F of j) {
        const P = c.get(F);
        P && !P.entityTypeRefs.includes(V.type) && P.entityTypeRefs.push(V.type);
      }
    }
    for (const V of t.collections.values()) {
      const j = V.viewIds && V.viewIds.length > 0 ? V.viewIds : [...c.keys()];
      for (const F of j) {
        const P = c.get(F);
        P && !P.collectionRefs.includes(V.id) && P.collectionRefs.push(V.id);
      }
    }
    for (const V of t.counters.values()) {
      const j = V.viewIds && V.viewIds.length > 0 ? V.viewIds : [...c.keys()];
      for (const F of j) {
        const P = c.get(F);
        P && !P.counterRefs.includes(V.id) && P.counterRefs.push(V.id);
      }
    }
  }
  for (const V of c.values())
    V.capabilities = [...new Set(V.capabilities)];
  return {
    views: [...c.values()],
    navigationEdges: l
  };
}
function Km(t, e) {
  const n = new Map(
    e.views.map((o) => [o.viewId, o])
  );
  return {
    views: t.views.map((o) => {
      const s = n.get(o.viewId);
      return s ? {
        ...o,
        label: s.label || o.label,
        businessPurpose: Ta(o.viewId),
        visitCount: s.visitCount
      } : {
        ...o,
        businessPurpose: Ta(o.viewId),
        visitCount: o.visitCount
      };
    }),
    navigationEdges: Gm(t.navigationEdges, e.viewGraph.edges)
  };
}
function ro(t, e) {
  return {
    viewId: t,
    label: e,
    businessPurpose: "",
    capabilities: [],
    components: [],
    inputs: [],
    entityTypeRefs: [],
    collectionRefs: [],
    counterRefs: [],
    visitCount: 1
  };
}
function Ta(t) {
  return {
    "product-detail": "Display product information for purchase decision",
    "search-results": "Present search results for browsing",
    cart: "Review selected items before checkout",
    "cart-confirmation": "Confirm item was added to cart",
    checkout: "Complete purchase transaction",
    login: "Authenticate user identity",
    register: "Create a new user account",
    home: "Application landing page",
    orders: "View past order history",
    wishlist: "View saved items"
  }[t] ?? "";
}
function Lc(t, e, n) {
  const r = t.find((o) => o.fromViewId === e && o.toViewId === n);
  r ? r.count++ : t.push({ fromViewId: e, toViewId: n, count: 1 });
}
function Gm(t, e) {
  const n = [...t];
  for (const r of e)
    Lc(n, r.fromViewId, r.toViewId);
  return n;
}
function Hm(t, e) {
  const n = /* @__PURE__ */ new Map();
  for (const r of t) {
    const o = e(r);
    if (o === null) continue;
    const s = n.get(o);
    s ? s.push(r) : n.set(o, [r]);
  }
  return n;
}
const zm = "m9.7-deterministic-v3-ddc";
function Wm(t) {
  const {
    interactions: e,
    outcomes: n,
    transitions: r,
    currentState: o,
    priorKnowledge: s,
    sessionId: c
  } = t, l = s ? km(s) : Ym(e, o), f = e.map(Pm), h = e.map(($) => {
    var P, L;
    const V = n.get($.interactionId), j = r.find((Y) => Y.interactionId === $.interactionId), F = ((P = j == null ? void 0 : j.after.currentView) == null ? void 0 : P.id) ?? ((L = o == null ? void 0 : o.currentView) == null ? void 0 : L.id);
    return _m($, V, F);
  }), m = Fh(e, n, t.intentVocabularyRegistry), g = [...m.values()], I = Mm(
    e,
    n,
    r,
    m,
    c
  );
  let b = Fm(
    o,
    e,
    h,
    f,
    m,
    r
  );
  s && (b = Km(b, s));
  const O = xc(
    I,
    t.priorRecordedWorkflows ?? []
  ), q = Jh(O), E = Xm(e, I, b, g, f);
  return {
    appId: t.appId,
    domain: l,
    surface: b,
    contracts: f,
    components: h,
    intents: g,
    workflows: I,
    recordedWorkflows: q,
    metadata: E
  };
}
function Ym(t, e) {
  const n = t.map((l) => l.trigger.accessibleName ?? "").join(" ").toLowerCase(), r = ["cart", "checkout", "product", "add to cart", "buy", "shop"], o = ["sign in", "login", "register", "sign up", "password"], s = r.filter((l) => n.includes(l)).length, c = o.filter((l) => n.includes(l)).length;
  if (e != null && e.currentView) {
    const l = e.currentView.id.toLowerCase();
    if (["cart", "checkout", "product"].some((f) => l.includes(f)))
      return { domain: "e-commerce", confidence: 0.6, evidence: qn(), alternative: null, margin: 0 };
    if (["login", "register", "account"].some((f) => l.includes(f)))
      return { domain: "authentication", confidence: 0.6, evidence: qn(), alternative: null, margin: 0 };
  }
  return s >= 2 && s > c ? { domain: "e-commerce", confidence: 0.5, evidence: qn(), alternative: null, margin: 0 } : c >= 2 ? { domain: "authentication", confidence: 0.5, evidence: qn(), alternative: null, margin: 0 } : { domain: "unknown", confidence: 0, evidence: qn(), alternative: null, margin: 0 };
}
function qn() {
  return {
    viewPatternScore: 0,
    entityTypeScore: 0,
    apiOperationScore: 0,
    notificationKeywordScore: 0,
    urlStructureScore: 0,
    matchedSignals: []
  };
}
function Xm(t, e, n, r, o) {
  const s = t.length, c = s > 0 ? o.length / s : 0, l = s > 0 ? r.filter((m) => m.confidence >= 0.5).length / s : 0, f = s > 0 ? s / Math.max(s, 1) : 0, h = {
    intentCoverage: Math.round(l * 1e3) / 1e3,
    componentCoverage: Math.round(f * 1e3) / 1e3,
    contractCoverage: Math.round(c * 1e3) / 1e3
  };
  return {
    enricherVersion: zm,
    generatedAt: Date.now(),
    interactionCount: s,
    workflowCount: e.length,
    viewCount: n.views.length,
    coverage: h
  };
}
class Qm {
  constructor() {
    B(this, "entries", /* @__PURE__ */ new Map());
  }
  /**
   * Register a state vocabulary entry. Keywords are case-insensitive.
   */
  register(e) {
    for (const n of e.keywords)
      this.entries.set(n.toLowerCase(), e.canonical);
  }
  /**
   * Register multiple entries.
   */
  registerAll(e) {
    for (const n of e)
      this.register(n);
  }
  /**
   * Resolve raw text to a canonical state.
   * Tries exact match first, then word-boundary partial match
   * (longest keyword first).
   */
  resolve(e) {
    const n = e.trim().toLowerCase();
    if (!n) return null;
    if (this.entries.has(n))
      return this.entries.get(n);
    const r = [...this.entries.keys()].sort((o, s) => s.length - o.length);
    for (const o of r)
      if (new RegExp(
        `(^|[^a-z])${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`,
        "i"
      ).test(n))
        return this.entries.get(o);
    return null;
  }
  /**
   * Get all registered keywords.
   */
  getKeywords() {
    return [...this.entries.keys()];
  }
  /**
   * Number of registered keywords.
   */
  get size() {
    return this.entries.size;
  }
  /**
   * Clear all entries.
   */
  clear() {
    this.entries.clear();
  }
}
class Zm {
  constructor() {
    B(this, "entries", []);
  }
  /**
   * Register vocabulary entries. Entries are prepended so domain-specific
   * intents are checked before generic fallbacks.
   */
  register(e) {
    this.entries = [...e, ...this.entries];
  }
  /**
   * Get all registered entries in priority order (domain-specific first).
   */
  getAll() {
    return this.entries;
  }
  /**
   * Number of registered entries.
   */
  get size() {
    return this.entries.length;
  }
  /**
   * Clear all entries.
   */
  clear() {
    this.entries = [];
  }
}
class Jm {
  constructor() {
    B(this, "patterns", []);
  }
  /**
   * Register patterns. Patterns are prepended so domain-specific rules
   * are checked before the built-in defaults.
   */
  register(e) {
    this.patterns = [...e, ...this.patterns];
  }
  /**
   * Classify a URL to an operation label.
   * Domain patterns first, then unknown if none match.
   */
  classify(e) {
    for (const n of this.patterns)
      if (new RegExp(n.pattern, "i").test(e)) return n.operation;
    return null;
  }
  /**
   * Get all registered patterns.
   */
  getAll() {
    return this.patterns;
  }
  clear() {
    this.patterns = [];
  }
  /** Number of registered patterns. */
  get size() {
    return this.patterns.length;
  }
}
class eg {
  constructor() {
    /** Lifecycle state vocabulary (M9.9). */
    B(this, "stateVocabulary", new Qm());
    /** Intent vocabulary (M9.7). */
    B(this, "intentVocabulary", new Zm());
    /** Network/API patterns (M9.1). */
    B(this, "networkPatterns", new Jm());
    B(this, "installedPacks", /* @__PURE__ */ new Map());
    /**
     * Collection of confirmation-view sets from all installed packs.
     * Key = packId, Value = Set of view IDs.
     */
    B(this, "confirmationViewSets", /* @__PURE__ */ new Map());
    /**
     * Entity-type detection rules from all installed packs.
     */
    B(this, "entityTypeRules", []);
    /**
     * View patterns from all installed packs.
     */
    B(this, "viewPatterns", []);
    /**
     * Page-content selectors from all installed packs.
     */
    B(this, "pageContentSelectors", []);
    /**
     * Domain signatures from all installed packs.
     */
    B(this, "signatures", []);
  }
  /**
   * Install a domain pack. All data flows into the appropriate registries.
   */
  install(e) {
    this.installedPacks.has(e.id) && this.uninstall(e.id), this.installedPacks.set(e.id, e), e.stateVocabulary && this.stateVocabulary.registerAll(e.stateVocabulary), e.intentVocabulary && this.intentVocabulary.register(e.intentVocabulary), e.networkPatterns && this.networkPatterns.register(e.networkPatterns), e.confirmationViews && this.confirmationViewSets.set(e.id, new Set(e.confirmationViews)), e.entityTypes && (this.entityTypeRules = [...this.entityTypeRules, ...e.entityTypes]), e.viewPatterns && (this.viewPatterns = [...this.viewPatterns, ...e.viewPatterns]), e.pageContentSelectors && (this.pageContentSelectors = [...this.pageContentSelectors, ...e.pageContentSelectors]), e.signatures && (this.signatures = [...this.signatures, ...e.signatures]);
  }
  /**
   * Uninstall a domain pack. Removes its contributions from all registries.
   */
  uninstall(e) {
    if (this.installedPacks.get(e)) {
      this.installedPacks.delete(e), this.stateVocabulary.clear(), this.intentVocabulary.clear(), this.networkPatterns.clear(), this.confirmationViewSets.clear(), this.entityTypeRules = [], this.viewPatterns = [], this.pageContentSelectors = [], this.signatures = [];
      for (const r of this.installedPacks.values())
        r.stateVocabulary && this.stateVocabulary.registerAll(r.stateVocabulary), r.intentVocabulary && this.intentVocabulary.register(r.intentVocabulary), r.networkPatterns && this.networkPatterns.register(r.networkPatterns), r.confirmationViews && this.confirmationViewSets.set(r.id, new Set(r.confirmationViews)), r.entityTypes && (this.entityTypeRules = [...this.entityTypeRules, ...r.entityTypes]), r.viewPatterns && (this.viewPatterns = [...this.viewPatterns, ...r.viewPatterns]), r.pageContentSelectors && (this.pageContentSelectors = [...this.pageContentSelectors, ...r.pageContentSelectors]), r.signatures && (this.signatures = [...this.signatures, ...r.signatures]);
    }
  }
  /**
   * Get all installed pack IDs.
   */
  getInstalledPackIds() {
    return [...this.installedPacks.keys()];
  }
  /**
   * Check if a view ID is a confirmation view in any installed pack.
   */
  isConfirmationView(e) {
    for (const n of this.confirmationViewSets.values())
      if (n.has(e)) return !0;
    return !1;
  }
  /**
   * Get all entity-type rules from installed packs.
   */
  getEntityTypeRules() {
    return this.entityTypeRules;
  }
  /**
   * Get all view patterns from installed packs.
   */
  getViewPatterns() {
    return this.viewPatterns;
  }
  /**
   * Get all page-content selectors from installed packs.
   */
  getPageContentSelectors() {
    return this.pageContentSelectors;
  }
  /**
   * Get all domain signatures from installed packs.
   */
  getSignatures() {
    return this.signatures;
  }
  /**
   * Clear everything.
   */
  clear() {
    this.installedPacks.clear(), this.stateVocabulary.clear(), this.intentVocabulary.clear(), this.networkPatterns.clear(), this.confirmationViewSets.clear(), this.entityTypeRules = [], this.viewPatterns = [], this.pageContentSelectors = [], this.signatures = [];
  }
}
const tg = [
  {
    intent: "Apply for leave",
    matchers: [
      { field: "label", pattern: "apply\\s*(leave|for leave)" },
      { field: "label", pattern: "request\\s*leave" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Approve leave",
    matchers: [
      { field: "label", pattern: "approve" },
      { field: "label", pattern: "accept\\s*(request|leave)" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Reject leave",
    matchers: [
      { field: "label", pattern: "reject" },
      { field: "label", pattern: "decline" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Add employee",
    matchers: [
      { field: "label", pattern: "add\\s*(employee|member|staff)" },
      { field: "label", pattern: "create\\s*(employee|staff)" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Save record",
    matchers: [
      { field: "label", pattern: "\\bsave\\b" },
      { field: "label", pattern: "update\\s*(record|info|details)" }
    ],
    baseConfidence: 0.8
  },
  {
    intent: "Assign task",
    matchers: [
      { field: "label", pattern: "assign" }
    ],
    baseConfidence: 0.75
  },
  {
    intent: "Shortlist candidate",
    matchers: [
      { field: "label", pattern: "shortlist" }
    ],
    baseConfidence: 0.8
  },
  {
    intent: "Schedule interview",
    matchers: [
      { field: "label", pattern: "schedule\\s*interview" },
      { field: "label", pattern: "book\\s*interview" }
    ],
    baseConfidence: 0.8
  }
], ng = [
  // Employee / record entities
  {
    selector: "[data-record-id], [data-employee-id]",
    kind: "entity",
    entityType: "employee",
    idAttribute: "data-record-id",
    extractAttributes: ["data-record-id", "data-employee-id", "aria-label"]
  },
  // HR status badges (OrangeHRM uses .oxd-table-cell and badge classes)
  {
    selector: '[class*="badge"][class*="status"], [class*="oxd-badge"], [data-testid*="status"]',
    kind: "status-badge",
    extractAttributes: ["aria-label", "data-testid"]
  },
  // HR notification toasts
  {
    selector: '[class*="oxd-toast"], [class*="toast-content"], [role="alert"]',
    kind: "notification",
    extractAttributes: ["aria-label"]
  },
  // Employee directory tables
  {
    selector: 'table[data-testid], [class*="oxd-table"]',
    kind: "collection",
    extractNumeric: !0
  }
], rg = {
  id: "hr",
  label: "Human Resources",
  domainType: "admin-crm",
  signatures: [{
    domain: "admin-crm",
    viewWeights: {
      "employee-list": 3,
      "leave-list": 3,
      "leave-detail": 3,
      "candidate-list": 2,
      "time-sheet": 2,
      performance: 2
    },
    entityWeights: {
      employee: 3,
      "leave-request": 3,
      candidate: 2,
      timesheet: 2
    },
    apiOperationWeights: {
      "apply-leave": 3,
      "approve-leave": 3,
      "add-employee": 3,
      "save-record": 2
    },
    notificationKeywords: {
      saved: 2,
      approved: 3,
      rejected: 3,
      submitted: 2,
      updated: 2
    },
    urlFragments: {
      "/pim": 3,
      "/leave": 3,
      "/admin": 2,
      "/recruitment": 3,
      "/time": 2,
      "/performance": 2,
      "/directory": 2
    }
  }],
  entityTypes: [
    // Employee
    {
      entityType: "employee",
      viewId: "employee-detail",
      urlPattern: "/pim/viewEmployeeDetails|/pim/viewEmployees|/directory"
    },
    // Leave request
    {
      entityType: "leave-request",
      viewId: "leave-detail",
      urlPattern: "/leave/(?:assign|view)LeaveRequest"
    },
    // Candidate
    {
      entityType: "candidate",
      viewId: "candidate-add",
      urlPattern: "/recruitment/addCandidate|/recruitment/viewCandidates"
    },
    // Timesheet
    {
      entityType: "timesheet",
      viewId: "time-sheet",
      urlPattern: "/time/viewTimesheet"
    }
  ],
  stateVocabulary: [
    { keywords: ["pending", "awaiting approval", "awaiting review"], canonical: "pending" },
    { keywords: ["approved"], canonical: "approved" },
    { keywords: ["rejected", "declined"], canonical: "rejected" },
    { keywords: ["cancelled", "canceled"], canonical: "cancelled" },
    { keywords: ["submitted"], canonical: "submitted" },
    { keywords: ["shortlisted"], canonical: "shortlisted" },
    { keywords: ["interviewed"], canonical: "interviewed" },
    { keywords: ["hired"], canonical: "hired" },
    { keywords: ["on hold"], canonical: "on-hold" },
    { keywords: ["active", "enabled"], canonical: "active" },
    { keywords: ["inactive", "disabled"], canonical: "inactive" }
  ],
  viewPatterns: [
    { pattern: "/pim/viewEmployees", label: "Employee List", viewId: "employee-list" },
    { pattern: "/pim/viewPersonalDetails", label: "Employee Detail", viewId: "employee-detail" },
    { pattern: "/pim/addEmployee", label: "Add Employee", viewId: "employee-add" },
    { pattern: "/leave/viewLeaveList", label: "Leave List", viewId: "leave-list" },
    { pattern: "/leave/assignLeave", label: "Assign Leave", viewId: "leave-assign" },
    { pattern: "/leave/applyLeave", label: "Apply Leave", viewId: "leave-apply" },
    { pattern: "/leave/viewLeaveRequest", label: "Leave Detail", viewId: "leave-detail" },
    { pattern: "/recruitment/viewCandidates", label: "Candidate List", viewId: "candidate-list" },
    { pattern: "/recruitment/addCandidate", label: "Add Candidate", viewId: "candidate-add" },
    { pattern: "/time/viewTimesheet", label: "Timesheet", viewId: "time-sheet" },
    { pattern: "/performance", label: "Performance Review", viewId: "performance" },
    { pattern: "/directory", label: "Directory", viewId: "directory" },
    { pattern: "/admin", label: "Admin", viewId: "admin" },
    { pattern: "/dashboard", label: "Dashboard", viewId: "dashboard" }
  ],
  intentVocabulary: tg,
  networkPatterns: [
    { operation: "apply-leave", pattern: "/leave.*apply|/api/v2/leave/employees/apply" },
    { operation: "approve-leave", pattern: "/leave.*approve|/api/v2/leave.*action" },
    { operation: "add-employee", pattern: "/pim.*add|/api/v2/pim/employees" },
    { operation: "save-record", pattern: "/api/v2/.*/save" },
    { operation: "upload-resume", pattern: "/recruitment.*upload|/file.*resume" }
  ],
  confirmationViews: [
    "leave-detail",
    "employee-detail",
    "candidate-detail"
  ],
  pageContentSelectors: ng
}, ig = [
  {
    intent: "Create issue",
    matchers: [
      { field: "label", pattern: "new\\s*issue" },
      { field: "label", pattern: "create\\s*issue" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Close issue",
    matchers: [
      { field: "label", pattern: "close\\s*(issue|ticket)" },
      { field: "label", pattern: "\\bclose\\b" }
    ],
    baseConfidence: 0.8
  },
  {
    intent: "Comment on issue",
    matchers: [
      { field: "label", pattern: "comment" },
      { field: "className", pattern: "comment" }
    ],
    baseConfidence: 0.75
  },
  {
    intent: "Merge pull request",
    matchers: [
      { field: "label", pattern: "merge" },
      { field: "label", pattern: "merge\\s*pull\\s*request" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Approve pull request",
    matchers: [
      { field: "label", pattern: "approve" },
      { field: "label", pattern: "approve\\s*(changes|pr)" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Request changes",
    matchers: [
      { field: "label", pattern: "request\\s*changes" },
      { field: "label", pattern: "changes\\s*requested" }
    ],
    baseConfidence: 0.85
  },
  {
    intent: "Assign reviewer",
    matchers: [
      { field: "label", pattern: "assign.*review" },
      { field: "label", pattern: "request\\s*review" }
    ],
    baseConfidence: 0.8
  },
  {
    intent: "Trigger build",
    matchers: [
      { field: "label", pattern: "(run|trigger|start)\\s*(build|pipeline|workflow)" }
    ],
    baseConfidence: 0.8
  },
  {
    intent: "Clone repository",
    matchers: [
      { field: "label", pattern: "clone" },
      { field: "label", pattern: "clone\\s*repo" }
    ],
    baseConfidence: 0.8
  }
], og = [
  // Issue/PR entities
  {
    selector: "[data-issue-id], [data-pull-request-id]",
    kind: "entity",
    entityType: "issue",
    idAttribute: "data-issue-id",
    extractAttributes: ["data-issue-id", "aria-label"]
  },
  // Status badges (GitHub uses .State and .Label classes)
  {
    selector: '[class*="State"][class*="state"], [class*="status-badge"], [data-testid*="status"]',
    kind: "status-badge",
    extractAttributes: ["aria-label", "data-testid"]
  },
  // Build/CI status
  {
    selector: '[class*="workflow-status"], [class*="build-status"], [data-testid*="build"]',
    kind: "status-badge",
    extractAttributes: ["aria-label", "data-testid"]
  },
  // Code diff lines (collection)
  {
    selector: '[class*="diff-view"] tr, [class*="diff-table"] tr',
    kind: "collection",
    extractNumeric: !0
  }
], sg = {
  id: "devtools",
  label: "Developer Tools",
  domainType: "content",
  signatures: [{
    domain: "content",
    viewWeights: {
      "issue-list": 3,
      "issue-detail": 3,
      "pr-list": 3,
      "pr-detail": 3,
      repository: 2,
      commit: 2,
      actions: 2
    },
    entityWeights: {
      issue: 3,
      "pull-request": 3,
      commit: 2,
      comment: 1,
      build: 2
    },
    apiOperationWeights: {
      "create-issue": 3,
      "close-issue": 3,
      "merge-pr": 3,
      comment: 2,
      "trigger-build": 2
    },
    notificationKeywords: {
      merged: 3,
      closed: 2,
      approved: 2,
      failed: 2,
      passed: 2,
      deployed: 2
    },
    urlFragments: {
      "/issues": 3,
      "/pulls": 3,
      "/pull/": 3,
      "/commit": 2,
      "/repos": 2,
      "/actions": 2,
      "/compare": 2
    }
  }],
  entityTypes: [
    {
      entityType: "issue",
      viewId: "issue-detail",
      urlPattern: "/issues/\\d+"
    },
    {
      entityType: "pull-request",
      viewId: "pr-detail",
      urlPattern: "/pull/\\d+"
    },
    {
      entityType: "commit",
      viewId: "commit-detail",
      urlPattern: "/commit/[a-f0-9]+"
    },
    {
      entityType: "build",
      viewId: "build-detail",
      urlPattern: "/actions/runs/\\d+"
    }
  ],
  stateVocabulary: [
    { keywords: ["open"], canonical: "open" },
    { keywords: ["closed"], canonical: "closed" },
    { keywords: ["merged"], canonical: "merged" },
    { keywords: ["in review", "in-review"], canonical: "in-review" },
    { keywords: ["changes requested", "changes-requested"], canonical: "changes-requested" },
    { keywords: ["in progress", "in-progress"], canonical: "in-progress" },
    { keywords: ["draft"], canonical: "draft" },
    { keywords: ["todo"], canonical: "todo" },
    { keywords: ["blocked"], canonical: "blocked" },
    { keywords: ["archived"], canonical: "archived" },
    { keywords: ["passed"], canonical: "passed" },
    { keywords: ["failed"], canonical: "failed" },
    { keywords: ["pending"], canonical: "pending" },
    { keywords: ["queued"], canonical: "queued" },
    { keywords: ["running"], canonical: "running" },
    { keywords: ["cancelled", "canceled"], canonical: "cancelled" }
  ],
  viewPatterns: [
    { pattern: "/issues$", label: "Issues", viewId: "issue-list" },
    { pattern: "/issues/\\d+", label: "Issue Detail", viewId: "issue-detail" },
    { pattern: "/issues/new", label: "New Issue", viewId: "issue-new" },
    { pattern: "/pulls$", label: "Pull Requests", viewId: "pr-list" },
    { pattern: "/pull/\\d+", label: "PR Detail", viewId: "pr-detail" },
    { pattern: "/compare", label: "Compare", viewId: "pr-compare" },
    { pattern: "/commit/[a-f0-9]", label: "Commit", viewId: "commit-detail" },
    { pattern: "/commits", label: "Commits", viewId: "commit-list" },
    { pattern: "/actions", label: "Actions/CI", viewId: "actions" },
    { pattern: "/actions/runs", label: "Build Detail", viewId: "build-detail" },
    { pattern: "/tree/", label: "Repository", viewId: "repository" },
    { pattern: "/blob/", label: "File Viewer", viewId: "file-viewer" }
  ],
  intentVocabulary: ig,
  networkPatterns: [
    { operation: "create-issue", pattern: "/repos/.*/issues$" },
    { operation: "close-issue", pattern: "/repos/.*/issues/.*\\?(state|status)" },
    { operation: "merge-pr", pattern: "/repos/.*/pulls/\\d+/merge" },
    { operation: "comment", pattern: "/repos/.*/(issues|pulls)/\\d+/comments" },
    { operation: "trigger-build", pattern: "/repos/.*/actions/workflows" },
    { operation: "review-pr", pattern: "/repos/.*/pulls/\\d+/reviews" }
  ],
  confirmationViews: [
    "issue-detail",
    "pr-detail",
    "build-detail"
  ],
  pageContentSelectors: og
};
class Mc {
  constructor(e) {
    B(this, "coordinator");
    B(this, "stateBuilder");
    B(this, "outcomeDeterminer");
    B(this, "persistenceService");
    B(this, "knowledgeLoader");
    B(this, "knowledgePreloader");
    B(this, "domainRegistry");
    B(this, "db");
    this.domainRegistry = (e == null ? void 0 : e.domainRegistry) ?? Ko();
    for (const c of this.domainRegistry.getSignatures())
      Tm(c);
    const n = dh();
    for (const c of this.domainRegistry.getViewPatterns())
      n.add({
        viewId: c.viewId,
        viewLabel: c.label,
        pattern: c.pattern,
        confidence: 0.8
      });
    this.coordinator = new Mp(), this.coordinator.register(new Vp(n)), this.coordinator.register(
      new Hp(this.domainRegistry.networkPatterns)
    ), this.coordinator.register(new zp()), this.coordinator.register(new Xp()), this.coordinator.register(new nh()), this.coordinator.register(new rh()), this.coordinator.register(new ch());
    const r = _c(!0);
    for (const c of this.domainRegistry.getEntityTypeRules())
      r.register(c);
    this.stateBuilder = new Eh(
      r,
      this.domainRegistry.stateVocabulary
    );
    const o = /* @__PURE__ */ new Set();
    for (const c of [
      "cart-confirmation",
      "order-confirmation",
      "checkout-confirmation",
      "payment-confirmation",
      "registration-confirmation",
      "login-success"
    ])
      o.add(c);
    const s = this.collectConfirmationViews();
    for (const c of s) o.add(c);
    if (this.outcomeDeterminer = new Ch(o), e != null && e.noPersistence)
      this.db = null, this.persistenceService = null, this.knowledgeLoader = null, this.knowledgePreloader = null;
    else {
      this.db = (e == null ? void 0 : e.db) ?? Nh();
      const c = new Io(this.db);
      this.persistenceService = new cm(c), this.knowledgeLoader = new dm(c), this.knowledgePreloader = new wm(this.knowledgeLoader);
    }
  }
  /**
   * Preload prior-session knowledge for an app origin.
   * Returns an empty seed if no prior knowledge exists or persistence
   * is disabled.  Never throws — always returns a valid seed.
   */
  async preloadPriorKnowledge(e) {
    const n = {
      entities: /* @__PURE__ */ new Map(),
      views: /* @__PURE__ */ new Map(),
      counters: /* @__PURE__ */ new Map(),
      hasPriorKnowledge: !1
    };
    if (!this.knowledgePreloader) return n;
    try {
      const r = So(e);
      return await this.knowledgePreloader.buildSeed(r);
    } catch {
      return n;
    }
  }
  /**
   * Run the full pipeline over a session's interactions.
   *
   * Each stage is isolated: a failure adds a warning and the pipeline
   * continues with whatever data it has.
   */
  async run(e) {
    var b, O;
    const n = [], r = So(e.origin);
    let o = null;
    try {
      o = this.coordinator.extract(e.interactions);
    } catch (q) {
      n.push(`signal-extraction: ${q.message}`);
    }
    const s = [];
    let c = null;
    try {
      if (e.seed && e.seed.hasPriorKnowledge && this.stateBuilder.loadSeed(e.seed), o) {
        for (const q of e.interactions) {
          const E = o.signals.get(q.interactionId);
          if (!E) continue;
          const $ = this.stateBuilder.processSignals(E);
          s.push($);
        }
        c = this.stateBuilder.getCurrentState();
      }
    } catch (q) {
      n.push(`state-building: ${q.message}`);
    }
    const l = /* @__PURE__ */ new Map();
    try {
      if (o) {
        for (const q of e.interactions) {
          const E = o.signals.get(q.interactionId);
          if (!E) continue;
          const $ = s.find(
            (P) => P.interactionId === q.interactionId
          ) ?? null, V = (b = q.behavioralEvidence) == null ? void 0 : b.applicationEvidence, j = V ? {
            mainThreadBlocked: ((O = V.performanceCondition) == null ? void 0 : O.mainThreadBlocked) ?? !1,
            domChangeOverflow: V.domChangeOverflow ?? 0,
            coarseMode: V.coarseMode ?? !1
          } : void 0, F = this.outcomeDeterminer.determine({
            interactionId: q.interactionId,
            actionType: q.type,
            actionTarget: q.trigger.accessibleName ?? q.trigger.tag ?? "",
            signals: E,
            transition: $,
            evidenceQuality: j
          });
          l.set(q.interactionId, F);
        }
        this.attributeReloadOutcomes(e.interactions, o.signals, l);
      }
    } catch (q) {
      n.push(`outcome-determination: ${q.message}`);
    }
    let f = null, h = [];
    try {
      if (e.interactions.length > 0) {
        const q = up(
          e.interactions,
          s,
          l,
          e.captureArtifacts ?? null
        ), E = e.generatedAtMs ?? e.interactions.reduce((V, j) => Math.max(V, j.endTime), -1 / 0), $ = Lp({
          ...q,
          sessionId: e.sessionId,
          generatedAtMs: E
        });
        h = $.warnings.map(
          (V) => `${V.code}: ${V.refs.join(",")}`
        ), f = $.model;
      }
    } catch (q) {
      n.push(`behavior-model: ${q.message}`);
    }
    let m = null, g = [];
    if (this.knowledgeLoader)
      try {
        m = await this.knowledgeLoader.load(r), g = await this.knowledgeLoader.loadRecordedWorkflows(r);
      } catch (q) {
        n.push(`knowledge-load: ${q.message}`);
      }
    if (e.skipKnowledgePersistence)
      n.push("knowledge-persistence: skipped — no web origin resolvable for this session (7.0-KR)");
    else if (this.persistenceService && c)
      try {
        await this.persistenceService.persist({
          origin: e.origin,
          projectId: r,
          recordingSessionId: e.sessionId,
          applicationState: c,
          transitions: s,
          outcomes: [...l.values()],
          behaviorModel: f
        });
      } catch (q) {
        n.push(`knowledge-persistence: ${q.message}`);
      }
    let I = null;
    try {
      I = Wm({
        appId: r,
        interactions: e.interactions,
        outcomes: l,
        transitions: s,
        currentState: c,
        priorKnowledge: m,
        // DDC-4: seed aggregation with persisted patterns
        priorRecordedWorkflows: g,
        sessionId: e.sessionId,
        intentVocabularyRegistry: this.domainRegistry.intentVocabulary
      });
    } catch (q) {
      n.push(`semantic-enrichment: ${q.message}`);
    }
    if (e.skipKnowledgePersistence)
      n.push("recorded-workflow-persistence: skipped — no web origin resolvable for this session (7.0-KR)");
    else if (this.persistenceService && I && c)
      try {
        await this.persistenceService.persist({
          origin: e.origin,
          projectId: r,
          recordingSessionId: e.sessionId,
          applicationState: c,
          transitions: s,
          outcomes: [...l.values()],
          recordedWorkflows: ag(
            I.workflows,
            e.sessionId,
            // D6: anchor interaction → signature key, derived exactly as
            // mapBehaviorModel derives it (same helpers, same inputs) so
            // linkage keys are byte-identical to the signature store.
            cg(f, s, r)
          )
        });
      } catch (q) {
        n.push(`recorded-workflow-persistence: ${q.message}`);
      }
    return {
      semanticKnowledge: I,
      applicationKnowledge: m,
      outcomes: l,
      transitions: s,
      finalState: c,
      warnings: n,
      appId: r,
      // CP5 — Stage 3.5 outputs
      behaviorModel: f,
      behaviorModelWarnings: h
    };
  }
  /**
   * Close the underlying database (if any).  Safe to call multiple times.
   */
  async close() {
    if (this.db)
      try {
        this.db.close();
      } catch {
      }
  }
  // ── Helpers ──
  /**
   * DDC-3: Attribute recovered network evidence to the triggering click.
   *
   * For each synthetic-navigation interaction carrying recovered API
   * operations (source 'webrequest' entries that the SW ring buffer
   * injected), find the nearest preceding action interaction (Click /
   * KeyboardShortcut / CompoundInteraction) within 10s. If that interaction
   * has NO api-operations of its own and its current outcome is
   * 'incomplete' (no votes), re-run determination with the recovered ops
   * merged into its signal set — the click then gets an evidenced outcome.
   *
   * Deterministic guards:
   *  - only merges ops the click interaction itself did NOT capture
   *  - only fires when the click's outcome has zero supporting evidence
   *  - bounded to the nearest preceding action, ≤3 ops
   */
  attributeReloadOutcomes(e, n, r) {
    var s, c, l, f, h, m, g, I, b;
    const o = /* @__PURE__ */ new Map();
    for (const O of e) {
      const q = (s = O.behavioralEvidence) == null ? void 0 : s.sourceEventId;
      q && o.set(q, O);
    }
    for (const O of e) {
      const q = n.get(O.interactionId);
      if (!q) continue;
      const E = q.apiOperations.filter(
        (J) => J.source === "network-url" || J.source === "network-status"
      );
      if (E.length === 0) continue;
      const $ = O.behavioralEvidence;
      if (!$ || !(((c = $.window) == null ? void 0 : c.endReason) === "page-reload-synthetic")) continue;
      let j = null;
      const F = E.filter((J) => J.sourceEventId);
      if (F.length > 0) {
        const J = o.get(F[0].sourceEventId);
        J && (j = J), F.every((le) => le.sourceEventId === F[0].sourceEventId) || (j = null);
      }
      if (!j) {
        if (E.filter((we) => !we.sourceEventId).length !== E.length) continue;
        const oe = /* @__PURE__ */ new Map();
        e.forEach((we, Ce) => oe.set(we.interactionId, Ce));
        const le = oe.get(O.interactionId) ?? -1;
        if (le < 0) continue;
        const fe = O.endTime ?? O.startTime ?? 0, be = /* @__PURE__ */ new Set(["Click", "KeyboardShortcut", "CompoundInteraction", "Link", "Expander"]);
        let me = null;
        for (let we = le - 1; we >= 0; we--) {
          const Ce = e[we];
          if (!be.has(Ce.type)) continue;
          const xe = Ce.endTime ?? Ce.startTime ?? 0;
          fe - xe <= 1e4 && (me = Ce);
          break;
        }
        j = me;
      }
      if (!j) continue;
      const P = n.get(j.interactionId);
      if (!P || P.apiOperations.length > 0) continue;
      const L = r.get(j.interactionId);
      if (!L || L.supportingEvidence.length > 0) continue;
      const Y = {
        ...P,
        apiOperations: [...P.apiOperations, ...E.slice(0, 3)]
      }, H = this.outcomeDeterminer.determine({
        interactionId: j.interactionId,
        actionType: j.type,
        actionTarget: j.trigger.accessibleName ?? j.trigger.tag ?? "",
        signals: Y,
        transition: null,
        evidenceQuality: {
          mainThreadBlocked: ((h = (f = (l = j.behavioralEvidence) == null ? void 0 : l.applicationEvidence) == null ? void 0 : f.performanceCondition) == null ? void 0 : h.mainThreadBlocked) ?? !1,
          domChangeOverflow: ((g = (m = j.behavioralEvidence) == null ? void 0 : m.applicationEvidence) == null ? void 0 : g.domChangeOverflow) ?? 0,
          coarseMode: ((b = (I = j.behavioralEvidence) == null ? void 0 : I.applicationEvidence) == null ? void 0 : b.coarseMode) ?? !1
        }
      });
      for (const J of H.supportingEvidence)
        J.kind === "api-operation" && (J.detail = `${J.detail} [attributed via reload recovery]`);
      r.set(j.interactionId, H);
    }
  }
  collectConfirmationViews() {
    const e = /* @__PURE__ */ new Set(), n = [
      "leave-detail",
      "employee-detail",
      "candidate-detail",
      "issue-detail",
      "pr-detail",
      "build-detail"
    ];
    for (const r of n)
      this.domainRegistry.isConfirmationView(r) && e.add(r);
    return e;
  }
}
function ag(t, e, n) {
  return xc(t, [], n).map((r) => ({ ...r, sessionIds: [e] }));
}
function cg(t, e, n) {
  var s, c, l;
  if (!t || t.episodes.length === 0) return;
  const r = /* @__PURE__ */ new Map();
  for (const f of e) r.set(f.interactionId, f);
  const o = /* @__PURE__ */ new Map();
  for (const f of t.episodes) {
    const h = ((l = (c = (s = r.get(f.anchor.interactionId)) == null ? void 0 : s.before) == null ? void 0 : c.currentView) == null ? void 0 : l.id) ?? null;
    o.set(
      f.anchor.interactionId,
      $c(
        n,
        f.anchor.actionType,
        Eo(f.anchor.actionTarget),
        h
      )
    );
  }
  return o;
}
function Ko() {
  const t = new eg();
  return t.install(rg), t.install(sg), t;
}
function Go(t) {
  return new Mc({
    domainRegistry: Ko(),
    noPersistence: t == null ? void 0 : t.noPersistence
  });
}
async function ug(t, e) {
  const n = e ?? Go(), r = await n.preloadPriorKnowledge(t);
  return await n.close(), r;
}
async function lg(t, e) {
  const n = e ?? Go(), r = await n.run(t);
  return await n.close(), r;
}
const Vc = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  UnderstandingPipeline: Mc,
  createDefaultDomainPackRegistry: Ko,
  createDefaultUnderstandingPipeline: Go,
  preloadPriorKnowledge: ug,
  runUnderstandingPipeline: lg
}, Symbol.toStringTag, { value: "Module" })), dg = /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff2?|ttf)(\?|$)/i, fg = /\/unagi|\/events\/|\/beacon|\/pixel|\/csm|\/aax2|\/impression|fls-|\/1\/batch\/|uedata/i, pg = 20;
function hg(t, e) {
  var l, f, h, m, g, I, b, O, q, E;
  const n = [], r = [], o = /* @__PURE__ */ new Map();
  for (const $ of t) {
    const V = /* @__PURE__ */ new Set();
    for (const j of ((f = (l = $.behavioralEvidence) == null ? void 0 : l.applicationEvidence) == null ? void 0 : f.networkActivity) ?? []) {
      const F = j.requestId;
      F && V.add(F);
    }
    o.set($.interactionId, V);
  }
  const s = /* @__PURE__ */ new Map();
  for (const $ of t) {
    if (((m = (h = $.behavioralEvidence) == null ? void 0 : h.window) == null ? void 0 : m.endReason) === "page-reload-synthetic") continue;
    const j = (g = $.triggerEvent) == null ? void 0 : g.eventId;
    j && (s.has(j) || s.set(j, $));
    for (const P of $.memberEvents ?? [])
      s.has(P.eventId) || s.set(P.eventId, $);
    const F = (I = $.behavioralEvidence) == null ? void 0 : I.sourceEventId;
    F && !s.has(F) && s.set(F, $);
  }
  const c = /* @__PURE__ */ new Set();
  for (const $ of e) {
    if (!$.sourceEventId || c.has($.requestId)) continue;
    const V = $.documentRequest;
    if (!V && dg.test($.url) || !V && fg.test($.url)) continue;
    const j = s.get($.sourceEventId), F = (b = j == null ? void 0 : j.metadata) == null ? void 0 : b.captureOrigin, L = (!j || !$.captureOrigin || !F || F.tabId === $.captureOrigin.tabId && F.frameId === $.captureOrigin.frameId) && j ? j : Ja($.sourceEventId, t, $.captureOrigin);
    if (!L || (O = o.get(L.interactionId)) != null && O.has($.requestId)) continue;
    const Y = ((q = L.behavioralEvidence) == null ? void 0 : q.applicationEvidence) ?? // Fast form-submit case: click evidence lost at pagehide — synthesize
    // thin evidence anchored to the exact sourceEventId (INV-4).
    ec(L, $.sourceEventId).applicationEvidence;
    if ((((E = Y.networkActivity) == null ? void 0 : E.length) ?? 0) >= pg) continue;
    const K = {
      url: $.url,
      method: $.method,
      status: $.status,
      startRelativeToEvent: 0,
      endRelativeToEvent: null,
      durationMs: null,
      resourceType: "unknown",
      source: "webrequest",
      requestBody: $.requestBody,
      sourceEventId: $.sourceEventId,
      requestId: $.requestId
    };
    Y.networkActivity = [...Y.networkActivity ?? [], K], c.add($.requestId), r.push($.requestId), n.includes(L) || n.push(L);
  }
  return { updatedInteractions: n, mergedRequestIds: r };
}
function mg(t, e) {
  var s, c;
  const n = /* @__PURE__ */ new Map();
  if (e.ring)
    for (const l of e.ring)
      typeof l.status == "number" && l.status > 0 && n.set(l.requestId, l.status);
  if (e.ledger)
    for (const l of e.ledger)
      typeof l.status == "number" && l.status > 0 && n.set(l.requestId, l.status);
  if (n.size === 0)
    return { updatedInteractions: [], enriched: [] };
  const r = [], o = [];
  for (const l of t) {
    const f = (c = (s = l.behavioralEvidence) == null ? void 0 : s.applicationEvidence) == null ? void 0 : c.networkActivity;
    if (!f || f.length === 0) continue;
    let h = !1;
    for (const m of f) {
      const g = m;
      if (g.status !== null && g.status !== void 0 || !g.requestId) continue;
      const I = n.get(g.requestId);
      I !== void 0 && (g.status = I, h = !0, o.push({ interactionId: l.interactionId, requestId: g.requestId, from: null, to: I }));
    }
    h && r.push(l);
  }
  return { updatedInteractions: r, enriched: o };
}
const Ca = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  drainNetworkEvidence: hg,
  enrichNetworkRowStatuses: mg
}, Symbol.toStringTag, { value: "Module" }));
function To(t) {
  return t ? {
    currentView: t.currentView,
    currentUrl: t.currentUrl,
    entities: io(t.entities),
    collections: io(t.collections),
    counters: io(t.counters),
    notifications: t.notifications,
    lastInteractionId: t.lastInteractionId,
    interactionCount: t.interactionCount
  } : null;
}
function qc(t) {
  return {
    interactionId: t.interactionId,
    before: To(t.before),
    after: To(t.after),
    changes: t.changes
  };
}
function gg(t) {
  return t.map(qc);
}
function io(t) {
  if (t instanceof Map) {
    const e = {};
    for (const [n, r] of t)
      e[n] = r;
    return e;
  }
  return t;
}
const yg = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  serializeApplicationState: To,
  serializeStateTransition: qc,
  serializeStateTransitions: gg
}, Symbol.toStringTag, { value: "Module" }));
var re = /* @__PURE__ */ ((t) => (t.CLICK = "click", t.FILL = "fill", t.SELECT = "select", t.SELECT_DATE = "selectDate", t.TOGGLE = "toggle", t.HOVER = "hover", t.NAVIGATE = "navigate", t.VERIFY = "verify", t.WAIT = "wait", t.DRAG_DROP = "dragDrop", t.KEYBOARD_SHORTCUT = "keyboardShortcut", t.WAIT_FOR_ELEMENT = "waitForElement", t))(re || {});
const oo = {
  timeoutMs: 3e4,
  retryCount: 0,
  retryDelayMs: 1e3,
  waitStrategy: "visible"
};
var Uc = /* @__PURE__ */ ((t) => (t.ACTIVE = "active", t.ARCHIVED = "archived", t))(Uc || {}), Bc = /* @__PURE__ */ ((t) => (t.CRITICAL = "critical", t.HIGH = "high", t.MEDIUM = "medium", t.LOW = "low", t))(Bc || {}), ze = /* @__PURE__ */ ((t) => (t.DRAFT = "draft", t.IN_REVIEW = "in_review", t.APPROVED = "approved", t.DEPRECATED = "deprecated", t))(ze || {}), Co = /* @__PURE__ */ ((t) => (t.CLICK = "click", t.FILL = "fill", t.SELECT = "select", t.SELECT_DATE = "selectDate", t.TOGGLE = "toggle", t.HOVER = "hover", t.NAVIGATE = "navigate", t.VERIFY = "verify", t.WAIT = "wait", t))(Co || {}), bt = /* @__PURE__ */ ((t) => (t.PRESENCE = "presence", t.VISIBILITY = "visibility", t.TEXT_MATCH = "textMatch", t.ATTRIBUTE_MATCH = "attributeMatch", t.COUNT = "count", t.EQUALITY = "equality", t.URL_MATCH = "urlMatch", t.CUSTOM = "custom", t))(bt || {}), Oe = /* @__PURE__ */ ((t) => (t.EQUALS = "equals", t.CONTAINS = "contains", t.MATCHES = "matches", t.STARTS_WITH = "startsWith", t.GREATER_THAN = "greaterThan", t.LESS_THAN = "lessThan", t.IS_TRUE = "isTrue", t.IS_FALSE = "isFalse", t))(Oe || {}), ti = /* @__PURE__ */ ((t) => (t.HARD = "hard", t.SOFT = "soft", t))(ti || {}), Ho = /* @__PURE__ */ ((t) => (t.ACTIVE = "active", t.STALE = "stale", t.BROKEN = "broken", t))(Ho || {}), Se = /* @__PURE__ */ ((t) => (t.ROLE = "role", t.ACCESSIBLE_NAME = "accessibleName", t.TEST_ID = "testId", t.TEXT = "text", t.LABEL = "label", t.CSS = "css", t.XPATH = "xpath", t))(Se || {}), un = /* @__PURE__ */ ((t) => (t.INTERACTION_TIMELINE = "interaction_timeline", t.NATURAL_LANGUAGE = "natural_language", t.IMAGE = "image", t.IMPORTED_DOCUMENT = "imported_document", t.MANUAL = "manual", t))(un || {}), Kt = /* @__PURE__ */ ((t) => (t.CLICK = "click", t.ACCEPT_TEXT = "acceptText", t.FOCUS = "focus", t.HOVER = "hover", t.SELECT_OPTION = "selectOption", t.TOGGLE = "toggle", t.SCROLL = "scroll", t))(Kt || {}), jc = /* @__PURE__ */ ((t) => (t[t.BUSINESS = 1] = "BUSINESS", t[t.ACCESSIBILITY = 2] = "ACCESSIBILITY", t[t.STABLE_TECHNICAL = 3] = "STABLE_TECHNICAL", t[t.CONTENT = 4] = "CONTENT", t[t.STRUCTURAL = 5] = "STRUCTURAL", t))(jc || {});
const vg = [
  /^:r\d+:$/,
  /^:r\d+_?/,
  /^react-\d[\d.]*$/,
  /^mui-\d+$/,
  /^ng-[\w-]+$/,
  /^cdk-[\w-]+$/,
  /^v-\d+$/,
  /^sc-[a-zA-Z0-9]+$/,
  /^css-[a-zA-Z0-9]+$/,
  /^.__[a-zA-Z0-9]+/,
  /^rc-\d+$/,
  /^__BVID__\d+$/,
  /^headlessui-/,
  /^radix-/,
  /^__ta-/,
  /^element-id-\d+$/,
  /^:S\d+:/,
  /^[a-f0-9]{16,}$/i
];
function zo(t) {
  return vg.some((e) => e.test(t));
}
function Wo(t) {
  return /\.(?:css|sc|emotion|styled|react|__)[a-zA-Z0-9_-]{4,}/.test(t);
}
const wg = {
  1: 0.9,
  2: 0.8,
  3: 0.72,
  4: 0.62,
  5: 0.35
};
function bg(t, e) {
  return wg[t];
}
function Fc(t) {
  return t.filter((e) => {
    if (!e.value || !e.value.trim()) return !1;
    if (e.type === Se.CSS && e.value.startsWith("#")) {
      const n = e.value.slice(1);
      if (zo(n)) return !1;
    }
    return !(e.type === Se.CSS && Wo(e.value));
  });
}
function Yo(t, e = 3) {
  const r = [...Fc(t)].sort((l, f) => l.category !== f.category ? l.category - f.category : 0), o = /* @__PURE__ */ new Set();
  return r.filter((l) => {
    const f = `${l.type}:${l.value}`;
    return o.has(f) ? !1 : (o.add(f), !0);
  }).map((l, f) => ({
    type: l.type,
    value: l.value.trim(),
    priority: f + 1,
    confidence: bg(l.category)
  })).slice(0, e);
}
function Xo(t) {
  const e = [];
  t.testId && e.push({
    type: Se.TEST_ID,
    value: t.testId,
    category: 1
    /* BUSINESS */
  }), t.dataCy && e.push({
    type: Se.TEST_ID,
    value: `[data-cy="${t.dataCy}"]`,
    category: 1
    /* BUSINESS */
  }), t.dataQa && e.push({
    type: Se.TEST_ID,
    value: `[data-qa="${t.dataQa}"]`,
    category: 1
    /* BUSINESS */
  }), t.dataAutoId && e.push({
    type: Se.TEST_ID,
    value: `[data-auto-id="${t.dataAutoId}"]`,
    category: 1
    /* BUSINESS */
  }), t.autoId && e.push({
    type: Se.TEST_ID,
    value: `[auto-id="${t.autoId}"]`,
    category: 1
    /* BUSINESS */
  }), t.ariaLabel && e.push({
    type: Se.ACCESSIBLE_NAME,
    value: t.ariaLabel,
    category: 2
    /* ACCESSIBILITY */
  }), t.ariaLabelledBy && e.push({
    type: Se.ACCESSIBLE_NAME,
    value: t.ariaLabelledBy,
    category: 2
    /* ACCESSIBILITY */
  }), t.stableId && e.push({
    type: Se.CSS,
    value: `#${t.stableId}`,
    category: 3
    /* STABLE_TECHNICAL */
  }), t.name && e.push({
    type: Se.LABEL,
    value: t.name,
    category: 3
    /* STABLE_TECHNICAL */
  });
  for (const n of Hc(t.className))
    e.push(n);
  return t.accessibleName && e.push({
    type: Se.ACCESSIBLE_NAME,
    value: t.accessibleName,
    category: 4
    /* CONTENT */
  }), t.placeholder && e.push({
    type: Se.LABEL,
    value: t.placeholder,
    category: 4
    /* CONTENT */
  }), t.cssSelector && e.push({
    type: Se.CSS,
    value: t.cssSelector,
    category: 5
    /* STRUCTURAL */
  }), t.xPath && e.push({
    type: Se.XPATH,
    value: t.xPath,
    category: 5
    /* STRUCTURAL */
  }), e;
}
const Kc = 2, Ig = /* @__PURE__ */ new Set([
  "selected",
  "checked",
  "active",
  "disabled",
  "open",
  "closed",
  "show",
  "showing",
  "shown",
  "hidden",
  "visible",
  "collapse",
  "collapsing",
  "loading",
  "loaded",
  "focused",
  "focus",
  "hover",
  "hovered",
  "enter",
  "entering",
  "leave",
  "leaving",
  "aria-checked",
  "true",
  "false"
]), Eg = [
  "is-",
  "has-",
  "was-",
  "are-",
  "not-",
  "no-",
  "fade",
  "ripple",
  "animate",
  "anim",
  "transition",
  "spin",
  "pulse",
  "shake",
  "slide",
  "v-",
  "ember",
  "ng-",
  "ngs-",
  "svelte-",
  "astro-",
  "next-",
  "nuxt-",
  "gwt-",
  "p-",
  "m-",
  "px",
  "py",
  "mx",
  "my",
  "mt",
  "mb",
  "ml",
  "mr",
  "w-",
  "h-",
  "sm:",
  "md:",
  "lg:",
  "xl:",
  "2xl:",
  "hover:",
  "focus:",
  "active:",
  "disabled:",
  "group-",
  "dark:",
  "motion-",
  "scroll-"
];
function Gc(t) {
  const e = t.trim();
  if (!e || e.length < 3 || Ig.has(e)) return !0;
  for (const n of Eg)
    if (e.startsWith(n)) return !0;
  return !!(Wo(`.${e}`) || /^css-/.test(e) || /^sc-[a-zA-Z]/.test(e) || /^__/.test(e) || /^_/.test(e) || /^e-/.test(e) || e.includes("!important") || /[0-9a-f]{6,}/i.test(e) && /[-_]/.test(e) || zo(e) || e.includes(":"));
}
function Hc(t) {
  if (!t || typeof t != "string") return [];
  const e = t.split(/\s+/).filter(Boolean), n = [];
  for (const r of e) {
    if (n.length >= Kc) break;
    Gc(r) || /[^\w-]/.test(r) || n.push({
      type: Se.CSS,
      value: `[class~="${r}"]`,
      category: 3
      /* STABLE_TECHNICAL */
    });
  }
  return n;
}
const Sg = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  LocatorCategory: jc,
  MAX_CLASS_CANDIDATES: Kc,
  extractCandidatesFromIdentity: Xo,
  filterValidCandidates: Fc,
  isAutoGeneratedId: zo,
  isCssInJsClass: Wo,
  isVolatileClassToken: Gc,
  rankLocatorCandidates: Yo,
  stableClassCandidates: Hc
}, Symbol.toStringTag, { value: "Module" }));
class ci extends Error {
  constructor(n, r, o) {
    super(o);
    /** The invariant ID from domain-schema.md (e.g., 'INV-EL3'). */
    B(this, "invariant");
    /** The entity type involved (e.g., 'Element', 'ApprovedTestCase'). */
    B(this, "entityType");
    this.name = "InvariantError", this.invariant = n, this.entityType = r, Object.setPrototypeOf(this, new.target.prototype);
  }
}
class Te extends ci {
  constructor(n, r) {
    const o = `${n}: required field "${r}" is missing or empty`;
    super("MISSING_FIELD", n, o);
    B(this, "fieldName");
    this.name = "MissingFieldError", this.fieldName = r, Object.setPrototypeOf(this, new.target.prototype);
  }
}
class Tg extends ci {
  constructor(n, r) {
    const o = `Element ${n} cannot be deleted because it is referenced by ${r.length} test case version(s): ${r.join(", ")}`;
    super("INV-EL3", "Element", o);
    B(this, "elementId");
    B(this, "referencedBy");
    this.name = "ElementReferencedError", this.elementId = n, this.referencedBy = r, Object.setPrototypeOf(this, new.target.prototype);
  }
}
class _e extends ci {
  constructor(e, n) {
    super("INVALID_VALUE_OBJECT", e, n), this.name = "ValueObjectError", Object.setPrototypeOf(this, new.target.prototype);
  }
}
class Cg extends ci {
  constructor(n, r) {
    const o = `Invalid status transition: ${n} → ${r}`;
    super("INV-ATC2", "ApprovedTestCase", o);
    B(this, "from");
    B(this, "to");
    this.name = "InvalidStatusTransitionError", this.from = n, this.to = r, Object.setPrototypeOf(this, new.target.prototype);
  }
}
function kg(t, e, n) {
  const r = [], o = t.toLowerCase(), s = (e == null ? void 0 : e.toLowerCase()) ?? "", c = (n == null ? void 0 : n.toLowerCase()) ?? "", l = ["button", "a", "select", "summary", "label"], f = [
    "button",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tab",
    "option",
    "treeitem",
    "checkbox",
    "radio",
    "switch",
    "combobox"
  ], h = ["checkbox", "radio", "submit", "button", "image", "reset", "file"];
  (l.includes(o) || f.includes(s) || o === "input" && h.includes(c)) && r.push(Kt.CLICK);
  const m = ["input", "textarea"], g = ["textbox", "searchbox", "combobox", "spinbutton"], I = [
    "text",
    "email",
    "password",
    "search",
    "tel",
    "url",
    "number",
    "textarea",
    ""
  ];
  (m.includes(o) || g.includes(s)) && (o === "input" && c && !I.includes(c) || r.push(Kt.ACCEPT_TEXT));
  const b = ["button", "a", "input", "textarea", "select", "summary"], O = [
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "combobox",
    "option",
    "textbox",
    "searchbox",
    "spinbutton",
    "treeitem",
    "slider"
  ];
  return (b.includes(o) || O.includes(s)) && r.push(Kt.FOCUS), r.length > 0 && r.push(Kt.HOVER), (["option", "treeitem"].includes(s) || o === "option") && r.push(Kt.SELECT_OPTION), (["checkbox", "switch", "menuitemcheckbox"].includes(s) || o === "input" && c === "checkbox") && r.push(Kt.TOGGLE), [...new Set(r)];
}
function Ag(t) {
  var r, o, s, c, l;
  if (!((r = t.elementId) != null && r.trim()))
    throw new Te("UiElement", "elementId");
  if (!t.identity)
    throw new Te("UiElement", "identity");
  if (!((o = t.sourceUrl) != null && o.trim()))
    throw new Te("UiElement", "sourceUrl");
  const e = (s = t.componentId) == null ? void 0 : s.trim(), n = t.componentRole != null;
  if (e && !n)
    throw new _e(
      "UiElement",
      `componentId is set but componentRole is null for element ${t.elementId}`
    );
  if (!e && n)
    throw new _e(
      "UiElement",
      `componentRole is set but componentId is null for element ${t.elementId}`
    );
  return {
    elementId: t.elementId.trim(),
    identity: t.identity,
    domAttributes: t.domAttributes ?? {},
    sourceUrl: t.sourceUrl.trim(),
    domTreePath: t.domTreePath,
    intrinsicCapabilities: kg(
      t.identity.tag ?? "",
      t.identity.ariaRole,
      ((c = t.domAttributes) == null ? void 0 : c.type) ?? null
    ),
    componentId: ((l = t.componentId) == null ? void 0 : l.trim()) || null,
    componentRole: t.componentRole ?? null
  };
}
class _g {
  constructor(e = "elem", n = 0) {
    B(this, "counter");
    B(this, "prefix");
    this.prefix = e, this.counter = n;
  }
  /**
   * Generate the next sequential Element ID.
   */
  next() {
    return this.counter += 1, `${this.prefix}-${String(this.counter).padStart(4, "0")}`;
  }
  /**
   * Get the current counter value.
   */
  get count() {
    return this.counter;
  }
  /**
   * Reset the counter back to zero.
   */
  reset() {
    this.counter = 0;
  }
  /**
   * Advance the counter to at least `num` so that the next `next()` call
   * returns `num + 1`. Used when restoring state from storage.
   */
  advanceTo(e) {
    e > this.counter && (this.counter = e);
  }
}
function Qo(t) {
  const e = t.testId ?? t.dataCy ?? t.dataQa ?? t.stableId ?? t.dataAutoId;
  return e ? `id:${e}` : `css:${t.cssSelector}|xp:${t.xPath}`;
}
function Rg(t, e) {
  const n = new _g(), r = /* @__PURE__ */ new Map(), o = [];
  for (const s of t) {
    const c = s.trigger, l = Qo(c);
    if (r.has(l)) continue;
    const f = n.next();
    r.set(l, f);
    try {
      o.push(
        Ag({
          elementId: f,
          identity: c,
          sourceUrl: e,
          domTreePath: c.cssSelector
        })
      );
    } catch {
    }
  }
  return { freshElements: o, idByKey: r };
}
const ka = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  elementIdentityKey: Qo,
  harvestSessionElements: Rg
}, Symbol.toStringTag, { value: "Module" })), Ng = {
  Click: re.CLICK,
  TextEntry: re.FILL,
  Dropdown: re.SELECT,
  Checkbox: re.TOGGLE,
  RadioButton: re.SELECT,
  DatePicker: re.SELECT_DATE,
  Hover: re.HOVER,
  Link: re.CLICK,
  FileUpload: re.FILL,
  Slider: re.FILL,
  ColorInput: re.FILL,
  Tab: re.CLICK,
  Expander: re.CLICK,
  // 7.4-B1: replay parity — a human replays an
  // expander by clicking it; TOGGLE sets
  // .checked (checkbox-specific, no-op on
  // div/button triggers). Direction lives on
  // metadata + behavioral layer, never the input.
  Scroll: re.CLICK,
  // filtered as noise below
  Navigation: re.NAVIGATE,
  DragDrop: re.DRAG_DROP,
  KeyboardShortcut: re.KEYBOARD_SHORTCUT,
  CompoundInteraction: re.DRAG_DROP,
  // compound actions typically resolve to drag-drop or click
  Unclassified: re.CLICK
  // unreachable — NOISE_TYPES drops Unclassified before the mapping table is consulted (D2 DROP, 7.4-B4)
}, Og = /* @__PURE__ */ new Set([
  "Scroll",
  "Unclassified"
]), Pg = "chrome", xg = { width: 1280, height: 720 };
function $g(t) {
  try {
    const e = new URL(t);
    if (e.protocol === "http:" || e.protocol === "https:")
      return e.origin;
  } catch {
  }
  return t;
}
function Dg(t) {
  let e = 5381;
  for (let n = 0; n < t.length; n++)
    e = (e << 5) + e + t.charCodeAt(n), e = e & 4294967295;
  return (e >>> 0).toString(16).padStart(8, "0");
}
function Lg(t) {
  return t.map((e) => `${e.id}:${e.action}:${e.target.kind}:${String(e.input ?? "")}`).join("|");
}
function Mg(t) {
  const e = Xo(t);
  return Yo(e);
}
function so(t, e) {
  const n = Mg(t), r = Qo(t);
  return {
    kind: "element",
    elementId: ((e == null ? void 0 : e.get(r)) ?? "") || t.elementId,
    elementName: t.accessibleName || t.ariaLabel || t.tag,
    pageOrComponent: "main",
    resolvedLocators: n
  };
}
function Vg(t) {
  return { kind: "url", url: t };
}
function zc(t, e) {
  const n = e ?? Wc(t), r = t.metadata;
  switch (t.type) {
    case "TextEntry":
      return `Fill "${r.typedValue || r.textValue || ""}" in the ${n}`;
    case "Checkbox":
      return `${r.checked ?? !1 ? "Check" : "Uncheck"} the ${n}`;
    case "Dropdown":
    case "RadioButton":
      return `Select "${r.selectedValue ?? ""}" from the ${n}`;
    case "DatePicker":
      return `Select ${r.dateValue ?? r.selectedDate ?? ""} in the ${n}`;
    case "Navigation":
      return `Navigate to ${r.pageUrl ?? ""}`;
    case "Hover":
      return `Hover over the ${n}`;
    case "Slider":
      return `Set the slider to ${r.value ?? ""}`;
    case "ColorInput":
      return `Set the color to ${r.value ?? ""}`;
    case "FileUpload":
      return `Upload ${(r.fileName ?? "") || "a file"}`;
    case "Tab":
      return `Click the "${n}" tab`;
    case "Expander":
      return `Expand or collapse the ${n}`;
    case "Link":
      return `Click the "${n}" link`;
    case "DragDrop": {
      const o = r.sourceName ?? n, s = r.dropTargetName ?? "target";
      return `Drag "${o}" to ${s}`;
    }
    case "KeyboardShortcut":
      return `Press ${r.shortcut ?? ""}`;
    case "CompoundInteraction":
      return r.summary ?? n;
    default:
      return `Click the ${n}`;
  }
}
function qg(t, e) {
  const n = zc(t, e);
  return n.charAt(0).toUpperCase() + n.slice(1);
}
function Wc(t) {
  const e = t.trigger;
  return e.accessibleName || e.ariaLabel || e.tag;
}
function Ug(t) {
  const e = t.metadata;
  switch (t.type) {
    case "TextEntry":
      return e.typedValue || e.textValue || null;
    case "Checkbox":
      return e.checked ?? null;
    case "Dropdown":
    case "RadioButton":
      return e.selectedValue ?? null;
    case "DatePicker":
      return e.dateValue ?? e.selectedDate ?? null;
    case "Slider":
      return e.value ?? null;
    case "ColorInput":
      return e.value ?? null;
    case "Navigation":
      return e.pageUrl ?? null;
    case "FileUpload":
      return e.fileName ?? null;
    case "DragDrop": {
      const n = e.sourceName ?? "", r = e.dropTargetName ?? "";
      return n || r || null;
    }
    case "KeyboardShortcut":
      return e.shortcut ?? null;
    default:
      return null;
  }
}
function Bg(t, e, n) {
  return {
    type: t.type,
    comparison: t.comparison,
    severity: t.severity,
    expectedValue: t.expectedValue,
    property: t.property,
    target: {
      kind: "element",
      // Observed elements are not repository-tracked. A stable synthetic id
      // (unique per step+slot) is REQUIRED, not cosmetic: POM registration
      // keys locator getters by elementId, and a shared '' would collide
      // when one step asserts multiple observed elements (first-wins
      // substitution would point later assertions at the WRONG getter).
      elementId: `obs-${e}-${n}`,
      elementName: t.targetName,
      pageOrComponent: "main",
      resolvedLocators: [
        {
          type: Se.CSS,
          value: t.targetCss,
          priority: 1,
          confidence: 0.7
          // generic-selector confidence (no per-locator ranking ran)
        }
      ]
    }
  };
}
function ao(t, e, n, r) {
  var c;
  const o = [], s = e ? (c = r == null ? void 0 : r.stepAssertions) == null ? void 0 : c.get(e) : void 0;
  if (s)
    for (let l = 0; l < s.length; l++)
      o.push(Bg(s[l], n, l));
  return o;
}
function jg(t) {
  if (t.length <= 1) return t;
  const e = [];
  let n = 0;
  for (; n < t.length; ) {
    const r = t[n], o = t[n + 1];
    if (o && r.action === re.CLICK && o.action === re.CLICK && r.target.kind === "element" && o.target.kind === "element" && r.target.elementId === o.target.elementId)
      for (e.push(r), n++; n < t.length; ) {
        const s = t[n];
        if (!(s.action === re.CLICK && s.target.kind === "element" && r.target.kind === "element" && s.target.elementId === r.target.elementId && s.assertions.length === 0)) break;
        n++;
      }
    else
      e.push(r), n++;
  }
  return e.map((r, o) => ({ ...r, order: o }));
}
function Fg(t, e) {
  const n = [];
  try {
    const o = new URL(t.startUrl).pathname.split("/").filter(Boolean)[0];
    o && n.push(o);
  } catch {
  }
  if (e != null && e.surfaceTags)
    for (const r of e.surfaceTags)
      r && !n.includes(r) && n.push(r);
  return n.slice(0, 5);
}
function Kg(t) {
  const e = t.memberEvents.filter(
    (n) => n.eventType === "click"
  );
  for (let n = e.length - 1; n >= 0; n--) {
    const r = e[n];
    if (qr(r.target.ariaRole, r.target.className))
      return r;
  }
}
function Gg(t) {
  var b;
  const { interactions: e, recordingContext: n, testCaseName: r, enrichment: o, elementIdByKey: s } = t, c = [];
  let l = 0;
  for (const O of e) {
    if (Og.has(O.type)) continue;
    const q = (b = o == null ? void 0 : o.businessLabels) == null ? void 0 : b.get(O.interactionId);
    if (O.type === "Dropdown" && O.trigger.tag === "INPUT" && O.metadata.selectionConfirmed === !0) {
      const K = q ?? Wc(O), H = so(O.trigger, s), J = O.triggerEvent.eventId, oe = ao(
        H.kind === "element" ? H.elementId : "",
        J,
        l,
        o
      ), le = `Open the ${K} list`;
      c.push({
        id: `step-${String(l + 1).padStart(4, "0")}`,
        order: l,
        action: re.CLICK,
        description: le,
        plainEnglish: le.charAt(0).toUpperCase() + le.slice(1),
        target: H,
        input: null,
        assertions: oe,
        executionParameters: oo,
        sourceEventId: J
      }), l++;
      const fe = Kg(O), be = O.metadata.selectedValue ?? "", me = q ? be : (fe == null ? void 0 : fe.target.accessibleName) || (fe == null ? void 0 : fe.target.ariaLabel) || be || "", we = fe ? so(fe.target, s) : H, Ce = (fe == null ? void 0 : fe.eventId) ?? J, xe = ao(
        we.kind === "element" ? we.elementId : "",
        Ce,
        l,
        o
      ), je = `Select ${be || me}`;
      c.push({
        id: `step-${String(l + 1).padStart(4, "0")}`,
        order: l,
        action: re.CLICK,
        description: je,
        plainEnglish: je.charAt(0).toUpperCase() + je.slice(1),
        target: we,
        input: null,
        assertions: xe,
        executionParameters: oo,
        sourceEventId: Ce
      }), l++;
      continue;
    }
    const E = Ng[O.type] ?? re.CLICK;
    let $;
    if (E === re.NAVIGATE) {
      const K = O.metadata.pageUrl ?? n.startUrl;
      $ = Vg(K);
    } else
      $ = so(O.trigger, s);
    const V = Ug(O), j = zc(O, q), F = qg(O, q), P = O.triggerEvent.eventId, L = $.kind === "element" ? $.elementId : "", Y = ao(L, P, l, o);
    c.push({
      id: `step-${String(l + 1).padStart(4, "0")}`,
      order: l,
      action: E,
      description: j,
      target: $,
      input: V,
      assertions: Y,
      executionParameters: oo,
      sourceEventId: P,
      plainEnglish: F
    }), l++;
  }
  const f = jg(c), h = Fg(n, o), m = {
    baseUrl: $g(n.startUrl),
    startUrl: n.startUrl,
    browser: Pg,
    viewport: n.viewport ?? xg
  }, g = `${r}|${n.startUrl}|${Lg(f)}`, I = Dg(g);
  return {
    testCaseId: `tc-${I}`,
    testCaseVersionId: `tcv-${I}`,
    testCaseVersionNumber: 1,
    title: r,
    tags: h,
    environment: m,
    steps: f
  };
}
const Aa = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  build: Gg
}, Symbol.toStringTag, { value: "Module" })), Hg = [
  "aria-label",
  "data-count",
  "data-auto-id",
  "data-test-id",
  "data-test"
];
function zg(t) {
  return Hg.includes(t);
}
const ko = 3, Zo = 60, Wg = /* @__PURE__ */ new Set([
  "counter",
  "collection",
  "status-badge",
  "notification",
  "entity"
]);
function Ao(t) {
  const e = t.split(">").map((n) => n.trim());
  for (let n = e.length - 1; n >= 0; n--) {
    const r = e[n].match(/^([a-zA-Z][\w-]*)#([\w-]+)$/);
    if (r) return r[2];
  }
  return null;
}
function Yc(t) {
  return t.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function Yg(t) {
  if (t.kind !== "entity" || !t.entityId) return null;
  const e = t.attributes ?? {};
  for (const [n, r] of Object.entries(e))
    if (r === t.entityId && /^data-[\w-]+$/i.test(n))
      return `[${n.toLowerCase()}="${Yc(r)}"]`;
  return null;
}
function Xg(t) {
  if (t.kind === "entity" || t.uniqueInSnapshot !== !0) return null;
  const e = t.attributes ?? {};
  for (const [n, r] of Object.entries(e))
    if (zg(n) && !(!r || r.length === 0))
      return `[${n}="${Yc(r)}"]`;
  return null;
}
const Qg = [
  "data-asin",
  "data-product-id",
  "data-item-id",
  "data-sku",
  "data-order-id",
  "data-order-number"
];
function Zg(t) {
  if (t.entityId) return t.entityId;
  const e = t.attributes ?? {};
  for (const n of Qg) {
    const r = e[n];
    if (r) return r;
  }
  return null;
}
function Jg(t) {
  const e = /* @__PURE__ */ new Map(), n = [];
  for (const r of t) {
    const o = Zg(r);
    if (!o) {
      n.push(r);
      continue;
    }
    const s = e.get(o);
    s ? !s.entityId && r.entityId && e.set(o, r) : e.set(o, r);
  }
  return [...e.values(), ...n];
}
function ey(t) {
  const e = t.split(">"), r = (e[e.length - 1] ?? "").trim().match(/^([a-zA-Z][\w-]*)#([\w-]+)$/);
  return r ? r[2] : null;
}
function Mr(t) {
  if (t.kind === "entity") {
    const o = Yg(t);
    if (o) return { css: o, tier: "identity-attribute" };
    const s = Ao(t.domPath);
    return s ? { css: `#${s}`, tier: "id" } : { css: null, tier: "none" };
  }
  const e = ey(t.domPath);
  if (e) return { css: `#${e}`, tier: "id" };
  const n = Xg(t);
  if (n)
    return { css: n, tier: "identity-attribute" };
  const r = Ao(t.domPath);
  return r ? { css: `#${r}`, tier: "id" } : { css: null, tier: "none" };
}
function ty(t) {
  const e = (t.text ?? "").trim();
  if (e.length < 2 || /^[\d\s.,()+-]+$/.test(e)) return null;
  const n = e.replace(/\s+/g, " ").slice(0, Zo);
  return n.length >= 2 ? n : null;
}
function ny(t) {
  return t.filter(
    (e) => !t.some(
      (n) => n !== e && n.domPath.startsWith(e.domPath + " > ")
    )
  );
}
function ry(t) {
  const e = (t.text ?? "").trim();
  return e ? e.replace(/\s+/g, " ").slice(0, Zo) : null;
}
function iy(t) {
  var s, c, l, f, h, m;
  const e = [], n = {
    counter: [],
    collection: [],
    "status-badge": [],
    notification: [],
    entity: []
  };
  for (const g of t.items ?? [])
    Wg.has(g.kind) && g.visible && n[g.kind].push(g);
  const r = (g) => {
    e.length >= ko || e.push(g);
  };
  for (const g of ny(n.counter)) {
    if (g.numericValue === null || !Number.isFinite(g.numericValue)) continue;
    const I = ry(g);
    if (!I) continue;
    const b = Mr(g);
    b.css && r({
      type: "textMatch",
      comparison: "contains",
      severity: "soft",
      expectedValue: I,
      property: null,
      targetCss: b.css,
      targetName: ((c = (s = g.attributes) == null ? void 0 : s["aria-label"]) == null ? void 0 : c.slice(0, 60)) || "counter",
      derivedFrom: "counter"
    });
  }
  for (const g of n.collection) {
    if (g.numericValue === null || !Number.isFinite(g.numericValue)) continue;
    const I = Ao(g.domPath);
    I && r({
      type: "count",
      comparison: "equals",
      severity: "soft",
      expectedValue: g.numericValue,
      property: null,
      targetCss: `#${I} > *`,
      targetName: ((f = (l = g.attributes) == null ? void 0 : l["aria-label"]) == null ? void 0 : f.slice(0, 60)) || "collection",
      derivedFrom: "collection"
    });
  }
  for (const g of n["status-badge"]) {
    const I = ty(g);
    if (!I) continue;
    const b = Mr(g);
    b.css && r({
      type: "textMatch",
      comparison: "contains",
      severity: "soft",
      expectedValue: I,
      property: null,
      targetCss: b.css,
      targetName: I.slice(0, 30),
      derivedFrom: "status-badge"
    });
  }
  for (const g of n.notification) {
    const I = Mr(g);
    I.css && r({
      type: "presence",
      comparison: "isTrue",
      severity: "soft",
      expectedValue: null,
      property: null,
      targetCss: I.css,
      targetName: ((m = (h = g.attributes) == null ? void 0 : h["aria-label"]) == null ? void 0 : m.slice(0, 60)) || "notification",
      derivedFrom: "notification"
    });
  }
  const o = Jg(n.entity);
  for (const g of o) {
    const I = Mr(g);
    !I.css || I.tier === "none" || r({
      type: "presence",
      comparison: "isTrue",
      severity: "soft",
      expectedValue: null,
      property: null,
      targetCss: I.css,
      targetName: g.entityType ? `${g.entityType}:${g.entityId ?? ""}`.slice(0, 60) : "entity",
      derivedFrom: "entity"
    });
  }
  return e;
}
function Xc(t) {
  var n, r, o;
  const e = /* @__PURE__ */ new Map();
  for (const s of t) {
    const c = (n = s.triggerEvent) == null ? void 0 : n.eventId;
    if (!c) continue;
    const l = oy(s), f = (o = (r = s.behavioralEvidence) == null ? void 0 : r.applicationEvidence) == null ? void 0 : o.resultingState;
    let h = [];
    f && f.items && f.items.length > 0 && (h = iy(f)), l && (h.unshift(l), h.length > ko && (h.length = ko)), h.length !== 0 && e.set(c, h);
  }
  return e;
}
function oy(t) {
  var c;
  if (t.type !== "TextEntry" || t.endState !== "completed") return null;
  const e = t.metadata;
  if (!e || !(e.userTyped === !0)) return null;
  const r = e.textValue;
  if (typeof r != "string" || r.trim() === "") return null;
  const o = (c = t.trigger) == null ? void 0 : c.stableId;
  if (typeof o != "string" || o === "") return null;
  const s = typeof e.targetName == "string" && e.targetName.trim() !== "" ? e.targetName.slice(0, 60) : "input field";
  return {
    type: "equality",
    comparison: "equals",
    severity: "soft",
    expectedValue: r.trim().slice(0, Zo),
    property: "value",
    targetCss: `#${o}`,
    targetName: s,
    derivedFrom: "fill-committed-value"
  };
}
function sy(t, e) {
  const n = Xc(t);
  return n.size === 0 ? e ?? {} : {
    ...e,
    stepAssertions: n
  };
}
const _a = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  buildResultingStateEnrichment: sy,
  deriveStepAssertions: Xc
}, Symbol.toStringTag, { value: "Module" }));
class Jo extends Error {
  constructor(e) {
    super(e), this.name = "LocatorRenderError";
  }
}
function es(t, e = "page") {
  if (!t || t.length === 0)
    throw new Jo(
      "Cannot render an empty locator array (INV-EL4 requires at least one strategy)"
    );
  const r = [...t].sort((s, c) => s.priority - c.priority)[0], o = ay(r);
  return { pageRef: e, expression: o };
}
function ay(t) {
  switch (t.type) {
    case Se.ROLE:
      return cy(t.value);
    case Se.ACCESSIBLE_NAME:
      return ly(t.value);
    case Se.TEST_ID:
      return dy(t.value);
    case Se.TEXT:
      return fy(t.value);
    case Se.LABEL:
      return py(t.value);
    case Se.CSS:
      return hy(t.value);
    case Se.XPATH:
      return my(t.value);
    default:
      throw new Jo(
        `Unsupported locator strategy type: "${t.type}"`
      );
  }
}
function cy(t) {
  const e = uy(t), { role: n, name: r } = e;
  return r ? `getByRole('${n}', { name: '${pt(r)}' })` : `getByRole('${n}')`;
}
function uy(t) {
  const e = t.match(/^([a-zA-Z]+)\[name="(.+)"\]$/);
  if (e)
    return { role: e[1], name: e[2] };
  const n = t.match(/^([a-zA-Z]+)$/);
  if (n)
    return { role: n[1], name: null };
  throw new Jo(
    `Cannot parse ROLE locator value: "${t}". Expected format: 'role' or 'role[name="Display Name"]'`
  );
}
function ly(t) {
  return `getByLabel('${pt(t)}')`;
}
function dy(t) {
  const e = t.match(/\[data-testid=["'](.+?)["']\]/);
  if (e)
    return `getByTestId('${pt(e[1])}')`;
  const n = t.match(
    /^\[(data-)?(cy|qa|auto-id|test|test-id)=["']([^\]"',()]+)["']\]$/
  );
  return n ? `locator('[${n[1] ?? ""}${n[2]}="${pt(n[3])}"]')` : `getByTestId('${pt(t)}')`;
}
function fy(t) {
  return `getByText('${pt(t)}')`;
}
function py(t) {
  return `getByLabel('${pt(t)}')`;
}
function hy(t) {
  return `locator('${pt(t)}')`;
}
function my(t) {
  return t.startsWith("xpath=") ? `locator('${pt(t)}')` : `locator('xpath=${pt(t)}')`;
}
function pt(t) {
  return t.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function _o(t, e = "page", n) {
  const r = (n == null ? void 0 : n.indent) ?? "", o = gy(t, e);
  return o ? `${r}${o}` : "";
}
function gy(t, e) {
  switch (t.action) {
    case re.CLICK:
      return vy(t, e);
    case re.FILL:
      return wy(t, e);
    case re.SELECT:
      return by(t, e);
    case re.SELECT_DATE:
      return Iy(t, e);
    case re.TOGGLE:
      return Ey(t, e);
    case re.HOVER:
      return Sy(t, e);
    case re.NAVIGATE:
      return Ty(t, e);
    case re.VERIFY:
      return "";
    case re.WAIT:
      return Cy(t, e);
    case re.WAIT_FOR_ELEMENT:
      return "";
    default:
      throw new Error(
        `Unsupported IRAction: "${t.action}". This is an IR completeness gap — add a renderer for this action.`
      );
  }
}
const yy = /* @__PURE__ */ new Set([
  re.CLICK,
  re.FILL,
  re.SELECT,
  re.SELECT_DATE,
  re.TOGGLE,
  re.HOVER
]);
function bn(t) {
  if (!yy.has(t.action)) return "";
  const e = t.executionParameters.timeoutMs;
  return e === 3e4 ? "" : `, { timeout: ${e} }`;
}
function In(t, e) {
  if (t.target.kind !== "element")
    throw new Error(
      `Step "${t.description}" has action ${t.action} which requires an element target, but target kind is "${t.target.kind}".`
    );
  const n = es(t.target.resolvedLocators, e);
  return `${n.pageRef}.${n.expression}`;
}
function vy(t, e) {
  const n = In(t, e), r = bn(t);
  return `${n}.click(${r ? r.replace(/^, /, "") : ""})`;
}
function wy(t, e) {
  const n = In(t, e), r = ts(t.input), o = bn(t);
  return `${n}.fill('${r}'${o})`;
}
function by(t, e) {
  const n = In(t, e), r = ts(t.input), o = bn(t);
  return `${n}.selectOption('${r}'${o})`;
}
function Iy(t, e) {
  const n = In(t, e), r = ts(t.input), o = bn(t);
  return `${n}.fill('${r}'${o})`;
}
function Ey(t, e) {
  const n = In(t, e), r = bn(t);
  return t.input === !0 ? `${n}.check(${r ? r.replace(/^, /, "") : ""})` : t.input === !1 ? `${n}.uncheck(${r ? r.replace(/^, /, "") : ""})` : `${n}.click(${r ? r.replace(/^, /, "") : ""})`;
}
function Sy(t, e) {
  const n = In(t, e), r = bn(t);
  return `${n}.hover(${r ? r.replace(/^, /, "") : ""})`;
}
function Ty(t, e) {
  if (t.target.kind !== "url")
    throw new Error(
      `NAVIGATE step "${t.description}" must have a url target, but target kind is "${t.target.kind}".`
    );
  return `${e}.goto('${Qc(t.target.url)}')`;
}
function Cy(t, e) {
  const n = ky(t.input);
  return `${e}.waitForTimeout(${n})`;
}
function ts(t) {
  return t == null ? "" : Qc(String(t));
}
function ky(t) {
  return typeof t == "number" && t > 0 ? Math.round(t) : 1e3;
}
function Qc(t) {
  return t.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function Zc(t, e = "page", n) {
  const r = (o, s) => Ay(o, s, n);
  switch (t.type) {
    case bt.VISIBILITY:
      return _y(t, e, r);
    case bt.PRESENCE:
      return Ry(t, e, r);
    case bt.TEXT_MATCH:
      return Ny(t, e, r);
    case bt.ATTRIBUTE_MATCH:
      return Oy(t, e, r);
    case bt.COUNT:
      return Py(t, e, r);
    case bt.EQUALITY:
      return xy(t, e, r);
    case bt.URL_MATCH:
      return $y(t, e);
    case bt.CUSTOM:
      return Dy(t);
    default:
      throw new Error(
        `Unsupported ValidationType: "${t.type}". This is an IR completeness gap — add a renderer for this assertion type.`
      );
  }
}
function Pe(t, e) {
  return e.severity === ti.SOFT ? `expect.soft(${t})` : `expect(${t})`;
}
function Ay(t, e, n) {
  if (n && t.target.kind === "element")
    return n;
  if (t.target.kind === "element") {
    const r = es(t.target.resolvedLocators, e);
    return `${r.pageRef}.${r.expression}`;
  }
  return t.target.kind === "url", e;
}
function _y(t, e, n) {
  const r = n(t, e), o = t.comparison === Oe.IS_FALSE ? "toBeHidden()" : "toBeVisible()";
  return { lines: [`await ${Pe(r, t)}.${o}`] };
}
function Ry(t, e, n) {
  const r = n(t, e), s = t.comparison === Oe.IS_FALSE ? "not.toBeAttached()" : "toBeAttached()";
  return { lines: [`await ${Pe(r, t)}.${s}`] };
}
function Ny(t, e, n) {
  const r = n(t, e), o = String(t.expectedValue ?? "");
  switch (t.comparison) {
    case Oe.EQUALS:
      return { lines: [`await ${Pe(r, t)}.toHaveText('${Je(o)}')`] };
    case Oe.CONTAINS:
      return { lines: [`await ${Pe(r, t)}.toContainText('${Je(o)}')`] };
    case Oe.STARTS_WITH:
      return { lines: [`await ${Pe(r, t)}.toContainText(/^${Jn(o)}/)`] };
    case Oe.MATCHES:
      return { lines: [`await ${Pe(r, t)}.toHaveText(/${ns(o)}/)`] };
    default:
      throw new Error(
        `TEXT_MATCH does not support comparison "${t.comparison}". Expected: equals | contains | matches | startsWith`
      );
  }
}
function Oy(t, e, n) {
  const r = n(t, e), o = t.property ?? "unknown", s = String(t.expectedValue ?? "");
  switch (t.comparison) {
    case Oe.EQUALS:
      return { lines: [`await ${Pe(r, t)}.toHaveAttribute('${Je(o)}', '${Je(s)}')`] };
    case Oe.CONTAINS:
      return { lines: [`await ${Pe(r, t)}.toHaveAttribute('${Je(o)}', /${Jn(s)}/)`] };
    case Oe.MATCHES:
      return { lines: [`await ${Pe(r, t)}.toHaveAttribute('${Je(o)}', /${ns(s)}/)`] };
    default:
      throw new Error(
        `ATTRIBUTE_MATCH does not support comparison "${t.comparison}". Expected: equals | contains | matches`
      );
  }
}
function Py(t, e, n) {
  const r = n(t, e), o = Number(t.expectedValue);
  switch (t.comparison) {
    case Oe.EQUALS:
      return { lines: [`await ${Pe(r, t)}.toHaveCount(${o})`] };
    case Oe.GREATER_THAN: {
      const s = t.severity === ti.SOFT ? ".soft" : "";
      return {
        lines: [
          `const count_${Vr(t)} = await ${r}.count()`,
          `expect${s}(count_${Vr(t)}).toBeGreaterThan(${o})`
        ]
      };
    }
    case Oe.LESS_THAN: {
      const s = t.severity === ti.SOFT ? ".soft" : "";
      return {
        lines: [
          `const count_${Vr(t)} = await ${r}.count()`,
          `expect${s}(count_${Vr(t)}).toBeLessThan(${o})`
        ]
      };
    }
    default:
      throw new Error(
        `COUNT does not support comparison "${t.comparison}". Expected: equals | greaterThan | lessThan`
      );
  }
}
function xy(t, e, n) {
  var c;
  const r = n(t, e), o = t.comparison === Oe.IS_TRUE;
  switch (((c = t.property) == null ? void 0 : c.toLowerCase()) ?? "") {
    case "checked":
      return { lines: [
        `await ${Pe(r, t)}.${o ? "toBeChecked()" : "not.toBeChecked()"}`
      ] };
    case "enabled":
      return { lines: [
        `await ${Pe(r, t)}.${o ? "toBeEnabled()" : "toBeDisabled()"}`
      ] };
    case "editable":
      return { lines: [
        `await ${Pe(r, t)}.${o ? "toBeEditable()" : "not.toBeEditable()"}`
      ] };
    case "value": {
      if (t.comparison === Oe.EQUALS) {
        const h = String(t.expectedValue ?? "");
        return { lines: [
          `await ${Pe(r, t)}.toHaveValue('${Je(h)}')`
        ] };
      }
      const l = t.property ?? "value", f = o ? `toHaveAttribute('${Je(l)}', 'true')` : `not.toHaveAttribute('${Je(l)}', 'true')`;
      return { lines: [`await ${Pe(r, t)}.${f}`] };
    }
    default: {
      const l = t.property ?? "value", f = o ? `toHaveAttribute('${Je(l)}', 'true')` : `not.toHaveAttribute('${Je(l)}', 'true')`;
      return { lines: [`await ${Pe(r, t)}.${f}`] };
    }
  }
}
function $y(t, e, n) {
  const r = e, o = String(t.expectedValue ?? "");
  switch (t.comparison) {
    case Oe.EQUALS:
      return { lines: [`await ${Pe(r, t)}.toHaveURL('${Je(o)}')`] };
    case Oe.CONTAINS:
      return { lines: [`await ${Pe(r, t)}.toHaveURL(/${Jn(o)}/)`] };
    case Oe.STARTS_WITH:
      return { lines: [`await ${Pe(r, t)}.toHaveURL(/^${Jn(o)}/)`] };
    case Oe.MATCHES:
      return { lines: [`await ${Pe(r, t)}.toHaveURL(/${ns(o)}/)`] };
    default:
      throw new Error(
        `URL_MATCH does not support comparison "${t.comparison}". Expected: equals | contains | matches | startsWith`
      );
  }
}
function Dy(t) {
  return {
    lines: [
      `// TODO: Custom assertion — type: ${t.type}, comparison: ${t.comparison}` + (t.property ? `, property: ${t.property}` : "")
    ]
  };
}
function Je(t) {
  return t.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function Jn(t) {
  return t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
function ns(t) {
  try {
    return new RegExp(t), t.replace(/\//g, "\\/").replace(/\r\n/g, "\\n").replace(/[\n\r\u2028\u2029]/g, "\\n");
  } catch {
    return Jn(t);
  }
}
function Vr(t) {
  return t.target.kind === "element" ? t.target.elementId.replace(/[^a-zA-Z0-9]/g, "_") : String(t.expectedValue ?? "count").replace(/[^a-zA-Z0-9]/g, "_") || "count";
}
function Jc(t) {
  const e = /* @__PURE__ */ new Map();
  for (const n of t.steps) {
    if (n.target.kind === "element") {
      const r = n.target, o = r.pageOrComponent;
      e.has(o) || e.set(o, { elements: /* @__PURE__ */ new Map(), methods: [], methodKeys: /* @__PURE__ */ new Set() });
      const s = e.get(o);
      if (s.elements.has(r.elementId) || s.elements.set(r.elementId, {
        elementId: r.elementId,
        elementName: r.elementName,
        locators: r.resolvedLocators,
        getterName: rs(r.elementName)
      }), qy(n.action)) {
        const c = Uy(n.action, r, n.input);
        if (c) {
          const l = `${n.action}:${c.elementGetter}`;
          s.methodKeys.has(l) || (s.methodKeys.add(l), s.methods.push(c));
        }
      }
    }
    for (const r of n.assertions)
      Ly(r, e);
  }
  return Array.from(e.entries()).map(([n, r]) => ({
    pageName: n,
    fileName: Fy(n),
    className: jy(n),
    elements: Array.from(r.elements.values()),
    methods: r.methods
  }));
}
function Ly(t, e) {
  if (t.target.kind !== "element") return;
  const n = t.target, r = n.pageOrComponent;
  e.has(r) || e.set(r, { elements: /* @__PURE__ */ new Map(), methods: [], methodKeys: /* @__PURE__ */ new Set() });
  const o = e.get(r);
  o.elements.has(n.elementId) || o.elements.set(n.elementId, {
    elementId: n.elementId,
    elementName: n.elementName,
    locators: n.resolvedLocators,
    getterName: rs(n.elementName)
  });
}
function My(t) {
  const e = [];
  if (e.push("import { Page, Locator } from '@playwright/test';"), e.push(""), e.push(`export class ${t.className} {`), e.push("  readonly page: Page;"), e.push(""), e.push("  constructor(page: Page) {"), e.push("    this.page = page;"), e.push("  }"), t.elements.length > 0) {
    e.push(""), e.push("  // ── Locators ──");
    for (const n of t.elements) {
      e.push(""), e.push(`  get ${n.getterName}(): Locator {`);
      const r = es(n.locators, "this.page");
      e.push(`    return ${r.pageRef}.${r.expression};`), e.push("  }");
    }
  }
  if (t.methods.length > 0) {
    e.push(""), e.push("  // ── Actions ──");
    for (const n of t.methods) {
      e.push("");
      const r = n.params ? `${n.params}` : "";
      e.push(`  async ${n.methodName}(${r}): Promise<void> {`), e.push(`    ${n.body}`), e.push("  }");
    }
  }
  return e.push("}"), e.push(""), e.join(`
`);
}
function Vy(t) {
  return Jc(t).map((n) => ({
    path: `pages/${n.fileName}`,
    content: My(n)
  }));
}
function qy(t) {
  return t === re.CLICK || t === re.FILL || t === re.SELECT || t === re.SELECT_DATE || t === re.TOGGLE || t === re.HOVER;
}
function _t(t, e) {
  const n = Ky(is(e));
  return n.length > 0 && n.length < t.length && t.toLowerCase().endsWith(n.toLowerCase()) ? t : t + n;
}
function Uy(t, e, n) {
  const r = rs(e.elementName);
  switch (t) {
    case re.CLICK:
      return {
        methodName: _t("click", e.elementName),
        action: t,
        elementGetter: r,
        params: "",
        body: `await this.${r}.click()`
      };
    case re.FILL:
      return {
        methodName: _t("fill", e.elementName),
        action: t,
        elementGetter: r,
        params: "value: string",
        body: `await this.${r}.fill(value)`
      };
    case re.SELECT:
      return {
        methodName: _t("select", e.elementName),
        action: t,
        elementGetter: r,
        params: "value: string",
        body: `await this.${r}.selectOption(value)`
      };
    case re.SELECT_DATE:
      return {
        methodName: _t("setDate", e.elementName),
        action: t,
        elementGetter: r,
        params: "date: string",
        body: `await this.${r}.fill(date)`
      };
    case re.TOGGLE:
      return n === !0 ? {
        methodName: _t("check", e.elementName),
        action: t,
        elementGetter: r,
        params: "",
        body: `await this.${r}.check()`
      } : n === !1 ? {
        methodName: _t("uncheck", e.elementName),
        action: t,
        elementGetter: r,
        params: "",
        body: `await this.${r}.uncheck()`
      } : {
        methodName: _t("toggle", e.elementName),
        action: t,
        elementGetter: r,
        params: "",
        body: `await this.${r}.click()`
      };
    case re.HOVER:
      return {
        methodName: _t("hover", e.elementName),
        action: t,
        elementGetter: r,
        params: "",
        body: `await this.${r}.hover()`
      };
    default:
      return null;
  }
}
const By = [
  "Input",
  "Button",
  "Checkbox",
  "Radio",
  "Dropdown",
  "Field",
  "Element",
  "Item",
  "Select",
  "Text",
  "Menu",
  "Link",
  "Switch",
  "Picker"
];
function rs(t) {
  return Gy(t);
}
function jy(t) {
  return !t.includes(" ") && /^[A-Z]/.test(t) ? t : is(t);
}
function Fy(t) {
  return t.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").replace(/-+/g, "-") + ".ts";
}
function Ky(t) {
  for (const e of By)
    if (t.endsWith(e) && t.length > e.length)
      return t.slice(0, -e.length);
  return t;
}
function Gy(t) {
  const e = is(t);
  return e.charAt(0).toLowerCase() + e.slice(1);
}
function is(t) {
  return t.split(/\s+/).map((e) => e.charAt(0).toUpperCase() + e.slice(1)).join("");
}
const eu = "// NOTE: No assertions generated — assertion derivation is not available. This test replays actions only.";
function tu(t) {
  return t.length > 0 && t.every((e) => e.assertions.length === 0);
}
function nu(t) {
  return t.filter((e) => e.action !== re.WAIT_FOR_ELEMENT);
}
function Hy(t, e) {
  const n = "  ", r = [];
  r.push("import { test, expect } from '@playwright/test';"), r.push("");
  const o = t.title;
  r.push(`test.describe('${er(o)}', () => {`);
  const s = ru(t.title);
  r.push(`${n}test('${er(s)}', async ({ page }) => {`);
  const c = n + n, l = zy(t.steps, c);
  return r.push(...l), r.push(`${n}});`), r.push("});"), r.push(""), r.join(`
`);
}
function zy(t, e) {
  const n = [];
  tu(nu(t)) && (n.push(`${e}${eu}`), n.push(""));
  for (const r of t) {
    if (r.action === re.WAIT_FOR_ELEMENT) continue;
    n.push(`${e}// ${r.description}`);
    const o = _o(r, "page", { indent: e });
    o && n.push(`${e}await ${o.trim()}`);
    for (const s of r.assertions) {
      const c = Zc(s, "page");
      for (const l of c.lines)
        n.push(`${e}${l}`);
    }
    n.push("");
  }
  return n.length > 0 && n[n.length - 1] === "" && n.pop(), n;
}
function ru(t) {
  return `should complete ${t.charAt(0).toLowerCase() + t.slice(1)} successfully`;
}
function Wy(t) {
  const e = "  ", n = "    ", r = Jc(t), o = [];
  o.push("import { test, expect } from '@playwright/test';");
  for (const m of r) {
    const g = m.fileName.replace(/\.ts$/, "");
    o.push(`import { ${m.className} } from '../pages/${g}';`);
  }
  o.push(""), o.push(`test.describe('${er(t.title)}', () => {`);
  const s = ru(t.title);
  o.push(`${e}test('${er(s)}', async ({ page }) => {`);
  const c = /* @__PURE__ */ new Map();
  for (const m of r) {
    const g = co(m.className);
    c.set(m.pageName, g), o.push(`${n}const ${g} = new ${m.className}(page);`);
  }
  r.length > 0 && o.push("");
  const l = /* @__PURE__ */ new Map();
  for (const m of r) {
    const g = co(m.className);
    for (const I of m.elements)
      l.set(I.elementId, `${g}.${I.getterName}`);
  }
  const f = /* @__PURE__ */ new Map();
  for (const m of r) {
    const g = co(m.className);
    for (const I of m.methods)
      f.set(`${I.action}:${I.elementGetter}`, {
        instanceName: g,
        methodName: I.methodName
      });
  }
  const h = Yy(t.steps, l, f, n);
  return o.push(...h), o.push(`${e}});`), o.push("});"), o.push(""), o.join(`
`);
}
function Yy(t, e, n, r) {
  const o = [];
  tu(nu(t)) && (o.push(`${r}${eu}`), o.push(""));
  for (const s of t)
    if (s.action !== re.WAIT_FOR_ELEMENT) {
      if (o.push(`${r}// ${s.description}`), s.action === re.NAVIGATE || s.action === re.WAIT) {
        const c = _o(s, "page", { indent: "" });
        c && o.push(`${r}await ${c.trim()}`);
      } else if (s.target.kind === "element") {
        const c = s.target;
        if (e.get(c.elementId)) {
          const f = Qy(c.elementName), h = `${s.action}:${f}`, m = n.get(h);
          if (m && s.action !== re.VERIFY) {
            const g = Xy(s);
            o.push(`${r}await ${m.instanceName}.${m.methodName}(${g})`);
          }
        } else {
          const f = _o(s, "page", { indent: "" });
          f && o.push(`${r}await ${f.trim()}`);
        }
      }
      for (const c of s.assertions) {
        let l;
        c.target.kind === "element" && (l = e.get(c.target.elementId));
        const f = Zc(c, "page", l);
        for (const h of f.lines)
          o.push(`${r}${h}`);
      }
      o.push("");
    }
  return o.length > 0 && o[o.length - 1] === "" && o.pop(), o;
}
function Xy(t) {
  switch (t.action) {
    case re.FILL:
    case re.SELECT:
    case re.SELECT_DATE:
      return `'${er(String(t.input ?? ""))}'`;
    default:
      return "";
  }
}
function Qy(t) {
  return t.split(/\s+/).map(
    (e, n) => n === 0 ? e.toLowerCase() : e.charAt(0).toUpperCase() + e.slice(1)
  ).join("");
}
function co(t) {
  return t.charAt(0).toLowerCase() + t.slice(1);
}
function er(t) {
  return t.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
const Zy = "^1.52.0";
class Jy {
  /**
   * Generate a complete Playwright project from an IR plan.
   */
  async generate(e, n) {
    const r = iu(e, n);
    return {
      files: r,
      projectMetadata: {
        engine: "playwright",
        language: n.language,
        pattern: n.pattern,
        fileCount: r.length
      }
    };
  }
}
function iu(t, e) {
  const n = [
    ou(t),
    su(t),
    (e == null ? void 0 : e.pattern) === "page-object" ? Ro(!0) : Ro(),
    au()
  ];
  if ((e == null ? void 0 : e.pattern) === "page-object") {
    const r = uu(t), o = Vy(t);
    return [...n, r, ...o];
  }
  return [...n, cu(t)];
}
function ou(t) {
  const e = ui(t.title);
  return { path: "package.json", content: JSON.stringify({
    name: e,
    version: "1.0.0",
    private: !0,
    description: `Playwright tests for ${t.title}`,
    scripts: {
      test: "npx playwright test",
      "test:headed": "npx playwright test --headed",
      "test:ui": "npx playwright test --ui",
      report: "npx playwright show-report"
    },
    devDependencies: {
      "@playwright/test": Zy
    }
  }, null, 2) + `
` };
}
function su(t) {
  const e = t.environment, n = ev(e.browser);
  return { path: "playwright.config.ts", content: [
    "import { defineConfig, devices } from '@playwright/test';",
    "",
    "/**",
    ` * Playwright configuration for ${tv(t.title)}.`,
    " * Generated by CmdRunner from the Execution IR.",
    " */",
    "export default defineConfig({",
    "  testDir: './tests',",
    "  fullyParallel: true,",
    "  forbidOnly: !!process.env.CI,",
    "  retries: process.env.CI ? 2 : 0,",
    "  workers: process.env.CI ? 1 : undefined,",
    "  reporter: 'html',",
    "  use: {",
    `    baseURL: '${nv(e.baseUrl)}',`,
    `    viewport: { width: ${e.viewport.width}, height: ${e.viewport.height} },`,
    "    trace: 'on-first-retry',",
    "  },",
    "  projects: [",
    "    {",
    `      name: '${n.projectName}',`,
    `      use: { ...devices['${n.deviceName}'] },`,
    "    },",
    "  ],",
    "});",
    ""
  ].join(`
`) };
}
function Ro(t = !1) {
  return { path: "tsconfig.json", content: JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "commonjs",
      moduleResolution: "node",
      strict: !0,
      esModuleInterop: !0,
      skipLibCheck: !0,
      forceConsistentCasingInFileNames: !0,
      outDir: "./test-out"
    },
    include: t ? ["tests/**/*.ts", "pages/**/*.ts"] : ["tests/**/*.ts"]
  }, null, 2) + `
` };
}
function au() {
  return { path: ".gitignore", content: [
    "node_modules/",
    "test-results/",
    "playwright-report/",
    "playwright/.cache/",
    ""
  ].join(`
`) };
}
function cu(t) {
  const e = ui(t.title), n = Hy(t);
  return { path: `tests/${e}.spec.ts`, content: n };
}
function uu(t) {
  const e = ui(t.title), n = Wy(t);
  return { path: `tests/${e}.spec.ts`, content: n };
}
function ev(t) {
  switch (t) {
    case "chrome":
      return { projectName: "chromium", deviceName: "Desktop Chrome" };
    case "firefox":
      return { projectName: "firefox", deviceName: "Desktop Firefox" };
    case "safari":
      return { projectName: "webkit", deviceName: "Desktop Safari" };
    case "edge":
      return { projectName: "msedge", deviceName: "Desktop Edge" };
    default:
      throw new Error(
        `Unsupported browser "${t}" in IR environment. Expected: chrome | firefox | safari | edge.`
      );
  }
}
function ui(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function tv(t) {
  return t.replace(/\*\//g, "*\\/").replace(/\/\*/g, "\\/\\*");
}
function nv(t) {
  return t.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
const rv = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  PlaywrightCodeGenerator: Jy,
  buildGitIgnore: au,
  buildPackageJson: ou,
  buildPlaywrightConfig: su,
  buildPomTestSpec: uu,
  buildProjectFiles: iu,
  buildTestSpec: cu,
  buildTsConfig: Ro,
  slugify: ui
}, Symbol.toStringTag, { value: "Module" }));
function iv(t) {
  var o, s, c;
  const e = (o = t.name) == null ? void 0 : o.trim();
  if (!e)
    throw new Te("Project", "name");
  const n = (s = t.createdBy) == null ? void 0 : s.trim();
  if (!n)
    throw new Te("Project", "createdBy");
  const r = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: crypto.randomUUID(),
    name: e,
    description: ((c = t.description) == null ? void 0 : c.trim()) ?? "",
    tags: t.tags ?? [],
    status: Uc.ACTIVE,
    createdAt: r,
    updatedAt: r,
    createdBy: n
  };
}
function ov(t, e) {
  const n = e.name !== void 0 ? e.name.trim() : t.name;
  if (!n)
    throw new Te("Project", "name");
  return {
    ...t,
    name: n,
    description: e.description !== void 0 ? e.description.trim() : t.description,
    tags: e.tags ?? t.tags,
    status: e.status ?? t.status,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
class sv {
  constructor(e) {
    this.projects = e;
  }
  async getById(e) {
    return this.projects.get(e);
  }
  async getAll() {
    return this.projects.toArray();
  }
  async create(e) {
    const n = iv(e);
    return await this.projects.add(n), n;
  }
  async update(e, n) {
    const r = await this.projects.get(e);
    if (!r)
      throw new Error(`Project not found: ${e}`);
    const o = ov(r, n);
    return await this.projects.put(o), o;
  }
  async delete(e) {
    await this.projects.delete(e);
  }
}
function av(t) {
  if (!t.type)
    throw new _e("Validation", "type is required");
  if (!t.comparison)
    throw new _e("Validation", "comparison is required");
  const e = t.comparison === Oe.IS_TRUE || t.comparison === Oe.IS_FALSE;
  if (!e && t.expectedValue === void 0)
    throw new _e(
      "Validation",
      `expectedValue is required for comparison "${t.comparison}"`
    );
  return {
    id: crypto.randomUUID(),
    type: t.type,
    elementId: t.elementId ?? null,
    property: t.property ?? null,
    comparison: t.comparison,
    expectedValue: e ? null : t.expectedValue,
    severity: t.severity
  };
}
const cv = /* @__PURE__ */ new Set([
  Co.NAVIGATE,
  Co.WAIT
]);
function uv(t) {
  var o, s;
  if (!t.action)
    throw new _e("Step", "action is required");
  const e = (o = t.description) == null ? void 0 : o.trim();
  if (!e)
    throw new Te("Step", "description");
  if (!Number.isInteger(t.order) || t.order < 0)
    throw new _e("Step", `order must be a non-negative integer (got ${t.order})`);
  if (!cv.has(t.action) && (!t.elementId || !t.elementId.trim()))
    throw new _e(
      "Step",
      `elementId is required for action "${t.action}"`
    );
  const r = (t.validations ?? []).map(av);
  return {
    id: crypto.randomUUID(),
    order: t.order,
    action: t.action,
    description: e,
    elementId: ((s = t.elementId) == null ? void 0 : s.trim()) || null,
    input: t.input ?? null,
    validations: r
  };
}
function lv(t) {
  return t ? {
    confidence: t.confidence ?? null,
    reasoning: t.reasoning ?? "",
    modelVersion: t.modelVersion ?? "",
    interpretationTimestamp: t.interpretationTimestamp ?? (/* @__PURE__ */ new Date()).toISOString()
  } : null;
}
function lu(t) {
  var o, s;
  if (!((o = t.testCaseId) != null && o.trim()))
    throw new Te("TestCaseVersion", "testCaseId");
  const e = (s = t.createdBy) == null ? void 0 : s.trim();
  if (!e)
    throw new Te("TestCaseVersion", "createdBy");
  if (!Number.isInteger(t.versionNumber) || t.versionNumber < 1)
    throw new _e(
      "TestCaseVersion",
      `versionNumber must be ≥ 1 (got ${t.versionNumber})`
    );
  const n = (/* @__PURE__ */ new Date()).toISOString(), r = t.steps.map(uv);
  return {
    id: crypto.randomUUID(),
    testCaseId: t.testCaseId.trim(),
    versionNumber: t.versionNumber,
    steps: r,
    sourceArtifactIds: t.sourceArtifactIds ?? [],
    aiMetadata: lv(t.aiMetadata),
    changeSummary: t.changeSummary ?? "",
    parentVersionId: t.parentVersionId ?? null,
    approvedBy: null,
    approvedAt: null,
    createdAt: n,
    createdBy: e
  };
}
function dv(t, e) {
  const n = e == null ? void 0 : e.trim();
  if (!n)
    throw new Te("TestCaseVersion", "approvedBy");
  return {
    ...t,
    approvedBy: n,
    approvedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
const fv = /* @__PURE__ */ new Map([
  [ze.DRAFT, [ze.IN_REVIEW]],
  [ze.IN_REVIEW, [ze.APPROVED, ze.DRAFT]],
  [ze.APPROVED, [ze.DEPRECATED, ze.DRAFT]],
  [ze.DEPRECATED, []]
]);
function pv(t, e) {
  const n = fv.get(t);
  return n ? n.includes(e) : !1;
}
function hv(t) {
  var l, f, h, m;
  if (!((l = t.projectId) != null && l.trim()))
    throw new Te("ApprovedTestCase", "projectId");
  const e = (f = t.title) == null ? void 0 : f.trim();
  if (!e)
    throw new Te("ApprovedTestCase", "title");
  const n = (h = t.createdBy) == null ? void 0 : h.trim();
  if (!n)
    throw new Te("ApprovedTestCase", "createdBy");
  const r = (/* @__PURE__ */ new Date()).toISOString(), o = lu({
    testCaseId: "pending",
    // temporary — replaced below
    versionNumber: 1,
    steps: t.steps,
    sourceArtifactIds: t.sourceArtifactIds,
    aiMetadata: t.aiMetadata,
    changeSummary: t.changeSummary ?? "Initial version",
    parentVersionId: null,
    createdBy: n
  }), s = crypto.randomUUID();
  return {
    testCase: {
      id: s,
      projectId: t.projectId.trim(),
      title: e,
      description: ((m = t.description) == null ? void 0 : m.trim()) ?? "",
      tags: t.tags ?? [],
      priority: t.priority ?? Bc.MEDIUM,
      status: ze.DRAFT,
      currentVersionId: o.id,
      testDataRefs: t.testDataRefs ?? [],
      capabilityId: null,
      createdAt: r,
      updatedAt: r,
      createdBy: n
    },
    version: { ...o, testCaseId: s }
  };
}
function mv(t, e) {
  const n = e.title !== void 0 ? e.title.trim() : t.title;
  if (!n)
    throw new Te("ApprovedTestCase", "title");
  return {
    ...t,
    title: n,
    description: e.description !== void 0 ? e.description.trim() : t.description,
    tags: e.tags ?? t.tags,
    priority: e.priority ?? t.priority,
    testDataRefs: e.testDataRefs ?? t.testDataRefs,
    capabilityId: e.capabilityId !== void 0 ? e.capabilityId : t.capabilityId,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function uo(t, e) {
  if (!pv(t.status, e))
    throw new Cg(t.status, e);
  return {
    ...t,
    status: e,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function gv(t, e) {
  if (!(e != null && e.trim()))
    throw new Te("ApprovedTestCase", "currentVersionId");
  return {
    ...t,
    currentVersionId: e,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
class yv {
  constructor(e, n) {
    this.testCases = e, this.testCaseVersions = n;
  }
  // ── ATC Identity ────────────────────────────────────────
  async getById(e) {
    return this.testCases.get(e);
  }
  async getByProject(e) {
    return this.testCases.where("projectId").equals(e).toArray();
  }
  async getByTag(e, n) {
    const r = await this.testCases.where("tags").anyOf(n).and((s) => s.projectId === e).toArray(), o = /* @__PURE__ */ new Map();
    for (const s of r)
      o.set(s.id, s);
    return Array.from(o.values());
  }
  // ── Versioning ──────────────────────────────────────────
  async create(e) {
    const { testCase: n, version: r } = hv(e);
    return await this.testCases.add(n), await this.testCaseVersions.add(r), { testCase: n, version: r };
  }
  async createVersion(e, n, r) {
    const o = await this.testCases.get(e);
    if (!o)
      throw new Error(`Test case not found: ${e}`);
    const l = (await this.testCaseVersions.where("testCaseId").equals(e).toArray()).reduce((I, b) => Math.max(I, b.versionNumber), 0) + 1, f = await this.testCaseVersions.get(o.currentVersionId), h = lu({
      testCaseId: e,
      versionNumber: l,
      steps: n,
      changeSummary: r == null ? void 0 : r.changeSummary,
      sourceArtifactIds: r == null ? void 0 : r.sourceArtifactIds,
      aiMetadata: r == null ? void 0 : r.aiMetadata,
      parentVersionId: (f == null ? void 0 : f.id) ?? null,
      createdBy: r.createdBy
    });
    await this.testCaseVersions.add(h);
    const m = gv(o, h.id), g = m.status === ze.DRAFT ? m : uo(m, ze.DRAFT);
    return await this.testCases.put(g), h;
  }
  async getVersion(e) {
    return this.testCaseVersions.get(e);
  }
  async getCurrentVersion(e) {
    const n = await this.testCases.get(e);
    if (n)
      return this.testCaseVersions.get(n.currentVersionId);
  }
  async listVersions(e) {
    return (await this.testCaseVersions.where("testCaseId").equals(e).toArray()).sort((r, o) => r.versionNumber - o.versionNumber);
  }
  // ── Metadata Updates ────────────────────────────────────
  async updateMetadata(e, n) {
    const r = await this.testCases.get(e);
    if (!r)
      throw new Error(`Test case not found: ${e}`);
    const o = mv(r, n);
    return await this.testCases.put(o), o;
  }
  // ── Status Transitions ──────────────────────────────────
  async transitionStatus(e, n) {
    const r = await this.testCases.get(e);
    if (!r)
      throw new Error(`Test case not found: ${e}`);
    const o = uo(r, n);
    return await this.testCases.put(o), o;
  }
  async approve(e, n) {
    const r = await this.testCases.get(e);
    if (!r)
      throw new Error(`Test case not found: ${e}`);
    const o = await this.testCaseVersions.get(r.currentVersionId);
    if (!o)
      throw new Error(`Current version not found: ${r.currentVersionId}`);
    const s = dv(o, n);
    await this.testCaseVersions.put(s);
    const c = uo(r, ze.APPROVED);
    await this.testCases.put(c);
  }
  // ── Referential Integrity ───────────────────────────────
  async findVersionsReferencingElement(e) {
    const n = await this.testCaseVersions.toArray(), r = [];
    for (const o of n) {
      const s = o.steps.some((l) => l.elementId === e), c = o.steps.some(
        (l) => l.validations.some((f) => f.elementId === e)
      );
      (s || c) && r.push({ versionId: o.id, testCaseId: o.testCaseId });
    }
    return r;
  }
  async delete(e) {
    const n = await this.testCaseVersions.where("testCaseId").equals(e).primaryKeys();
    await this.testCaseVersions.bulkDelete(n), await this.testCases.delete(e);
  }
}
function os(t) {
  if (!t.type)
    throw new _e("LocatorStrategy", "type is required");
  if (!t.value || !t.value.trim())
    throw new _e("LocatorStrategy", "value is required");
  if (!Number.isInteger(t.priority) || t.priority < 1)
    throw new _e(
      "LocatorStrategy",
      `priority must be a positive integer (got ${t.priority})`
    );
  return {
    type: t.type,
    value: t.value.trim(),
    priority: t.priority,
    confidence: t.confidence ?? null
  };
}
function vv(t, e) {
  return t.type === e.type && t.value === e.value;
}
function wv(t, e) {
  var m;
  if (!((m = e.context.sourceSessionId) != null && m.trim()))
    throw new Te("HealContext", "sourceSessionId");
  if (!e.newStrategies || e.newStrategies.length === 0)
    throw new _e(
      "Element",
      "newStrategies must have at least one strategy for healing"
    );
  const n = t.locatorStrategies, r = e.newStrategies.map(os), o = [], s = /* @__PURE__ */ new Set();
  let c = 1;
  for (const g of r) {
    const I = n.find((b) => vv(b, g));
    I ? o.push({ ...I, priority: c++ }) : o.push({ ...g, priority: c++ }), s.add(g.type);
  }
  for (const g of n)
    s.has(g.type) || o.push({ ...g, priority: c++ });
  const l = /* @__PURE__ */ new Set();
  for (const g of o) {
    if (l.has(g.priority))
      throw new _e(
        "Element",
        `duplicate locator strategy priority ${g.priority} — priorities must be unique`
      );
    l.add(g.priority);
  }
  const f = (/* @__PURE__ */ new Date()).toISOString(), h = {
    healedAt: f,
    runId: e.context.sourceSessionId,
    reason: e.context.reason,
    proposedBy: e.context.proposedBy,
    oldStrategies: [...n],
    newStrategies: o
  };
  return {
    ...t,
    locatorStrategies: o,
    status: Ho.ACTIVE,
    lastHealedAt: f,
    healHistory: [...t.healHistory, h],
    updatedAt: f
  };
}
function bv(t) {
  var s, c, l, f;
  if (!((s = t.projectId) != null && s.trim()))
    throw new Te("Element", "projectId");
  const e = (c = t.logicalName) == null ? void 0 : c.trim();
  if (!e)
    throw new Te("Element", "logicalName");
  if (!t.locatorStrategies || t.locatorStrategies.length === 0)
    throw new _e(
      "Element",
      "locatorStrategies must have at least one strategy (INV-EL4)"
    );
  const n = t.locatorStrategies.map(os), r = /* @__PURE__ */ new Set();
  for (const h of n) {
    if (r.has(h.priority))
      throw new _e(
        "Element",
        `duplicate locator strategy priority ${h.priority} — priorities must be unique`
      );
    r.add(h.priority);
  }
  const o = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: crypto.randomUUID(),
    projectId: t.projectId.trim(),
    logicalName: e,
    description: ((l = t.description) == null ? void 0 : l.trim()) ?? "",
    pageOrComponent: ((f = t.pageOrComponent) == null ? void 0 : f.trim()) ?? "",
    locatorStrategies: n,
    status: Ho.ACTIVE,
    createdAt: o,
    updatedAt: o,
    lastHealedAt: null,
    healHistory: []
  };
}
function Iv(t, e) {
  const n = e.logicalName !== void 0 ? e.logicalName.trim() : t.logicalName;
  if (!n)
    throw new Te("Element", "logicalName");
  let r = t.locatorStrategies;
  if (e.locatorStrategies) {
    if (e.locatorStrategies.length === 0)
      throw new _e(
        "Element",
        "locatorStrategies must have at least one strategy (INV-EL4)"
      );
    r = e.locatorStrategies.map(os);
    const o = /* @__PURE__ */ new Set();
    for (const s of r) {
      if (o.has(s.priority))
        throw new _e(
          "Element",
          `duplicate locator strategy priority ${s.priority} — priorities must be unique`
        );
      o.add(s.priority);
    }
  }
  return {
    ...t,
    logicalName: n,
    description: e.description !== void 0 ? e.description.trim() : t.description,
    pageOrComponent: e.pageOrComponent !== void 0 ? e.pageOrComponent.trim() : t.pageOrComponent,
    status: e.status ?? t.status,
    locatorStrategies: r,
    healHistory: e.healHistory ?? t.healHistory,
    lastHealedAt: e.lastHealedAt ?? t.lastHealedAt,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
class Ev {
  constructor(e, n) {
    this.elements = e, this.testCaseVersions = n;
  }
  async getById(e) {
    return this.elements.get(e);
  }
  async getByProject(e) {
    return this.elements.where("projectId").equals(e).toArray();
  }
  async getByPageComponent(e, n) {
    return this.elements.where("[projectId+pageOrComponent]").equals([e, n]).toArray();
  }
  async create(e) {
    const n = bv(e);
    return await this.elements.add(n), n;
  }
  async update(e, n) {
    const r = await this.elements.get(e);
    if (!r)
      throw new Error(`Element not found: ${e}`);
    const o = Iv(r, n);
    return await this.elements.put(o), o;
  }
  async delete(e) {
    const n = await this.findReferencingVersions(e);
    if (n.length > 0)
      throw new Tg(e, n.map((r) => r.versionId));
    await this.elements.delete(e);
  }
  async isReferenced(e) {
    return (await this.findReferencingVersions(e)).map((r) => r.versionId);
  }
  /**
   * Scan all versions for steps or validations referencing this element.
   * This is an O(n) scan over versions, acceptable for V1 scale.
   * Future optimization: maintain a reverse index.
   */
  async findReferencingVersions(e) {
    const n = await this.testCaseVersions.toArray(), r = [];
    for (const o of n) {
      const s = o.steps.some((l) => l.elementId === e), c = o.steps.some(
        (l) => l.validations.some((f) => f.elementId === e)
      );
      (s || c) && r.push({ versionId: o.id, testCaseId: o.testCaseId });
    }
    return r;
  }
}
function Sv(t) {
  var n, r;
  if (!((n = t.projectId) != null && n.trim()))
    throw new Te("SourceArtifact", "projectId");
  if (!t.type)
    throw new Te("SourceArtifact", "type");
  if (!t.content || typeof t.content != "object")
    throw new Te("SourceArtifact", "content");
  const e = (r = t.createdBy) == null ? void 0 : r.trim();
  if (!e)
    throw new Te("SourceArtifact", "createdBy");
  return Tv(t.type, t.content), {
    id: crypto.randomUUID(),
    projectId: t.projectId.trim(),
    type: t.type,
    content: t.content,
    metadata: t.metadata ?? { captureMethod: "unknown" },
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    createdBy: e
  };
}
function Tv(t, e) {
  var n, r, o, s;
  switch (t) {
    case un.INTERACTION_TIMELINE: {
      const c = e;
      if (!Array.isArray(c.sessionEvents))
        throw new _e(
          "SourceArtifact",
          "interaction_timeline content must have a sessionEvents array"
        );
      break;
    }
    case un.NATURAL_LANGUAGE: {
      if (!((n = e.description) != null && n.trim()))
        throw new _e(
          "SourceArtifact",
          "natural_language content must have a description string"
        );
      break;
    }
    case un.IMAGE: {
      if (!((r = e.imagePath) != null && r.trim()))
        throw new _e(
          "SourceArtifact",
          "image content must have an imagePath string"
        );
      break;
    }
    case un.IMPORTED_DOCUMENT: {
      if (!((o = e.documentPath) != null && o.trim()))
        throw new _e(
          "SourceArtifact",
          "imported_document content must have a documentPath string"
        );
      break;
    }
    case un.MANUAL: {
      if (!((s = e.description) != null && s.trim()))
        throw new _e(
          "SourceArtifact",
          "manual content must have a description string"
        );
      break;
    }
    default:
      throw new _e(
        "SourceArtifact",
        `unknown source artifact type: ${t}`
      );
  }
}
class Cv {
  constructor(e) {
    this.sourceArtifacts = e;
  }
  async getById(e) {
    return this.sourceArtifacts.get(e);
  }
  async getByProject(e) {
    return this.sourceArtifacts.where("projectId").equals(e).toArray();
  }
  async getByType(e, n) {
    return this.sourceArtifacts.where("[projectId+type]").equals([e, n]).toArray();
  }
  async create(e) {
    const n = Sv(e);
    return await this.sourceArtifacts.add(n), n;
  }
  async getByVersion(e) {
    if (!e.length) return [];
    const n = [];
    for (const r of e) {
      const o = await this.sourceArtifacts.get(r);
      o && n.push(o);
    }
    return n;
  }
}
class kv {
  constructor(e) {
    this.executionIRs = e;
  }
  async getById(e) {
    return this.executionIRs.get(e);
  }
  async getByTestCaseVersion(e) {
    return this.executionIRs.where("testCaseVersionId").equals(e).first();
  }
  async save(e) {
    return await this.deleteByTestCaseVersion(e.testCaseVersionId), await this.executionIRs.add(e), e;
  }
  async delete(e) {
    await this.executionIRs.delete(e);
  }
  async deleteByTestCaseVersion(e) {
    const n = await this.executionIRs.where("testCaseVersionId").equals(e).toArray();
    for (const r of n)
      await this.executionIRs.delete(r.id);
  }
}
class Av {
  constructor(e) {
    this.sessions = e;
  }
  async getById(e) {
    return this.sessions.get(e);
  }
  async getByProject(e) {
    return this.sessions.where("projectId").equals(e).toArray();
  }
  async create(e) {
    return await this.sessions.add(e), e;
  }
  async update(e) {
    return await this.sessions.put(e), e;
  }
}
class _v {
  constructor(e) {
    this.executionRuns = e;
  }
  async getById(e) {
    return this.executionRuns.get(e);
  }
  async getByTestCaseVersion(e) {
    return this.executionRuns.where("testCaseVersionId").equals(e).toArray();
  }
  async getByProject(e) {
    return this.executionRuns.where("projectId").equals(e).toArray();
  }
  async save(e) {
    return await this.executionRuns.add(e), e;
  }
  async delete(e) {
    await this.executionRuns.delete(e);
  }
}
class Rv {
  constructor(e) {
    this.evidence = e;
  }
  async save(e) {
    return await this.evidence.put(e), e;
  }
  async getByInteraction(e) {
    return this.evidence.where("interactionId").equals(e).toArray();
  }
  async getBySession(e) {
    return this.evidence.where("recordingSessionId").equals(e).toArray();
  }
  async deleteBySession(e) {
    const r = (await this.evidence.where("recordingSessionId").equals(e).toArray()).map((o) => o.windowId);
    await this.evidence.bulkDelete(r);
  }
}
class Nv {
  constructor(e) {
    B(this, "projects");
    B(this, "testCases");
    B(this, "elements");
    B(this, "sourceArtifacts");
    B(this, "executionIRs");
    B(this, "recordingSessions");
    B(this, "executionRuns");
    B(this, "behavioralEvidence");
    this.projects = new sv(e.projects), this.testCases = new yv(e.testCases, e.testCaseVersions), this.elements = new Ev(e.elements, e.testCaseVersions), this.sourceArtifacts = new Cv(e.sourceArtifacts), this.executionIRs = new kv(e.executionIRs), this.recordingSessions = new Av(e.recordingSessions), this.executionRuns = new _v(e.executionRuns), this.behavioralEvidence = new Rv(e.behavioralEvidence);
  }
}
class Ov {
  constructor(e) {
    this.db = e;
  }
  async execute(e) {
    return this.db.transaction(
      "rw!",
      [
        this.db.projects,
        this.db.testCases,
        this.db.testCaseVersions,
        this.db.elements,
        this.db.sourceArtifacts,
        this.db.executionIRs,
        this.db.recordingSessions,
        this.db.executionRuns,
        this.db.behavioralEvidence
      ],
      async () => {
        const n = new Nv(this.db);
        return e(n);
      }
    );
  }
}
const Pv = "cmdrunner_repository";
class xv extends Wt {
  constructor() {
    super(Pv);
    B(this, "projects");
    B(this, "elements");
    B(this, "testCases");
    B(this, "testCaseVersions");
    B(this, "sourceArtifacts");
    B(this, "executionIRs");
    B(this, "recordingSessions");
    B(this, "executionRuns");
    B(this, "behavioralEvidence");
    this.version(1).stores({
      projects: "id, status",
      elements: "id, projectId, [projectId+pageOrComponent], status",
      testCases: "id, projectId, *tags, status, priority",
      testCaseVersions: "id, testCaseId, [testCaseId+versionNumber]",
      sourceArtifacts: "id, projectId, [projectId+type]",
      executionIRs: "id, testCaseVersionId"
    }), this.version(2).stores({
      // V1 tables (unchanged — must repeat in Dexie version upgrade)
      projects: "id, status",
      elements: "id, projectId, [projectId+pageOrComponent], status",
      testCases: "id, projectId, *tags, status, priority",
      testCaseVersions: "id, testCaseId, [testCaseId+versionNumber]",
      sourceArtifacts: "id, projectId, [projectId+type]",
      executionIRs: "id, testCaseVersionId",
      // V2 new table
      recordingSessions: "id, projectId"
    }), this.version(3).stores({
      // V1 tables
      projects: "id, status",
      elements: "id, projectId, [projectId+pageOrComponent], status",
      testCases: "id, projectId, *tags, status, priority",
      testCaseVersions: "id, testCaseId, [testCaseId+versionNumber]",
      sourceArtifacts: "id, projectId, [projectId+type]",
      executionIRs: "id, testCaseVersionId",
      // V2 table
      recordingSessions: "id, projectId",
      // V3 new table
      executionRuns: "id, testCaseVersionId, projectId"
    }), this.version(4).stores({
      // V1 tables
      projects: "id, status",
      elements: "id, projectId, [projectId+pageOrComponent], status",
      testCases: "id, projectId, *tags, status, priority",
      testCaseVersions: "id, testCaseId, [testCaseId+versionNumber]",
      sourceArtifacts: "id, projectId, [projectId+type]",
      executionIRs: "id, testCaseVersionId",
      // V2 table
      recordingSessions: "id, projectId",
      // V3 table
      executionRuns: "id, testCaseVersionId, projectId",
      // V4 new table
      behavioralEvidence: "windowId, interactionId, recordingSessionId"
    });
  }
}
function $v() {
  return new xv();
}
class Dv {
  constructor() {
    B(this, "db");
    this.db = $v();
  }
  create() {
    return new Ov(this.db);
  }
  /** Expose the database for testing/debugging purposes. */
  getDatabase() {
    return this.db;
  }
}
const ni = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  DexieUnitOfWorkFactory: Dv
}, Symbol.toStringTag, { value: "Module" }));
function Lv(t) {
  var e, n;
  if (!((e = t.projectId) != null && e.trim()))
    throw new Te("RecordingSession", "projectId");
  if (!t.understandingResult)
    throw new Te("RecordingSession", "understandingResult");
  return {
    id: crypto.randomUUID(),
    projectId: t.projectId.trim(),
    understandingResult: t.understandingResult,
    rawEvents: [...t.rawEvents],
    rawInteractions: [...t.rawInteractions],
    url: ((n = t.url) == null ? void 0 : n.trim()) ?? "",
    recordedAt: t.understandingResult.generatedAt,
    duration: t.duration ?? null,
    testCaseIds: []
  };
}
async function Mv(t, e) {
  return t.create().execute(async (r) => {
    let o = e.projectId;
    if (!o) {
      const l = await r.projects.getAll();
      l.length > 0 ? o = l[0].id : o = (await r.projects.create({
        name: "Default Project",
        createdBy: "recorder"
      })).id;
    }
    const s = Lv({
      projectId: o,
      understandingResult: e.understanding,
      rawEvents: [...e.events],
      rawInteractions: [...e.interactions],
      url: e.url
    });
    await r.recordingSessions.create(s);
    const c = {
      id: crypto.randomUUID(),
      testCaseVersionId: s.id,
      // Temporary — linked to session for now
      plan: e.irPlan,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      generatorVersion: "ir-bridge-1.0",
      renderings: {}
    };
    return await r.executionIRs.save(c), {
      sessionId: s.id,
      irArtifactId: c.id,
      projectId: o
    };
  });
}
async function Vv(t, e, n) {
  return t.create().execute(async (o) => {
    let s = 0;
    for (const c of n) {
      if (!c.behavioralEvidence) continue;
      const l = {
        ...c.behavioralEvidence,
        interactionId: c.interactionId,
        recordingSessionId: e,
        persistedAt: Date.now()
      };
      await o.behavioralEvidence.save(l), s++;
    }
    return { count: s };
  });
}
const Ra = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  persistBehavioralEvidence: Vv,
  persistSession: Mv
}, Symbol.toStringTag, { value: "Module" })), Ft = {
  ACCESSIBLE_NAME: 0.3,
  ROLE_TAG: 0.25,
  ANCESTOR_CHAIN: 0.25,
  BUSINESS_IDS: 0.15,
  PAGE_SCOPE: 0.05
}, qv = 0.7;
function Uv(t, e, n) {
  return {
    accessibleName: t.accessibleName ?? "",
    ariaRole: t.ariaRole,
    tag: t.tag ?? "",
    testId: t.testId,
    dataCy: t.dataCy,
    dataQa: t.dataQa,
    ancestorRoles: null,
    sourceUrl: e ?? ""
  };
}
function Bv(t) {
  let e = null;
  for (const n of t.locatorStrategies)
    n.type === Se.TEST_ID && !e && (e = n.value);
  return {
    accessibleName: t.logicalName,
    ariaRole: null,
    // Not stored on Element entity
    tag: "",
    // Not stored on Element entity
    testId: e,
    dataCy: null,
    dataQa: null,
    ancestorRoles: null,
    // Not stored on Element entity
    sourceUrl: t.pageOrComponent
  };
}
function Na(t, e, n = !0) {
  return !t && !e ? 1 : !t || !e ? 0 : (n ? t.toLowerCase() === e.toLowerCase() : t === e) ? 1 : 0;
}
function lo(t, e, n = 0.5) {
  const r = (t == null ? void 0 : t.trim()) ?? "", o = (e == null ? void 0 : e.trim()) ?? "";
  return !r && !o ? 1 : !r || !o ? n : r.toLowerCase() === o.toLowerCase() ? 1 : 0;
}
function jv(t, e) {
  let n = 0;
  n += Ft.ACCESSIBLE_NAME * Na(t.accessibleName, e.accessibleName);
  const r = lo(t.ariaRole, e.ariaRole), o = lo(t.tag, e.tag);
  n += Ft.ROLE_TAG * ((r + o) / 2), n += Ft.ANCESTOR_CHAIN * 1;
  const s = t.testId ?? t.dataCy ?? t.dataQa, c = e.testId ?? e.dataCy ?? e.dataQa;
  return s && c ? n += Ft.BUSINESS_IDS * Na(s, c) : n += Ft.BUSINESS_IDS * 0.5, n += Ft.PAGE_SCOPE * lo(t.sourceUrl, e.sourceUrl), n;
}
function Fv(t, e, n = qv) {
  const r = [];
  for (const f of t) {
    const h = Uv(
      f.identity,
      f.sourceUrl
    );
    for (const m of e) {
      const g = Bv(m), I = jv(h, g);
      I >= n && r.push({ fresh: f, stored: m, score: I });
    }
  }
  r.sort((f, h) => h.score - f.score);
  const o = /* @__PURE__ */ new Set(), s = /* @__PURE__ */ new Set(), c = [];
  for (const { fresh: f, stored: h, score: m } of r)
    o.has(f.elementId) || s.has(h.id) || (c.push({
      storedElement: h,
      freshUiElement: f,
      matchScore: m
    }), o.add(f.elementId), s.add(h.id));
  const l = t.filter((f) => !o.has(f.elementId));
  return { matches: c, unmatched: l };
}
async function du(t, e) {
  const n = await e.getById(t.elementId);
  if (!n) return;
  const r = wv(n, {
    newStrategies: t.newStrategies.map((s) => ({
      type: s.type,
      value: s.value,
      priority: s.priority,
      confidence: s.confidence
    })),
    context: t.context
  }), o = {
    locatorStrategies: r.locatorStrategies.map((s) => ({
      type: s.type,
      value: s.value,
      priority: s.priority,
      confidence: s.confidence
    })),
    status: r.status,
    healHistory: r.healHistory,
    lastHealedAt: r.lastHealedAt
  };
  return await e.update(r.id, o), r;
}
async function Kv(t, e, n, r) {
  return e.length === 0 ? { examined: 0, healed: 0, created: 0, details: [] } : await r.create().execute(async (c) => {
    const l = await c.elements.getByProject(t), f = Fv(e, l), h = [];
    let m = 0;
    for (const I of f.matches) {
      const b = Oa(I.freshUiElement.identity), O = I.storedElement.locatorStrategies;
      if (Gv(O, b)) {
        const E = await du(
          {
            elementId: I.storedElement.id,
            newStrategies: b,
            context: {
              sourceSessionId: n,
              reason: "css-shifted",
              proposedBy: "cross-session-matching"
            }
          },
          c.elements
        );
        E && (m++, h.push({
          elementId: E.id,
          logicalName: E.logicalName,
          action: "healed",
          reason: "locator-changed"
        }));
      } else
        h.push({
          elementId: I.storedElement.id,
          logicalName: I.storedElement.logicalName,
          action: "unchanged"
        });
    }
    let g = 0;
    for (const I of f.unmatched) {
      const b = Oa(I.identity);
      if (b.length === 0) continue;
      const O = {
        projectId: t,
        logicalName: I.identity.accessibleName || `Element ${I.elementId}`,
        pageOrComponent: I.sourceUrl,
        locatorStrategies: b.map((E) => ({
          type: E.type,
          value: E.value,
          priority: E.priority,
          confidence: E.confidence
        }))
      }, q = await c.elements.create(O);
      g++, h.push({
        elementId: q.id,
        logicalName: q.logicalName,
        action: "created"
      });
    }
    return {
      examined: f.matches.length,
      healed: m,
      created: g,
      details: h
    };
  });
}
function Oa(t) {
  const e = Xo(t);
  return Yo(e);
}
function Gv(t, e) {
  const n = (s) => `${s.type}::${s.value}`, r = new Set(t.map(n)), o = new Set(e.map(n));
  for (const s of o)
    if (!r.has(s)) return !0;
  for (const s of r)
    if (!o.has(s)) return !0;
  return !1;
}
const fu = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  healElementAndPersist: du,
  healFromRecording: Kv
}, Symbol.toStringTag, { value: "Module" }));
function Hv(t, e, n) {
  if (!t)
    return { status: "missing" };
  const r = [];
  for (const o of e)
    o.updatedAt > t.generatedAt && r.push({
      type: "element_changed",
      description: `Element "${o.logicalName}" was updated after IR generation`,
      elementId: o.id,
      elementName: o.logicalName
    });
  return n !== t.generatorVersion && r.push({
    type: "generator_upgraded",
    description: `IR generated with ${t.generatorVersion}, current is ${n}`
  }), r.length > 0 ? { status: "stale", reasons: r } : { status: "fresh" };
}
function zv(t, e) {
  const n = [], r = /* @__PURE__ */ new Set(), o = Pa(e.steps), s = Pa(t.steps);
  for (const [c, l] of s) {
    const f = o.get(c);
    f && !Wv(l.locators, f.locators) && (r.has(c) || (n.push({
      elementId: c,
      elementName: f.elementName,
      stepDescription: f.stepDescription,
      oldLocators: l.locators,
      newLocators: f.locators
    }), r.add(c)));
  }
  return n;
}
function Pa(t) {
  const e = /* @__PURE__ */ new Map();
  for (const n of t)
    if (n.target.kind === "element") {
      const r = n.target.resolvedLocators.map((o) => ({
        type: o.type,
        value: o.value,
        priority: o.priority
      }));
      e.has(n.target.elementId) || e.set(n.target.elementId, {
        elementName: n.target.elementName,
        stepDescription: n.description,
        locators: r
      });
    }
  return e;
}
function Wv(t, e) {
  if (t.length !== e.length) return !1;
  for (let n = 0; n < t.length; n++)
    if (t[n].type !== e[n].type || t[n].value !== e[n].value || t[n].priority !== e[n].priority)
      return !1;
  return !0;
}
const Yv = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  checkStaleness: Hv,
  detectLocatorChanges: zv
}, Symbol.toStringTag, { value: "Module" }));
async function Xv(t) {
  const e = await chrome.tabs.create({ url: t, active: !1 });
  if (!e.id) throw new Error("Failed to create tab");
  return e.id;
}
async function Qv(t) {
  await chrome.scripting.executeScript({
    target: { tabId: t },
    files: ["src/execution/executor-content-script.js"]
  });
}
async function Zv(t, e) {
  return chrome.tabs.sendMessage(t, e);
}
async function Jv(t) {
  return (await chrome.tabs.get(t)).url ?? "";
}
async function ew(t, e) {
  await chrome.tabs.update(t, { url: e });
}
async function tw(t) {
  await chrome.tabs.remove(t);
}
class nw {
  constructor(e) {
    B(this, "createTab");
    B(this, "injectScript");
    B(this, "sendTabMessage");
    B(this, "getTabUrl");
    B(this, "updateTabUrl");
    B(this, "closeTab");
    B(this, "networkDrain");
    this.createTab = (e == null ? void 0 : e.createTab) ?? Xv, this.injectScript = (e == null ? void 0 : e.injectScript) ?? Qv, this.sendTabMessage = (e == null ? void 0 : e.sendTabMessage) ?? Zv, this.getTabUrl = (e == null ? void 0 : e.getTabUrl) ?? Jv, this.updateTabUrl = (e == null ? void 0 : e.updateTabUrl) ?? ew, this.closeTab = (e == null ? void 0 : e.closeTab) ?? tw, this.networkDrain = (e == null ? void 0 : e.networkDrain) ?? null;
  }
  async execute(e, n) {
    var b, O;
    const r = (/* @__PURE__ */ new Date()).toISOString(), o = performance.now(), s = [], c = /* @__PURE__ */ new Map();
    let l = !1;
    const f = e.environment.startUrl ?? e.environment.baseUrl;
    let h;
    try {
      h = await this.createTab(f), (b = this.networkDrain) == null || b.beginTab(h), await this.waitForPageLoad(h);
    } catch {
      return {
        status: "error",
        stepResults: [],
        startedAt: r,
        completedAt: (/* @__PURE__ */ new Date()).toISOString(),
        durationMs: performance.now() - o
      };
    }
    try {
      await this.injectScript(h);
    } catch {
      return await this.closeTab(h).catch(() => {
      }), {
        status: "error",
        stepResults: [],
        startedAt: r,
        completedAt: (/* @__PURE__ */ new Date()).toISOString(),
        durationMs: performance.now() - o
      };
    }
    for (const q of e.steps) {
      if (n != null && n.onStepStart && n.onStepStart(q), l) {
        s.push({
          stepId: q.id,
          status: "skipped",
          durationMs: 0,
          assertionResults: []
        });
        continue;
      }
      const E = await this.executeStep(h, q, c, n);
      s.push(E), n != null && n.onStepComplete && n.onStepComplete(q, E), E.status === "error" && (l = !0);
    }
    await this.closeTab(h).catch(() => {
    }), (O = this.networkDrain) == null || O.endTab(h);
    const m = s.some((q) => q.status === "error"), g = s.some((q) => q.status === "failed");
    return {
      status: m ? "error" : g ? "failed" : "passed",
      stepResults: s,
      startedAt: r,
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: performance.now() - o
    };
  }
  // ── Single Step Execution ─────────────────────────────────
  async executeStep(e, n, r, o) {
    const s = performance.now();
    if (n.action === "navigate" && n.target.kind === "url" && n.target.url)
      try {
        await this.updateTabUrl(e, n.target.url), await this.waitForPageLoad(e), await this.injectScript(e), this.networkDrain && await this.networkDrain.drainForTab(
          e,
          n.executionParameters.timeoutMs ?? 0
        );
        let g = [];
        if (n.assertions && n.assertions.length > 0) {
          const b = await this.getTabUrl(e), O = await this.sendTabMessage(e, {
            type: "EVALUATE_ASSERTIONS",
            assertions: n.assertions,
            url: b
          });
          g = (O == null ? void 0 : O.results) ?? [];
        }
        const I = g.some(
          (b) => !b.passed && (b.severity === "hard" || b.severity === void 0)
        );
        return {
          stepId: n.id,
          status: I ? "failed" : "passed",
          durationMs: performance.now() - s,
          assertionResults: g,
          error: I ? { message: "One or more assertions failed", type: "AssertionFailure" } : void 0
        };
      } catch (g) {
        return {
          stepId: n.id,
          status: "error",
          durationMs: performance.now() - s,
          assertionResults: [],
          error: {
            message: `Navigation to "${n.target.url}" failed: ${g.message}`,
            type: "NavigationError"
          }
        };
      }
    if (n.target.kind === "element") {
      const g = n.target.elementId, I = r.get(g) ?? n.target.resolvedLocators;
      if (!(await this.sendTabMessage(e, {
        type: "RESOLVE_LOCATOR",
        locators: I,
        requireVisible: n.executionParameters.waitStrategy !== "none",
        // Late-rendered targets: poll up to timeoutMs (content script caps
        // at 10s). waitStrategy 'none' NEVER waits — resolveElementWithWait
        // parity ('none' = one immediate attempt).
        timeoutMs: n.executionParameters.waitStrategy === "none" ? 0 : n.executionParameters.timeoutMs ?? 0
      })).found)
        if (await this.attemptRuntimeHealing(
          e,
          n,
          r,
          o
        )) {
          if (!(await this.sendTabMessage(e, {
            type: "RESOLVE_LOCATOR",
            locators: r.get(g) ?? n.target.resolvedLocators,
            requireVisible: n.executionParameters.waitStrategy !== "none",
            timeoutMs: n.executionParameters.waitStrategy === "none" ? 0 : n.executionParameters.timeoutMs ?? 0
          })).found)
            return {
              stepId: n.id,
              status: "failed",
              durationMs: performance.now() - s,
              assertionResults: [],
              error: {
                message: `Element "${n.target.elementName}" not found after healing attempt`,
                type: "ElementNotFound"
              }
            };
        } else
          return {
            stepId: n.id,
            status: "failed",
            durationMs: performance.now() - s,
            assertionResults: [],
            error: {
              message: `Element "${n.target.elementName}" not found`,
              type: "ElementNotFound"
            }
          };
    }
    const c = await this.sendTabMessage(e, {
      type: "EXECUTE_STEP",
      step: {
        id: n.id,
        action: n.action,
        target: n.target,
        input: n.input,
        executionParameters: n.executionParameters
      }
    });
    if (!c || c.status === "error")
      return {
        stepId: n.id,
        status: "error",
        durationMs: performance.now() - s,
        assertionResults: [],
        error: (c == null ? void 0 : c.error) ?? { message: "Unknown execution error", type: "UnknownError" }
      };
    if (c.status === "failed")
      return {
        stepId: n.id,
        status: "failed",
        durationMs: performance.now() - s,
        assertionResults: [],
        error: c.error,
        actualValue: c.actualValue
      };
    this.networkDrain && await this.networkDrain.drainForTab(
      e,
      n.executionParameters.timeoutMs ?? 0
    );
    let l = [];
    if (n.assertions && n.assertions.length > 0) {
      const g = await this.getTabUrl(e), I = await this.sendTabMessage(e, {
        type: "EVALUATE_ASSERTIONS",
        assertions: n.assertions,
        url: g
      });
      l = (I == null ? void 0 : I.results) ?? [];
    }
    const f = l.some(
      (g) => !g.passed && (g.severity === "hard" || g.severity === void 0)
    ), h = c.status === "passed", m = h && !f ? "passed" : "failed";
    return {
      stepId: n.id,
      status: m,
      durationMs: performance.now() - s,
      assertionResults: l,
      actualValue: c.actualValue,
      error: m === "failed" && f ? { message: "One or more assertions failed", type: "AssertionFailure" } : m === "failed" && !h ? c.error : void 0
    };
  }
  // ── Runtime Healing ──────────────────────────────────────
  /**
   * Attempt runtime healing for a locator resolution failure.
   *
   * Flow:
   *   1. Extract live DOM context from the content script (EXTRACT_DOM_CONTEXT)
   *   2. Rank locators from the live DOM identity using rankLocatorCandidates
   *   3. Call healElementAndPersist() with the fresh locators
   *   4. Store healed locators in the override map for this run
   *
   * Returns true if healing succeeded and locators were updated.
   * Returns false if healing is not available, not needed, or failed.
   */
  async attemptRuntimeHealing(e, n, r, o) {
    if (n.target.kind !== "element") return !1;
    const s = n.target.elementId;
    try {
      const c = await this.sendTabMessage(
        e,
        {
          type: "EXTRACT_DOM_CONTEXT",
          hint: { accessibleName: n.target.elementName }
        }
      );
      if (!(c != null && c.identity)) return !1;
      const { extractCandidatesFromIdentity: l, rankLocatorCandidates: f } = await Promise.resolve().then(() => Sg), h = l(
        c.identity
      ), m = f(h);
      if (m.length === 0) return !1;
      const { DexieUnitOfWorkFactory: g } = await Promise.resolve().then(() => ni), { healElementAndPersist: I } = await Promise.resolve().then(() => fu), q = await new g().create().execute(async ($) => I(
        {
          elementId: s,
          newStrategies: m,
          context: {
            sourceSessionId: `execution-${Date.now()}`,
            reason: "Runtime locator resolution failure",
            proposedBy: "runtime-healer"
          }
        },
        $.elements
      ));
      if (!q) return !1;
      const E = q.locatorStrategies.map(($) => ({
        type: $.type,
        value: $.value,
        priority: $.priority,
        confidence: $.confidence
      }));
      return r.set(s, E), !0;
    } catch (c) {
      return console.warn("[IRExecutor] Runtime healing failed:", c), !1;
    }
  }
  // ── Page Load Wait ────────────────────────────────────────
  /**
   * Wait for the tab's page to finish loading.
   * Polls the tab status until 'complete' or timeout.
   */
  async waitForPageLoad(e, n = 3e4) {
    const r = performance.now();
    for (; performance.now() - r < n; ) {
      try {
        if ((await chrome.tabs.get(e)).status === "complete") return;
      } catch {
        return;
      }
      await new Promise((o) => setTimeout(o, 200));
    }
  }
}
const rw = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  IRExecutorImpl: nw
}, Symbol.toStringTag, { value: "Module" }));
function iw(t) {
  var n, r, o;
  if (!((n = t.testCaseId) != null && n.trim()))
    throw new Error("ExecutionRun requires testCaseId");
  if (!((r = t.testCaseVersionId) != null && r.trim()))
    throw new Error("ExecutionRun requires testCaseVersionId");
  if (!((o = t.projectId) != null && o.trim()))
    throw new Error("ExecutionRun requires projectId");
  const e = t.result.stepResults.map((s, c) => {
    var f;
    return {
      stepId: s.stepId,
      stepOrder: c + 1,
      action: "",
      // Populated by caller from the IR plan
      description: "",
      status: s.status,
      durationMs: s.durationMs,
      assertionResults: s.assertionResults.map((h) => ({
        type: String(h.type),
        comparison: "",
        expectedValue: h.expectedValue,
        actualValue: h.actualValue,
        passed: h.passed,
        severity: "hard",
        message: h.message
      })),
      healed: !1,
      screenshot: (f = t.screenshots) == null ? void 0 : f[s.stepId],
      error: s.error ? { message: s.error.message, type: s.error.type } : void 0
    };
  });
  return {
    id: crypto.randomUUID(),
    testCaseId: t.testCaseId.trim(),
    testCaseVersionId: t.testCaseVersionId.trim(),
    projectId: t.projectId.trim(),
    status: t.result.status,
    startedAt: t.result.startedAt,
    completedAt: t.result.completedAt,
    durationMs: t.result.durationMs,
    stepResults: e,
    environment: t.environment,
    healedElementIds: t.healedElementIds
  };
}
const ow = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  createExecutionRun: iw
}, Symbol.toStringTag, { value: "Module" }));
