/**
 * Full Pipeline Quality Validation
 * 
 * Tests the COMPLETE recording pipeline: observer → boundary detector → state diff
 * → pattern registry → assembler → intent resolver → SessionEvent output.
 * 
 * Architecture:
 * 1. Browser (puppeteer) runs the V2 observer against real DOM interactions
 * 2. Events are sent to the Node.js side via page.exposeFunction
 * 3. Node.js feeds events through PipelineV2.processUnit()
 * 4. The resulting SessionEvents are evaluated for quality
 * 
 * For each interaction we evaluate:
 * - What the user did (human description)
 * - Raw events captured
 * - Final SessionEvent produced
 * - Whether it accurately represents the action
 * - Whether it has enough info for replay
 */

const puppeteer = require('/workspace/node_modules/puppeteer-core');
const fs = require('fs');
const { PipelineV2 } = require('/tmp/pipeline-v2-node.cjs');

const CHROME_PATH = '/usr/bin/google-chrome';
const OBSERVER_BUNDLE = fs.readFileSync('/tmp/v2-observer-bundle.js', 'utf-8');
const TEST_PAGE = 'file:///workspace/public/coverage-test.html';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Results
const results = [];

// ── Node-side: Pipeline V2 instance ──
let pipeline = null;
let sessionEvents = [];
let pipelineEvents = [];

function createPipeline() {
  pipeline = new PipelineV2();
  pipeline.onEvent((event) => {
    sessionEvents.push(event);
  });
}

// ── Bridge function exposed to the page ──
// The observer calls this instead of chrome.runtime.sendMessage
async function bridgeToPipeline(msg) {
  if (msg && msg.type === 'PIPELINE_EVENT' && msg.payload) {
    pipelineEvents.push(msg.payload);
    if (pipeline) {
      pipeline.ingestEvidence(msg.payload);
    }
  }
  return {};
}

// ── Evaluation helper ──
function evaluateInteraction(testName, userAction, expectedFields, sessionEventsForThis, rawEventCount) {
  const ev = sessionEventsForThis[0]; // Primary event
  const allEvents = sessionEventsForThis;
  
  const evaluation = {
    testName,
    userAction,
    rawEventCount,
    sessionEventCount: allEvents.length,
    sessionEvents: allEvents.map(e => ({
      type: e.type,
      actionId: e.actionId,
      elementName: e.elementIdentity?.accessibleName || 'N/A',
      elementType: e.elementIdentity?.tag || 'N/A',
      value: e.value || e.displayValue || undefined,
      checked: e.checked,
      dateType: e.dateType,
      isoValue: e.isoValue,
      url: e.url,
      title: e.title,
      cssSelector: e.elementIdentity?.cssSelector || '',
      xPath: e.elementIdentity?.xPath || '',
      testId: e.elementIdentity?.testId || null,
    })),
    quality: {
      typeMatch: ev ? ev.type === expectedFields.expectedType : false,
      hasTarget: ev ? !!(ev.elementIdentity?.accessibleName) : false,
      hasValue: expectedFields.expectValue ? !!(ev?.value || ev?.displayValue) : true,
      hasReplayInfo: ev ? !!(ev.elementIdentity?.cssSelector || ev.elementIdentity?.xPath) : false,
      correctTarget: ev ? (ev.elementIdentity?.accessibleName || '').includes(expectedFields.expectedTarget || '') : false,
    },
    verdict: 'UNKNOWN',
    issues: [],
  };
  
  // Determine verdict
  const q = evaluation.quality;
  let score = 0;
  let maxScore = 0;
  
  for (const [check, passed] of Object.entries(q)) {
    maxScore++;
    if (passed) score++;
    else evaluation.issues.push(`${check} FAILED`);
  }
  
  // Check for noise (too many events for a single interaction)
  if (allEvents.length > 3) {
    evaluation.issues.push(`NOISE: ${allEvents.length} session events for one interaction (expected 1-2)`);
    score -= 0.5;
  }
  
  if (allEvents.length === 0) {
    evaluation.verdict = 'NOT_RECORDED';
    evaluation.issues.push('No SessionEvent produced by the pipeline');
  } else if (score >= maxScore - 0.5 && allEvents.length <= 3) {
    evaluation.verdict = 'ACCURATE';
  } else if (score >= maxScore * 0.6) {
    evaluation.verdict = 'PARTIAL';
  } else {
    evaluation.verdict = 'INACCURATE';
  }
  
  results.push(evaluation);
  
  // Log
  const icon = evaluation.verdict === 'ACCURATE' ? '✓' :
               evaluation.verdict === 'PARTIAL' ? '~' :
               evaluation.verdict === 'NOT_RECORDED' ? '✗' : '!';
  console.log(`  ${icon} [${evaluation.verdict}] ${testName}`);
  console.log(`    User did: ${userAction}`);
  console.log(`    Raw events: ${rawEventCount}, Session events: ${allEvents.length}`);
  if (ev) {
    console.log(`    Recorded: ${ev.type} on "${ev.elementIdentity?.accessibleName || 'N/A'}" (${ev.elementIdentity?.tag || '?'})`);
    if (ev.value) console.log(`    Value: "${ev.value}"`);
    if (ev.displayValue) console.log(`    Date: "${ev.displayValue}" (${ev.isoValue})`);
    if (ev.checked !== undefined) console.log(`    Checked: ${ev.checked}`);
  } else {
    console.log(`    Recorded: NOTHING`);
  }
  if (evaluation.issues.length > 0) {
    console.log(`    Issues: ${evaluation.issues.join('; ')}`);
  }
  console.log('');
  
  return evaluation;
}

