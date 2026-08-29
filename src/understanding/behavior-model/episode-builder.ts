/**
 * Application Behavior Model — Episode Builder (CP2)
 *
 * Deterministic, pure derivation of ActionEpisodes from recorded
 * ComponentInteractions (+ optional network rows / post-nav records).
 *
 * Governing rules (approved architecture + coding design R1–R7):
 *   - Anchors are EXACTLY the interactions whose trigger event type is in
 *     DISCRETE_ACTION_TYPES (consumed from the evidence ledger — never
 *     redefined here). One anchor = one episode (`ep-<anchorInteractionId>`).
 *   - Members derive by rule, in a fixed resolution order:
 *       navigation → parameter → companion → unclassified(malformed only)
 *     Everything else stays unowned (never guessed into an episode).
 *   - Split horizons (R2): uiOwnership closes at the earliest of next-anchor
 *     (same tab) / stabilization (max effective member end) / recording stop.
 *     attribution closes only when all stamped requests settle, or the tail
 *     cap, or recording stop. A new anchor NEVER closes attribution.
 *   - Ordering domain (R3): recorded epoch milliseconds ONLY
 *     (triggerEvent.timestamp, startTime/endTime, committedAt). captureSeq /
 *     performance.now are document-local and never order across documents.
 *     Tie-break ladder: epoch → CER-5 (compareInteractionIds) → eventId
 *     lexical. No Date.now(), no randomness, no Map-iteration-order output.
 *   - Malformed interactions (R4): never dropped silently — retained as
 *     degraded `unclassified` members via horizon-interval containment, or
 *     reported as warnings when not even an id exists.
 *
 * This module MUST NOT:
 *   - read stores, spawn timers, or perform I/O (pure derivation);
 *   - create CausalEdges / EvidenceRefs (CP3 causal-graph owns that);
 *   - touch capture, attribution, StateBuilder, M9, ASIN, Phase-1 NAV,
 *     Fix 2/4, or persistence.
 */

import { isAnchorEligibleInteraction } from '../../runtime/evidence-ledger';
import { compareInteractionIds } from '../state-builder/interaction-ordering';
import type { ComponentInteraction } from '../../shared/component-types';
import type {
  ActionEpisode,
  AttributionCloseReason,
  BehaviorModelWarning,
  ConsequenceHorizon,
  EpisodeAnchor,
  EpisodeMember,
  EpisodeMemberRole,
  ParameterLink,
  ParameterInput,
  UiOwnershipCloseReason,
} from './model-types';
import { ATTRIBUTION_TAIL_MS } from './model-types';

// ═════════════════════════════════════════════════════════════════════════
// Inputs
// ═════════════════════════════════════════════════════════════════════════

/**
 * Tolerant interaction shape. `triggerEvent` is typed optional because
 * runtime/storage data may predate enrichment or arrive partially written —
 * the builder treats a missing/invalid triggerEvent as MALFORMED (R4),
 * never crashes on it.
 */
export type EpisodeBuilderInteraction = Omit<ComponentInteraction, 'triggerEvent'> & {
  triggerEvent?: ComponentInteraction['triggerEvent'];
};

/** Network row subset the builder needs for pending-request tracking. */
export interface BuilderNetworkRow {
  /** Chrome webRequest requestId — globally unique per HTTP request. */
  requestId?: string;
  /** CER trusted event id active at request start (the T1 stamp). */
  sourceEventId?: string;
  /** HTTP status once the request completed; null/undefined = unsettled. */
  status?: number | null;
}

/** PostNavCaptureRecord subset (correlated by navEventId). */
export interface BuilderPostNavRecord {
  navEventId: string;
  committedAt: number;
}

export interface EpisodeBuilderInput {
  interactions: EpisodeBuilderInteraction[];
  /** Provide to settle attribution horizons; omit to leave them open. */
  networkRows?: BuilderNetworkRow[];
  /** Full-reload commit records (SW pendingNavCapture), by navEventId. */
  postNavRecords?: BuilderPostNavRecord[];
  /** Wall-clock ms at recording stop, when known. */
  recordingStopAtMs?: number;
}

