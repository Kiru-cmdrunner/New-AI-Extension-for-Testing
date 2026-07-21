/**
 * Unit tests for ScreenshotService.
 *
 * Tests cover: capture, storage, retrieval by action ID, count, clear,
 * and the screenshot ID counter sequence.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { ScreenshotService, resetScreenshotCounter } from '../src/screenshots/screenshot-service';
import { StorageKeys } from '../src/shared/types';

// Mock chrome.tabs.captureVisibleTab
function mockCaptureVisibleTab(dataUrl: string | null = 'data:image/png;base64,FAKE_PNG') {
  const captureMock = vi.fn(async () => dataUrl);
  (globalThis.chrome as unknown as { tabs: { captureVisibleTab: typeof captureMock } }).tabs = {
    captureVisibleTab: captureMock,
  };
  return captureMock;
}

describe('ScreenshotService', () => {
  beforeEach(() => {
    setupChromeMock({});
    resetScreenshotCounter();
    mockCaptureVisibleTab();
  });

  describe('capture()', () => {
    it('captures a screenshot and stores metadata', async () => {
      const result = await ScreenshotService.capture(1, 'click-0001', 'elem-0001', 'click');

      expect(result).not.toBeNull();
      expect(result!.screenshotId).toBe('shot-0001');
      expect(result!.actionId).toBe('click-0001');
      expect(result!.elementId).toBe('elem-0001');
      expect(result!.actionType).toBe('click');
      expect(result!.dataUrl).toBe('data:image/png;base64,FAKE_PNG');
      expect(result!.timestamp).toBeTruthy();
    });

    it('generates sequential screenshot IDs', async () => {
      const s1 = await ScreenshotService.capture(1, 'click-0001', 'elem-0001', 'click');
      const s2 = await ScreenshotService.capture(1, 'text-0001', 'elem-0002', 'text_entry');
      const s3 = await ScreenshotService.capture(1, 'click-0002', 'elem-0003', 'click');

      expect(s1!.screenshotId).toBe('shot-0001');
      expect(s2!.screenshotId).toBe('shot-0002');
      expect(s3!.screenshotId).toBe('shot-0003');
    });

    it('supports null elementId for navigation events', async () => {
      const result = await ScreenshotService.capture(1, 'nav-0001', null, 'navigation');

      expect(result).not.toBeNull();
      expect(result!.elementId).toBeNull();
      expect(result!.actionType).toBe('navigation');
    });

    it('returns null when captureVisibleTab returns empty', async () => {
      mockCaptureVisibleTab(null);
      const result = await ScreenshotService.capture(1, 'click-0001', 'elem-0001', 'click');
      expect(result).toBeNull();
    });

    it('returns null when captureVisibleTab throws', async () => {
      const captureMock = vi.fn(async () => {
        throw new Error('Tab not visible');
      });
      (globalThis.chrome as unknown as { tabs: { captureVisibleTab: typeof captureMock } }).tabs = {
        captureVisibleTab: captureMock,
      };

      const result = await ScreenshotService.capture(1, 'click-0001', 'elem-0001', 'click');
      expect(result).toBeNull();
    });
  });

  describe('storage', () => {
    it('stores screenshots in chrome.storage.local under SCREENSHOTS key', async () => {
      await ScreenshotService.capture(1, 'click-0001', 'elem-0001', 'click');

      const stored = await chrome.storage.local.get(StorageKeys.SCREENSHOTS);
      const screenshots = stored[StorageKeys.SCREENSHOTS];
      expect(Array.isArray(screenshots)).toBe(true);
      expect(screenshots).toHaveLength(1);
      expect(screenshots[0].actionId).toBe('click-0001');
    });

    it('appends new screenshots to existing ones', async () => {
      await ScreenshotService.capture(1, 'click-0001', 'elem-0001', 'click');
      await ScreenshotService.capture(1, 'click-0002', 'elem-0002', 'click');
      await ScreenshotService.capture(1, 'text-0001', 'elem-0003', 'text_entry');

      const all = await ScreenshotService.getAll();
      expect(all).toHaveLength(3);
    });
  });

  describe('getAll()', () => {
    it('returns empty array when no screenshots stored', async () => {
      const result = await ScreenshotService.getAll();
      expect(result).toEqual([]);
    });

    it('returns all stored screenshots', async () => {
      await ScreenshotService.capture(1, 'click-0001', 'elem-0001', 'click');
      await ScreenshotService.capture(1, 'nav-0001', null, 'navigation');

      const result = await ScreenshotService.getAll();
      expect(result).toHaveLength(2);
      expect(result[0].actionId).toBe('click-0001');
      expect(result[1].actionId).toBe('nav-0001');
    });
  });

  describe('getByActionId()', () => {
    it('finds screenshot by action ID', async () => {
      await ScreenshotService.capture(1, 'click-0001', 'elem-0001', 'click');
      await ScreenshotService.capture(1, 'click-0002', 'elem-0002', 'click');

      const result = await ScreenshotService.getByActionId('click-0002');
      expect(result).not.toBeNull();
      expect(result!.actionId).toBe('click-0002');
      expect(result!.elementId).toBe('elem-0002');
    });

    it('returns null for non-existent action ID', async () => {
      const result = await ScreenshotService.getByActionId('click-9999');
      expect(result).toBeNull();
    });
  });

  describe('clear()', () => {
    it('removes all screenshots', async () => {
      await ScreenshotService.capture(1, 'click-0001', 'elem-0001', 'click');
      await ScreenshotService.capture(1, 'click-0002', 'elem-0002', 'click');
      expect(await ScreenshotService.count()).toBe(2);

      await ScreenshotService.clear();
      expect(await ScreenshotService.count()).toBe(0);
      expect(await ScreenshotService.getAll()).toEqual([]);
    });
  });

  describe('count()', () => {
    it('returns 0 when empty', async () => {
      expect(await ScreenshotService.count()).toBe(0);
    });

    it('returns correct count after captures', async () => {
      await ScreenshotService.capture(1, 'click-0001', 'elem-0001', 'click');
      await ScreenshotService.capture(1, 'click-0002', 'elem-0002', 'click');
      await ScreenshotService.capture(1, 'nav-0001', null, 'navigation');
      expect(await ScreenshotService.count()).toBe(3);
    });
  });

  describe('resetScreenshotCounter()', () => {
    it('resets the counter to shot-0001', async () => {
      await ScreenshotService.capture(1, 'click-0001', 'elem-0001', 'click');
      expect((await ScreenshotService.getAll())[0].screenshotId).toBe('shot-0001');

      resetScreenshotCounter();
      await ScreenshotService.capture(1, 'click-0002', 'elem-0002', 'click');
      const all = await ScreenshotService.getAll();
      expect(all[1].screenshotId).toBe('shot-0001');
    });
  });
});
