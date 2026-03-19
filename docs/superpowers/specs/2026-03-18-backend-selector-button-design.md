# Backend Selector Toolbar Button

Add a toolbar button that shows the active backend's icon and opens a dropdown menu to switch between backends.

## Context

The extension delivers captured browser context (elements, screenshots, console logs) to one of three backends: OpenCode, OpenChamber, or Clipboard. The active backend is controlled by the `browserChat.backend` VS Code setting. There is no in-toolbar UI for seeing or changing it -- the user must open VS Code settings to switch. This makes it easy to send data to the wrong place without realizing.

## Goals

- Always show which backend is active via its brand icon in the toolbar
- Let users switch backends directly from the toolbar via a dropdown menu
- Disable unavailable backends in the dropdown so the user can't select a broken target
- Persist the selection to `browserChat.backend` so it survives panel close/reopen

## Non-Goals

- Background polling of backend availability (check on dropdown open only)
- Backend health monitoring or status indicators beyond available/unavailable
- Adding new backends

## Toolbar Placement

The button sits in the right toolbar group, after a new divider, between the Screenshot button and the overflow menu:

```
[Back][Fwd][Reload] [── URL Bar ──] [Inspect][AddElement] | [Logs][Screenshot] | [Backend ▾] [More ⋮]
```

The button displays the active backend's icon at 18x18px, matching other toolbar icons.

## Icon Assets

SVG files stored in `media/icons/`:

| Backend | Files | Source |
|---------|-------|--------|
| OpenCode | `opencode-light.svg`, `opencode-dark.svg` | Official brand kit: square pixel-art "O" logo from `anomalyco/opencode` repo |
| OpenChamber | `openchamber-light.svg`, `openchamber-dark.svg` | Official isometric cube logo from `openchamber/openchamber` repo |
| Clipboard | Material Symbol `content_copy` | Already loaded via Google Fonts CDN |

Light variants are for dark VS Code themes (light icon on dark background). Dark variants are for light VS Code themes.

## Dropdown Menu

Clicking the backend button opens a dropdown menu (same visual pattern as the existing overflow menu).

Each row contains:
- Backend icon (18x18 `<img>` for SVG icons, Material Symbol span for clipboard)
- Backend name ("OpenCode", "OpenChamber", "Clipboard")
- Checkmark indicator if this is the active backend

Unavailable backends render with `opacity: 0.4` and `pointer-events: none` (same pattern as `.toolbar-btn:disabled`).

The dropdown closes when the user clicks an item or clicks outside (same as the overflow menu).

### Availability Check

When the dropdown opens, the webview requests availability state from the extension host. The extension calls `isAvailable()` on each adapter in parallel (each wrapped in a 3-second `Promise.race` timeout) and returns the results. The dropdown opens immediately showing a brief loading state (all items disabled), then updates once the `backend:state` response arrives (typically <100ms for local checks).

If `isAvailable()` throws or times out (>3s), the adapter is treated as unavailable.

The Clipboard adapter always returns `true`, so there is always at least one selectable option.

## Message Protocol

Three new message types added to `src/types.ts`:

### Webview -> Extension

**`backend:request`** -- Webview asks for current backend state.
```typescript
{ type: 'backend:request', payload: {} }
```

**`backend:select`** -- User selected a new backend.
```typescript
{ type: 'backend:select', payload: { backend: string } }
```

### Extension -> Webview

**`backend:state`** -- Extension sends current backend and availability.
```typescript
{ type: 'backend:state', payload: { active: string, available: Record<string, boolean> } }
```

### Message Flow

1. User clicks backend button -> webview sends `backend:request`
2. Extension calls `isAvailable()` on each adapter in parallel, reads `browserChat.backend` setting
3. Extension sends `backend:state` with active backend + availability map
4. Webview renders dropdown with correct active/disabled states
5. User clicks available backend -> webview sends `backend:select`
6. Extension updates `browserChat.backend` VS Code setting
7. Extension sends `backend:state` to confirm the change
8. Webview updates toolbar button icon

### Relationship to Existing `config:update` Message

The existing `config:update` message (sent when any `browserChat.*` setting changes) remains unchanged and continues to handle general config sync. The new `backend:state` message is sent **in addition to** `config:update` when `browserChat.backend` changes. The config change listener in `extension.ts` will send both messages: `config:update` (for existing consumers) and `backend:state` (for the new backend selector).

When `browserChat.backend` changes externally (e.g. via VS Code settings UI), the config change listener sends `backend:state` to the webview so the button icon stays in sync.

## Toolbar Code Changes

### DOM Structure

New elements added to the toolbar template in `src/webview/toolbar.ts`, after the screenshot divider:

```html
<div class="toolbar-divider"></div>
<div style="position: relative;">
  <button class="toolbar-btn" id="btn-backend" title="Select Backend">
    <!-- Three icon containers, one visible at a time based on data-backend -->
    <img class="backend-btn-icon backend-icon-light" />
    <img class="backend-btn-icon backend-icon-dark" />
    <span class="material-symbols-outlined backend-btn-icon-clipboard">content_copy</span>
  </button>
  <div class="backend-menu" id="backend-menu">
    <!-- Populated dynamically when backend:state is received -->
  </div>
</div>
```

