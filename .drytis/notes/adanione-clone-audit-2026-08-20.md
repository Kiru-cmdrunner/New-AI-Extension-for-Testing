# AdaniOne architecture investigation + tech-clone E2E audit (2026-08-20, HEAD dc63957)

Site itself unreachable from this environment (Akamai edge body-blocking — see
note adanione-site-access-blocked). Investigation used ONLY public evidence:
Common Crawl WARC capture of the real homepage (2026-07-12, CC-MAIN-2026-30),
urlscan.io scan metadata (169 public scans), LinkedIn/Databricks public signals,
apex 301 headers served to us. No bypass attempted.

## AdaniOne confirmed architecture (from served HTML)
- Next.js **14.2.35** App Router (`data-next-version="14.2.35"`, `main-app-*.js`,
  `global-error-*.js`, `self.__next_f.push` RSC streaming, `data-precedence` React 19-style styles).
- SSR + client hydration (JSX-style `charSet="utf-8"`, streaming payload in HTML).
- **Sitecore CMS** (`sitecoreConfig` in RSC payload, `sa.adanione.com/-/media/` media paths).
- Akamai edge (`akamaiedge.net`, `x-akamai-transformed`, **`_abck` Bot Manager cookie** —
  the blocking mechanism itself), nginx/1.25.4 at apex, HSTS, x-frame-options SAMEORIGIN.
- Separate **assets host** `assets.adanione.com` with **per-vertical builds**:
  `/home/` and `/flight/` (e.g. `flight/statics/js/cdn/bundles/widgets/booking/be/base.js`
  — a separately-built booking-widget bundle, micro-frontend style).
- Web property codename `aoneui` (`data-app-name`), version attrs `data-pkg-version=2.0.477`.
- Own test-ID convention **`data-auto-id`** (4 hits) — NOT data-testid.
- GTM-WD2S9V8, webengage analytics; NO iframes, NO custom elements, NO Shadow DOM
  in captured homepage; `x-isapp: false` (not their app-shell).
- Backend: Azure + Databricks (public customer story), app = "Adani OneApp" 48M users
  (React/Next/Redux/TypeScript per public ADL profiles).

Inferred (reasonable but not byte-proven): widget-per-vertical micro-frontend
composition into the Next shell; SPA-style client routing within the Next app.

## Clone built from confirmed characteristics
/tmp/adanione-clone/app.mjs (embedded in harness): SSR-ish shell + hydration re-render
(300ms), +700ms late async widget bundle injection building the search UI, `__next_f`-style
late push, data-auto-id convention, icon-only aria-label buttons, skeleton→content swap
(900ms fetch), 400ms debounced typeahead w/ dynamic options, soft navigation
(pushState router), analytics beacon noise, delayed 1.2s follow-up mutation.
(Copy of clone + harness + dumps preserved in
.drytis/notes/evidence/adanione-clone-audit/.)

## E2E result on the clone (real Chrome 148 + shipped dist): 19 PASS / 3 FAIL
Recording pipeline healthy end-to-end: 15 interactions (Hover windows correctly
lifecycle-abandoned; Click/Link/TextEntry consequence-settled), 41 network rows
incl. webrequest+main-world+perf-observer triple attribution, per-interaction
resultingState, soft-nav captured as Click→URL change (not MPA nav), 8-step IR with
distinct sourceEventIds, OR-1 repeated qty-plus clicks preserved as separate steps
with per-step assertions, aria-label-only icon buttons recorded fine, no skeleton
assertions, no contradictory expectations, codegen produced role/label locators +
expect.soft. Badge counter captured (kind=counter numericValue 0→1→2→3 via [data-count]).

### Genuine product defects exposed (do NOT fix yet — audit only)
1. **Executor single-shot resolution** (major): `ir-executor-impl.ts` RESOLVE_LOCATOR →
   `resolveElement` is single-shot; `resolveElementWithWait` (30s wait, exists in
   locator-resolver.ts:326) is NEVER used on the execution path. Late widget
   injection (+700ms), debounce-rendered options, skeleton→content swaps all
   produce ElementNotFound on replay. All 7 of 8 replay failures = this one cause.
   Also EXTRACT_DOM_CONTEXT healing hint matches only exact aria-label/textContent
   (substring unfound → heal fails silently). Fix: route execution resolution through
   resolveElementWithWait (respecting waitStrategy), consider retry within sendTabMessage.
2. **data-testid-centric assertion derivation** (major): page-content-config.ts
   DEFAULT_SEMANTIC_SELECTORS match data-testid*/[data-count]-style conventions;
   `data-auto-id` (AdaniOne's convention) matches nothing → counters/collections/
   entities unobserved → no textMatch/COUNT assertions derivable on such sites.
   Recorded numericValue exists (span numericValue=1 captured) but deriveForSnapshot
   can't emit because decideLocator requires #id or entity identity-attr →
   **counter with no id → no assertion**. AdaniOne badge = span in header without id
   → systematically under-asserted. This is exactly the "resulting-state observations
   produce expected assertions" gap on modern semantic-attribute sites.
3. **Presence-only assertions for page-shaped changes** (minor): Link→/cart captured
   RS including `div#cart-root > div` entity + counter progression, but steps emit only
   presence(#cart-root) — entity/counter→assertion derivation paths exist for
   data-testid sites only (same root as #2).

### What worked / proven real-Chrome
- Consequence ownership across late widget injection, hydration re-render, debounce,
  skeleton swap, soft-nav, repeated actions (OR-1), aria-label-only targets,
  analytics noise (42 rows w/ correct attribution incl. POST /api/cart/add 500ms),
  network attribution, IR generation, codegen.

### Harness/clone bugs fixed during run (NOT product issues)
FLIGHTS/AIRPORTS/delay undefined in page (fixed: injected), res.writeHead||res.end bug,
detached node server reaped by environment (embedded server), wrong qty-plus SKU selector,
over-strict check regexes. run1..run5 logs preserved.

## MCP assessment
Previous investigation never used MCP/browser-automation against AdaniOne: CDP
probes (real Chrome) were the only automation attempted; both fail at L0 (site
access) before any browser automation layer could matter. MCP browser servers
(Puppeteer/Playwright MCP) wrap the SAME CDP/WebDriver surface — they cannot bypass
an IP/TLS-fingerprint block (would hit identical ERR_HTTP2_PROTOCOL_ERROR). MCP adds
value only for interactive/exploratory browsing and tool-integration UX, not for
reaching a site our network cannot. Bypassing (residential proxies, header spoofing
beyond legit UA) is out of scope by instruction.
