# Storage Data — Design Spec

**Date:** 2026-04-06  
**Feature:** Persistent cookie storage across panel sessions  
**Status:** Approved

---

## Summary

Web Lens currently forwards cookies during live proxy sessions but discards them when the panel closes. This feature adds opt-in persistence: cookies are captured from `Set-Cookie` response headers and replayed on subsequent requests, so users don't have to re-authenticate every time the panel restarts.

Storage uses VS Code's encrypted `SecretStorage` API. The feature is **disabled by default** (`webLens.storeCookies: false`) and is configurable at both global and workspace level.

---

## Goals

- Survive panel restarts without re-login for proxied sites
- Per-workspace cookie isolation (different projects → different cookie jars for the same origin)
- Secure storage: cookies are encrypted at rest via VS Code's OS keychain integration
- User controls in the "more" menu: toggle, view stored data, delete selected, clear all

## Non-Goals

- Sharing cookies across machines or teammates (no git-committed storage)
- Full cookie attribute replay (`HttpOnly`, `Secure`, `SameSite`, expiry) — only `name=value` pairs are persisted
- Cookie editing (users cannot modify stored values, only delete)

---

## Architecture

### New Module: `src/cookies/CookieStore.ts`

Single class that owns all cookie persistence. No other module touches `context.secrets` for cookies directly.

```ts
class CookieStore {
  constructor(secrets: vscode.SecretStorage, workspaceFolderUri?: string) {}

  isEnabled(): boolean
  get(origin: string, scope: CookieScope): Promise<Record<string, string>>
  merge(origin: string, scope: CookieScope, cookies: Record<string, string>): Promise<void>
  remove(origin: string, scope: CookieScope, names: string[]): Promise<void>
  clear(origin: string, scope: CookieScope): Promise<void>
  listNames(origin: string, scope: CookieScope): Promise<string[]>
}

type CookieScope = 'global' | 'workspace'
```

**Key naming convention:**
- Global: `web-lens:cookies:global:<origin>`
- Workspace: `web-lens:cookies:ws:<workspaceFolderUri>:<origin>`

Example keys:
```
web-lens:cookies:global:http://localhost:3000
web-lens:cookies:ws:file:///home/user/myapp:http://localhost:3000
```

### Scope Resolution

When `webLens.storeCookies` is `true`:
- If a workspace folder is open (i.e. `workspaceFolderUri` was provided to `CookieStore`) → use `workspace` scope (per-project isolation)
- Otherwise → use `global` scope (shared across projects)

This means two projects both with `storeCookies: true` get independent cookie jars for the same origin, regardless of whether the setting was set at workspace or global level. The scope follows the workspace, not the config target.

### Integration Points

| Module | Change |
|---|---|
| `src/extension.ts` | Instantiate `CookieStore` with `context.secrets` + workspace URI; pass to `BrowserPanelManager` |
| `src/panel/BrowserPanelManager.ts` | Pass `CookieStore` to `ProxyServer`; handle new webview messages; react to config changes; send `storageDataState` on panel open + navigation |
| `src/proxy/ProxyServer.ts` | Intercept `Set-Cookie` response headers → call `CookieStore.merge()`; inject `Cookie:` header on outbound requests via `CookieStore.get()` |
| `src/types.ts` | Add new message types (see below) |
| `src/webview/toolbar.ts` | Add Storage Data toggle + "View Storage Data" button to more menu |
| `src/webview/main.ts` | Handle `storageDataState` and `storageDataView` messages; render storage data view |

---

## Settings

**New setting in `package.json`:**

```json
"webLens.storeCookies": {
  "type": "boolean",
  "default": false,
  "description": "When enabled, cookies are captured from proxied sites and replayed across panel sessions. Stored securely in VS Code's encrypted secret storage.",
  "scope": "resource"
}
```

`"scope": "resource"` enables both workspace and global configuration targets via standard VS Code settings.

**Toggle behavior in UI:**  
The toolbar toggle writes `config.update('webLens.storeCookies', value, ConfigurationTarget.Workspace)` — workspace target first, respecting per-project overrides. If no workspace folder is open, falls back to `ConfigurationTarget.Global`.

**Toggling OFF** does not delete stored data. The user must explicitly use "Clear All" or "Delete Selected" to erase cookies.

---

## Data Flow

### Capture (Set-Cookie → SecretStorage)

