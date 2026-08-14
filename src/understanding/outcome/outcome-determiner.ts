/**
 * M9.3 - Outcome Determiner
 *
 * Evaluates an interaction's signals + state transition to determine
 * a semantic outcome (success/failure/ambiguous/incomplete) using
 * weighted-evidence voting.
 *
 * Key principle: never claim an outcome without evidence. If the SignalSet
 * is empty and the transition shows no state changes, the outcome is
 * 'incomplete' -- NOT 'success'.
 *
 * Architecture: .drytis/specs/m9-3-outcome-determination.md
 */

// types are accessed indirectly through OutcomeDeterminerInput
import type {
  ActionOutcome,
  OutcomeCategory,
  OutcomeVote,
  OutcomeDeterminerInput,
} from './outcome-types';
import { confidenceToLevel, CONFIRMATION_VIEWS } from './outcome-types';

// ── Weights ────────────────────────────────────────────────────────────

/**
 * Weight constants for each evidence type.
 * Tuned so that a single strong signal (API success = 0.4) reaches
 * 'possible' but needs corroboration (another signal) to reach 'likely'.
 */
const WEIGHTS = {
  apiSuccess: 0.4,
  apiFailure: 0.5,
  notificationSuccess: 0.3,
  notificationError: 0.4,
  notificationWarning: 0.15,
  counterPositive: 0.2,
  counterNegative: 0.2,
  viewConfirmation: 0.25,
  listGrowth: 0.15,
  pageContentEntity: 0.15,
  pageContentCounter: 0.2,
  pageContentNotification: 0.2,
} as const;

// ── Outcome Determiner ──────────────────────────────────────────────────

export class OutcomeDeterminer {
  /**
   * Optional additional confirmation view IDs from domain packs (M9.11).
   * Checked in addition to the built-in CONFIRMATION_VIEWS set.
   */
  private readonly extraConfirmationViews: Set<string>;

  /**
   * @param extraConfirmationViews Optional set of additional view IDs that
   *   indicate successful confirmation (e.g., domain-specific views from
   *   a DomainPack). M9.11.
   */
  constructor(extraConfirmationViews?: Set<string>) {
    this.extraConfirmationViews = extraConfirmationViews ?? new Set();
  }
  /**
   * Determine the outcome for a single interaction.
   *
   * Steps:
   * 1. Collect weighted votes from all signals + state transition delta.
   * 2. Sum success votes and failure votes.
   * 3. If both sides have votes -> ambiguous.
   * 4. If neither side has votes -> incomplete.
   * 5. Otherwise -> the winning side, with confidence = total weight.
   */
  determine(input: OutcomeDeterminerInput): ActionOutcome {
    const votes = this.collectVotes(input);
    const stateChanges = this.extractStateChanges(input);
    const resultingEntities = this.extractResultingEntities(input);

    const outcome = this.categorize(votes, stateChanges);
    const confidence = this.computeConfidence(outcome);

    return {
      interactionId: input.interactionId,
      actionType: input.actionType,
      actionTarget: input.actionTarget,
      outcome: outcome.outcome,
      confidence: confidence,
      confidenceLevel: confidenceToLevel(confidence),
      supportingEvidence: votes.map((v) => v.evidence),
      resultingEntities,
      stateChanges,
    };
  }

  // ── Vote Collection ───────────────────────────────────────────────────