export interface EpisodeBuilderResult {
  /** Anchor order: (trigger epoch asc, CER-5, eventId lexical). */
  episodes: ActionEpisode[];
  /** Interactions that are neither anchors nor members of any episode,
   *  ordered by CER-5. Reported, never guessed into an episode. */
  unownedInteractionIds: string[];
  warnings: BehaviorModelWarning[];
}

// ═════════════════════════════════════════════════════════════════════════
// Constants (builder-local: CP1 types stay untouched)
// ═════════════════════════════════════════════════════════════════════════

/**
 * How long before an anchor a completed input interaction may still be
 * linked as a parameter via the form-overlap heuristic.
 *
 * NOTE — capture ceiling (disclosed in the implementation plan): form
 * membership (which <form> an element belongs to) is NOT captured anywhere
 * in ElementIdentity or DomContext. The approved 'form-overlap' link is
 * therefore implemented as its best provable approximation: the anchor is a
 * submit-capable control (BUTTON, or INPUT[type=submit|button|image]) on
 * the same document/tab, the input completed within this window before the
 * anchor, and no other anchor intervened. When form identity is captured in
 * the future, tighten this rule — the link kind stays the same.
 */
export const PARAMETER_LINK_WINDOW_MS = 30_000;

/**
 * D1b: how close to a non-link anchor (the suggestion-<div> shape) a
 * completed input may sit to still be linked as that anchor's parameter
 * via the gesture-adjacency rule. Typing then immediately picking a
 * suggestion is one gesture — observed lag is well under 500ms — while a
 * submit-capable button keeps the original generous window.
 */
export const GESTURE_ADJACENT_MS = 500;

/**
 * Effective settling span added to a navigation member's end: mirrors the
 * Phase-1 post-navigation observation window's 3s hard cap. The navigation
 * interaction itself completes immediately at commit, but the destination
 * document's observations belong to this episode's uiOwnership horizon
 * while that window is live (R1: destination churn is claimed by the
 * episode, degraded capped-window).
 */
export const NAV_MEMBER_SETTLING_MS = 3_000;

/**
 * How long after a submit-capable anchor's T₀ a browser-generated 'submit'
 * interaction may still derive as that anchor's companion (design R3
 * submit-follows-click key). The observed native-submit lag is ~40–80ms;
 * the bound is generous but bounded.
 */
export const SUBMIT_FOLLOWS_WINDOW_MS = 5_000;

/** Interaction types that represent user INPUT (parameter candidates). */
const INPUT_INTERACTION_TYPES = new Set<string>([
  'TextEntry',
  'Dropdown',
  'Checkbox',
  'RadioButton',
  'DatePicker',
  'FileUpload',
  'Slider',
  'ColorInput',
]);

// ═════════════════════════════════════════════════════════════════════════
// Internal normalized form
// ═════════════════════════════════════════════════════════════════════════

interface NormalizedInteraction {
  id: string;
  type: string;
  /** Trigger epoch ms; NaN when malformed. */
  t0: number;
  startTime: number;
  endTime: number;
  lifecycleId: string | null;
  tabId: number | null;
  pageId: string | null;
  /** triggerEvent.eventType when present. */
  triggerEventType: string | null;
  /** All event ids owned by this interaction (trigger + members). */
  eventIds: Set<string>;
  /** Full record, for metadata reads. */
  raw: EpisodeBuilderInteraction;
  malformed: boolean;
  /** Effective end for horizon math (navigation members get +settling). */
  effectiveEnd: number;
  /** Assigned role + owning episode once resolved. */
  assignedEpisodeId: string | null;
  assignedRole: EpisodeMemberRole | null;
  parameterLink: ParameterLink | null;
  degraded: boolean;
}

