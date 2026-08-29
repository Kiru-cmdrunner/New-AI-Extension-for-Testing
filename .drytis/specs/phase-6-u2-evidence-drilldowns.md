# MS-U2 — Application Evidence Drill-Downs (Application Understanding surface)

Spec: phase-6-u2 · Milestone: MS-U2 (2nd of the U-series, per
.drytis/notes/u1-u5-availability-mapping-2026-08-22.md)
Base: capability-surgical-removal @ f3452d5 · Date: 2026-08-22
Status: DRAFT — owner approval required before implementation.

## 0. Binding constraints (owner doctrine, unchanged from MS-U1)

- RENDERER-ONLY. Files touched must be under src/sidepanel/ (+ tests/sidepanel/).
  No capture, ledger, projection, runtime/definitions, IR, schema, storage-writer,
  or engine changes. No new env keys/services/proxies/deps/setup changes.
- Honesty: absent data → absent element. No fabricated explanations; no dead UI.
- textContent/createElement only for any site-sourced string (XSS posture of MS-U1).
- No timing BEHAVIOR. Displaying already-recorded timings (firstMutationAt, durationMs,
  stability samples) is permitted — no thresholds, no decisions.
- Caps respected (existing MAX_*); drill-downs reveal what exists, never fetch more.
- entity-title items stay unrendered (provenance carriers — deliberate, documented
  at evidence-renderer.ts:558).
- Full verification path: pins → implement → suite → reviewer → infra → real-Chrome
  panel E2E → owner gate before commit.

## 1. Goal

Turn the per-card Application Evidence block from a fixed summary into a
progressive-disclosure view: same compact rows by default, expandable detail per
row/section for trust and debuggability. Zero data added — everything shown is
already on `behavioralEvidence.applicationEvidence` / window / network records.

## 2. Data sources (verified @ f3452d5)

- WireObservedItem (src/shared/page-content-wire.ts:35-70): kind, matchedSelector
  (may be the `changed-element-seed` sentinel), text, numericValue, entityId/type,
  domPath, attributes (≤30), visible, uniqueInSnapshot?.
- NetworkActivity (behavioral-evidence-types.ts:436-472): method, status, url,
  durationMs, resourceType, source ('main-world'|'webrequest'|'performance-observer'),
  requestBody? (formData pairs, POST/webRequest only), sourceEventId?, requestId?.
- DomChangeSummary (:338-360): types[], targetPath/tag, changedAttributes,
  attributeDeltas, added/removedNodesCount, characterDataDelta, firstMutationAt,
  lastMutationAt, rawMutationCount.
- SurfaceChange (:374-392): path, tagName, ariaRole, accessibleName, descendantCount,
  relativeTime, batchIndex, kind added/removed, emergence.
- EvidenceWindow (:95-110): endReason, stabilityTrace (StabilitySample[] ≤50:
  timestamp, msSinceLastMutation, globalBatchCount), duration (existing meta line).
- Whole BehavioralEvidence — for the raw JSON disclosure.

## 3. Design decisions

- D1 — Native <details>/<summary> for every drill-down. No JS state, no timing.
  Collapsed by default; MS-U1 default output stays visually byte-equivalent
  (summary row text unchanged).
- D2 — Resulting State rows gain a per-item `via {selector}` suffix ONLY inside the
  new details block (not on the compact row — compact stays as-is). Seed-sentinel
  renders as `via changed-element-seed` (distinct honesty marker). Plus per-item:
  attributes (k="v", ≤30), visible flag, `unique ✓` when uniqueInSnapshot===true,
  `unverified` when false/absent + allowlisted. entityId rendered as plain text with
  tooltip "Knowledge browser arrives in MS-U4" — NO link (no dead UI).
- D3 — Network drill-down per entry: resourceType, source label text (main-world /
  webRequest / performance-observer), requestId (when present), sourceEventId
  ("joined to causal event {id}" — display only), requestBody as `k: v` rows when
  present. Compact row unchanged except source dot retained.
- D4 — DOM-changes drill-down per group: `raw: {rawMutationCount} mutations ·
  {firstMutationAt}→{lastMutationAt}ms` (recorded values, rounded, display only)
  + attributeDeltas already on compact row stay.