  /**
   * Collect all weighted votes from signals and state transition.
   */
  private collectVotes(input: OutcomeDeterminerInput): OutcomeVote[] {
    const votes: OutcomeVote[] = [];
    const { signals, transition } = input;

    // API operations
    for (const op of signals.apiOperations) {
      if (op.operation === 'analytics' || op.operation === 'resource') continue;
      if (op.succeeded === true) {
        votes.push({
          result: 'success',
          weight: WEIGHTS.apiSuccess,
          evidence: {
            kind: 'api-operation',
            result: 'success',
            weight: WEIGHTS.apiSuccess,
            detail: `${op.operation} API ${op.method} ${op.url} -> ${op.status}`,
            interactionId: input.interactionId,
          },
        });
      } else if (op.succeeded === false) {
        votes.push({
          result: 'failure',
          weight: WEIGHTS.apiFailure,
          evidence: {
            kind: 'api-operation',
            result: 'failure',
            weight: WEIGHTS.apiFailure,
            detail: `${op.operation} API ${op.method} ${op.url} -> ${op.status}`,
            interactionId: input.interactionId,
          },
        });
      }
    }

    // Notifications
    for (const notif of signals.notifications) {
      if (notif.kind !== 'appeared') continue;
      if (notif.severity === 'success') {
        votes.push({
          result: 'success',
          weight: WEIGHTS.notificationSuccess,
          evidence: {
            kind: 'notification',
            result: 'success',
            weight: WEIGHTS.notificationSuccess,
            detail: `Notification: "${notif.text}" (success)`,
            interactionId: input.interactionId,
          },
        });
      } else if (notif.severity === 'error') {
        votes.push({
          result: 'failure',
          weight: WEIGHTS.notificationError,
          evidence: {
            kind: 'notification',
            result: 'failure',
            weight: WEIGHTS.notificationError,
            detail: `Notification: "${notif.text}" (error)`,
            interactionId: input.interactionId,
          },
        });
      } else if (notif.severity === 'warning') {
        votes.push({
          result: 'failure',
          weight: WEIGHTS.notificationWarning,
          evidence: {
            kind: 'notification',
            result: 'failure',
            weight: WEIGHTS.notificationWarning,
            detail: `Notification: "${notif.text}" (warning)`,
            interactionId: input.interactionId,
          },
        });
      }
    }

    // Counter changes (only if delta is meaningful for the action type)
    for (const cc of signals.counterChanges) {
      if (cc.numericDelta === null) continue;
      // Positive counter delta suggests success for add-type actions
      if (cc.numericDelta > 0) {
        votes.push({
          result: 'success',
          weight: WEIGHTS.counterPositive,
          evidence: {
            kind: 'counter-change',
            result: 'success',
            weight: WEIGHTS.counterPositive,
            detail: `Counter ${cc.elementPath}: ${cc.oldValue} -> ${cc.newValue} (+${cc.numericDelta})`,
            interactionId: input.interactionId,
          },
        });
      } else if (cc.numericDelta < 0) {
        votes.push({
          result: 'failure',
          weight: WEIGHTS.counterNegative,
          evidence: {
            kind: 'counter-change',
            result: 'failure',
            weight: WEIGHTS.counterNegative,
            detail: `Counter ${cc.elementPath}: ${cc.oldValue} -> ${cc.newValue} (${cc.numericDelta})`,
            interactionId: input.interactionId,
          },
        });
      }
    }

    // View changes to confirmation views (built-in + domain-specific)
    for (const vc of signals.viewChanges) {
      if (CONFIRMATION_VIEWS.has(vc.toView.id) || this.extraConfirmationViews.has(vc.toView.id)) {
        votes.push({
          result: 'success',
          weight: WEIGHTS.viewConfirmation,
          evidence: {
            kind: 'view-change',
            result: 'success',
            weight: WEIGHTS.viewConfirmation,
            detail: `Navigated to confirmation view: ${vc.toView.id}`,
            interactionId: input.interactionId,
          },
        });
      }
    }

    // List growth (items added to a collection)
    for (const lc of signals.listChanges) {
      if (lc.netChange > 0) {
        votes.push({
          result: 'success',
          weight: WEIGHTS.listGrowth,
          evidence: {
            kind: 'list-change',
            result: 'success',
            weight: WEIGHTS.listGrowth,
            detail: `List ${lc.containerPath}: +${lc.netChange} items`,
            interactionId: input.interactionId,
          },
        });
      }
    }

    // Page content observations (M9.4) - low weight, corroborating evidence
    const pc = input.signals.pageContent;
    if (pc) {
      // Entities observed in content -> success signal
      for (const obs of pc.observedEntities) {
        votes.push({
          result: 'success',
          weight: WEIGHTS.pageContentEntity,
          evidence: {
            kind: 'page-content',
            result: 'success',
            weight: WEIGHTS.pageContentEntity,
            detail: `Page content entity: ${obs.entityType}:${obs.entityId ?? obs.text.substring(0, 40)}`,
            interactionId: input.interactionId,
          },
        });
      }

      // Counters with positive values in content -> success signal
      for (const obs of pc.observedCounters) {
        if (obs.numericValue !== null && obs.numericValue > 0) {
          votes.push({
            result: 'success',
            weight: WEIGHTS.pageContentCounter,
            evidence: {
              kind: 'page-content',
              result: 'success',
              weight: WEIGHTS.pageContentCounter,
              detail: `Page content counter: ${obs.domPath} = ${obs.numericValue}`,
              interactionId: input.interactionId,
            },
          });
        }
      }

      // Notifications in content -> classify by text
      for (const obs of pc.observedNotifications) {
        if (!obs.text) continue;
        const lower = obs.text.toLowerCase();
        const isError = lower.includes('error') || lower.includes('failed') || lower.includes('invalid');
        votes.push({
          result: isError ? 'failure' : 'success',
          weight: WEIGHTS.pageContentNotification,
          evidence: {
            kind: 'page-content',
            result: isError ? 'failure' : 'success',
            weight: WEIGHTS.pageContentNotification,
            detail: `Page content notification: "${obs.text.substring(0, 40)}"`,
            interactionId: input.interactionId,
          },
        });
      }
    }

    // If no votes from signals, check the state transition for entity/collection changes
    if (votes.length === 0 && transition && transition.changes.length > 0) {
      // A non-empty change set without explicit failure signals suggests success
      // But we only give this a low weight since it's indirect
      const hasFailureHint = transition.changes.some((c) =>
        c.includes('error') || c.includes('fail'),
      );
      if (!hasFailureHint) {
        votes.push({
          result: 'success',
          weight: 0.1,
          evidence: {
            kind: 'view-change',
            result: 'success',
            weight: 0.1,
            detail: `State changes detected (${transition.changes.length} changes)`,
            interactionId: input.interactionId,
          },
        });
      }
    }

    return votes;
  }