function parsePageId(eventId: string | undefined): string | null {
  if (!eventId) return null;
  const m = /^evt-(.+)-\d+$/.exec(eventId);
  return m ? m[1] : null;
}

function tabIdOf(i: EpisodeBuilderInteraction): number | null {
  const fromEvent = i.triggerEvent?.captureOrigin?.tabId;
  if (typeof fromEvent === 'number') return fromEvent;
  const fromMeta = (i.metadata?.captureOrigin as { tabId?: number } | undefined)?.tabId;
  if (typeof fromMeta === 'number') return fromMeta;
  return null;
}

function normalize(interaction: EpisodeBuilderInteraction): NormalizedInteraction | null {
  // An interaction with no usable id cannot be referenced by ANY model
  // object — retained as a warning only (never a silent drop).
  const id = interaction.interactionId;
  if (typeof id !== 'string' || id.length === 0) return null;

  const trigger = interaction.triggerEvent;
  const t0 = typeof trigger?.timestamp === 'number' && Number.isFinite(trigger.timestamp)
    ? trigger.timestamp
    : NaN;
  const malformed = !trigger || !Number.isFinite(t0);

  const eventIds = new Set<string>();
  if (trigger?.eventId) eventIds.add(trigger.eventId);
  for (const e of interaction.memberEvents ?? []) {
    if (e?.eventId) eventIds.add(e.eventId);
  }

  const startTime = Number.isFinite(interaction.startTime)
    ? interaction.startTime
    : Number.isFinite(t0)
      ? t0
      : 0;
  const endTime = Number.isFinite(interaction.endTime)
    ? interaction.endTime
    : startTime;

  return {
    id,
    type: String(interaction.type ?? 'Unclassified'),
    t0,
    startTime,
    endTime,
    lifecycleId: typeof interaction.lifecycleId === 'string' ? interaction.lifecycleId : null,
    tabId: tabIdOf(interaction),
    pageId: parsePageId(trigger?.eventId),
    triggerEventType: trigger?.eventType ?? null,
    eventIds,
    raw: interaction,
    malformed,
    effectiveEnd: endTime,
    assignedEpisodeId: null,
    assignedRole: null,
    parameterLink: null,
    degraded: malformed,
  };
}

/** Submit-capable anchor target, per the captured identity fields. */
function isSubmitCapable(a: NormalizedInteraction): boolean {
  const trigger = a.raw.trigger ?? a.raw.triggerEvent?.target;
  const tag = trigger?.tag ?? null;
  const inputType = a.raw.trigger?.inputType ?? a.raw.triggerEvent?.domContext?.inputType ?? null;
  if (tag === 'BUTTON') return true;
  if (tag === 'INPUT' && typeof inputType === 'string') {
    return inputType === 'submit' || inputType === 'button' || inputType === 'image';
  }
  return false;
}

function anchorTargetOf(a: NormalizedInteraction): string {
  const name =
    a.raw.trigger?.accessibleName ??
    (a.raw.metadata?.targetName as string | undefined) ??
    a.raw.triggerEvent?.target?.accessibleName ??
    null;
  if (typeof name === 'string' && name.length > 0) return name;
  return a.raw.trigger?.tag ?? a.type;
}

// ═════════════════════════════════════════════════════════════════════════
// Builder
// ═════════════════════════════════════════════════════════════════════════

