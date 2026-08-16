/**
 * CP4 — episode-outcome unit tests.
 *
 * Merge semantics: member votes summed with OutcomeDeterminer's computed
 * weights (already in supportingEvidence), determiner decision rules
 * mirrored EXACTLY (both sides > 0.3 ratio → ambiguous, tie → ambiguous,
 * winner takes winning-side sum capped at 1, ambiguous takes half the
 * total evidence weight), confidenceToLevel thresholds reused, no
 * re-weighting. DDC-8: votes never fabricated; null ⇔ no member has ANY
 * recorded outcome (CP1 type contract).
 */
import { describe, expect, it } from 'vitest';
import {
  categorizeVotes,
  deriveEpisodeOutcome,
  EPISODE_WEIGHTS,
  episodeConfidence,
} from '../../../src/understanding/behavior-model/episode-outcome';
import type { ActionEpisode } from '../../../src/understanding/behavior-model/model-types';
import type { ActionOutcome, OutcomeEvidence } from '../../../src/understanding/outcome/outcome-types';

function vote(
  result: 'success' | 'failure',
  weight: number,
  kind: OutcomeEvidence['kind'] = 'api-operation',
): OutcomeEvidence {
  return { kind, result, weight, detail: `${kind} ${result}`, interactionId: 'x' };
}

function member(id: string, votes: OutcomeEvidence[]): ActionOutcome {
  return {
    interactionId: id,
    actionType: 'Click',
    actionTarget: id,
    outcome: votes.some((v) => v.result === 'failure') ? 'failure' : 'success',
    confidence: 0.9,
    confidenceLevel: 'likely',
    supportingEvidence: votes,
    resultingEntities: [],
    stateChanges: [],
  };
}

function episodeOf(...ids: string[]): ActionEpisode {
  return {
    members: ids.map((interactionId) => ({ interactionId, role: 'anchor' })),
  } as unknown as ActionEpisode;
}

function merge(
  members: ActionOutcome[],
  degraded = false,
): ReturnType<typeof deriveEpisodeOutcome> {
  return deriveEpisodeOutcome({
    episode: episodeOf(...members.map((m) => m.interactionId)),
    memberOutcomes: new Map(members.map((m) => [m.interactionId, m])),
    degraded,
  });
}

describe('deriveEpisodeOutcome — merge semantics', () => {
  it('Amazon shape: api 0.4 + view 0.25 + notification 0.3 → success ≈0.95 confirmed', () => {
    const anchor = member('int-19', [vote('success', 0.4)]);
    const navMember = member('int-20', [
      vote('success', 0.25, 'view-change'),
      vote('success', 0.3, 'notification'),
    ]);
    const out = merge([anchor, navMember])!;
    expect(out.outcome).toBe('success');
    expect(out.confidence).toBe(0.95);
    expect(out.confidenceLevel).toBe('confirmed');
    expect(out.contributingMembers).toEqual(['int-19', 'int-20']);
    expect(out.derivation).toBe('derived-episode-outcome');
  });

  it('both sides → ambiguous with mirrored confidence: (0.4+0.5)*0.5 = 0.45', () => {
    const out = merge([member('a', [vote('success', 0.4)]), member('b', [vote('failure', 0.5)])])!;
    expect(out.outcome).toBe('ambiguous');
    // OutcomeDeterminer.computeConfidence: ambiguous → min(1, total * 0.5).
    expect(out.confidence).toBe(0.45);
    expect(out.confidenceLevel).toBe('inconclusive');
  });

  it('member HAS an outcome but no vote-bearing evidence → incomplete at 0, never null (DDC-8)', () => {
    const out = merge([member('a', [])])!;
    expect(out.outcome).toBe('incomplete');
    expect(out.confidence).toBe(0);
    expect(out.confidenceLevel).toBe('inconclusive');
    expect(out.contributingMembers).toEqual([]);
  });

  it('no member has ANY recorded outcome → null (CP1 contract)', () => {
    const out = deriveEpisodeOutcome({
      episode: episodeOf('int-19', 'int-20'),
      memberOutcomes: new Map(),
    });
    expect(out).toBeNull();
  });

  it('outcome map holds entries only for OTHER interactions → null', () => {
    const out = deriveEpisodeOutcome({
      episode: episodeOf('int-19'),
      memberOutcomes: new Map([['int-other', member('int-other', [vote('success', 0.4)])]]),
    });
    expect(out).toBeNull();
  });

  it('failure-only votes → failure with capped total', () => {
    const out = merge([member('a', [vote('failure', 0.5), vote('failure', 0.4)])])!;
    expect(out.outcome).toBe('failure');
    expect(out.confidence).toBe(0.9);
    expect(out.confidenceLevel).toBe('confirmed'); // 0.9 ≥ 0.85
  });

  it('confidence caps at 1.0', () => {
    const out = merge([member('a', [vote('success', 0.4), vote('success', 0.5), vote('success', 0.3)])])!;
    expect(out.outcome).toBe('success');
    expect(out.confidence).toBe(1);
  });

  it('degraded evidence halves confidence: 0.95 → 0.475 (DDC-5)', () => {
    const anchor = member('int-19', [vote('success', 0.4)]);
    const navMember = member('int-20', [
      vote('success', 0.25, 'view-change'),
      vote('success', 0.3, 'notification'),
    ]);
    const out = merge([anchor, navMember], true)!;
    expect(out.outcome).toBe('success');
    expect(out.confidence).toBe(0.475);
    expect(out.confidenceLevel).toBe('inconclusive');
  });

  it('degraded incomplete stays 0 (never negative)', () => {
    const out = merge([member('a', [])], true)!;
    expect(out.confidence).toBe(0);
  });

  it('unknown-result votes are ignored, not guessed', () => {
    const out = merge([
      member('a', [{ kind: 'api-operation', result: 'unknown', weight: 0.4, detail: 'pending', interactionId: 'x' }]),
    ])!;
    expect(out.outcome).toBe('incomplete');
    expect(out.confidence).toBe(0);
  });

  it('contributingMembers dedupes across votes and sorts CER-5 (numeric, not lexical)', () => {
    // int-9 vs int-10: lexically "int-10" < "int-9" (WRONG); CER-5 puts int-9 first.
    const out = merge([
      member('int-10', [vote('success', 0.2)]),
      member('int-9', [vote('success', 0.4), vote('success', 0.3, 'notification')]),
    ])!;
    expect(out.contributingMembers).toEqual(['int-9', 'int-10']);
  });

  it('rounds to 3 decimals (0.1+0.2 float drift never leaks)', () => {
    const out = merge([member('a', [vote('success', 0.1), vote('success', 0.2)])])!;
    expect(out.confidence).toBe(0.3);
  });

  it('does not mutate the memberOutcomes map or episode', () => {
    const m = member('a', [vote('success', 0.4)]);
    const map = new Map([['a', m]]);
    const ep = episodeOf('a');
    const snap = JSON.stringify([...map.entries()]);
    deriveEpisodeOutcome({ episode: ep, memberOutcomes: map });
    expect(JSON.stringify([...map.entries()])).toBe(snap);
    expect(ep.members).toEqual([{ interactionId: 'a', role: 'anchor' }]);
  });
});

