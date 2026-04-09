# Router-Safe Proxy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Web Lens's `?url=` top-level proxy navigation with a root-mirroring per-origin proxy session so SPA routers behave like they are running on a normal same-origin site.

**Architecture:** Introduce a proxy-session URL model where each browser panel tracks one upstream origin and mirrors that origin's root path space at the proxy root. Keep `BrowserPanelManager` responsible for original user-facing URLs, move proxy/original translation into focused proxy helpers, and keep the inject script as instrumentation only rather than router-compatibility glue.

**Tech Stack:** VS Code extension host, TypeScript, Node `http`/`https`, Vitest, webview iframe, local reverse proxy.

---

## File Structure

Current ownership assumption for this codebase:

- one `BrowserPanelManager` owns one `ProxyServer`
- one `ProxyServer` owns one active `ProxySession`
- this is valid because the current extension exposes a single browser panel instance at a time

If multi-panel support is added later, session ownership must be revisited instead of sharing one `ProxySession` globally.

### Existing files to modify

- `src/proxy/ProxyServer.ts`
  - Replace `?url=` request parsing with session-bound root mirroring.
  - Route reserved internal endpoints under a protected namespace.
  - Rewrite HTML, redirects, and same-origin absolute URLs into proxy-root space.
  - Add service-worker blocking and better request/response translation boundaries.
- `src/panel/BrowserPanelManager.ts`
  - Keep original URL history for the toolbar.
  - Initialize/update the active upstream origin before loading proxy URLs.
  - Decode iframe-reported proxy URLs back to original URLs.
- `src/webview/main.ts`
  - Stop assuming original URLs come from `?url=`.
  - Add minimal helpers for translating proxy-space iframe URLs back into toolbar-visible original URLs using extension messages.
- `src/types.ts`
  - Extend message types if needed for explicit proxy/original URL exchange.
- `src/proxy/ProxyServer.test.ts`
  - Expand from bootstrap-only coverage into mapper/rewrite/regression tests.
- `src/panel/BrowserPanelManager.test.ts`
  - Cover root-mirroring navigation and origin-switch behavior.
- `src/webview/main.test.ts`
  - Covers browser-facing history/url behavior inside the webview shell.
- `README.md`
  - Update architecture/troubleshooting notes for router-safe proxying and explicit remaining limitations.

### New files to create

- `src/proxy/ProxySession.ts`
  - Holds one panel session's active upstream origin, cookie jar, and recovery metadata.
- `src/proxy/ProxyUrlMapper.ts`
  - Single source of truth for proxy-space <-> upstream/original URL translation.
- `src/proxy/ProxySession.test.ts`
  - Covers session origin switching and recovery rules.
- `src/proxy/ProxyUrlMapper.test.ts`
  - Covers route/path/query/hash/default-port/IPv6/internal-route cases.

### Optional new file if implementation gets crowded

- `src/proxy/htmlRewrite.ts`
  - Extract HTML rewrite helpers if `ProxyServer.ts` becomes too large while implementing `<base>`, `href`, `src`, `action`, and service-worker changes.

## Chunk 1: Proxy URL model and session state

### Task 1: Add proxy session state and URL mapper

**Files:**
- Create: `src/proxy/ProxySession.ts`
- Create: `src/proxy/ProxyUrlMapper.ts`
- Test: `src/proxy/ProxySession.test.ts`
- Test: `src/proxy/ProxyUrlMapper.test.ts`

- [ ] **Step 1: Write the failing session tests**

Create these exact tests:
- `creates_session_from_original_url_and_extracts_upstream_origin`
  - input: `http://localhost:3000/dashboard`
  - expect origin: `http://localhost:3000`
  - expect proxy path: `/dashboard`
- `maps_root_relative_proxy_url_back_to_upstream_url`
  - active origin: `http://localhost:3000`
  - input proxy URL: `http://127.0.0.1:40123/dashboard?tab=logs#details`
  - expect upstream URL: `http://localhost:3000/dashboard?tab=logs#details`
- `normalizes_default_ports_when_matching_same_origin_urls`
  - input origin: `http://localhost:80/app`
  - expect stored origin: `http://localhost`
- `preserves_ipv6_hosts_when_building_upstream_urls`
  - input original URL: `http://[::1]:3000/dashboard`
  - expect recovered upstream URL: `http://[::1]:3000/dashboard`
- `rejects_reserved_internal_namespace_for_app_routes`
  - input path: `/__web_lens/inject.js`
  - expect: explicit error
