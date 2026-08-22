/**
 * MS-U2 — pure helpers for evidence drill-downs.
 *
 * Spec: .drytis/specs/phase-6-u2-evidence-drilldowns.md (D6/D7).
 *
 * Deterministic, DOM-free data shaping only:
 *  - truncateJson: serialize evidence to JSON with an honest cap.
 *  - stabilityBars: cap stability samples to the newest 12, map to bar heights.
 *
 * No engine imports. No timing decisions — display of RECORDED values only.
 */

import type { StabilitySample } from '../shared/behavioral-evidence-types';

/** Max characters of raw evidence JSON rendered in the panel (D7). */
export const RAW_JSON_MAX_CHARS = 200_000;

/**
 * Serialize evidence for the raw JSON disclosure.
 * Returns the full serialization when it fits, else the first RAW_JSON_MAX_CHARS
 * characters plus an honest truncation marker.
 */
export function truncateJson(value: unknown): { text: string; truncated: boolean } {
  const full = JSON.stringify(value, null, 2) ?? '(unserializable)';
  if (full.length <= RAW_JSON_MAX_CHARS) return { text: full, truncated: false };
  return {
    text: full.slice(0, RAW_JSON_MAX_CHARS),
    truncated: true,
  };
}

/** Max stability bars rendered (newest samples win; D6). */
export const STABILITY_BARS_MAX = 12;

export interface StabilityBar {
  /** 0-100, proportional to msSinceLastMutation against the max in the shown set. */
  heightPct: number;
  /** Recorded values, for tooltips/aria. */
  msSinceLastMutation: number;
  globalBatchCount: number;
}

/**
 * Map stability samples to bar descriptors. Deterministic: newest N samples,
 * height proportional to the max msSinceLastMutation within that window.
 * Empty input → empty array (caller renders nothing — honest absence).
 */
export function stabilityBars(samples: StabilitySample[]): StabilityBar[] {
  if (!samples || samples.length === 0) return [];
  const shown = samples.slice(-STABILITY_BARS_MAX);
  const max = Math.max(...shown.map((s) => s.msSinceLastMutation), 1);
  return shown.map((s) => ({
    heightPct: Math.round((s.msSinceLastMutation / max) * 100),
    msSinceLastMutation: s.msSinceLastMutation,
    globalBatchCount: s.globalBatchCount,
  }));
}

/** Human label for a network source enum (D3). */
export function networkSourceLabel(source: string): string {
  switch (source) {
    case 'main-world':
      return 'main-world';
    case 'webrequest':
      return 'webRequest';
    case 'performance-observer':
      return 'performance-observer';
    default:
      return source;
  }
}
