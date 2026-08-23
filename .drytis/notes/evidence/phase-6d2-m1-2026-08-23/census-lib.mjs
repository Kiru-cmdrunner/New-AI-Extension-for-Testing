// M1-B: aria-pressed / role=switch / data-state census (read-only, no product code).
// Surfaces: (1) AdaniOne clone app (archived, in-container) — the realistic
// flight-booking surface; (2) 6D.1 app (W1 fixtures, in-container) — the
// generic app; (3) Avis Ford LIVE (container egress verified 200).
// Counts: interactive elements, aria-pressed (with value distribution),
// role=switch, data-state on non-form-controls, chip-family classes, and the
// classification each element would receive under the CURRENT engine rules
// (isCheckbox / Link / Click / plain), so the "uncovered toggle population" is
// measured, not estimated.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

// ── The census function (injected into a page; DOM-only, structural) ──
const CENSUS_JS = `(() => {
  const isVisible = (el) => { const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const interactiveSel = 'a[href], button, [role="button"], [role="checkbox"], [role="switch"], [role="menuitemcheckbox"], [role="tab"], [role="option"], input, select, textarea, summary, [tabindex], label';
  const els = [...document.querySelectorAll(interactiveSel)];
  const rows = [];
  for (const el of els) {
    const tag = el.tagName, role = el.getAttribute('role');
    const pressed = el.getAttribute('aria-pressed');
    const isSwitch = role === 'switch' || role === 'menuitemcheckbox';
    const dataState = tag === 'INPUT' || tag === 'SELECT' ? null : el.getAttribute('data-state');
    const cls = el.getAttribute('class') || '';
    const chipClass = /\\b(chip|toggle|pill|badge)s?\\b/i.test(cls);
    const inputType = tag === 'INPUT' ? el.getAttribute('type') : null;
    const href = tag === 'A' ? el.getAttribute('href') : null;
    // Current-engine classification (mirrors G5 trace rules):
    let classification;
    if (inputType === 'checkbox' || role === 'checkbox' || isSwitch) classification = 'Checkbox';
    else if (tag === 'A' && href) classification = 'Link';
    else if (tag === 'BUTTON' || role === 'button') classification = 'Click';
    else if (inputType === 'radio' || role === 'radio') classification = 'RadioButton';
    else if (inputType === 'range' || role === 'slider') classification = 'Slider';
    else if (tag === 'SELECT') classification = 'Dropdown';
    else if (inputType === 'text' || tag === 'TEXTAREA' || el.getAttribute('contenteditable')) classification = 'TextEntry';
    else classification = 'other';
    rows.push({ tag, role, pressed, isSwitch, dataState, chipClass, inputType, classification,
      name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
      cls: cls.slice(0, 60), visible: isVisible(el) });
  }
  const summary = {
    url: location.href,
    interactiveTotal: rows.length,
    visibleInteractive: rows.filter(r => r.visible).length,
    ariaPressed: { total: rows.filter(r => r.pressed !== null).length,
      true: rows.filter(r => r.pressed === 'true').length,
      false: rows.filter(r => r.pressed === 'false').length },
    roleSwitch: rows.filter(r => r.isSwitch).length,
    roleCheckbox: rows.filter(r => r.role === 'checkbox' || r.inputType === 'checkbox').length,
    dataStateNonForm: rows.filter(r => r.dataState !== null).length,
    chipClassFamily: rows.filter(r => r.chipClass).length,
    byClassification: rows.reduce((m, r) => (m[r.classification] = (m[r.classification] || 0) + 1, m), {}),
    // THE uncovered-population metric: interactive + toggle-shaped (pressed or
    // switch) + NOT classified Checkbox today → plain Click/other cards today.
    uncoveredToggleShaped: rows.filter(r => (r.pressed !== null || r.isSwitch) && r.classification !== 'Checkbox').length,
    uncoveredExamples: rows.filter(r => (r.pressed !== null || r.isSwitch) && r.classification !== 'Checkbox')
      .slice(0, 8).map(r => ({ tag: r.tag, pressed: r.pressed, name: r.name, cls: r.cls })),
  };
  return { summary, rows };
})()`;

// ── CDP page census helper (drives a URL in the real-Chrome harness instance) ──
const censusViaCDP = (client) => async (url) => {
  const { targetId } = await client.send('Target.createTarget', { url });
  await new Promise(r => setTimeout(r, 3000));
  const page = await import('chrome-remote-interface').then(m => m.default({ target: targetId, port: 9583 }));
  await page.send('Runtime.enable');
  const res = await page.send('Runtime.evaluate', { expression: CENSUS_JS, returnByValue: true });
  await client.send('Target.closeTarget', { targetId }).catch(() => {});
  return res.result.value;
};

export { CENSUS_JS, censusViaCDP };