  // ── Categorization ────────────────────────────────────────────────────

  /**
   * Categorize the outcome based on collected votes.
   */
  private categorize(
    votes: OutcomeVote[],
    stateChanges: string[],
  ): { outcome: OutcomeCategory; successSum: number; failureSum: number } {
    const successVotes = votes.filter((v) => v.result === 'success');
    const failureVotes = votes.filter((v) => v.result === 'failure');

    const successSum = successVotes.reduce((sum, v) => sum + v.weight, 0);
    const failureSum = failureVotes.reduce((sum, v) => sum + v.weight, 0);

    // No evidence at all
    if (votes.length === 0 && stateChanges.length === 0) {
      return { outcome: 'incomplete', successSum: 0, failureSum: 0 };
    }

    // Conflicting: both sides present with meaningful weight
    if (successSum > 0 && failureSum > 0) {
      // If one side is much weaker (< 30% of the other), don't call it ambiguous
      const ratio = Math.min(successSum, failureSum) / Math.max(successSum, failureSum);
      if (ratio > 0.3) {
        return { outcome: 'ambiguous', successSum, failureSum };
      }
      // Otherwise the stronger side wins
    }

    if (successSum > failureSum) {
      return { outcome: 'success', successSum, failureSum };
    }
    if (failureSum > successSum) {
      return { outcome: 'failure', successSum, failureSum };
    }

    // Tie with some evidence but no clear winner
    if (votes.length > 0) {
      return { outcome: 'ambiguous', successSum, failureSum };
    }

    // Votes exist from state changes only (low-weight)
    return { outcome: 'success', successSum, failureSum };
  }

  // ── Confidence ────────────────────────────────────────────────────────

  /**
   * Compute confidence score based on outcome and total evidence weight.
   */
  private computeConfidence(
    categorized: { outcome: OutcomeCategory; successSum: number; failureSum: number },
  ): number {
    if (categorized.outcome === 'incomplete') {
      return 0;
    }
    if (categorized.outcome === 'ambiguous') {
      // Confidence in ambiguity = how balanced the evidence is
      const total = categorized.successSum + categorized.failureSum;
      return Math.min(1, total * 0.5);
    }

    // Success or failure: confidence = winning side weight, capped at 1
    const winning = categorized.outcome === 'success' ? categorized.successSum : categorized.failureSum;
    return Math.min(1, winning);
  }

  // ── State Change Extraction ───────────────────────────────────────────

  /**
   * Extract human-readable state changes from the transition.
   */
  private extractStateChanges(input: OutcomeDeterminerInput): string[] {
    if (!input.transition) return [];
    return [...input.transition.changes];
  }

  /**
   * Extract entity IDs that were created/updated in this interaction.
   */
  private extractResultingEntities(input: OutcomeDeterminerInput): string[] {
    if (!input.transition) return [];

    const before = input.transition.before;
    const after = input.transition.after;

    const newEntityIds: string[] = [];
    for (const [id, entity] of after.entities) {
      if (!before.entities.has(id) || before.entities.get(id)?.lastUpdated !== entity.lastUpdated) {
        newEntityIds.push(id);
      }
    }
    return newEntityIds;
  }
}