- `switches_session_origin_on_cross_origin_navigation`
  - start: `http://localhost:3000/foo`
  - switch to: `https://example.com/bar`
  - expect active origin: `https://example.com`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/proxy/ProxySession.test.ts src/proxy/ProxyUrlMapper.test.ts`
Expected: FAIL because the new files/helpers do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Implement `ProxySession` and `ProxyUrlMapper` with these capabilities:
- parse an original URL into `{ upstreamOrigin, path, query, hash }`
- map original URLs into proxy-root URLs such as `/dashboard?tab=logs#details`
- map proxy-root URLs back to upstream URLs using the active session origin
- reserve an internal namespace such as `/__web_lens/`
- normalize default ports and preserve query/hash exactly

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/proxy/ProxySession.test.ts src/proxy/ProxyUrlMapper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/ProxySession.ts src/proxy/ProxyUrlMapper.ts src/proxy/ProxySession.test.ts src/proxy/ProxyUrlMapper.test.ts
git commit -m "feat: add router-safe proxy session mapping"
```

### Task 2: Wire `ProxyServer` to the new session-bound routing model

**Files:**
- Modify: `src/proxy/ProxyServer.ts`
- Test: `src/proxy/ProxyServer.test.ts`

- [ ] **Step 1: Write the failing proxy routing tests**

Create these exact tests:
- `serves_reserved_internal_inject_route_without_upstream_lookup`
- `maps_proxy_root_request_to_active_upstream_root`
  - active URL: `http://localhost:3000/`
  - request path: `/`
  - expect upstream fetch path: `/`
- `maps_proxy_nested_path_request_to_active_upstream_path`
  - active URL: `http://localhost:3000/dashboard`
  - request path: `/settings`
  - expect upstream fetch URL: `http://localhost:3000/settings`
- `rejects_request_when_no_active_session_exists`
- `does_not_require_query_param_url_for_document_requests`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/proxy/ProxyServer.test.ts`
Expected: FAIL because `ProxyServer` still expects `?url=`.

- [ ] **Step 3: Write the minimal implementation**

Update `ProxyServer` to:
- hold a `ProxySession`
- expose explicit methods such as `setActiveUrl(originalUrl)` and `getProxyUrl(originalUrl)` backed by the mapper
- route normal requests by proxy path instead of `searchParams.get('url')`
- keep internal endpoints under the reserved namespace

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/proxy/ProxyServer.test.ts src/proxy/ProxySession.test.ts src/proxy/ProxyUrlMapper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/ProxyServer.ts src/proxy/ProxyServer.test.ts
git commit -m "feat: route proxy requests through session state"
```

## Chunk 2: HTML rewriting, redirects, and cookie/session behavior

### Task 3: Make HTML rewriting preserve proxy-root routing semantics

**Files:**
- Modify: `src/proxy/ProxyServer.ts`
- Optional Create: `src/proxy/htmlRewrite.ts`
- Test: `src/proxy/ProxyServer.test.ts`

- [ ] **Step 1: Write the failing rewrite tests**

Create these exact tests:
- `rewrites_same_origin_absolute_anchor_to_proxy_root`
  - upstream origin: `http://localhost:3000`
  - input HTML: `<a href="http://localhost:3000/dashboard">`
  - expect HTML: `<a href="/dashboard">`
- `rewrites_root_relative_asset_and_form_targets_to_proxy_root`
  - inputs: `src="/_next/static/app.js"`, `action="/login"`
  - expect unchanged root-space paths, not `?url=` links
- `rewrites_nested_relative_document_links_using_current_proxy_document_context`
  - current upstream document: `http://localhost:3000/dashboard/`
  - input HTML: `<a href="settings">Settings</a><script src="app.js"></script>`
  - expect proxy-space targets resolving as `/dashboard/settings` and `/dashboard/app.js`
- `removes_or_rewrites_upstream_base_tag_that_points_to_real_origin`
- `rewrites_or_injects_proxy_space_base_for_nested_documents`
  - current upstream document: `http://localhost:3000/dashboard/`
  - expect any retained/injected `<base>` to resolve relative URLs inside proxy space, never the original origin
- `preserves_cross_origin_cdn_asset_urls`
  - input HTML: `<script src="https://cdn.example.com/app.js"></script>`
  - expect direct URL preserved
- `preserves_bootstrap_and_inject_script_order_before_app_scripts`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/proxy/ProxyServer.test.ts`
Expected: FAIL because the current rewrite logic still injects original-origin `<base>` and `?url=` links.

- [ ] **Step 3: Write the minimal implementation**

Implement rewrite logic that:
- never emits original-origin `<base>` tags
- keeps same-origin routes inside proxy root space
- resolves plain relative document links and assets using the current proxied document context
- leaves cross-origin subresources direct unless explicitly unsupported
- preserves the existing bootstrap/inject ordering

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/proxy/ProxyServer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/ProxyServer.ts src/proxy/ProxyServer.test.ts src/proxy/htmlRewrite.ts
git commit -m "fix: rewrite html into proxy-root navigation"
```

