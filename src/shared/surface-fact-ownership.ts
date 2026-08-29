/**
 * B7-P4 §5.4 item 2 — SHARED ADVERSARIAL SURFACE-FACT OWNERSHIP PASS.
 *
 * One pure pass over ALL window-bearing interactions. The revealed-surface
 * fact must be OWNED by a hover's window, not merely contained in it
 * (INV-C1: the DOM/surface accumulator is GLOBAL — overlapping windows
 * re-report each other's facts; containment is never causation).
 *
 * OWNERSHIP RULE (adversarial, not naive first-reporter):
 *   (a) BATCH BOUNDARY — the fact was recorded at/after the window's
 *       open: fact batch ordinal >= the window's delivered `openedBatch`
 *       (the global MutationObserver batch counter at open — the same
 *       coordinate space every fact ordinal lives in). A window whose
 *       evidence carries NO `openedBatch` (legacy rows) owns NOTHING —
 *       ownership that cannot be verified is never claimed.
 *   (b) PRIMARY-ACTION VETO (Channel A Variant 1) — a Hover does not own
 *       a fact when a click-family anchor (trigger `click`/`contextmenu`
 *       — the primary-stamp classes) on a compatible tab has T0 inside
 *       the hover's window span [open epoch, open epoch + durationMs]
 *       AND the fact's batch ordinal is at/after that click's own
 *       `openedBatch` (facts recorded before the click cannot be its
 *       consequences). When the click's evidence lacks `openedBatch`
 *       (legacy), the span veto applies to every fact of the window
 *       (conservative direction — silence, never fabrication). A naive
 *       earliest-reporter rule FAILS Variant 1: the hover opens BEFORE
 *       the click and would claim first report.
 *   (c) CONTAINER PRECEDENCE (Channel A Variant 2) — a Hover does not
 *       own a fact whose path is, or lives under, a surface path already
 *       OWNED by an earlier interaction. The click that revealed a panel
 *       owns facts on that panel's path; staggered insertions landing in
 *       that panel later — after the click's own window closed, so ONLY
 *       the inheriting hover's window contains them — are the click's
 *       handler's consequences, not the hover's. Applies to Hover
 *       claimants only: a click (primary action) operating on a surface
 *       an earlier hover revealed is surface-REUSE, not inheritance.
 *
 * Click-family interactions are never vetoed by (b)/(c) — they ARE the
 * primary-action class the rule defers to; they still require (a).
 *
 * Deterministic (INV-GEN-1 family): input order only, no clock, no
 * randomness, no site vocabulary. Lives in src/shared so BOTH consumers
 * share one implementation: the causal-graph provenance pass (B7-P3
 * §5.3.2, extended) and the generation-layer surface-visible derivation
 * (INV-GEN-8: the generation layer imports shared modules only).
 */

// ── Input shapes (tolerant subsets of recorded artifacts) ───────────────

/** Minimal event record the pass reads. */
export interface OwnershipEventLike {
  eventId?: string;
  eventType?: string;
  timestamp?: number;
  captureOrigin?: { tabId?: number | null } | null;
}

/** Minimal evidence payload the pass reads. */
export interface OwnershipEvidenceLike {
  window?: {
    durationMs?: number;
    /** Global batch counter at window open (P4 delivery; absent = legacy). */
    openedBatch?: number;
  };
  applicationEvidence?: {
    domChanges?: Array<{
      targetPath?: string | null;
      addedNodesCount?: number;
      changedAttributes?: string[];
      attributeDeltas?: Record<string, { old?: string | null; new?: string | null }>;
      firstBatchIndex?: number;
    }>;
    newSurfaces?: Array<{
      path?: string | null;
      ariaRole?: string | null;
      accessibleName?: string | null;
      batchIndex?: number;
    }>;
    visibilityChanges?: Array<{
      path?: string | null;
      property?: string;
      oldValue?: string | null;
      newValue?: string | null;
      batchIndex?: number;
    }>;
  };
}

/** Minimal interaction record the pass reads. */
export interface OwnershipInteraction {
  interactionId: string;
  type?: string;
  triggerEvent?: OwnershipEventLike | null;
  behavioralEvidence?: OwnershipEvidenceLike;
}

// ── Facts ────────────────────────────────────────────────────────────────

/**
 * Surface fact classes. 'reveal' and 'insertion' are the assertion-
 * derivable kinds (B7-P4 surface-visible); 'mutation' is any other
 * recorded DOM change on a path — ownership-only, never derivable, kept
 * so container precedence (rule (c)) can see the click's footprint on a
 * surface even when the change was not a reveal-class flip.
 */
export type SurfaceFactKind = 'reveal' | 'insertion' | 'mutation';

