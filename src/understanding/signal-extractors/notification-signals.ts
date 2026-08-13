/**
 * Notification Signal Extractor — extracts notification signals from
 * SurfaceChange entries.
 *
 * Reads `applicationEvidence.newSurfaces[]` and `removedSurfaces[]` and
 * identifies notification-like elements (role=alert, status, log).
 * Extracts the accessible name as notification text.
 *
 * M9.2
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { SignalExtractor, Signal, NotificationSignal } from '../types';

/** ARIA roles that indicate notification surfaces. */
const NOTIFICATION_ROLES = new Set(['alert', 'status', 'log']);

/** Severity classification from role + accessible name heuristics. */
function classifySeverity(
  role: string | null,
  text: string | null,
): NotificationSignal['severity'] {
  if (role === 'alert') {
    // Alerts are typically errors or warnings
    if (text && /error|fail|invalid|incorrect|required|unable/i.test(text)) {
      return 'error';
    }
    return 'warning';
  }
  if (role === 'status') {
    if (text && /success|added|removed|updated|complete|saved|done/i.test(text)) {
      return 'success';
    }
    return 'info';
  }
  if (role === 'log') {
    return 'info';
  }
  return 'unknown';
}

export class NotificationSignalExtractor implements SignalExtractor {
  readonly name = 'NotificationSignalExtractor';

  extract(interaction: ComponentInteraction): Signal[] {
    const evidence = interaction.behavioralEvidence;
    if (!evidence) return [];

    const app = evidence.applicationEvidence;
    const signals: NotificationSignal[] = [];

    // Check new surfaces (notifications that appeared)
    for (const surface of app.newSurfaces) {
      if (surface.ariaRole && NOTIFICATION_ROLES.has(surface.ariaRole)) {
        signals.push({
          type: 'notification',
          interactionId: interaction.interactionId,
          source: 'surface',
          confidence: 0.8,
          text: surface.accessibleName ?? '',
          severity: classifySeverity(surface.ariaRole, surface.accessibleName),
          elementPath: surface.path,
          kind: 'appeared',
        });
      }
    }

    // Check removed surfaces (notifications that disappeared)
    for (const surface of app.removedSurfaces) {
      if (surface.ariaRole && NOTIFICATION_ROLES.has(surface.ariaRole)) {
        signals.push({
          type: 'notification',
          interactionId: interaction.interactionId,
          source: 'surface',
          confidence: 0.7,
          text: surface.accessibleName ?? '',
          severity: classifySeverity(surface.ariaRole, surface.accessibleName),
          elementPath: surface.path,
          kind: 'disappeared',
        });
      }
    }

    return signals;
  }
}
