# Push blocked — git object store corruption (2026-08-15)

## State (verified, safe)
- Commit `6abdde9` on local branch `capability-surgical-removal` contains
  the FULL validated G4+G5 code (17 files, +2225/−193). Working tree clean,
  byte-identical to the manually-validated build (v10.9.0 ZIP md5
  3961cf19d7e9f2734de5ef2a3600c330). TSC 0 errors, 3,139 tests green.
- Local branch is 10 ahead of origin/capability-surgical-removal (the
  pre-existing 9 + this commit). Nothing pushed. Nothing lost.

## The problem
`git push` aborts: `fatal: bad tree object ea2ee865…`. fsck shows exactly
TWO missing objects, both belonging to commit `c2a3b1e` (Aug 14 07:44,
"Network Evidence Hardening" — the FIRST of the 10 unpushed commits):
- tree `ea2ee865` = src/shared/ directory tree at that commit
- blob `b61c6537` = src/background/service-worker.ts at that commit

Only c2a3b1e's tree references them; all 9 later commits have their own
complete trees. Push pack construction must walk c2a3b1e's tree → fails.

## Where the objects are NOT (all verified absent)
- origin (drytis git server): no refs contain them (remote tip 10d10e0)
- github / upstream remote (Kiru-cmdrunner/New-AI-Extension-for-Testing):
  main has NEWER doc commits we lack; merge-base of our lines = f25bfdd;
  no branch contains our missing objects
- No other refs, reflogs (0 hits for c2a3b1e), stashes, dangling blobs,
  bundles, mirror copies, or second repos on this container
- code-server local history: not enabled (~/.local/share/code-server has
  only coder-logs + extensions)
- .trash-* dirs: only node_modules / dist / an empty bisect_bad — no source

## Why it happened
Loose objects deleted around the Aug 14 12:53 repack (repack without
--keep-unreachable, or pruned while c2a3b1e was not on any remote). The
commit was local-only for ~19h before the corruption window.

## Recovery options (needs human decision)
- **A. Backfill from a copy**: if the user has ANY clone/bundle/archive of
  this repo from before Aug 14 12:53 that includes c2a3b1e, then
  `git fetch <path> capability-surgical-removal` (or bundle unbundle)
  restores the objects; push then succeeds with NO SHA changes.
  ASK: does a laptop/CI/another workspace clone exist?
- **B. Exact-object reconstruction**: if byte-identical contents of
  src/background/service-worker.ts and ALL of src/shared/ as of c2a3b1e
  (Aug 14 07:44) exist anywhere (editor history, tarball, screenshot),
  `git hash-object -w` re-creates them; SHA self-verifies (wrong bytes →
  different hash). No SHA changes.
- **C. History rewrite**: rebuild c2a3b1e..HEAD without the broken tree
  (e.g. re-commit c2a3b1e's diff onto 10d10e0, then rebase the 9). All 10
  SHAs change. Preserves the validated code; loses the original hashes.
  Cleanest variant: `git rebase --onto <rebuilt-c2a3b1e> c2a3b1e capability-surgical-removal`.
  - Simplest C variant given only ONE commit is broken: since all 9 later
    commits have complete trees, rebuild ONLY c2a3b1e by committing its
    tree diff onto 10d10e0, then cherry-pick/rebase the rest — the 9 later
    commits keep their exact content (tree SHAs unchanged), only the
    commit SHAs change.
- **D. Fresh-branch push (pragmatic)**: VERIFIED INVALID — a real push of
  `6abdde9` to a NEW branch name (`g4-g5-test`) fails with the same
  `fatal: bad tree object ea2ee865` (pack construction always walks
  c2a3b1e's tree because the remote lacks all 10 commits). Only
  `--dry-run` (which skips pack construction) appeared to succeed.

## Recommended path
Ask the user first: any external clone from before Aug 14 12:53 (option A)
is the zero-risk fix. If none exists, option C (surgical rebuild of ONE
commit) is the honest fallback — the validated code is preserved exactly;
only the c2a3b1e commit hash changes.

## Note on the commit itself
The commit 6abdde9 is INTACT and independently verifiable (fsck on it
passes — its own tree b4e80822 is complete). Even if the repo history
ends up rewritten, the validated G4+G5 content will be identical.
