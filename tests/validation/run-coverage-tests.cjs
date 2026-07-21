/**
 * Real-World Interaction Coverage Test v2
 * 
 * Directly instantiates V2EventObserver and captures events.
 * No chrome extension API mocking needed.
 */

const puppeteer = require('/workspace/node_modules/puppeteer-core');
const fs = require('fs');

const CHROME_PATH = '/usr/bin/google-chrome';
const TEST_PAGE = 'file:///workspace/public/coverage-test.html';

// Read the observer bundle
const observerBundle = fs.readFileSync('/tmp/v2-observer-bundle.js', 'utf-8');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const testResults = [];

// The page-side script that:
// 1. Mocks chrome.storage with PIPELINE_V2_ENABLED + UI_STATE(recording)
// 2. Mocks chrome.runtime.sendMessage to collect events
// 3. Mocks chrome.storage.onChanged + chrome.runtime.onMessage
// 4. Evaluates the observer bundle
const PAGE_SETUP = `
// Set up mock chrome API before the observer loads
window.__cmdrunnerEvents = [];

// Mock chrome.storage
window.__mockStorage = {
  pipeline_v2_enabled: true,
  architecture_c_enabled: false,
  ui_state: { recordingState: 'recording' }
};

if (!window.chrome) window.chrome = {};
if (!chrome.storage) chrome.storage = {};
chrome.storage.local = {
  get: function(keys, cb) {
    let result = {};
    if (keys === null || keys === undefined) {
      result = JSON.parse(JSON.stringify(window.__mockStorage));
    } else if (typeof keys === 'string') {
      result[keys] = window.__mockStorage[keys];
    } else if (Array.isArray(keys)) {
      keys.forEach(k => { if (window.__mockStorage[k] !== undefined) result[k] = window.__mockStorage[k]; });
    } else if (typeof keys === 'object') {
      Object.keys(keys).forEach(k => { result[k] = window.__mockStorage[k] !== undefined ? window.__mockStorage[k] : keys[k]; });
    }
    if (cb) cb(result);
    return Promise.resolve(result);
  },
  set: function(items, cb) {
    Object.assign(window.__mockStorage, items);
    if (cb) cb();
    return Promise.resolve();
  }
};
chrome.storage.onChanged = { addListener: function() {} };

// Mock chrome.runtime
if (!chrome.runtime) chrome.runtime = {};
chrome.runtime.id = 'test-extension';
chrome.runtime.sendMessage = function(msg, cb) {
  if (msg && msg.type) window.__cmdrunnerEvents.push(msg);
  if (cb) try { cb({}); } catch(e) {}
  return Promise.resolve({});
};
chrome.runtime.onMessage = { addListener: function() {} };

console.log('[TEST] Chrome mock API ready, PIPELINE_V2_ENABLED=true, recording=true');
`;

async function testInteraction(page, name, category, expectedType, actions) {
  await page.evaluate(() => { window.__cmdrunnerEvents = []; });
  
  let interactionError = null;
  try {
    for (const action of actions) {
      await action(page);
      await sleep(300);
    }
  } catch(e) {
    interactionError = e.message;
  }
  
  await sleep(500);
  const events = await page.evaluate(() => JSON.parse(JSON.stringify(window.__cmdrunnerEvents || [])));
  
  const result = {
    name, category, expectedType,
    captured: events.length > 0,
    eventCount: events.length,
    eventTypes: [...new Set(events.map(e => e.type || 'unknown'))],
    eventDetails: events.map(e => {
      const p = e.payload || {};
      const id = p.identity || {};
      return {
        msgType: e.type,
        eventType: p.eventType || 'N/A',
        target: id.accessibleName || id.tagName || 'N/A',
        value: p.value !== undefined ? p.value : undefined,
      };
    }),
    error: interactionError,
  };
  
  testResults.push(result);
  
  const status = events.length > 0 ? 'CAPTURED' : (interactionError ? 'ERR' : 'MISS');
  console.log(`[${status.padEnd(7)}] ${name} (${events.length} events)`);
  events.forEach(e => {
    const p = e.payload || {};
    const id = p.identity || {};
    console.log(`    → ${e.type} [${p.eventType}] "${String(id.accessibleName || id.tagName || '').substring(0, 50)}"`);
  });
  
  return result;
}

