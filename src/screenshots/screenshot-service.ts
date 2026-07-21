/**
 * Screenshot Service — captures and stores screenshots during recording.
 *
 * Captures are triggered at meaningful action points (navigation, click,
 * text entry, dropdown) and are fire-and-forget: the capture happens
 * asynchronously after the event is added to the recording session,
 * so it never blocks or delays the recording pipeline.
 *
 * Each screenshot is linked to the triggering action via actionId and
 * elementId, enabling future AI Vision analysis to correlate screenshots
 * with recorded events.
 *
 * This service does NOT analyze screenshots — it only captures and stores.
 */
import { StorageKeys, ScreenshotMetadata } from '../shared/types';

/** Singleton screenshot ID counter (in-memory, reset on session start). */
let screenshotCounter = 0;

/** Reset the screenshot counter when a new recording session starts. */
export function resetScreenshotCounter(): void {
  screenshotCounter = 0;
}

/** Generate the next screenshot ID. */
function nextScreenshotId(): string {
  screenshotCounter += 1;
  return `shot-${String(screenshotCounter).padStart(4, '0')}`;
}

export class ScreenshotService {
  // ── Capture ──────────────────────────────────────────────

  /**
   * Capture a screenshot of the visible tab and store it with metadata.
   *
   * This is fire-and-forget: it calls chrome.tabs.captureVisibleTab,
   * stores the result, and resolves. Failures are logged but do not
   * affect the recording pipeline.
   *
   * @param tabId — the tab to capture (passed for API compatibility;
   *   captureVisibleTab targets the tab's window)
   * @param actionId — the action that triggered the screenshot
   * @param elementId — the element associated with the action (null for navigation)
   * @param actionType — the type of action
   */
  static async capture(
    _tabId: number,
    actionId: string,
    elementId: string | null,
    actionType: string,
  ): Promise<ScreenshotMetadata | null> {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(undefined as unknown as number, {
        format: 'png',
      });

      if (!dataUrl) return null;

      const metadata: ScreenshotMetadata = {
        screenshotId: nextScreenshotId(),
        timestamp: new Date().toISOString(),
        actionId,
        elementId,
        actionType,
        dataUrl,
      };

      await this.appendScreenshot(metadata);
      return metadata;
    } catch (err) {
      // captureVisibleTab can fail if the tab is not visible,
      // permissions changed, or the rate limit is exceeded (max 2/sec).
      // Log but don't throw — screenshots are non-blocking.
      console.error('[CmdRunner] Screenshot capture failed:', err);
      return null;
    }
  }

  // ── Storage ──────────────────────────────────────────────

  /**
   * Read all screenshots from the current session.
   */
  static async getall(): Promise<ScreenshotMetadata[]> {
    const result = await chrome.storage.local.get(StorageKeys.SCREENSHOTS);
    const stored = result[StorageKeys.SCREENSHOTS];
    return Array.isArray(stored) ? stored as ScreenshotMetadata[] : [];
  }

  /**
   * Read all screenshots from the current session.
   * Alias for getall() — the canonical name.
   */
  static async getAll(): Promise<ScreenshotMetadata[]> {
    return this.getall();
  }

  /**
   * Append a screenshot metadata to storage.
   */
  private static async appendScreenshot(metadata: ScreenshotMetadata): Promise<void> {
    const screenshots = await this.getall();
    screenshots.push(metadata);
    await chrome.storage.local.set({ [StorageKeys.SCREENSHOTS]: screenshots });
  }

  /**
   * Get screenshots for a specific action.
   */
  static async getByActionId(actionId: string): Promise<ScreenshotMetadata | null> {
    const screenshots = await this.getall();
    return screenshots.find((s) => s.actionId === actionId) ?? null;
  }

  /**
   * Clear all stored screenshots.
   */
  static async clear(): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.SCREENSHOTS]: [] });
  }

  /**
   * Get the current screenshot count without loading full data.
   */
  static async count(): Promise<number> {
    const screenshots = await this.getall();
    return screenshots.length;
  }
}
