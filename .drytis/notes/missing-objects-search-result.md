# Exhaustive search for c2a3b1e's missing objects — result (2026-08-15)

## Verified findings
1. **Tree ea2ee865 IS reconstructible from objects already in the store.**
   c2a3b1e's `src/shared` tree = parent 10d10e0's tree with ONE entry
   changed: `behavioral-evidence-types.ts` → blob `b003fac06119178f2436`…
   (computed tree hash matches `ea2ee865` exactly — brute-force verified
   across all 4,062 blobs in the store, single-slot substitution).
2. **Blob b61c6537 (service-worker.ts at c2a3b1e) does NOT exist anywhere:**
   - Not in the object store (all-objects listing, dangling blobs, 314
     dangling checked individually)
   - Not on the filesystem: full-container sweep of every file 1KB–200KB
     (skipping system dirs/node_modules outside workspace) hashed as git
     blobs — zero matches. Includes `.drytis/quarantine/background-old/`
     copy (hashes 356e1508), all `service-worker*.ts` copies, `legacy/`,
     `.trash-*` (only node_modules/dist/empty), sourcemaps (none from
     that window), npm cache (unpublished package), code-server history
     (not enabled).
   - Not on any remote: origin (drytis) refs = {main, capability-v1-
     complete, capability-surgical-removal@10d10e0}; github remote
     (Kiru-cmdrunner/New-AI-Extension-for-Testing) refs = {main (has
     newer doc commits we lack), capability-v1-complete, m1-m2-complete,
     2 PR refs} — none descend from c2a3b1e (merge-base with our line is
     f25bfdd). No bundles, no CI workspaces, no alternates, no worktrees
     with separate object stores (the prunable deff878-audit worktree is
     an Aug 8 ancestor — predates c2a3b1e and its tree doesn't contain
     the objects).
   - No git bundles exist; no .git dirs outside /workspace.

## Consequence
The exact `c2a3b1e` commit hash can NEVER be recreated (blob unrecoverable).
Any repair MUST rewrite history from c2a3b1e onward. The 9 commits after
it have complete trees, so a surgical rebuild can preserve their CONTENT
byte-for-byte while only changing commit SHAs.

## Options for the human decision
- **C-surgical (recommended)**: rebuild c2a3b1e onto its parent 10d10e0
  using either (a) its actual diff is unknown → reconstruct the commit by
  committing the next commit's tree? NO — ac7ebbb's tree contains ac7ebbb's
  file versions; c2a3b1e's exact content is partially unknown (only
  service-worker.ts@b61c6537 is lost; behavioral-evidence-types.ts@b003fac0
  is recoverable; the commit message says it also touched ~25 files).
  Practical variant: rebuild c2a3b1e as a commit whose tree = ac7ebbb's
  tree? That merges two commits' content into one, then rebase the rest.
  OR simplest honest variant: rebuild c2a3b1e with the SAME message but
  tree = parent's tree with the two known changes applied — i.e., lose the
  service-worker.ts@b61c6537 intermediate version (its content evolution
  is fully present in the surviving diffs 10d10e0→ac7ebbb for every other
  file). The net effect on any future checkout of c2a3b1e would be an
  intermediate state where service-worker.ts = parent's version. Since
  nobody ever checks out that commit and push only needs connectivity,
  this preserves 100% of reachable, referenced content while restoring
  pushability. All 9 later commits keep their exact trees (content), only
  their commit SHAs change (new parents).
- **C-aggressive**: graft/drop c2a3b1e entirely (rebase the 9 commits onto
  10d10e0 with `--onto`, letting the diffs apply). Content-equivalent for
  the final state; c2a3b1e's unique intermediate states are folded into
  the first rebased commit.
- **A/B (backfill)**: impossible — no copy exists anywhere (verified).

## Repair plan sketch (NOT executed, per user instruction)
For each option: run in a CLONE first (never mutate the real repo until
approved): `git clone --no-hardlinks /workspace /tmp/repair-repo`, apply
the rebuild there, verify `git fsck` clean + `git rev-parse 6abdde9` tree
identical (`b4e80822`) + tests/build green on the repaired clone, then
present the exact 10 old→new SHA mapping for approval before touching
this repo or any remote.

---
## PHASE 2 COMPLETE — dry-run repair mapping (built & validated in /tmp/repair-repo clone; /workspace untouched)

Reconstruction breakthrough: the "src/shared" TREE object ea2ee865 was recovered bit-exactly — only
behavioral-evidence-types.ts changed in src/shared at c2a3b1e, and its blob b003fac is present.
Tree rebuilt from existing store objects and hashes EXACTLY to ea2ee865. Blob b61c6537
(service-worker.ts @ c2a3b1e) confirmed unrecoverable; substituted with parent 10d10e0's 2972cb42
in the rewritten first commit only — net tip content unaffected (see below).

Rewritten chain (parent of first = 10d10e0 = current origin tip, i.e. clean fast-forward):
  c2a3b1e -> 2d1bd92  Network Evidence Hardening (tree REBUILT: a9bc9a3; sw.ts shows parent version)
  ac7ebbb -> 9f2fbaa  DDC-1..8 (tree unchanged)
  4f7b73b -> 3a35c80  CER: correlation-based evidence routing
  a9793c0b-> 9330b56  CER: spec document
  0066a54 -> 97fa1b1  RACE FIX: onCompleted→onCommitted
  b61a96e -> dad3c19  MV3 lifecycle fix
  90eeb8b -> a1cc802  Form-submit evidence recovery
  aac4f42 -> 69bbf20  Review fixes
  696f0d9 -> 76cae87  Native form-submit attribution
  6abdde9 -> b4a58f3  G4+G5 (VALIDATED TIP)

Validations performed:
  * 6abdde9^{tree} == b4a58f3^{tree} == b4e80822 → all 991 files byte-identical (md5 spot-checks match)
  * author/committer/messages/dates preserved verbatim on all 10 commits
  * git bundle (76.9 MB) built from b4a58f3 — THE OPERATION THAT FAILS ON /workspace — succeeded
  * fresh clone from that bundle: fsck CLEAN, 3363/3363 objects, zero missing
  * origin tip 10d10e0 is ancestor of b4a58f3 → push is a clean fast-forward of
    origin/capability-surgical-removal
Known caveat (unavoidable): rewritten commit 2d1bd92 omits the service-worker.ts portion of the
original "Network Evidence Hardening" commit (that exact intermediate content is lost); the change
appears instead as part of 9f2fbaa's cumulative diff. Tip content unaffected.
Backup plan: keep original chain on backup branch (refs/original/* + branch backup/pre-repair) in
/workspace before moving the branch pointer; corrupt objects remain unreachable until gc.

NOT EXECUTED. Awaiting explicit user approval.

---
## EXECUTED 2026-08-15 07:1x UTC (user-approved)
* Backups: refs/heads/backup/pre-repair = 6abdde9, refs/original/refs/heads/capability-surgical-removal = 6abdde9
* All 10 rewritten hashes reproduced EXACTLY as dry-run predicted (deterministic rebuild after /tmp wipe)
* Branch moved to b4a58f36cb1eedad0f04454ea709fa434863380b; tree == b4e80822 == validated; diff vs 6abdde9 empty; 991 files
* fsck: only the 3 pre-existing corrupt-object lines (unreachable backups); HEAD chain 3363 objects, fully connected
* origin push: 10d10e0..b4a58f3 fast-forward OK
* github push via one-shot tool: OK + PR #3 (capability-surgical-removal -> main)
* Old corrupt chain still referenced by backups — DO NOT gc until user confirms. mapping file: .drytis/notes/.repair-mapping-executed