export interface OwnedSurfaceFact {
  kind: SurfaceFactKind;
  /** Recorded DOM path (segment grammar `tag` / `tag#id`, ' > ' joined). */
  path: string;
  /** Global batch ordinal of the fact's first recording. */
  batchIndex: number;
  /** Honest locator from the last #id-bearing segment, or null. */
  locator: string | null;
  ariaRole: string | null;
  /** accessibleName for surface records; null otherwise. */
  targetName: string | null;
}

export interface SurfaceOwnershipResult {
  /** interactionId → facts owned by that interaction's window. */
  ownedByInteraction: ReadonlyMap<string, OwnedSurfaceFact[]>;
}

// ── Path grammar helpers ─────────────────────────────────────────────────

/** Split a recorded path into segments (' > ' separator). */
function pathSegments(path: string): string[] {
  return path.split('>').map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Honest locator for a recorded path: the LAST #id-bearing segment, as a
 * '#id' CSS selector — the same tier the derivation layer trusts
 * (INV-GEN-4: no class chains, no synthesized nth). Null when the path
 * has no id-bearing segment (the fact is owned but not derivable).
 */
function idLocatorOfPath(path: string): string | null {
  const segments = pathSegments(path);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const hash = segments[i].indexOf('#');
    if (hash >= 0) {
      const id = segments[i].slice(hash + 1);
      if (id) return `#${id}`;
    }
  }
  return null;
}

/** Is `self` the same path as, or a descendant of, `ancestor`? */
function pathContains(ancestor: string, self: string): boolean {
  if (ancestor === self) return true;
  return self.startsWith(`${ancestor} > `);
}

// ── Fact extraction (parity with deriveConsequenceClasses class list) ───

/** Attribute flips that count as reveal-class facts (B7-P2 §5.2.7 list). */
function isRevealAttributeFlip(
  deltas: Record<string, { old?: string | null; new?: string | null }> | undefined,
): boolean {
  if (!deltas) return false;
  return (
    (deltas['aria-expanded']?.old === 'false' && deltas['aria-expanded']?.new === 'true') ||
    (deltas['aria-selected']?.old === 'false' && deltas['aria-selected']?.new === 'true') ||
    (deltas['aria-checked']?.old === 'false' && deltas['aria-checked']?.new === 'true') ||
    (deltas['aria-hidden']?.old === 'true' &&
      (deltas['aria-hidden']?.new === 'false' || deltas['aria-hidden']?.new == null)) ||
    (deltas['hidden']?.old != null && deltas['hidden']?.new == null) ||
    (deltas['open']?.old === 'false' && deltas['open']?.new === 'true')
  );
}

/** Visibility flips that count as reveal-class facts (shown direction). */
function isRevealVisibilityFlip(v: {
  property?: string;
  oldValue?: string | null;
  newValue?: string | null;
}): boolean {
  if (v.property == null || v.oldValue == null || v.newValue == null) return false;
  if (v.oldValue === v.newValue) return false;
  return (
    (v.property === 'display' && v.newValue === 'block') ||
    (v.property === 'display' && v.newValue === 'flex') ||
    (v.property === 'visibility' && v.newValue === 'visible') ||
    (v.property === 'opacity' && v.newValue !== '' && v.newValue !== '0')
  );
}

interface ExtractedFact {
  kind: SurfaceFactKind;
  path: string;
  batchIndex: number;
  ariaRole: string | null;
  targetName: string | null;
}

/** Extract surface facts recorded in one interaction's evidence window. */
function extractFacts(interaction: OwnershipInteraction): ExtractedFact[] {
  const app = interaction.behavioralEvidence?.applicationEvidence;
  if (!app) return [];
  const facts: ExtractedFact[] = [];

  for (const s of app.newSurfaces ?? []) {
    if (!s?.path) continue;
    facts.push({
      // Every new-surface record is a surface emergence (revealed or
      // inserted) — reveal-class for ownership purposes.
      kind: 'reveal',
      path: s.path,
      batchIndex: s.batchIndex ?? 0,
      ariaRole: s.ariaRole ?? null,
      targetName: s.accessibleName ?? null,
    });
  }

  for (const c of app.domChanges ?? []) {
    if (!c?.targetPath) continue;
    const batchIndex = c.firstBatchIndex ?? 0;
    if (isRevealAttributeFlip(c.attributeDeltas)) {
      facts.push({ kind: 'reveal', path: c.targetPath, batchIndex, ariaRole: null, targetName: null });
    }
    if ((c.addedNodesCount ?? 0) > 0) {
      facts.push({ kind: 'insertion', path: c.targetPath, batchIndex, ariaRole: null, targetName: null });
    }
    if (
      !isRevealAttributeFlip(c.attributeDeltas) &&
      (c.addedNodesCount ?? 0) === 0
    ) {
      // Any other recorded change on the path — ownership footprint only.
      facts.push({ kind: 'mutation', path: c.targetPath, batchIndex, ariaRole: null, targetName: null });
    }
  }

  for (const v of app.visibilityChanges ?? []) {
    if (!v?.path) continue;
    if (isRevealVisibilityFlip(v)) {
      facts.push({
        kind: 'reveal',
        path: v.path,
        batchIndex: v.batchIndex ?? 0,
        ariaRole: null,
        targetName: null,
      });
    }
  }

  return facts;
}

