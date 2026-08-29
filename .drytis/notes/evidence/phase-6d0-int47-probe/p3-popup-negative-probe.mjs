// P3 — popup-class NEGATIVE probe (read-only; synthetic DOM, no product code).
// R2 measurement: does the unanchored `popup` token in
// OPEN_SELECTION_SURFACE_CLASS_RE over-promote non-modal containers?
//
// Method: run the SHIPPED dist service-worker bundle's real surface-gating
// logic (extractSemanticRoles + OPEN_SELECTION_SURFACE_CLASS_RE) against a
// corpus of negative container classes. A class list "matches" the surface
// vocabulary if ANY of its class tokens would satisfy the RE — exactly what
// isInsideOpenSelectionSurface does per ancestor class string.
//
// Expected (per roadmap §6): zero TRUE for negatives; TRUE only for
// genuine popup/dropdown/modal surfaces (positive control).
import { readFileSync } from 'node:fs';

const SW = readFileSync('/workspace/dist/assets/service-worker-inline.js', 'utf8');

// Extract the real shipped regex from the bundle (minified names).
const reMatch = SW.match(/\/\((listbox[^)]*)\)\/i/);
if (!reMatch) { console.log('P3 FATAL: surface class RE not found in dist'); process.exit(1); }
const RE = new RegExp(`(${reMatch[1]})`, 'i');
// Verify the shipped parser regex content is present in the bundle.
const hasParser = SW.includes('(\\S+)\\[role=(.+)\\]') || /\\S\+\)\\\[role=/.test(SW);
if (!hasParser) { console.log('P3 FATAL: extractSemanticRoles pattern not found in dist'); process.exit(1); }
console.log(`P3: extracted from dist — RE /(${reMatch[1]})/i + parser pattern present`);

const CASES = [
  // [label, ancestorClasses[] (one per ancestor), ancestorRoles[], expect]
  ['popup banner (top, non-modal, dismissible)', ['adani-popup-banner', 'promo-popup'], [], false],
  ['popup blocker notice', ['popup-blocked-notice'], [], false],
  ['newsletter popup', ['newsletter-popup__container'], [], false],
  ['cookie popup', ['cookie-popup-wrapper'], [], false],
  ['chat-widget bubble', ['chat-bubble', 'floating-widget'], [], false],
  ['plain main', [], [], false],
  ['utility nav', [], [], false],
  ['top nav bar', [], [], false],
  ['footer', [], [], false],
  ['POSITIVE: traveler-popup (PaxAndClass pattern)', ['traveler-popup'], [], true],
  ['POSITIVE: generic popup container', ['popup'], [], true],
  ['POSITIVE: modal overlay', ['modal-overlay'], [], true],
  ['POSITIVE: role=dialog (semantic-role path)', [], ['div[role=dialog]'], true],
  ['POSITIVE: role=listbox', [], ['div[role=listbox]'], true],
];

// Recreate isInsideOpenSelectionSurface faithfully: roles via parser, classes via RE per entry.
const semanticRoles = (arr) => arr.flatMap(e => {
  const m = /^(\S+)\[role=(.+)\]$/.exec(e);
  return m ? m[2].replace(/["']/g, '').split(/\s+/).filter(Boolean) : [e];
});
const ROLE_SET = new Set(['listbox', 'menu', 'grid', 'dialog']);

let pass = 0, fail = 0;
for (const [label, classes, roles, expect] of CASES) {
  const byRole = semanticRoles(roles).some(r => ROLE_SET.has(r));
  const byClass = classes.some(c => RE.test(c));
  const got = byRole || byClass;
  const ok = got === expect;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label} :: classes=${JSON.stringify(classes)} roles=${JSON.stringify(roles)} → ${got} (expected ${expect})`);
}
console.log(`════ P3 POPUP-CLASS NEGATIVE PROBE — ${pass} PASS / ${fail} FAIL ════`);
