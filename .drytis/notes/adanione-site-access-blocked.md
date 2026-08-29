# adanione.com is unreachable from this environment (2026-08-20)

**Classification: environment / site-access limitation — NOT an extension defect.**

Any future request to E2E-audit or record against adanione.com must check this note first.

## Evidence (container, real Chrome 148 via CDP, pinned binary)
- DNS resolves normally: apex `adanione.com` → 20.192.98.161 (301 → www); `www.adanione.com` → Akamai edge (e116425.dsca.akamaiedge.net).
- TLS 1.3 handshake completes; cert is genuine: `CN=*.adanione.com`, O=Adani Enterprises Ltd, DigiCert-issued, verify ok. ALPN negotiates h2.
- **No response body is ever delivered** to this environment's egress IP:
  - HTTP/2: request sent → `HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR (err 2)`, 0 bytes.
  - HTTP/1.1 forced: full stall, 0 bytes, timeout.
  - Every path (/, /favicon.ico), every resolvable A/AAAA record: same result.
  - Real Chrome 148 (genuine browser fingerprint): `net::ERR_HTTP2_PROTOCOL_ERROR` → `chrome-error://chromewebdata/` after ~1.3 s, no DOM.
- Pattern (TLS completes, body never delivered, H2 stream reset right after request) = datacenter-IP / fingerprint-based edge blocking at the AdaniOne/Akamai edge.

## Layer isolation (extension loaded via --load-extension=/workspace/dist)
- L1 Extension loads: SW target `chrome-extension://gndjidfncanlhlonpcabokbdhnikglpn/service-worker-loader.js` — OK.
- L2 Site: never loads in ANY client (curl, Chrome-with-extension, Chrome-clean) — earliest failure point.
- L3 Content-script injection: not evaluable — no DOM exists to inject into.
- L4 Contrast on saucedemo.com with same extension instance: page loads, recorder chrome present (page-load path functioned).

## Consequence
Recording pipeline, resulting-state capture, network evidence, IR/assertions/codegen/replay can never be reached on adanione.com from this environment. Earliest failure = site access, one layer before extension logic. Do not re-probe; do not treat as product regression. Requires egress from a residential/allowed network, a proxy the user controls, or AdaniOne staging access.

## Contrast — sites verified reachable 200 OK from this container (2026-08-20)
saucedemo.com (best e-commerce fit: login, repeated add-to-cart, cart count), books.toscrape.com, demoblaze.com, automationexercise.com, flipkart.com. magento.softwaretestingboard.com = 526 (invalid cert).