```
Proxied site sends response with Set-Cookie header
  → ProxyServer intercepts response headers
  → if storeCookies enabled AND Set-Cookie present
      → parse Set-Cookie header(s): extract name=value pairs, drop flags
      → CookieStore.merge(origin, scope, { name: value, ... })
          → SecretStorage.get(key) → parse existing JSON (or {})
          → merge new cookies into existing map
          → SecretStorage.store(key, JSON.stringify(merged))
```

### Replay (SecretStorage → outbound Cookie header)

```
ProxyServer.prepareRequestHeaders() called for each proxied request
  → if storeCookies enabled
      → CookieStore.get(origin, scope) → { name: value, ... }
      → build Cookie header string: "name=value; name2=value2"
      → merge with any existing Cookie header in the request
        (request-supplied cookies take precedence over stored ones)
      → attach combined Cookie header to outbound request
```

Cookies are loaded lazily per-request — no eager load on panel open. Keeps proxy stateless between requests.

### Clear / Delete

```
User clicks "Clear All" or "Delete Selected" in Storage Data view
  → webview sends clearStorageData or deleteStorageDataEntries message
  → BrowserPanelManager → CookieStore.clear() or CookieStore.remove()
      → SecretStorage.delete(key) or SecretStorage.store(key, JSON.stringify(remaining))
  → BrowserPanelManager sends updated storageDataState to webview
```

---

## Webview UI

### More Menu additions

```
⋯ More
  ├── ... existing items ...
  ├── ──────────────────────────
  ├── Storage Data    [toggle]
  └── View Storage Data          ← shown only when storeCookies=true AND data exists
```

### Storage Data View

Replaces the proxied site content temporarily (rendered in the webview area):

```
Storage Data — http://localhost:3000
┌──┬──────────────────┬───────────────┐
│☐ │ Name             │ Value         │
├──┼──────────────────┼───────────────┤
│☐ │ session_id       │ ••••••••••    │
│☐ │ csrf_token       │ ••••••••••    │
└──┴──────────────────┴───────────────┘
  [Delete Selected]  [Clear All]  [Close]
```

- Values are **masked** (dots) — the view shows names only for awareness, not a secret inspector
- "Delete Selected" enabled only when at least one row is checked
- "Clear All" wipes entire origin's storage
- "Close" returns to the proxied site (no navigation, just hides the view)
- Raw cookie values are **never sent** to the webview — only names

---

## Message Protocol

New types added to `src/types.ts`:

```ts
// Webview → Extension
{ type: 'setStorageData'; enabled: boolean }
{ type: 'openStorageDataView' }
{ type: 'clearStorageData'; origin: string }
{ type: 'deleteStorageDataEntries'; origin: string; names: string[] }

// Extension → Webview
{ type: 'storageDataState'; origin: string; enabled: boolean; hasData: boolean }
{ type: 'storageDataView'; origin: string; names: string[] }
```

`storageDataState` is sent on: panel open, navigation to new origin, cookie capture, clear/delete, config change.  
`storageDataView` is sent in response to `openStorageDataView`.

---

## Error Handling

- All `SecretStorage` operations wrapped in `try/catch`; failures logged via `OutputChannel`, proxy request continues unaffected
- Malformed JSON in storage (corrupted entry): discarded, warning logged, treated as empty — no crash
- No workspace folder open + workspace scope requested: falls back to global scope automatically
- `storeCookies` toggled off: capture and replay stop immediately; stored data is preserved until explicitly cleared

---

## Testing

| Test file | Coverage |
|---|---|
| `src/cookies/CookieStore.test.ts` | merge/get/clear/remove, key naming (global vs workspace), malformed JSON recovery, disabled-state short-circuits |
| `src/proxy/ProxyServer.test.ts` | Extended: `Cookie:` header injected when store has data; `Set-Cookie` response triggers `CookieStore.merge()` |
| `src/panel/BrowserPanelManager.test.ts` | Extended: new inbound message types handled; `storageDataState` and `storageDataView` sent correctly |

`SecretStorage` is mocked in all tests via a simple `Map<string, string>` — no real keychain dependency.

---

## Implementation Order

1. `CookieStore.ts` + unit tests
2. `types.ts` — new message types
3. `ProxyServer.ts` — capture + replay
4. `extension.ts` — instantiate and wire `CookieStore`
5. `BrowserPanelManager.ts` — message handling + config-change reaction
6. `package.json` — `webLens.storeCookies` setting contribution
7. Webview: toolbar more menu additions + Storage Data view
8. Integration tests
