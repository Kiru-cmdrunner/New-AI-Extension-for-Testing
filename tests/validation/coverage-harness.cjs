/**
 * Interaction Coverage Validation Harness
 * 
 * Loads the CmdRunner Smart Recorder extension into Chrome via puppeteer,
 * performs real interactions on test pages, reads back captured events
 * from the extension's side panel, and reports what was actually captured.
 * 
 * Usage: node tests/validation/coverage-harness.js
 */

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '../../dist');
const CHROME_PATH = '/usr/bin/google-chrome';

// Results storage
const results = [];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function launchBrowser() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,  // Extensions require headed mode even in newer Chrome
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--window-size=1400,900',
    ],
  });
  return browser;
}

async function getExtensionId(browser) {
  // Get the service worker target
  const targets = browser.targets();
  const sw = targets.find(t => t.type() === 'service_worker');
  if (!sw) {
    // Wait for it
    await sleep(2000);
    const targets2 = browser.targets();
    const sw2 = targets2.find(t => t.type() === 'service_worker');
    if (!sw2) throw new Error('Extension service worker not found');
    const url = sw2.url();
    return url.split('/')[2]; // chrome-extension://<ID>/...
  }
  const url = sw.url();
  return url.split('/')[2];
}

async function startRecording(browser, extensionId) {
  // Send START_RECORDING via the service worker
  const sw = await browser.serviceWorker();
  if (!sw) throw new Error('No service worker target');
  
  // First, enable Pipeline V2
  await sw.evaluate(`
    chrome.storage.local.get(null, async (data) => {
      await chrome.storage.local.set({
        PIPELINE_V2_ENABLED: true,
        ARCHITECTURE_C_ENABLED: false
      });
    });
  `);
  await sleep(500);

  // Now send START_RECORDING
  await sw.evaluate(`
    chrome.runtime.sendMessage({ type: 'START_RECORDING' });
  `);
  await sleep(1000);
}

async function stopRecording(browser, extensionId) {
  const sw = await browser.serviceWorker();
  
  // Send STOP_RECORDING
  await sw.evaluate(`
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  `);
  await sleep(1000);
  
  // Read the recorded events from storage
  const data = await sw.evaluate(`
    new Promise((resolve) => {
      chrome.storage.local.get(null, (data) => {
        // Find the most recent session
        const keys = Object.keys(data).filter(k => k.startsWith('session_'));
        if (keys.length === 0) {
          // Maybe stored differently - check for events array
          resolve(JSON.stringify(data));
        } else {
          const latest = keys.sort().pop();
          resolve(JSON.stringify(data[latest]));
        }
      });
    })
  `);
  return data;
}

async function readCapturedEvents(browser) {
  const sw = await browser.serviceWorker();
  const result = await sw.evaluate(`
    new Promise((resolve) => {
      chrome.storage.local.get(null, (data) => {
        // Dump all storage keys for debugging
        const keys = Object.keys(data);
        const summary = {};
        for (const key of keys) {
          const val = data[key];
          if (typeof val === 'string') {
            summary[key] = val.substring(0, 200);
          } else if (Array.isArray(val)) {
            summary[key] = 'Array[' + val.length + ']';
          } else if (val && typeof val === 'object') {
            summary[key] = 'Object keys: ' + Object.keys(val).join(',').substring(0, 200);
          } else {
            summary[key] = String(val);
          }
        }
        resolve(JSON.stringify(summary));
      });
    })
  `);
  return JSON.parse(result);
}

async function performInteraction(page, interaction) {
  const { type, selector, value, options = {} } = interaction;
  
  try {
    switch (type) {
      case 'click':
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector, options);
        return { ok: true };
      case 'clickText':
        const [el] = await page.$x("//text()[contains(., '" + value + "')]/..");
        if (el) {
          await el.click();
          return { ok: true };
        }
        return { ok: false, error: 'Text not found: ' + value };
      case 'type':
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
        await page.type(selector, value, options);
        return { ok: true };
      case 'select':
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.select(selector, value);
        return { ok: true };
      case 'check':
        await page.waitForSelector(selector, { timeout: 5000 });
        const isChecked = await page.$eval(selector, el => el.checked);
        if (!isChecked) await page.click(selector);
        return { ok: true };
      case 'press':
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.focus(selector);
        await page.keyboard.press(value);
        return { ok: true };
      case 'hover':
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.hover(selector);
        await sleep(options.dwell || 600);
        return { ok: true };
      case 'evaluate':
        const result = await page.evaluate(value);
        return { ok: true, result };
      case 'focus':
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.focus(selector);
        return { ok: true };
      case 'blur':
        await page.evaluate('document.body.click()');
        return { ok: true };
      case 'wait':
        await sleep(value);
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown type: ' + type };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  launchBrowser,
  getExtensionId,
  startRecording,
  stopRecording,
  readCapturedEvents,
  performInteraction,
  sleep,
  results,
};