### Task 4: Handle redirects and request translation boundaries

**Files:**
- Modify: `src/proxy/ProxyServer.ts`
- Test: `src/proxy/ProxyServer.test.ts`

- [ ] **Step 1: Write the failing redirect/request tests**

Create these exact tests:
- `rewrites_absolute_same_origin_location_header_into_proxy_root`
- `rewrites_relative_location_header_against_current_upstream_request`
- `marks_cross_origin_location_header_as_origin_switch`
- `preserves_request_method_for_307_and_308_redirects`
- `rewrites_same_origin_request_headers_for_upstream_forwarding`
  - assert rewritten `Host`, `Origin`, and `Referer`
- `drops_or_normalizes_sec_fetch_headers_for_upstream_requests`
- `decodes_compressed_html_before_rewrite`
- `strips_frame_blocking_headers_from_html_and_assets`
- `forwards_request_body_for_post_form_submission`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/proxy/ProxyServer.test.ts`
Expected: FAIL because redirect handling is not explicit today.

- [ ] **Step 3: Write the minimal implementation**

Implement:
- explicit redirect normalization helper(s)
- request-header rewriting for `Host`, `Origin`, and `Referer` for same-origin proxied requests
- clear logging for redirect loops or malformed redirects
- request body forwarding for form submissions
- compression decode/rewrite/re-emit flow for HTML responses
- explicit assertions around `Sec-Fetch-*` handling and frame-blocking header stripping
- an explicit origin-switch signal from `ProxyServer` that `BrowserPanelManager` can consume when a cross-origin redirect escapes the active upstream origin

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/proxy/ProxyServer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/ProxyServer.ts src/proxy/ProxyServer.test.ts
git commit -m "feat: normalize redirects for proxy-root sessions"
```

### Task 5: Add cookie jar behavior and block service workers explicitly

**Files:**
- Modify: `src/proxy/ProxySession.ts`
- Modify: `src/proxy/ProxyServer.ts`
- Modify: `src/webview/inject.ts`
- Test: `src/proxy/ProxySession.test.ts`
- Test: `src/proxy/ProxyServer.test.ts`

- [ ] **Step 1: Write the failing cookie/service-worker tests**

Create these exact tests:
- `stores_upstream_set_cookie_values_in_session_jar`
- `attaches_session_cookie_jar_to_later_same_origin_request`
- `mirrors_non_httponly_cookie_when_browser_side_exposure_is_allowed`
- `does_not_expose_httponly_cookie_to_page_js`
- `documents_secure_cookie_mirroring_as_unsupported_on_http_proxy_origin`
- `blocks_service_worker_registration_and_emits_diagnostic`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/proxy/ProxySession.test.ts src/proxy/ProxyServer.test.ts`
Expected: FAIL because cookie translation and service-worker policy are not implemented.

- [ ] **Step 3: Write the minimal implementation**

Implement:
- a per-session cookie jar for upstream continuity
- mirroring rules for non-HttpOnly cookies when allowed by the phase contract
- explicit service-worker blocking in injected bootstrap or rewritten page script path, with logging

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/proxy/ProxySession.test.ts src/proxy/ProxyServer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/ProxySession.ts src/proxy/ProxyServer.ts src/webview/inject.ts src/proxy/ProxySession.test.ts src/proxy/ProxyServer.test.ts
git commit -m "feat: add session cookie handling and block service workers"
```

## Chunk 3: Panel/webview integration and regression coverage

### Task 6: Update panel/webview navigation contract and session recovery together

**Files:**
- Modify: `src/panel/BrowserPanelManager.ts`
- Modify: `src/panel/BrowserPanelManager.test.ts`
- Modify: `src/webview/main.ts`
- Modify: `src/webview/inspect-overlay.ts` (only if message shapes change)
- Modify: `src/types.ts`

- [ ] **Step 1: Write the failing panel/webview contract tests**

Create these exact tests:
- `opens_original_dashboard_url_but_loads_proxy_root_path_into_iframe`
  - original URL: `http://localhost:3000/dashboard`
  - expect iframe URL: `http://127.0.0.1:<port>/dashboard`
