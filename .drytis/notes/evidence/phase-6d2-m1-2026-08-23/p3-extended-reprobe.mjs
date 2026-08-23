// M1-C: Extended P3 popup-token re-probe (read-only; no product code).
// Compares the SHIPPED unanchored regex (extracted live from dist) against the
// anchored candidate recorded in the 2026-08-21 P3 verdict:
//   anchored = /(listbox|dropdown|popover|overlay|modal|dialog|flyout|menu)([-_]|$)/i
//   (token-boundary form; `popup` handling decided separately below)
// Corpus = the archived P3 corpus + extended real-world popup-class shapes.
import { readFileSync } from 'node:fs';

const SW = readFileSync('/workspace/dist/assets/service-worker-inline.js', 'utf8');
const reMatch = SW.match(/\/\((listbox[^)]*)\)\/i/);
if (!reMatch) { console.log('M1-C FATAL: surface class RE not found in dist'); process.exit(1); }
const SHIPPED = new RegExp(`(${reMatch[1]})`, 'i');
console.log(`M1-C: shipped RE extracted from dist — /(${reMatch[1]})/i`);

// Anchored candidate — boundary form. For `popup` we test BOTH anchored
// variants since 'popup' only appears as suffix/prefix in real classes:
//   A: ([-_]|$)  after the token  (popup-banner matches, traveler-popup matches)
//   B: ([-_]|^)  before the token, for prefix forms (popup-banner matches)
// The 6D.0-era note wrote /(listbox|…|menu)([-_]|$)/ — `popup` wasn't in the
// anchored set. We mirror that note exactly and ALSO measure prefix-only popup.
const ANCHORED = new RegExp(/(listbox|dropdown|popover|overlay|modal|dialog|flyout|menu)([-_]|$)/i.source);
const ANCHORED_POPUP = new RegExp(/([-_]|^)(listbox|dropdown|popover|overlay|modal|dialog|flyout|menu|popup)([-_]|$)/i.source);

const cases = [
  // [label, class, isTrueSurface]
  // — Archived P3 corpus (2026-08-21) —
  ['ARCHIVED adani-popup-banner (promo banner, non-modal)', 'adani-popup-banner', false],
  ['ARCHIVED promo-popup', 'promo-popup', false],
  ['ARCHIVED popup-blocked-notice', 'popup-blocked-notice', false],
  ['ARCHIVED newsletter-popup__container', 'newsletter-popup__container', false],
  ['ARCHIVED cookie-popup-wrapper', 'cookie-popup-wrapper', false],
  ['ARCHIVED chat-bubble (floating widget)', 'chat-bubble', false],
  ['ARCHIVED plain main', 'main-content', false],
  ['ARCHIVED utility nav', 'utility-nav', false],
  ['ARCHIVED top nav bar', 'top-nav', false],
  ['ARCHIVED footer', 'site-footer', false],
  ['ARCHIVED POSITIVE traveler-popup', 'traveler-popup', true],
  ['ARCHIVED POSITIVE generic popup container', 'popup', true],
  ['ARCHIVED POSITIVE modal-overlay', 'modal-overlay', true],
  // — Extended corpus: real-world popup-class shapes (negative) —
  ['EXT cookie-consent popup--dark', 'cookie-consent popup--dark', false],
  ['EXT newsletter-signup popup_open', 'newsletter-signup popup_open', false],
  ['EXT age-verification popup-container', 'age-verification popup-container', false],
  ['EXT chat-popup launcher', 'chat-popup launcher', false],
  ['EXT notification popup-holder', 'notification popup-holder', false],
  ['EXT popup-banner topbar', 'popup-banner topbar', false],
  ['EXT app-install popup', 'app-install popup', false],
  // — Extended corpus: prefix-form negatives (popup- as prefix) —
  ['EXT popup-footer (footer contains popup prefix)', 'popup-footer', false],
  ['EXT popup-menu-toggle (nav toggle, menu token present)', 'popup-menu-toggle', false],
  // — Extended corpus: TRUE surfaces (positive) —
  ['EXT POSITIVE react-select dropdown-menu', 'react-select__dropdown-menu', true],
  ['EXT POSITIVE popover-content (anchored suffix)', 'popover-content', true],
  ['EXT POSITIVE flyout-panel', 'flyout-panel', true],
  ['EXT POSITIVE suggestion-list', 'suggestion-list', true],
  ['EXT POSITIVE autocomplete-listbox', 'autocomplete-listbox', true],
  ['EXT POSITIVE options-list', 'options-list', true],
  ['EXT POSITIVE ModalDialog MUI root', 'MuiDialog-root ModalDialog', true],
  ['EXT POSITIVE menu popup (generic menu)', 'menu popup', true],
  ['EXT POSITIVE native select menu surface', 'dropdown-menu', true],
  ['EXT POSITIVE overlay-panel (generic overlay)', 'overlay-panel', true],
];

let sPass = 0, sFail = 0, aPass = 0, aFail = 0, apPass = 0, apFail = 0;
const rows = [];
for (const [label, cls, expect] of cases) {
  const s = SHIPPED.test(cls);
  const a = ANCHORED.test(cls);
  const ap = ANCHORED_POPUP.test(cls);
  const sOK = s === expect, aOK = a === expect, apOK = ap === expect;
  sOK ? sPass++ : sFail++; aOK ? aPass++ : aFail++; apOK ? apPass++ : apFail++;
  rows.push({ label, cls, expect, shipped: s, anchored: a, anchoredPopup: ap });
  console.log(`${label}\n   shipped=${s}(${sOK ? 'ok' : 'OVER-MATCH'})  anchored=${a}(${aOK ? 'ok' : 'MISS'})  anchored+popup=${ap}(${apOK ? 'ok' : 'MISS'})`);
}
console.log(`\n════ M1-C EXTENDED P3 RE-PROBE ════`);
console.log(`shipped (unanchored, current)   : ${sPass}/${cases.length} correct — ${sFail} over-matches`);
console.log(`anchored ([-_]|$), no popup    : ${aPass}/${cases.length} correct — ${aFail} misses`);
console.log(`anchored + popup w/ boundary   : ${apPass}/${cases.length} correct — ${apFail} misses`);

// Which tokens caused the shipped over-matches (the R2 measurement)?
const overMatched = rows.filter(r => r.shipped !== r.expect);
console.log(`\nR2 over-match inventory (shipped): ${overMatched.map(r => r.cls).join(' | ')}`);
const missesA = rows.filter(r => r.anchored !== r.expect);
console.log(`Anchored no-popup misses        : ${missesA.map(r => r.cls).join(' | ') || 'none'}`);
const missesAP = rows.filter(r => r.anchoredPopup !== r.expect);
console.log(`Anchored+popup misses           : ${missesAP.map(r => r.cls).join(' | ') || 'none'}`);

import { writeFileSync } from 'node:fs';
writeFileSync('/workspace/.drytis/notes/evidence/phase-6d2-m1-2026-08-23/dumps/p3-extended-table.json', JSON.stringify(rows, null, 1));
console.log('table → dumps/p3-extended-table.json');