describe('categorizeVotes — determiner categorize() mirror', () => {
  it('ratio > 0.3 → ambiguous', () => {
    expect(categorizeVotes(0.4, 0.5, 2)).toBe('ambiguous');
    expect(categorizeVotes(0.5, 0.5, 2)).toBe('ambiguous');
  });

  it('ratio exactly 0.3 → stronger side wins (boundary is strict >)', () => {
    expect(categorizeVotes(0.3, 1.0, 2)).toBe('failure');
    expect(categorizeVotes(1.0, 0.3, 2)).toBe('success');
  });

  it('one-sided evidence → that side wins', () => {
    expect(categorizeVotes(0.4, 0, 1)).toBe('success');
    expect(categorizeVotes(0, 0.15, 1)).toBe('failure');
  });

  it('tie with votes → ambiguous', () => {
    expect(categorizeVotes(0.4, 0.4, 2)).toBe('ambiguous');
  });

  it('no votes → incomplete', () => {
    expect(categorizeVotes(0, 0, 0)).toBe('incomplete');
  });
});

describe('episodeConfidence — determiner computeConfidence() mirror', () => {
  it('success/failure → winning side sum, capped at 1', () => {
    expect(episodeConfidence('success', 0.95, 0.4, false)).toBe(0.95);
    expect(episodeConfidence('failure', 0.4, 1.4, false)).toBe(1);
  });

  it('ambiguous → half the TOTAL evidence weight, capped at 1', () => {
    expect(episodeConfidence('ambiguous', 0.4, 0.5, false)).toBe(0.45);
    expect(episodeConfidence('ambiguous', 1.2, 1.2, false)).toBe(1);
  });

  it('incomplete → 0, degraded or not', () => {
    expect(episodeConfidence('incomplete', 0.9, 0.9, false)).toBe(0);
    expect(episodeConfidence('incomplete', 0.9, 0.9, true)).toBe(0);
  });

  it('degraded halves any positive confidence', () => {
    expect(episodeConfidence('success', 0.8, 0, true)).toBe(0.4);
    // ambiguous base (0.5+0.5)*0.5 = 0.5, degraded → 0.25.
    expect(episodeConfidence('ambiguous', 0.5, 0.5, true)).toBe(0.25);
  });
});

describe('EPISODE_WEIGHTS — mirrored weight table', () => {
  it('sums to 3.1 (any determiner drift must be mirrored here)', () => {
    const values = Object.values(EPISODE_WEIGHTS);
    const sum = values.reduce((s, v) => s + v, 0);
    expect(Math.round(sum * 100) / 100).toBe(3.1);
  });

  it('matches outcome-determiner WEIGHTS value-for-value', () => {
    expect(EPISODE_WEIGHTS.apiSuccess).toBe(0.4);
    expect(EPISODE_WEIGHTS.apiFailure).toBe(0.5);
    expect(EPISODE_WEIGHTS.notificationSuccess).toBe(0.3);
    expect(EPISODE_WEIGHTS.notificationError).toBe(0.4);
    expect(EPISODE_WEIGHTS.notificationWarning).toBe(0.15);
    expect(EPISODE_WEIGHTS.counterPositive).toBe(0.2);
    expect(EPISODE_WEIGHTS.counterNegative).toBe(0.2);
    expect(EPISODE_WEIGHTS.viewConfirmation).toBe(0.25);
    expect(EPISODE_WEIGHTS.listGrowth).toBe(0.15);
    expect(EPISODE_WEIGHTS.pageContentEntity).toBe(0.15);
    expect(EPISODE_WEIGHTS.pageContentCounter).toBe(0.2);
    expect(EPISODE_WEIGHTS.pageContentNotification).toBe(0.2);
  });
});