export function buildEpisodes(input: EpisodeBuilderInput): EpisodeBuilderResult {
  const warnings: BehaviorModelWarning[] = [];
  const unowned: string[] = [];

  // ── 1. Normalize (id-less records → warning; the rest retained) ──────
  const all: NormalizedInteraction[] = [];
  for (const interaction of input.interactions ?? []) {
    const n = normalize(interaction);
    if (!n) {
      warnings.push({
        code: 'malformed-interaction-dropped',
        message:
          'Interaction record without a usable interactionId cannot be referenced by the model; retained as a warning only.',
        refs: [String((interaction as { interactionId?: unknown }).interactionId ?? '<missing>')],
      });
      continue;
    }
    all.push(n);
  }

  // ── 2. Anchors: B7-P3 §5.3.1 — admission-keyed anchor gate ───────────
  // ANCHOR_ELIGIBLE raw-event types anchor exactly as before; an ADMITTED
  // Hover (completed + ≥1 recorded consequence class) anchors its own
  // episode. Gesture-only/abandoned hovers never anchor (V4 honesty).
  const anchors = all
    .filter((i) => !i.malformed && isAnchorEligibleInteraction(i.raw))
    .sort(compareAnchors);
  const nonAnchors = all.filter((i) => !anchors.includes(i));

  // Episode skeletons, anchor order.
  interface Skeleton {
    episodeId: string;
    anchor: NormalizedInteraction;
    members: NormalizedInteraction[];
    tabId: number | null;
    usedNullTabFallback: boolean;
  }
  const skeletons: Skeleton[] = anchors.map((anchor) => ({
    episodeId: `ep-${anchor.id}`,
    anchor,
    members: [],
    tabId: anchor.tabId,
    usedNullTabFallback: anchor.tabId === null,
  }));

  // Per-tab anchor T₀ list (for provisional uiOwnership bounds + the
  // "no intervening anchor" parameter check). null-tab forms one group.
  const anchorT0sByTab = new Map<number | null, number[]>();
  for (const a of anchors) {
    const list = anchorT0sByTab.get(a.tabId) ?? [];
    list.push(a.t0);
    anchorT0sByTab.set(a.tabId, list);
  }
  for (const list of anchorT0sByTab.values()) list.sort((x, y) => x - y);

  /** Earliest anchor T₀ on the tab strictly after `epoch` (undefined: none). */
  function nextAnchorT0(tabId: number | null, epoch: number): number | undefined {
    const list = anchorT0sByTab.get(tabId);
    if (!list) return undefined;
    for (const t of list) if (t > epoch) return t;
    return undefined;
  }

  // ── D1b pre-pass (pure): anchors that own a committed NAVIGATION member.
  //
  // A click on a plain <div> (search suggestion) that triggers a
  // programmatic form submit is the canonical "caused a navigation" shape:
  // the div is not submit-capable (isSubmitCapable is false), so Rule 2
  // below would never fire and the typed query lost its parameterInputs.
  // Owning a committed navigation on the same tab is the observable proof
  // the gesture submitted the form. Computed BEFORE member resolution
  // (navigation roles are assigned in step 3a) from the same inputs the
  // builder already has: pure, no extra state, no ordering coupling.
  const navOwnerAnchorIds = new Set<string>();
  {
    const navType = all.filter(
      (i) => i.type === 'Navigation' && !i.malformed && i.raw.triggerEvent?.eventId,
    );
    for (const nav of navType) {
      const navRecord = input.postNavRecords?.find(
        (r) => r.navEventId === nav.raw.triggerEvent?.eventId,
      );
      const commitEpoch = navRecord ? navRecord.committedAt : nav.t0;
      // Find the latest anchor whose gesture owns this commit: same tab,
      // anchor T₀ ≤ commit, no later anchor in between.
      let owner: NormalizedInteraction | null = null;
      for (const a of anchors) {
        if (a.tabId !== nav.tabId) continue;
        if (a.t0 > commitEpoch) continue;
        if (!owner || a.t0 > owner.t0) owner = a;
      }
      if (owner) navOwnerAnchorIds.add(owner.id);
    }
  }

  /** Provisional uiOwnership upper bound for membership containment:
   *  the next anchor's T₀ (exclusive) — members may end before it. */
  function provisionalBound(tabId: number | null, t0: number): number {
    return nextAnchorT0(tabId, t0) ?? Number.POSITIVE_INFINITY;
  }

  /** Candidate episodes on the tab whose provisional horizon contains
   *  `epoch`; latest anchor wins (deterministic). */
  function liveEpisodeAt(tabId: number | null, epoch: number): Skeleton | null {
    let best: Skeleton | null = null;
    for (const s of skeletons) {
      if (s.tabId !== tabId) continue;
      if (epoch < s.anchor.t0) continue;
      if (epoch >= provisionalBound(tabId, s.anchor.t0)) continue;
      if (!best || s.anchor.t0 > best.anchor.t0) best = s;
    }
    return best;
  }

  // ── 3. Member resolution (fixed order, first match wins) ─────────────
  for (const i of nonAnchors) {
    if (i.assignedEpisodeId) continue; // defensive; nothing assigned yet

    // (a) NAVIGATION — a Navigation interaction committed inside a live
    //     episode's provisional horizon on the same tab.
    if (i.type === 'Navigation' && !i.malformed) {
      const navRecord = input.postNavRecords?.find((r) => r.navEventId === i.raw.triggerEvent?.eventId);
      const commitEpoch = navRecord ? navRecord.committedAt : i.t0;
      const owner = liveEpisodeAt(i.tabId, commitEpoch);
      if (owner) {
        i.assignedEpisodeId = owner.episodeId;
        i.assignedRole = 'navigation';
        // Destination observations stay claimable for the settling span.
        i.effectiveEnd = Math.max(i.endTime, commitEpoch + NAV_MEMBER_SETTLING_MS);
        owner.members.push(i);
        continue;
      }
      // No live episode → unowned (its destination evidence is claimed by
      // whichever episode IS live later — CP3, not membership).
      unowned.push(i.id);
      continue;
    }

    // (b) PARAMETER — input-type interaction linked to an anchor.
    if (!i.malformed && INPUT_INTERACTION_TYPES.has(i.type)) {
      const linked = linkParameter(i, skeletons, nextAnchorT0, navOwnerAnchorIds);
      if (linked) {
        i.assignedEpisodeId = linked.skeleton.episodeId;
        i.assignedRole = 'parameter';
        i.parameterLink = linked.link;
        linked.skeleton.members.push(i);
        continue;
      }
      // fall through: an unlinked input is not a member.
    }

    // (c) COMPANION — shares the anchor's component lifecycle (exact).
    if (!i.malformed && i.lifecycleId !== null) {
      const owner = skeletons.find(
        (s) => s.anchor.lifecycleId === i.lifecycleId && s.anchor.lifecycleId !== null,
      );
      if (owner) {
        i.assignedEpisodeId = owner.episodeId;
        i.assignedRole = 'companion';
        owner.members.push(i);
        continue;
      }
    }

    // (c2) COMPANION — submit-follows-click (design R3 derivation key).
    //     A browser-generated native submit (trigger eventType 'submit')
    //     that fires inside a live submit-capable anchor's provisional
    //     horizon on the same tab. This is the Amazon shape: the
    //     input[type=submit] click triggers a native form submit ~40–80ms
    //     later as its own interaction with a distinct lifecycle.
    if (i.triggerEventType === 'submit' && !i.malformed) {
      let owner: Skeleton | null = null;
      for (const s of skeletons) {
        if (s.tabId !== i.tabId) continue;
        if (!isSubmitCapable(s.anchor)) continue;
        if (i.t0 < s.anchor.t0 || i.t0 - s.anchor.t0 > SUBMIT_FOLLOWS_WINDOW_MS) continue;
        if (i.t0 >= provisionalBound(s.tabId, s.anchor.t0)) continue;
        if (!owner || s.anchor.t0 > owner.anchor.t0) owner = s;
      }
      if (owner) {
        i.assignedEpisodeId = owner.episodeId;
        i.assignedRole = 'companion';
        owner.members.push(i);
        continue;
      }
      // A submit with no live submit-capable anchor stays unowned — it is
      // browser-generated, never an anchor itself (DISCRETE_ACTION_TYPES).
      unowned.push(i.id);
      continue;
    }

    // (d) UNCLASSIFIED — malformed records retained by horizon-interval
    //     containment (R4): never dropped, flagged degraded. Tab resolution
    //     ladder: exact tab → (when tabId unknown) epoch bracket across all
    //     episodes with an unknown-tab warning.
    if (i.malformed) {
      let owner = i.tabId === null ? null : liveEpisodeAt(i.tabId, i.startTime);
      if (!owner && i.tabId === null) {
        let fallback: Skeleton | null = null;
        for (const s of skeletons) {
          if (i.startTime < s.anchor.t0) continue;
          if (i.startTime >= provisionalBound(s.tabId, s.anchor.t0)) continue;
          if (!fallback || s.anchor.t0 > fallback.anchor.t0) fallback = s;
        }
        owner = fallback;
      }
      if (owner) {
        i.assignedEpisodeId = owner.episodeId;
        i.assignedRole = 'unclassified';
        i.degraded = true;
        owner.members.push(i);
        warnings.push({
          code: 'malformed-member-retained',
          message: `Interaction ${i.id} is malformed (missing/invalid triggerEvent) and retained as a degraded unclassified member of ${owner.episodeId} by interval containment${i.tabId === null ? ' (tab unknown; epoch-bracket fallback)' : ''}.`,
          refs: [i.id, owner.episodeId],
        });
        continue;
      }
      warnings.push({
        code: 'malformed-member-retained',
        message: `Malformed interaction ${i.id} lies outside every episode horizon; reported as unowned rather than guessed into an episode.`,
        refs: [i.id],
      });
      unowned.push(i.id);
      continue;
    }

    // (e) Well-formed with no derivation key → unowned, no warning noise.
    unowned.push(i.id);
  }

  // ── 4. Horizons ──────────────────────────────────────────────────────
  const anchorIndex = anchors.map((a) => ({ tabId: a.tabId, t0: a.t0 }));
  const episodes: ActionEpisode[] = skeletons.map((s) => {
    const horizon = computeHorizon(s, anchorIndex, input);

    // Members in deterministic order: role precedence, then epoch, then id.
    const roleRank: Record<EpisodeMemberRole, number> = {
      anchor: 0,
      parameter: 1,
      companion: 2,
      navigation: 3,
      unclassified: 4,
    };
    const orderedMembers: EpisodeMember[] = [
      {
        interactionId: s.anchor.id,
        role: 'anchor',
        degraded: s.anchor.malformed ? true : undefined,
      },
      ...s.members
        .slice()
        .sort(
          (a, b) =>
            roleRank[(a.assignedRole ?? 'unclassified') as EpisodeMemberRole] -
              roleRank[(b.assignedRole ?? 'unclassified') as EpisodeMemberRole] ||
            a.startTime - b.startTime ||
            compareInteractionIds(a.id, b.id),
        )
        .map((m) => ({
          interactionId: m.id,
          role: (m.assignedRole ?? 'unclassified') as EpisodeMemberRole,
          degraded: m.degraded ? true : undefined,
        })),
    ];

    const parameterInputs: Array<ParameterInput & { link: ParameterLink }> = s.members
      .filter((m) => m.assignedRole === 'parameter')
      .sort((a, b) => a.endTime - b.endTime || compareInteractionIds(a.id, b.id))
      .map((m) => ({
        interactionId: m.id,
        label: (m.raw.metadata?.targetName as string | undefined) ?? null,
        value:
          (m.raw.metadata?.textValue as string | undefined) ??
          // 6F-M1 B: DatePicker writes dateValue (never textValue — its
          // focus-triggered shape has no text); params were rendering null.
          (m.raw.metadata?.dateValue as string | undefined) ??
          (m.raw.triggerEvent?.valueAfter as string | null) ??
          null,
        link: m.parameterLink ?? 'form-overlap',
      }));

    const anchorDef: EpisodeAnchor = {
      interactionId: s.anchor.id,
      actionType: s.anchor.raw.type,
      actionTarget: anchorTargetOf(s.anchor),
      triggerTimestamp: s.anchor.t0,
    };

    return {
      id: s.episodeId,
      anchor: anchorDef,
      members: orderedMembers,
      parameterInputs,
      edges: [], // CP3 — causal-graph
      provenanceLinks: [], // CP3
      unattributed: [], // CP3
      horizon,
      episodeOutcome: null, // CP4
      tabId: s.tabId,
    };
  });

  if (skeletons.some((s) => s.usedNullTabFallback)) {
    warnings.push({
      code: 'unknown-tab-resolution',
      message:
        'One or more anchors carry no captureOrigin.tabId; they were grouped into the shared null-tab scope. Membership decisions involving them may be coarser than tab-scoped ones.',
      refs: skeletons.filter((s) => s.usedNullTabFallback).map((s) => s.episodeId),
    });
  }

  return {
    episodes,
    unownedInteractionIds: unowned.slice().sort(compareInteractionIds),
    warnings,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Parameter linking
// ═════════════════════════════════════════════════════════════════════════

function linkParameter(
  i: NormalizedInteraction,
  skeletons: Array<{
    episodeId: string;
    anchor: NormalizedInteraction;
    members: NormalizedInteraction[];
    tabId: number | null;
  }>,
  nextAnchorT0: (tabId: number | null, epoch: number) => number | undefined,
  navOwnerAnchorIds: Set<string>,
): {
  skeleton: { episodeId: string; members: NormalizedInteraction[] };
  link: ParameterLink;
} | null {
  let best: {
    skeleton: { episodeId: string; members: NormalizedInteraction[] };
    link: ParameterLink;
    t0: number;
  } | null = null;

  for (const s of skeletons) {
    // Rule 1 — SAME-LIFECYCLE (exact): input shares the anchor's component
    // lifecycle. Works for any anchor type; no window needed.
    if (i.lifecycleId !== null && s.anchor.lifecycleId === i.lifecycleId) {
      if (!best || s.anchor.t0 > best.t0) {
        best = { skeleton: s, link: 'same-lifecycle', t0: s.anchor.t0 };
      }
      continue;
    }

    // Rule 2 — FORM-OVERLAP (best provable approximation; see
    // PARAMETER_LINK_WINDOW_MS note): anchor is submit-capable, same
    // document, input completed inside the link window before the anchor,
    // no intervening anchor on the tab.
    //
    // D1b: OR the anchor is gesture-adjacent AND owns a committed
    // navigation (the suggestion-<div> programmatic-submit shape — not
    // submit-capable, but its click navigated). A-links are excluded: a
    // link click does not submit a form, so its parameters come from
    // Rule 1 only. The window tightens to GESTURE_ADJACENT_MS for this
    // arm to keep the same-document guard meaningful.
    const submitCapable = isSubmitCapable(s.anchor);
    const gestureAdjacentNavOwner =
      !submitCapable &&
      navOwnerAnchorIds.has(s.anchor.id) &&
      s.anchor.raw.trigger?.tag !== 'A';
    if (!submitCapable && !gestureAdjacentNavOwner) continue;
    if (i.tabId !== s.tabId) continue;
    if (i.pageId === null || s.anchor.pageId === null || i.pageId !== s.anchor.pageId) continue;
    if (i.endTime > s.anchor.t0) continue; // must complete before the anchor
    const windowMs = gestureAdjacentNavOwner ? GESTURE_ADJACENT_MS : PARAMETER_LINK_WINDOW_MS;
    if (s.anchor.t0 - i.endTime > windowMs) continue;
    const intervening = nextAnchorT0(s.tabId, i.endTime);
    if (intervening !== undefined && intervening < s.anchor.t0) continue;

    if (!best || s.anchor.t0 > best.t0) {
      best = { skeleton: s, link: 'form-overlap', t0: s.anchor.t0 };
    }
  }

  return best ? { skeleton: best.skeleton, link: best.link } : null;
}

// ═════════════════════════════════════════════════════════════════════════
// Horizons
// ═════════════════════════════════════════════════════════════════════════

/** Earliest strictly-later anchor T₀ on the same tab, from the full anchor
 *  population (pure — index passed in, no module state). */
function laterAnchorT0(
  s: { anchor: NormalizedInteraction; tabId: number | null },
  anchorIndex: Array<{ tabId: number | null; t0: number }>,
): number | undefined {
  let best: number | undefined;
  for (const a of anchorIndex) {
    if (a.tabId !== s.tabId) continue;
    if (a.t0 <= s.anchor.t0) continue;
    if (best === undefined || a.t0 < best) best = a.t0;
  }
  return best;
}

function computeHorizon(
  s: {
    episodeId: string;
    anchor: NormalizedInteraction;
    members: NormalizedInteraction[];
    tabId: number | null;
  },
  anchorIndex: Array<{ tabId: number | null; t0: number }>,
  input: EpisodeBuilderInput,
): ConsequenceHorizon {
  const t0 = s.anchor.t0;

  // uiOwnership close: earliest of next-anchor / stabilization / stop.
  const memberEnds = [s.anchor.effectiveEnd, ...s.members.map((m) => m.effectiveEnd)];
  const maxEnd = memberEnds.reduce((acc, v) => (v > acc ? v : acc), t0);

  let uiClosedAt = maxEnd;
  let uiReason: UiOwnershipCloseReason = 'stabilized';

  const later = laterAnchorT0(s, anchorIndex);
  if (later !== undefined && later < uiClosedAt) {
    uiClosedAt = later;
    uiReason = 'next-anchor';
  } else if (
    input.recordingStopAtMs !== undefined &&
    input.recordingStopAtMs < uiClosedAt
  ) {
    uiClosedAt = input.recordingStopAtMs;
    uiReason = 'recording-stop';
  }

  // attribution close: pending stamped requests settle, else tail cap,
  // else recording stop. New anchors NEVER close attribution.
  const episodeEventIds = new Set<string>([
    ...s.anchor.eventIds,
    ...s.members.flatMap((m) => [...m.eventIds]),
  ]);

  let attributionClosedAt: number | null = null;
  let attributionReason: AttributionCloseReason | null = null;
  let pendingRequestIds: string[] = [];

  if (input.networkRows) {
    const pending = new Set<string>();
    for (const row of input.networkRows) {
      if (!row.requestId || !row.sourceEventId) continue;
      if (!episodeEventIds.has(row.sourceEventId)) continue;
      if (row.status === null || row.status === undefined) pending.add(row.requestId);
    }
    pendingRequestIds = [...pending].sort();

    if (pending.size === 0) {
      // All stamped requests settled (or none were stamped). Exact settle
      // instants are not derivable from the row shape — close at the
      // uiOwnership boundary (documented approximation).
      attributionClosedAt = uiClosedAt;
      attributionReason = 'all-stamped-settled';
    } else {
      const tailBound = uiClosedAt + ATTRIBUTION_TAIL_MS;
      if (input.recordingStopAtMs !== undefined && input.recordingStopAtMs <= tailBound) {
        attributionClosedAt = input.recordingStopAtMs;
        attributionReason = 'recording-stop';
      } else {
        attributionClosedAt = tailBound;
        attributionReason = 'tail-capped';
      }
    }
  }
  // No networkRows input → attribution left open (null, null, []).

  return {
    uiOwnership: {
      openedAtMs: t0,
      closedAtMs: uiClosedAt,
      closeReason: uiReason,
    },
    attribution: {
      openedAtMs: t0,
      closedAtMs: attributionClosedAt,
      closeReason: attributionReason,
      pendingRequestIds,
    },
  };
}

function compareAnchors(a: NormalizedInteraction, b: NormalizedInteraction): number {
  return a.t0 - b.t0 || compareInteractionIds(a.id, b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
