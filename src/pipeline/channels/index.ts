/**
 * Evidence Channel Registry — Phase 2
 *
 * Central registry for all evidence channels. The EventTap (Phase 3)
 * will iterate over this registry to collect evidence from each channel.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { ChannelId } from '../../types/foundation';
import type { EvidenceRecord } from '../../types/foundation';
import type { ChannelMap, ChannelCollectInput } from './evidence-channel';
import { ChannelA } from './channel-a-accessibility';
import { ChannelB } from './channel-b-dom-structure';
import { ChannelC } from './channel-c-behavioural';
import { ChannelD } from './channel-d-mutations';
import { ChannelE } from './channel-e-focus-overlay';

/**
 * All registered evidence channels in a fixed order.
 *
 * Channel execution order is deterministic:
 *   A (Accessibility) → B (DOM Structure) → C (Behavioural) →
 *   D (Runtime Mutations) → E (Focus & Overlay)
 *
 * This ensures that channels which produce shared context (e.g. Channel D
 * detecting surfaces) run after channels that need it.
 */
export const ALL_CHANNELS = [ChannelA, ChannelB, ChannelC, ChannelD, ChannelE] as const;

/**
 * Channel registry as a map for O(1) lookup by ChannelId.
 */
export const CHANNEL_MAP: ChannelMap = {
  A: ChannelA,
  B: ChannelB,
  C: ChannelC,
  D: ChannelD,
  E: ChannelE,
};

/**
 * Collect evidence from ALL registered channels for a given input.
 *
 * This is the main entry point that the EventTap will call.
 * Each channel runs independently — a failure in one channel does not
 * affect the others.
 *
 * @returns Combined EvidenceRecord[] from all channels
 */
export function collectAllEvidence(input: ChannelCollectInput): EvidenceRecord[] {
  const allRecords: EvidenceRecord[] = [];
  for (const channel of ALL_CHANNELS) {
    try {
      const records = channel.collect(input);
      allRecords.push(...records);
    } catch {
      // Non-fatal: a failing channel is skipped
    }
  }
  return allRecords;
}

/**
 * Collect evidence from a specific channel by ID.
 */
export function collectFromChannel(channelId: ChannelId, input: ChannelCollectInput): EvidenceRecord[] {
  const channel = CHANNEL_MAP[channelId];
  if (!channel) return [];
  try {
    return channel.collect(input);
  } catch {
    return [];
  }
}