### ToolbarAPI Additions

- `setBackendState(active: string, available: Record<string, boolean>)` -- updates button icon and caches state for dropdown rendering

### New Callbacks

- `callbacks.onBackendRequest()` -- fired when user clicks the backend button (triggers message flow)
- `callbacks.onBackendSelect(backend: string)` -- fired when user picks a backend from dropdown

### Icon Switching

The button uses a `data-backend` attribute to control which icon element is visible:
- `opencode` / `openchamber`: show the `<img>` element with the corresponding webview URI
- `clipboard`: show the Material Symbol `<span>`

### Icon URI Plumbing

`BrowserPanelManager` must add `media/icons/` to `localResourceRoots` (currently only `webview/` and `out/` are allowed). Then `getHtmlForWebview()` resolves webview URIs for the SVG files in `media/icons/` and passes them as `data-*` attributes on a DOM element so the webview JS can reference them in `<img>` tags.

## CSS & Styling

### New Classes in `webview/main.css`

**`.backend-menu`** -- Dropdown container. Same visual treatment as `.overflow-menu`: absolute position below button, `min-width: 200px`, same background/border/shadow/border-radius.

**`.backend-menu.visible`** -- `display: block` (same toggle pattern as `.overflow-menu.visible`).

**`.backend-menu-item`** -- Flex row: icon + label + check indicator. Same padding, font, and hover styles as `.overflow-menu-item`.

**`.backend-menu-item.active`** -- Currently selected backend. Shows a checkmark on the right side.

**`.backend-menu-item.disabled`** -- `opacity: 0.4; cursor: default; pointer-events: none` (matches `.toolbar-btn:disabled` pattern).

**`.backend-btn-icon`** -- 18x18px `<img>` for SVG backend icons, vertically aligned to match Material Symbol positioning.

### Theme Handling

The `data-theme` attribute is a new mechanism introduced by this feature. It works as follows:

**Initial load:** `BrowserPanelManager.getHtmlForWebview()` reads `vscode.window.activeColorTheme.kind` and sets `data-theme="dark"` or `data-theme="light"` on the `<body>` element in the generated HTML. `ColorThemeKind.Dark` and `ColorThemeKind.HighContrast` map to `"dark"`; `ColorThemeKind.Light` and `ColorThemeKind.HighContrastLight` map to `"light"`.

**Theme changes at runtime:** The extension host registers `vscode.window.onDidChangeActiveColorTheme` and sends a new `theme:update` message to the webview with `{ kind: "dark" | "light" }`. The webview handler in `main.ts` updates `document.body.dataset.theme` accordingly.

Both light and dark icon URIs are passed to the webview. CSS toggles visibility:

```css
[data-theme="dark"] .backend-icon-light { display: inline; }
[data-theme="dark"] .backend-icon-dark { display: none; }
[data-theme="light"] .backend-icon-light { display: none; }
[data-theme="light"] .backend-icon-dark { display: inline; }
```

## Error Handling & Edge Cases

**Availability check failure:** If `isAvailable()` throws or times out, the adapter is treated as unavailable and greyed out. No error toast.

**Race conditions:** If the setting changes externally while the dropdown is open, the next `backend:state` message updates the dropdown in place.

**First load:** On webview initialization, `main.ts` sends `backend:request` so the button renders with the correct icon immediately. Until the response arrives, clipboard icon is shown as a safe default.

**Extension host restart:** The webview sends `backend:request` again on the next user interaction after reconnection.

## Testing

Unit tests for message handling in `extension.ts`:
- `backend:request` returns correct active backend and availability map
- `backend:select` updates the VS Code setting
- Config change listener sends `backend:state` to webview

No toolbar DOM unit tests (the existing codebase doesn't unit-test webview DOM). Toolbar changes are verified manually via the test-app dashboard.

## Files Changed

| File | Change |
|------|--------|
| `media/icons/opencode-light.svg` | New -- OpenCode brand icon (light variant) |
| `media/icons/opencode-dark.svg` | New -- OpenCode brand icon (dark variant) |
| `media/icons/openchamber-light.svg` | New -- OpenChamber brand icon (light variant) |
| `media/icons/openchamber-dark.svg` | New -- OpenChamber brand icon (dark variant) |
| `src/types.ts` | Add `backend:request`, `backend:select`, `backend:state`, `theme:update` message types |
| `src/extension.ts` | Handle new messages, wire availability checks, send state on config change, register `onDidChangeActiveColorTheme` listener |
| `src/webview/toolbar.ts` | Add backend button, dropdown DOM, icon switching, new ToolbarAPI method |
| `src/webview/main.ts` | Wire backend callbacks, handle `backend:state` and `theme:update` messages |
| `src/panel/BrowserPanelManager.ts` | Add `media/icons` to `localResourceRoots`, resolve icon webview URIs, set `data-theme` on body, pass icon URIs as data attributes |
| `webview/main.css` | Add `.backend-menu`, `.backend-menu-item`, `.backend-btn-icon`, theme toggle styles |
| `package.json` | No changes needed (setting already exists) |
