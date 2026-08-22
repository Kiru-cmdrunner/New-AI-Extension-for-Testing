# Stage 0 Lock — Phase 6B (Locator Durability)

**Baseline commit:** 153f5c23e9f6066a3815757e8f97f959783679b6 (HEAD, capability-surgical-removal)
**Working tree:** clean (0 tracked modifications)
**Locked:** 2026-08-22 16:48 UTC

## Baseline numbers
- **Suite:** 246 files / 4,351 tests / 0 failures (~84s) — .drytis/evidence/phase-6b/stage0-suite.txt
- **tsc --noEmit:** exactly 8 errors, ALL pre-existing:
  ir-executor-navigate ×5 (TS2322/TS2540), ir-bridge-repeated-clicks (TS6133),
  resulting-state-seeded-display (TS2322), changed-element-seed-honesty (TS6133)
  — .drytis/evidence/phase-6b/stage0-tsc-errors.txt
- **Protected-set slice green:** tests/tap + locator-ranking + healing-service = 25 files / 385 tests

## Protected invariants (behavior-locked, byte-identical after 6B)
1. Evidence Ledger / Projection / EventTap capture flow / NOISE_TYPES — untouched (out of scope).
2. `extractCandidatesFromIdentity` output for identities WITHOUT dataAutoId/className candidates —
   byte-identical (STAB pin to be written against a pre-6B fixture corpus captured below).
3. `data-testid` TEST_ID values stay BARE in candidates, IR, renderer, resolver (owner refinement).
4. LocatorStrategyType enum values (no new enum member — family tagging lives in the VALUE, not the type).
5. KR signatureKey v1 FROZEN (behavior-knowledge-mapper.ts:62-71) — untouched.
6. elementIdentityKey chain order for existing business IDs — unchanged (dataAutoId appended last).

## STAB fixture corpus (baseline candidate output, pre-6B)
Captured in the STAB pin itself: 12 identities spanning all existing candidate shapes
(business IDs, aria, name, stableId, placeholder, accessibleName, cssSelector, xPath, empty).
Baseline generated at commit time by running extractCandidatesFromIdentity on fixtures and
FREEZING the JSON in the test — any post-6B drift for new-field-less identities fails the pin.