// ── Test runner ──
async function runTest(page, testName, userAction, expectedFields, interactions) {
  // Clear state
  sessionEvents = [];
  pipelineEvents = [];
  if (pipeline) pipeline.reset();
  
  // Perform interactions
  let interactionError = null;
  try {
    for (const action of interactions) {
      await action(page);
      await sleep(300);
    }
  } catch(e) {
    interactionError = e.message;
  }
  
  // Flush the pipeline to process remaining units
  await sleep(500);
  if (pipeline) pipeline.flush();
  await sleep(500);
  
  const rawCount = pipelineEvents.length;
  const sessionCount = sessionEvents.length;
  const eventsForThis = [...sessionEvents];
  
  const evaluation = evaluateInteraction(testName, userAction, expectedFields, eventsForThis, rawCount);
  if (interactionError) evaluation.issues.push(`INTERACTION_ERROR: ${interactionError}`);
  
  return evaluation;
}

async function runTests() {
  console.log('=== Full Pipeline Quality Validation ===\n');
  
  // Set up pipeline
  createPipeline();
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run'],
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  
  // Expose the bridge function to the page
  await page.exposeFunction('__bridgeToPipeline', bridgeToPipeline);
  
  // Set up mock chrome API + bridge
  const setupScript = `
    window.__cmdrunnerEvents = [];
    window.__mockStorage = {
      pipeline_v2_enabled: true,
      architecture_c_enabled: false,
      ui_state: { recordingState: 'recording' }
    };
    window.chrome = {
      storage: {
        local: {
          get: function(keys, cb) {
            let result = {};
            if (keys === null) { result = JSON.parse(JSON.stringify(window.__mockStorage)); }
            else if (Array.isArray(keys)) { keys.forEach(k => { if (window.__mockStorage[k] !== undefined) result[k] = window.__mockStorage[k]; }); }
            else if (typeof keys === 'string') { result[keys] = window.__mockStorage[keys]; }
            if (cb) cb(result);
            return Promise.resolve(result);
          },
          set: function(items, cb) { Object.assign(window.__mockStorage, items); if (cb) cb(); return Promise.resolve(); }
        },
        onChanged: { addListener: function() {} }
      },
      runtime: {
        id: 'test',
        sendMessage: async function(msg, cb) {
          // Bridge to the Node.js pipeline instead of a service worker
          if (msg && msg.type === 'PIPELINE_EVENT') {
            window.__cmdrunnerEvents.push(msg);
            try { await window.__bridgeToPipeline(msg); } catch(e) { console.log('[BRIDGE ERROR]', e.message); }
          }
          if (cb) cb({});
          return Promise.resolve({});
        },
        onMessage: { addListener: function() {} }
      }
    };
  `;
  
  await page.evaluateOnNewDocument(setupScript);
  await page.evaluateOnNewDocument(OBSERVER_BUNDLE);
  
  // Page console for debugging
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[CmdRunner V2] PIPELINE OUTPUT') || text.includes('[CmdRunner V2] INTENT RESOLVER')) {
      console.log('  [PIPELINE]', text.substring(0, 200));
    }
  });
  
  console.log('Loading test page...');
  await page.goto(TEST_PAGE, { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(3000);
  
  console.log('\n--- Testing Interaction Quality ---\n');
  
  // ════════ 1. BUTTON CLICK ════════
  await runTest(page,
    'Button click',
    'Click "Primary Button"',
    { expectedType: 'click', expectedTarget: 'Primary Button' },
    [p => p.click('[data-testid="btn-primary"]')]
  );
  
  // ════════ 2. HYPERLINK ════════
  await runTest(page,
    'Hyperlink click',
    'Click "Internal Hyperlink"',
    { expectedType: 'click', expectedTarget: 'Internal Hyperlink' },
    [p => p.click('[data-testid="link-internal"]')]
  );
  
  // ════════ 3. TEXT INPUT ════════
  await runTest(page,
    'Text input',
    'Type "Hello World" in the text field, then click away',
    { expectedType: 'text', expectedTarget: 'Text', expectValue: true },
    [
      p => p.click('[data-testid="input-text"]'),
      p => p.type('[data-testid="input-text"]', 'Hello World'),
      p => p.evaluate('document.activeElement.blur()'),
    ]
  );
  
  // ════════ 4. PASSWORD INPUT ════════
  await runTest(page,
    'Password input',
    'Type "secret123" in password field',
    { expectedType: 'text', expectedTarget: 'Password', expectValue: true },
    [
      p => p.click('[data-testid="input-password"]'),
      p => p.type('[data-testid="input-password"]', 'secret123'),
      p => p.evaluate('document.activeElement.blur()'),
    ]
  );
  
  // ════════ 5. SEARCH INPUT ════════
  await runTest(page,
    'Search input',
    'Type "find me" in search box',
    { expectedType: 'text', expectedTarget: 'Search', expectValue: true },
    [
      p => p.click('[data-testid="input-search"]'),
      p => p.type('[data-testid="input-search"]', 'find me'),
      p => p.evaluate('document.activeElement.blur()'),
    ]
  );
  
  // ════════ 6. TEXTAREA ════════
  await runTest(page,
    'Textarea',
    'Type "multi-line content" in textarea',
    { expectedType: 'text', expectedTarget: 'Textarea', expectValue: true },
    [
      p => p.click('[data-testid="textarea"]'),
      p => p.type('[data-testid="textarea"]', 'multi-line content'),
      p => p.evaluate('document.activeElement.blur()'),
    ]
  );
  
  // ════════ 7. CHECKBOX ════════
  await runTest(page,
    'Checkbox toggle',
    'Check "Checkbox 1"',
    { expectedType: 'checkbox', expectedTarget: 'Checkbox 1', expectValue: false },
    [p => p.click('[data-testid="cb-1"]')]
  );
  
  // ════════ 8. RADIO ════════
  await runTest(page,
    'Radio selection',
    'Select "Option 2" radio button',
    { expectedType: 'radio', expectedTarget: 'Option 2' },
    [p => p.click('[data-testid="rb-2"]')]
  );
  
  // ════════ 9. NATIVE SELECT ════════
  await runTest(page,
    'Native dropdown',
    'Select "Banana" from dropdown',
    { expectedType: 'select', expectedTarget: 'Native Select', expectValue: true },
    [p => p.select('[data-testid="select-native"]', 'banana')]
  );
  
  // ════════ 10. MULTI-SELECT ════════
  await runTest(page,
    'Multi-select',
    'Select Red and Green from multi-select',
    { expectedType: 'select', expectedTarget: 'Multi-select', expectValue: true },
    [p => p.select('[data-testid="select-multi"]', 'red', 'green')]
  );
  
  // ════════ 11. DATE PICKER (native) ════════
  await runTest(page,
    'Date picker (native)',
    'Select date 2025-06-15',
    { expectedType: 'dateSelect', expectedTarget: 'Date', expectValue: true },
    [
      p => p.evaluate(`
        var el = document.getElementById('date-native');
        el.value = '2025-06-15';
        el.dispatchEvent(new Event('change', {bubbles: true}));
      `),
    ]
  );
  
  // ════════ 12. TIME PICKER (native) ════════
  await runTest(page,
    'Time picker (native)',
    'Select time 14:30',
    { expectedType: 'dateSelect', expectedTarget: 'Time', expectValue: true },
    [
      p => p.evaluate(`
        var el = document.getElementById('time-native');
        el.value = '14:30';
        el.dispatchEvent(new Event('change', {bubbles: true}));
      `),
    ]
  );
  
  // ════════ 13. CUSTOM CALENDAR ════════
  await runTest(page,
    'Custom calendar date picker',
    'Open calendar and select day 15',
    { expectedType: 'dateSelect', expectedTarget: 'calendar', expectValue: true },
    [
      p => p.click('[data-testid="calendar-trigger"]'),
      p => sleep(500),
      p => p.evaluate(`
        var cells = document.querySelectorAll('#cal-grid .calendar-day:not(.other-month)');
        if (cells[14]) cells[14].click();
      `),
    ]
  );
  
  // ════════ 14. DATE RANGE ════════
  await runTest(page,
    'Date range picker',
    'Select start=2025-01-01 and end=2025-12-31',
    { expectedType: 'dateSelect', expectedTarget: 'date-range', expectValue: true },
    [
      p => p.evaluate(`
        var s = document.getElementById('date-range-start');
        s.value = '2025-01-01'; s.dispatchEvent(new Event('change', {bubbles: true}));
        var e = document.getElementById('date-range-end');
        e.value = '2025-12-31'; e.dispatchEvent(new Event('change', {bubbles: true}));
      `),
    ]
  );
  
  // ════════ 15. ARIA DROPDOWN ════════
  await runTest(page,
    'ARIA combobox dropdown',
    'Open dropdown and select "Beta"',
    { expectedType: 'select', expectedTarget: 'aria-dd', expectValue: true },
    [
      p => p.click('#aria-dd-trigger'),
      p => sleep(300),
      p => p.evaluate(`
        var opts = document.querySelectorAll('#aria-dd-menu [role="option"]');
        if (opts[1]) opts[1].click();
      `),
    ]
  );
  
  // ════════ 16. CSS-ONLY DROPDOWN ════════
  await runTest(page,
    'CSS-only dropdown (no ARIA)',
    'Open dropdown and select "Red"',
    { expectedType: 'select', expectedTarget: 'css-dd', expectValue: true },
    [
      p => p.click('#css-dd-trigger'),
      p => sleep(300),
      p => p.evaluate(`
        var opts = document.querySelectorAll('#css-dd-menu .dropdown-option');
        if (opts[0]) opts[0].click();
      `),
    ]
  );
  
  // ════════ 17. ARIA CHECKBOX ════════
  await runTest(page,
    'ARIA checkbox toggle',
    'Toggle the ARIA checkbox',
    { expectedType: 'checkbox', expectedTarget: 'ARIA Checkbox' },
    [p => p.click('[data-testid="aria-cb"]')]
  );
  
  // ════════ 18. ARIA RADIO ════════
  await runTest(page,
    'ARIA radio selection',
    'Select "Option B" in ARIA radio group',
    { expectedType: 'radio', expectedTarget: 'Option B' },
    [p => p.click('[data-testid="aria-rb-2"]')]
  );
  
  // ════════ 19. TOGGLE SWITCH ════════
  await runTest(page,
    'Toggle switch',
    'Flip the toggle switch',
    { expectedType: 'checkbox', expectedTarget: 'toggle' },
    [
      p => p.evaluate(`
        var el = document.querySelector('[data-testid="toggle-native"]');
        if (el) el.click();
      `),
    ]
  );
  
  // ════════ 20. SEGMENTED CONTROL ════════
  await runTest(page,
    'Segmented control',
    'Switch from "List" to "Grid" view',
    { expectedType: 'click', expectedTarget: 'Grid' },
    [p => p.click('[data-testid="seg-2"]')]
  );
  
  // ════════ 21. RANGE SLIDER ════════
  await runTest(page,
    'Range slider',
    'Move slider from 50 to ~53',
    { expectedType: 'click', expectedTarget: 'Range' },
    [
      p => p.focus('[data-testid="input-range"]'),
      p => p.keyboard.press('ArrowRight'),
      p => p.keyboard.press('ArrowRight'),
      p => p.keyboard.press('ArrowRight'),
    ]
  );
  
  // ════════ 22. TABS ════════
  await runTest(page,
    'Tab switch',
    'Click "Tab 2"',
    { expectedType: 'click', expectedTarget: 'Tab 2' },
    [p => p.click('[data-testid="tab2"]')]
  );
  
  // ════════ 23. ACCORDION (custom) ════════
  await runTest(page,
    'Accordion expand',
    'Click to expand "Custom Accordion 1"',
    { expectedType: 'click', expectedTarget: 'Accordion' },
    [p => p.click('[data-testid="acc-h1"]')]
  );
  
  // ════════ 24. ACCORDION (native) ════════
  await runTest(page,
    'Native details expand',
    'Click summary to expand native details',
    { expectedType: 'click', expectedTarget: 'Native Details' },
    [p => p.click('[data-testid="summary-1"]')]
  );
  
  // ════════ 25. AUTOCOMPLETE ════════
  await runTest(page,
    'Autocomplete',
    'Type "United" and select first suggestion',
    { expectedType: 'text', expectedTarget: 'autocomplete', expectValue: true },
    [
      p => p.click('[data-testid="autocomplete-input"]'),
      p => p.type('[data-testid="autocomplete-input"]', 'United'),
      p => sleep(500),
      p => p.evaluate(`
        var items = document.querySelectorAll('#autocomplete-list .autocomplete-item');
        if (items[0]) items[0].click();
      `),
    ]
  );
  
  // ════════ 26. TREE VIEW ════════
  await runTest(page,
    'Tree expand/collapse',
    'Click "Documents" to collapse it',
    { expectedType: 'click', expectedTarget: 'Documents' },
    [p => p.click('[data-testid="tree-1"]')]
  );
  
  // ════════ 27. TABLE SORT ════════
  await runTest(page,
    'Table sort',
    'Click "Age" column header to sort',
    { expectedType: 'click', expectedTarget: 'Age' },
    [p => p.click('[data-testid="th-age"]')]
  );
  
  // ════════ 28. TABLE ROW CHECKBOX ════════
  await runTest(page,
    'Table row checkbox',
    'Check row 2 checkbox in the table',
    { expectedType: 'checkbox', expectedTarget: 'row-2' },
    [p => p.click('[data-testid="row-2-cb"]')]
  );
  
  // ════════ 29. MODAL OPEN ════════
  await runTest(page,
    'Modal open',
    'Click "Open Modal" button',
    { expectedType: 'click', expectedTarget: 'Open Modal' },
    [p => p.click('[data-testid="open-modal-btn"]')]
  );
  
  // ════════ 30. MODAL CLOSE ════════
  await runTest(page,
    'Modal close (Cancel button)',
    'Click "Cancel" in modal',
    { expectedType: 'click', expectedTarget: 'Cancel' },
    [p => p.click('[data-testid="modal-cancel"]')]
  );
  
  // ════════ 31. FILE UPLOAD ════════
  await runTest(page,
    'File upload',
    'Click file input (simulated)',
    { expectedType: 'click', expectedTarget: 'File' },
    [p => p.click('[data-testid="input-file"]')]
  );
  
  // ════════ 32. DRAG & DROP ════════
  await runTest(page,
    'Drag & Drop',
    'Drag "Item A" from column 1 to column 2',
    { expectedType: 'click', expectedTarget: 'Item A' },
    [
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
    ]
  );
  
  // ════════ 33. RICH TEXT EDITOR ════════
  await runTest(page,
    'Rich text editor',
    'Type "Rich text content" in editor',
    { expectedType: 'text', expectedTarget: 'Rich text editor', expectValue: true },
    [
      p => p.click('[data-testid="rte-editor"]'),
      p => p.keyboard.type('Rich text content'),
      p => p.evaluate('document.activeElement.blur()'),
    ]
  );
  
  // ════════ 34. SHADOW DOM BUTTON ════════
  await runTest(page,
    'Shadow DOM button',
    'Click "Shadow Button 1" inside shadow root',
    { expectedType: 'click', expectedTarget: 'Shadow Button' },
    [
      p => p.evaluate(`
        var host = document.getElementById('shadow-host');
        var shadow = host.shadowRoot;
        var btn = shadow.querySelector('[data-testid="shadow-btn-1"]');
        if (btn) btn.click();
      `),
    ]
  );
  
  // ════════ 35. FORM SUBMIT ════════
  await runTest(page,
    'Form submit',
    'Type in form field and click Submit',
    { expectedType: 'click', expectedTarget: 'Submit' },
    [
      p => p.click('[data-testid="form-input"]'),
      p => p.type('[data-testid="form-input"]', 'test'),
      p => p.click('#form-submit button[type="submit"]'),
    ]
  );
  
  // Write full report
  const reportPath = '/workspace/tests/validation/pipeline-quality-results.json';
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  
  // ── Summary ──
  console.log('\n\n═══════════════════════════════════════════\n');
  console.log('           PIPELINE QUALITY SUMMARY\n');
  console.log('═══════════════════════════════════════════\n');
  
  const byVerdict = {};
  results.forEach(r => { byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1; });
  console.log('By Verdict:');
  Object.entries(byVerdict).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}/${results.length}`);
  });
  
  console.log('\n--- ACCURATE ---');
  results.filter(r => r.verdict === 'ACCURATE').forEach(r => {
    const ev = r.sessionEvents[0];
    console.log(`  ✓ ${r.testName}: ${ev.type} "${ev.elementName}" ${ev.value ? 'value="' + ev.value + '"' : ''}`);
  });
  
  console.log('\n--- PARTIAL ---');
  results.filter(r => r.verdict === 'PARTIAL').forEach(r => {
    const ev = r.sessionEvents[0];
    console.log(`  ~ ${r.testName}: ${ev?.type || 'NONE'} "${ev?.elementName || 'N/A'}"`);
    r.issues.forEach(i => console.log(`    → ${i}`));
  });
  
  console.log('\n--- INACCURATE ---');
  results.filter(r => r.verdict === 'INACCURATE').forEach(r => {
    const ev = r.sessionEvents[0];
    console.log(`  ! ${r.testName}: ${ev?.type || 'NONE'} "${ev?.elementName || 'N/A'}"`);
    r.issues.forEach(i => console.log(`    → ${i}`));
  });
  
  console.log('\n--- NOT RECORDED ---');
  results.filter(r => r.verdict === 'NOT_RECORDED').forEach(r => {
    console.log(`  ✗ ${r.testName}: no SessionEvent produced (${r.rawEventCount} raw events)`);
  });
  
  console.log(`\nFull report: ${reportPath}`);
  
  await browser.close();
}

runTests().catch(err => { console.error('Fatal:', err); process.exit(1); });