- `keeps_toolbar_history_in_original_url_space`
- `switches_proxy_session_when_user_navigates_to_new_origin`
- `restores_original_url_after_panel_recreation`
- `restores_original_url_after_extension_restart_using_saved_state`
- `webview_toolbar_does_not_parse_original_url_from_query_string_anymore`
- `redirect_driven_origin_switch_updates_session_and_reloads_iframe`
  - start origin: `http://localhost:3000`
  - proxy emits cross-origin redirect/origin-switch to `https://example.com/foo`
  - expect updated session origin: `https://example.com`
  - expect iframe reload URL: `http://127.0.0.1:<port>/foo`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/panel/BrowserPanelManager.test.ts`
Expected: FAIL because the manager still sends `?url=` proxy URLs, the webview still parses original URLs from query params, and recovery is not implemented.

- [ ] **Step 3: Write the minimal implementation**

Update `BrowserPanelManager`, `src/webview/main.ts`, and `src/types.ts` together to:
- set the active session/origin before navigation
- store original URLs in history
- request proxy URLs from `ProxyServer` for iframe loading
- pass enough original/proxy URL information through messages so the toolbar never depends on `?url=` parsing
- persist original URL state in both panel state and webview state for recreation/restart recovery
- consume cross-origin redirect/origin-switch signals from `ProxyServer` and reload the iframe into the new proxy-root URL cleanly

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/panel/BrowserPanelManager.test.ts src/proxy/ProxySession.test.ts src/proxy/ProxyUrlMapper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/panel/BrowserPanelManager.ts src/panel/BrowserPanelManager.test.ts src/webview/main.ts src/webview/inspect-overlay.ts src/types.ts
git commit -m "feat: align panel and webview navigation with proxy sessions"
```

### Task 7: Add explicit Next.js regression coverage and final docs update

**Files:**
- Modify: `src/proxy/ProxyServer.test.ts`
- Create or Modify: `src/webview/main.test.ts`
- Modify: `src/panel/BrowserPanelManager.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing regression and docs expectations**

Add a regression test that models the confirmed failure invariant:
- browser-facing or webview-facing test where:
  - top-level document starts at proxy root
  - router-equivalent call updates to `/dashboard`, `settings`, `?tab=logs`, and `#details`
  - resulting observed iframe/browser URL remains in proxy-root space, not original-origin space

Add these exact regression cases too:
- `keeps_relative_push_state_inside_proxy_root`
  - current proxy URL: `/dashboard`
  - call: `pushState({}, '', 'settings')`
  - expect resulting browser URL: `/settings`
- `keeps_query_only_replace_state_on_current_proxy_path`
- `keeps_hash_only_replace_state_on_current_proxy_path`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/proxy/ProxyServer.test.ts src/panel/BrowserPanelManager.test.ts src/webview/main.test.ts`
Expected: FAIL until the browser/webview-facing history regression is encoded and satisfied by the new URL model.

- [ ] **Step 3: Write the minimal implementation/docs update**

Update tests and `README.md` to document:
- router-safe proxying
- remaining unsupported areas (service workers, broad cross-origin API parity, HMR/WebSocket parity)
- real-browser/CDP fallback as future escape hatch, not current default

Create the smallest possible browser-facing test harness in `src/webview/main.test.ts` needed to verify observed iframe/webview URL behavior rather than relying only on `ProxyServer` unit tests.

- [ ] **Step 4: Run full verification**

Run: `npm test -- src/proxy/ProxyServer.test.ts src/panel/BrowserPanelManager.test.ts src/webview/main.test.ts && npm test && npm run typecheck && npm run build`
Expected: all tests pass, typecheck passes, build completes successfully

- [ ] **Step 5: Commit**

```bash
git add src/proxy/ProxyServer.test.ts src/panel/BrowserPanelManager.test.ts src/webview/main.test.ts README.md
git commit -m "docs: describe router-safe proxy behavior and limits"
```

### Task 8: Run manual compatibility verification matrix

**Files:**
- Modify: `README.md` (only if verification reveals user-facing caveats that must be documented)

- [ ] **Step 1: Verify Next.js App Router manually**

Check with a running Next app:
- initial load renders
- `history.replaceState('/dashboard')`-style navigation no longer crashes
- toolbar shows original URLs
- inspect/log/screenshot still work

- [ ] **Step 2: Verify one non-Next SPA manually**

Check with a React Router or Vue Router app:
- root-relative navigation works
- relative navigation from nested routes works
- refresh on nested route works

- [ ] **Step 3: Verify one multi-page site manually**

Check:
- standard links and form navigation work
- redirects stay in proxy-root space or switch origin correctly

- [ ] **Step 4: Record any remaining unsupported behaviors**

If service workers, broad cross-origin APIs, or dev-server live reload remain unsupported, document them in `README.md`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "test: document manual browser compatibility verification"
```

## Plan Review Notes

- Keep tasks narrowly scoped; do not rewrite unrelated adapter or UI code.
- If `ProxyServer.ts` starts to sprawl, extract helpers into focused files instead of growing a monolith.
- Use @superpowers:test-driven-development for each task exactly as written: failing test first, verify failure, minimal code, verify success.
- Use small commits after each task; do not batch the whole plan into one large commit.