- D5 — Surfaces drill-down per surface: descendantCount, ariaRole, accessibleName,
  emergence, batchIndex.
- D6 — Window internals disclosure (one per evidence block, after existing meta):
  endReason + stability trace summary line `stability: {n} samples · last gap {ms}ms`
  + up to 12 inline bars (div heights, pure CSS, from msSinceLastMutation — static
  render, no animation) when samples exist.
- D7 — Raw evidence JSON: one collapsed <details> at the bottom of the evidence
  block: "Raw evidence JSON" → <pre> with JSON.stringify(behavioralEvidence, null, 2),
  textContent-set. Size guard: if serialized > 200KB show first 200KB + honest
  truncation note.
- D8 — All new rendering lives in evidence-renderer.ts (+ optional small pure
  helpers module evidence-drilldown.ts for JSON trunc + stability bars). No changes
  to interaction-renderer.ts, sidepanel.ts, index.html beyond linking any new css
  (reuse styles.css if needed).

## 4. Pins (tests/sidepanel/, red first)

- P1 provenance: counter row details contains `via changed-element-seed` for seeded
  item; `via [data-count="…"]` style for selector item; compact row UNCHANGED text.
- P2 item fidelity: attributes ≤30 rendered; `unique ✓`; `unverified` when absent.
- P3 network: requestBody k/v rows for POST/webRequest entry; absent otherwise;
  source label + requestId + sourceEventId text; compact row byte-identical.
- P4 dom raw: rawMutationCount + range line inside details only.
- P5 surfaces: descendantCount/ariaRole/accessibleName/emergence in details.
- P6 window internals: endReason + stability summary + ≤12 bars; absent when no
  samples (honest).
- P7 raw JSON: valid <pre> content equals JSON of input; truncation note at >200KB.
- P8 default-view regression: rendering WITHOUT expanding any details produces
  identical DOM text content to pre-MS-U2 for the same fixture (string equality on
  container.textContent minus the new summary labels' additions — pin exact delta:
  only the collapsed <summary> labels are additive).
- P9 XSS: every drilled field flows through textContent (verify no innerHTML with
  dynamic content anywhere new).
- P10 absence honesty: null/undefined fields → row omitted, never "undefined".

## 5. Acceptance criteria

- [ ] A1 every compact row/section from MS-U1 state renders byte-identically when
      all details are collapsed (P8).
- [ ] A2 Resulting State details show per-item provenance (seed vs selector),
      attributes, visibility, uniqueness verification state (D2).
- [ ] A3 Network details show body/type/source/requestId/event join text (D3).
- [ ] A4 DOM-change details show raw mutation counts + recorded time range (D4).
- [ ] A5 Surface details show structural + accessible identity (D5).
- [ ] A6 Window internals: endReason + stability summary + static bars (D6).
- [ ] A7 Raw JSON disclosure with truncation guard (D7).
- [ ] A8 zero non-sidepanel file changes; zero engine imports added.
- [ ] A9 full suite green + all new pins green.
- [ ] A10 real-Chrome panel E2E: expand one drill-down per section type through the
       real panel; zero console errors.

## 6. Real-Chrome validation expectations

multipattern harness (panel's own Start/Stop):
- classic Click card: Resulting State details → `via changed-element-seed` present
  (6A) on collection row; network row (if any) details expandable.
- reactish commit Click: new-surface details show descendantCount + ariaRole;
  window internals show endReason `consequence-settled` + stability samples.
- shop stepper Click: counter row details show `unique ✓` when Phase-2b verified;
  raw JSON opens and parses.
- MS-U1 chips still present (no regression).

## 7. Implementation order

1. Pins P1–P10 red.
2. evidence-drilldown.ts pure helpers (json trunc, stability bars data).
3. evidence-renderer.ts: D2–D7 insertions.
4. styles.css: details/summary + bar styles.
5. Suite + reviewer + infra + real-Chrome E2E → owner gate.

## 8. Out of scope (recorded)

- entity→KR hyperlinks (MS-U4 when the browser exists).
- requestBody redaction policy (values shown as captured; policy decision deferred
  to owner if secrets ever appear — none in multipattern apps).
- Any engine-side additions (U6).
