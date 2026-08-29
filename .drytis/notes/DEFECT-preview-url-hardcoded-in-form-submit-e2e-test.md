# DEFECT — Preview URL hardcoded in form-submit e2e test (pre-existing)

**Discovered:** 2026-08-18, D5 infra_verifier round (not a D5 regression — file untouched by D5)
**Severity:** low (test-only, public URL, no secret) · **Status:** CLOSED 2026-08-23 @ `be5faf3` — host replaced with domain-agnostic `validation.local` + genericity pin test `tests/integration/no-env-hostnames-in-source.test.ts`; no env-key machinery (fixture constant stays a constant). Infra re-audit: RESULT PASS.

## Where

`tests/integration/form-submit-e2e.test.ts:63–64`:

```ts
const CART_URL = 'https://semantic-test-intell-wvxv6e.drytis.dev/public/m9-cart-landed.html?ASIN=...';
```

The preview-subdomain hostname is baked into a tracked test file. The URL is used as a
synthetic navigation URL that the test matches against captured behavioral evidence.

## Why it matters

- The preview domain is environment-specific; the test breaks silently-ish if the project
  is redeployed under a different subdomain or cloned elsewhere.
- It is exactly the class of "environment value in source" the infra gate scans for
  (preview URL hostname).

Mitigating context (why it passed review until now): test-only, public URL, no credential,
and this project currently has **zero backend env_keys** (browser extension; runtime config
lives in chrome.storage), so there is no established env mechanism to relocate it into yet.

## Fix sketch (when scheduled)

1. Introduce the project's first env_key (e.g. `VITE_TEST_CART_URL`, tag `static` with
   `{{DOMAIN}}` placeholder, or a dedicated test fixture constant derived from a config).
2. Replace the literal in the test with the env accessor / fixture.
3. Update the assertion to match the injected value.

**Owner note:** same triage bucket as DEFECT-executor-content-script-missing-from-dist.md —
schedule as its own small task; do not bundle into feature work.