async function runTests() {
  console.log('=== Interaction Coverage Validation ===\n');
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run'],
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  
  // Inject mock API before page loads
  await page.evaluateOnNewDocument(PAGE_SETUP);
  // Inject the observer bundle
  await page.evaluateOnNewDocument(observerBundle);
  
  // Collect console logs for debugging
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[CmdRunner') || text.includes('[TEST]')) {
      console.log('[PAGE]', text.substring(0, 150));
    }
  });
  
  console.log('Loading test page...');
  await page.goto(TEST_PAGE, { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(3000);
  
  // Check observer status
  const status = await page.evaluate(() => ({
    eventCount: window.__cmdrunnerEvents?.length || 0,
    storage: JSON.stringify(window.__mockStorage || {}),
  }));
  console.log('Status:', status);
  
  console.log('\n--- Testing Interaction Types ---\n');
  
  // 1. Buttons
  await testInteraction(page, 'Button click', 'HTML5 Standard', 'click', [
    p => p.click('[data-testid="btn-primary"]')
  ]);
  await testInteraction(page, 'Secondary button', 'HTML5 Standard', 'click', [
    p => p.click('[data-testid="btn-secondary"]')
  ]);
  
  // 2. Hyperlinks
  await testInteraction(page, 'Hyperlink', 'HTML5 Standard', 'click', [
    p => p.click('[data-testid="link-internal"]')
  ]);
  
  // 3. Text inputs
  await testInteraction(page, 'Text input', 'HTML5 Standard', 'text_entry', [
    p => p.click('[data-testid="input-text"]'),
    p => p.type('[data-testid="input-text"]', 'Hello World'),
    p => p.evaluate('document.activeElement.blur()'),
  ]);
  await testInteraction(page, 'Password input', 'HTML5 Standard', 'text_entry', [
    p => p.click('[data-testid="input-password"]'),
    p => p.type('[data-testid="input-password"]', 'secret123'),
    p => p.evaluate('document.activeElement.blur()'),
  ]);
  await testInteraction(page, 'Search input', 'HTML5 Standard', 'text_entry', [
    p => p.click('[data-testid="input-search"]'),
    p => p.type('[data-testid="input-search"]', 'find me'),
    p => p.evaluate('document.activeElement.blur()'),
  ]);
  await testInteraction(page, 'Textarea', 'HTML5 Standard', 'text_entry', [
    p => p.click('[data-testid="textarea"]'),
    p => p.type('[data-testid="textarea"]', 'multi-line'),
    p => p.evaluate('document.activeElement.blur()'),
  ]);
  
  // 4. Checkboxes
  await testInteraction(page, 'Checkbox toggle', 'HTML5 Standard', 'checkbox', [
    p => p.click('[data-testid="cb-1"]')
  ]);
  await testInteraction(page, 'Checkbox toggle 2', 'HTML5 Standard', 'checkbox', [
    p => p.click('[data-testid="cb-2"]')
  ]);
  
  // 5. Radio buttons
  await testInteraction(page, 'Radio selection', 'HTML5 Standard', 'radio', [
    p => p.click('[data-testid="rb-2"]')
  ]);
  
  // 6. Native select
  await testInteraction(page, 'Native select', 'HTML5 Standard', 'select', [
    p => p.select('[data-testid="select-native"]', 'banana')
  ]);
  
  // 7. Multi-select
  await testInteraction(page, 'Multi-select', 'HTML5 Standard', 'select', [
    p => p.select('[data-testid="select-multi"]', 'red', 'green')
  ]);
  
  // 8. Date inputs
  await testInteraction(page, 'Native date input', 'Date & Time', 'date', [
    p => p.evaluate(`
      var el = document.getElementById('date-native');
      el.value = '2025-06-15';
      el.dispatchEvent(new Event('change', {bubbles: true}));
    `),
  ]);
  await testInteraction(page, 'Native time input', 'Date & Time', 'time', [
    p => p.evaluate(`
      var el = document.getElementById('time-native');
      el.value = '14:30';
      el.dispatchEvent(new Event('change', {bubbles: true}));
    `),
  ]);
  
  // 9. Custom calendar
  await testInteraction(page, 'Custom calendar picker', 'Date & Time', 'date', [
    p => p.click('[data-testid="calendar-trigger"]'),
    p => sleep(500),
    p => p.evaluate(`
      var cells = document.querySelectorAll('#cal-grid .calendar-day:not(.other-month)');
      if (cells[14]) cells[14].click();
    `),
  ]);
  
  // 10. Date range
  await testInteraction(page, 'Date range picker', 'Date & Time', 'date', [
    p => p.evaluate(`
      var s = document.getElementById('date-range-start');
      s.value = '2025-01-01'; s.dispatchEvent(new Event('change', {bubbles: true}));
      var e = document.getElementById('date-range-end');
      e.value = '2025-12-31'; e.dispatchEvent(new Event('change', {bubbles: true}));
    `),
  ]);
  
  // 11. ARIA Dropdown
  await testInteraction(page, 'ARIA combobox dropdown', 'Custom Widget (ARIA)', 'select', [
    p => p.click('#aria-dd-trigger'),
    p => sleep(300),
    p => p.evaluate(`
      var opts = document.querySelectorAll('#aria-dd-menu [role="option"]');
      if (opts[1]) opts[1].click();
    `),
  ]);
  
  // 12. CSS-only dropdown (no ARIA)
  await testInteraction(page, 'CSS-only dropdown', 'Custom Widget (No ARIA)', 'select', [
    p => p.click('#css-dd-trigger'),
    p => sleep(300),
    p => p.evaluate(`
      var opts = document.querySelectorAll('#css-dd-menu .dropdown-option');
      if (opts[0]) opts[0].click();
    `),
  ]);
  
  // 13. ARIA Checkbox
  await testInteraction(page, 'ARIA checkbox toggle', 'Custom Widget (ARIA)', 'checkbox', [
    p => p.click('[data-testid="aria-cb"]')
  ]);
  
  // 14. ARIA Radio
  await testInteraction(page, 'ARIA radio selection', 'Custom Widget (ARIA)', 'radio', [
    p => p.click('[data-testid="aria-rb-2"]')
  ]);
  
  // 15. Toggle switch
  await testInteraction(page, 'Toggle switch', 'Custom Widget', 'toggle', [
    p => p.click('[data-testid="toggle-native"]')
  ]);
  
  // 16. Segmented control
  await testInteraction(page, 'Segmented control', 'Custom Widget (ARIA)', 'toggle', [
    p => p.click('[data-testid="seg-2"]')
  ]);
  
  // 17. Range slider
  await testInteraction(page, 'Range slider', 'HTML5 Standard', 'range', [
    p => p.focus('[data-testid="input-range"]'),
    p => p.keyboard.press('ArrowRight'),
    p => p.keyboard.press('ArrowRight'),
  ]);
  
  // 18. Tabs
  await testInteraction(page, 'Tab switch', 'Navigation', 'tab', [
    p => p.click('[data-testid="tab2"]')
  ]);
  
  // 19. Accordion
  await testInteraction(page, 'Accordion (custom)', 'Navigation', 'accordion', [
    p => p.click('[data-testid="acc-h1"]')
  ]);
  await testInteraction(page, 'Accordion (native details)', 'Navigation', 'accordion', [
    p => p.click('[data-testid="summary-1"]')
  ]);
  
  // 20. Hover menu
  await testInteraction(page, 'Hover menu', 'Navigation', 'hover', [
    p => p.hover('[data-testid="hover-menu-trigger"]'),
    p => sleep(800),
    p => p.click('[data-testid="hover-item-1"]'),
  ]);
  
  // 21. Autocomplete
  await testInteraction(page, 'Autocomplete type + select', 'Custom Widget (ARIA)', 'autocomplete', [
    p => p.click('[data-testid="autocomplete-input"]'),
    p => p.type('[data-testid="autocomplete-input"]', 'United'),
    p => sleep(500),
    p => p.evaluate(`
      var items = document.querySelectorAll('#autocomplete-list .autocomplete-item');
      if (items[0]) items[0].click();
    `),
  ]);
  
  // 22. Tree view
  await testInteraction(page, 'Tree expand/collapse', 'Complex Widget', 'tree', [
    p => p.click('[data-testid="tree-1"]')
  ]);
  await testInteraction(page, 'Tree select child', 'Complex Widget', 'tree', [
    p => p.click('[data-testid="tree-1-1"]')
  ]);
  
  // 23. Table
  await testInteraction(page, 'Table sort', 'Complex Widget', 'click', [
    p => p.click('[data-testid="th-age"]')
  ]);
  await testInteraction(page, 'Table row checkbox', 'Complex Widget', 'checkbox', [
    p => p.click('[data-testid="row-2-cb"]')
  ]);
  
  // 24. Modal
  await testInteraction(page, 'Modal open', 'Navigation', 'dialog', [
    p => p.click('[data-testid="open-modal-btn"]'),
    p => sleep(300),
  ]);
  await testInteraction(page, 'Modal close', 'Navigation', 'dialog', [
    p => p.click('[data-testid="modal-cancel"]')
  ]);
  
  // 25. Native dialog
  await testInteraction(page, 'Native dialog open', 'Navigation', 'dialog', [
    p => p.click('[data-testid="open-dialog-btn"]'),
    p => sleep(300),
  ]);
  await testInteraction(page, 'Native dialog close', 'Navigation', 'dialog', [
    p => p.click('[data-testid="dialog-close"]')
  ]);
  
  // 26. File upload
  await testInteraction(page, 'File upload', 'Not Supported', 'file', [
    p => p.click('[data-testid="input-file"]'),
  ]);
  
  // 27. Drag & drop
  await testInteraction(page, 'Drag & Drop', 'Not Supported', 'drag_drop', [
    async p => {
      const item = await p.$('[data-testid="dnd-item-1"]');
      const col2 = await p.$('#dnd-col-2');
      if (item && col2) {
        const ib = await item.boundingBox();
        const cb = await col2.boundingBox();
        await p.mouse.move(ib.x + ib.width/2, ib.y + ib.height/2);
        await p.mouse.down();
        await p.mouse.move(cb.x + cb.width/2, cb.y + 10, {steps: 10});
        await sleep(200);
        await p.mouse.up();
      }
    },
  ]);
  
  // 28. Rich text editor
  await testInteraction(page, 'Rich text editor', 'Not Supported', 'rte', [
    p => p.click('[data-testid="rte-editor"]'),
    p => p.keyboard.type('Rich text'),
    p => p.evaluate('document.activeElement.blur()'),
  ]);
  
  // 29. Shadow DOM
  await testInteraction(page, 'Shadow DOM button', 'Shadow DOM', 'click', [
    p => p.evaluate(`
      var host = document.getElementById('shadow-host');
      var shadow = host.shadowRoot;
      var btn = shadow.querySelector('[data-testid="shadow-btn-1"]');
      if (btn) btn.click();
    `),
  ]);
  await testInteraction(page, 'Shadow DOM checkbox', 'Shadow DOM', 'checkbox', [
    p => p.evaluate(`
      var host = document.getElementById('shadow-host');
      var shadow = host.shadowRoot;
      var cb = shadow.querySelector('[data-testid="shadow-cb"]');
      if (cb) cb.click();
    `),
  ]);
  
  // 30. Virtualized list
  await testInteraction(page, 'Virtualized list scroll', 'Complex Widget', 'scroll', [
    p => p.evaluate(`
      var c = document.getElementById('virtualized-list');
      c.scrollTop = 200;
      c.dispatchEvent(new Event('scroll'));
    `),
  ]);
  
  // 31. Canvas
  await testInteraction(page, 'Canvas click', 'Not Supported', 'canvas', [
    async p => {
      const canvas = await p.$('[data-testid="canvas-test"]');
      const box = await canvas.boundingBox();
      await p.mouse.click(box.x + 50, box.y + 50);
    },
  ]);
  
  // 32. Form submit
  await testInteraction(page, 'Form submit', 'HTML5 Standard', 'submit', [
    p => p.click('[data-testid="form-input"]'),
    p => p.type('[data-testid="form-input"]', 'test'),
    p => p.click('#form-submit button[type="submit"]'),
  ]);
  
  // Write results
  const reportPath = '/workspace/tests/validation/coverage-results.json';
  fs.writeFileSync(reportPath, JSON.stringify(testResults, null, 2));
  
  // Summary
  console.log('\n\n=== SUMMARY ===\n');
  const captured = testResults.filter(r => r.captured);
  const missed = testResults.filter(r => !r.captured);
  
  console.log('CAPTURED (' + captured.length + '/' + testResults.length + '):');
  captured.forEach(r => console.log(`  ✓ ${r.name}`));
  
  console.log('\nNOT CAPTURED (' + missed.length + '/' + testResults.length + '):');
  missed.forEach(r => console.log(`  ✗ ${r.name}${r.error ? ' (ERR: ' + r.error.substring(0, 50) + ')' : ''}`));
  
  console.log(`\nFull report: ${reportPath}`);
  
  await browser.close();
}

runTests().catch(err => { console.error('Fatal:', err); process.exit(1); });
