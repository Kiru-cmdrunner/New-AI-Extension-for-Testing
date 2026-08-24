# 7.2-M1 — reviewer WARNs as followup items

Recorded per owner instruction at closure (2026-08-24). Source: reviewer
report on the uncommitted 7.2-M1 diff (all three non-blocking; none
triggered a code change in 7.2-M1 itself).

## WARN-1 — `resolveSessionAppId` caches failure permanently

`sidepanel.ts` — a panel instance opened before any recording resolves
appId → null and caches it; `repo-btn`, `browse-repo-btn` and evidence
knowledge-links stay cold-open-scoped until panel reload (chip path
unaffected — it derives appId from signature rows). Low severity, honest
degradation.

**Followup**: make the cache miss-aware — e.g. cache only successful
resolutions, or invalidate on STOP_RECORDING, so a later recording
upgrades the buttons to app-scoped without a panel reload.

## WARN-2 — E2E pin ⑫ omits the entity deep-link branch

Harness covers W1–W5 (chip, selector, signature highlight, repo-btn,
regression) but never clicks "Open in knowledge browser" / the `?entity=`
branch; the honest-zero-entities alternative is also undocumented in the
run log. Unit-pinned (D10) — coverage gap, not a code defect.

**Followup**: extend the harness with W6 — exercise the entity link (or
assert + document the zero-entity honest branch) on a fixture that seeds
an entity row.

## WARN-3 — `installKrLookup` session scoping switched beyond spec

The lookup's session scoping moved from `REPOSITORY_SESSION_ID` to
`resolveUnderstandingSessionId()` (`understanding_result.sessionId`).
Correct and evidenced (`dbg-cards-vs-episodes.json` live probe: the old
key domain finds nothing post-7.0; the new one matches the chip join),
but it is a semantic change to a proven path that the spec's §6 said
would be deferred.

**Followup**: fold the remaining two session-scoped lookups
(`lookupSessionGaps` :815-family, `lookupSessionSignatures` :841-family)
onto the same shared helper so one join domain remains — the "three-
lookup refactor" the spec deferred. Re-pin each with its existing test.

## Standing acceptance

These three followups are OUT of 7.2-M1 scope. Track on the roadmap's
7.2 section; pick up in a hygiene pass or the next 7.x milestone.
