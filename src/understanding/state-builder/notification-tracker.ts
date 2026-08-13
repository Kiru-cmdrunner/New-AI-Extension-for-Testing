/**
 * Notification Tracker — records notifications and their lifecycle.
 *
 * When a NotificationSignal with kind='appeared' arrives, a new
 * NotificationRecord is created. When kind='disappeared' arrives for
 * a known notification, its disappearedAt is set.
 *
 * M9.2
 */

import type { NotificationRecord } from './types';

export class NotificationTracker {
  private notifications: NotificationRecord[] = [];
  private nextId = 0;

  /**
   * Record a notification appearance.
   */
  recordAppearance(
    text: string,
    severity: NotificationRecord['severity'],
    elementPath: string,
    interactionId: string,
  ): NotificationRecord {
    // Dedup: if a notification with the same text+path is already active,
    // don't create a duplicate.
    const existing = this.notifications.find(
      (n) => n.elementPath === elementPath && n.disappearedAt === null && n.text === text,
    );
    if (existing) return existing;

    const record: NotificationRecord = {
      id: `notification-${this.nextId++}`,
      text,
      severity,
      elementPath,
      appearedAt: interactionId,
      disappearedAt: null,
    };
    this.notifications.push(record);
    return record;
  }

  /**
   * Record a notification disappearance.
   */
  recordDisappearance(elementPath: string, interactionId: string): void {
    const active = this.notifications.find(
      (n) => n.elementPath === elementPath && n.disappearedAt === null,
    );
    if (active) {
      active.disappearedAt = interactionId;
    }
  }

  /**
   * Get all notifications.
   */
  getAll(): NotificationRecord[] {
    return [...this.notifications];
  }

  /**
   * Get active (not yet disappeared) notifications.
   */
  getActive(): NotificationRecord[] {
    return this.notifications.filter((n) => n.disappearedAt === null);
  }

  get size(): number {
    return this.notifications.length;
  }

  clear(): void {
    this.notifications = [];
    this.nextId = 0;
  }
}