// ── Click-family anchors ─────────────────────────────────────────────────

interface ClickAnchor {
  interactionId: string;
  t0: number;
  tabId: number | null;
  /** The click's own openedBatch (undefined = legacy/absent evidence). */
  openedBatch: number | undefined;
}

const CLICK_FAMILY_EVENT_TYPES = new Set(['click', 'contextmenu']);

function isClickFamily(interaction: OwnershipInteraction): boolean {
  const t = interaction.triggerEvent?.eventType;
  return t != null && CLICK_FAMILY_EVENT_TYPES.has(t);
}

// ── The pass ─────────────────────────────────────────────────────────────

/**
 * Derive surface-fact ownership for every interaction. See the module
 * doc for the rule. Pure; input order determines all tie-breaks.
 */
export function deriveSurfaceFactOwnership(
  interactions: readonly OwnershipInteraction[],
): SurfaceOwnershipResult {
  const ownedByInteraction = new Map<string, OwnedSurfaceFact[]>();
  /** path → first owning interactionId (drives rule (c) for later hovers). */
  const ownedPaths = new Map<string, string>();

  // Click-family anchors, input (recorded) order.
  const clickAnchors: ClickAnchor[] = [];
  for (const interaction of interactions) {
    if (!isClickFamily(interaction)) continue;
    const t = interaction.triggerEvent?.timestamp;
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    clickAnchors.push({
      interactionId: interaction.interactionId,
      t0: t,
      tabId: interaction.triggerEvent?.captureOrigin?.tabId ?? null,
      openedBatch: interaction.behavioralEvidence?.window?.openedBatch,
    });
  }

  for (const interaction of interactions) {
    const evidence = interaction.behavioralEvidence;
    const window = evidence?.window;
    // Rule (a) precondition: ownership is only verifiable against a
    // delivered openedBatch. Legacy rows (field absent) own nothing.
    const openedBatch = window?.openedBatch;
    const isHover = interaction.type === 'Hover';
    const openEpoch =
      typeof interaction.triggerEvent?.timestamp === 'number' &&
      Number.isFinite(interaction.triggerEvent.timestamp)
        ? interaction.triggerEvent.timestamp
        : null;

    const facts = extractFacts(interaction);
    if (openedBatch === undefined || facts.length === 0) continue;

    const durationMs =
      typeof window?.durationMs === 'number' && Number.isFinite(window.durationMs)
        ? window.durationMs
        : 0;
    // A hover whose open epoch is unresolvable cannot run the veto —
    // unverifiable ownership is never claimed.
    if (isHover && openEpoch === null) continue;

    const owned: OwnedSurfaceFact[] = [];
    for (const fact of facts) {
      // (a) batch boundary — replay of pre-open history owns nothing.
      if (fact.batchIndex < openedBatch) continue;

      if (isHover && openEpoch !== null) {
        // (b) primary-action veto — Channel A Variant 1.
        const vetoed = clickAnchors.some((c) => {
          if (c.interactionId === interaction.interactionId) return false;
          // Tab compatibility mirrors T4: a KNOWN mismatch never vetoes;
          // an unknown tab on either side is honest same-tab assumption.
          if (c.tabId !== null && interaction.triggerEvent?.captureOrigin?.tabId != null) {
            if (c.tabId !== interaction.triggerEvent.captureOrigin.tabId) return false;
          }
          if (c.t0 < openEpoch || c.t0 > openEpoch + durationMs) return false;
          // Fact granularity: a fact recorded BEFORE the click's first
          // post-open batch cannot be the click's consequence.
          if (c.openedBatch !== undefined && fact.batchIndex < c.openedBatch) return false;
          return true;
        });
        if (vetoed) continue;

        // (c) container precedence — Channel A Variant 2. A surface path
        // (or an ancestor of it) already owned by an EARLIER interaction
        // is not this hover's to claim.
        const precedent = [...ownedPaths.entries()].some(
          ([path, ownerId]) =>
            ownerId !== interaction.interactionId && pathContains(path, fact.path),
        );
        if (precedent) continue;
      }

      owned.push({
        kind: fact.kind,
        path: fact.path,
        batchIndex: fact.batchIndex,
        locator: idLocatorOfPath(fact.path),
        ariaRole: fact.ariaRole,
        targetName: fact.targetName,
      });
      if (!ownedPaths.has(fact.path)) ownedPaths.set(fact.path, interaction.interactionId);
    }

    if (owned.length > 0) ownedByInteraction.set(interaction.interactionId, owned);
  }

  return { ownedByInteraction };
}
