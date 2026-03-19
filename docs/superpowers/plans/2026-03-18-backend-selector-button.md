# Backend Selector Toolbar Button Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toolbar button that shows the active backend's icon and opens a dropdown menu to switch between OpenCode, OpenChamber, and Clipboard backends.

**Architecture:** The feature adds a new button to the existing webview toolbar with a dropdown menu. The webview communicates with the extension host via three new message types (`backend:request`, `backend:select`, `backend:state`) to check adapter availability and update the `browserChat.backend` VS Code setting. Icon SVGs are stored in `media/icons/` and loaded via webview URIs.

**Tech Stack:** TypeScript, VS Code Webview API, vanilla DOM, CSS, SVG icons

**Spec:** `docs/superpowers/specs/2026-03-18-backend-selector-button-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `media/icons/opencode-light.svg` | OpenCode icon for dark themes (new) |
| `media/icons/opencode-dark.svg` | OpenCode icon for light themes (new) |
| `media/icons/openchamber-light.svg` | OpenChamber icon for dark themes (new) |
| `media/icons/openchamber-dark.svg` | OpenChamber icon for light themes (new) |
| `src/types.ts` | Message type definitions (modify) |
| `src/extension.ts` | Backend message handling, theme listener (modify) |
| `src/panel/BrowserPanelManager.ts` | Icon URI resolution, localResourceRoots, data-theme, HTML generation (modify) |
| `src/webview/toolbar.ts` | Backend button DOM, dropdown, icon switching (modify) |
| `src/webview/main.ts` | Wire backend callbacks, handle backend:state and theme:update messages (modify) |
| `webview/main.css` | Backend menu styles, theme icon toggle (modify) |

---

## Chunk 1: Foundation — Icon Assets, Message Types, Extension Host

### Task 1: Add icon SVG files

**Files:**
- Create: `media/icons/opencode-light.svg`
- Create: `media/icons/opencode-dark.svg`
- Create: `media/icons/openchamber-light.svg`
- Create: `media/icons/openchamber-dark.svg`

- [ ] **Step 1: Create the `media/icons/` directory**

```bash
mkdir -p media/icons
```

- [ ] **Step 2: Download and save the OpenCode light icon SVG**

Source: `https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/console/app/src/asset/brand/opencode-logo-dark-square.svg`

This is the dark-on-transparent variant — used on dark backgrounds (i.e., dark VS Code themes), so it becomes our "light" icon (light-colored foreground). Save it as `media/icons/opencode-light.svg`.

The SVG is 300x300 with a pixel-art "O" shape. Optimize it for toolbar use:
- Set viewBox to `0 0 300 300` (already correct)
- Outer shape fill: `#F1ECEC` (light), inner fill: `#4B4646`

- [ ] **Step 3: Save the OpenCode dark icon SVG**

Source: `https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/console/app/src/asset/brand/opencode-logo-light-square.svg`

This is the light-background variant (dark foreground) — save as `media/icons/opencode-dark.svg`.
- Outer shape fill: `#211E1E` (dark), inner fill: `#CFCECD`

- [ ] **Step 4: Save the OpenChamber light icon SVG**

Source: `https://raw.githubusercontent.com/openchamber/openchamber/main/docs/references/badges/openchamber-logo-light.svg`

This is a 100x100 isometric cube. It uses `fill="black"` with various opacities plus `stroke="black"`. For the dark-theme variant (light icon), change all `fill="black"` to `fill="white"` and `stroke="black"` to `stroke="white"`. Save as `media/icons/openchamber-light.svg`.

- [ ] **Step 5: Save the OpenChamber dark icon SVG**

Use the original source SVG as-is (black strokes/fills on transparent background work on light themes). Save as `media/icons/openchamber-dark.svg`.

- [ ] **Step 6: Verify all four files exist**

```bash
ls -la media/icons/
```

Expected: 4 SVG files — `opencode-light.svg`, `opencode-dark.svg`, `openchamber-light.svg`, `openchamber-dark.svg`

- [ ] **Step 7: Commit**

```bash
git add media/icons/
git commit -m "feat: add backend brand icon SVGs for toolbar selector"
```

---

### Task 2: Add message types to `src/types.ts`

**Files:**
- Modify: `src/types.ts:4-18` (WebviewMessage union), `src/types.ts:21-27` (ExtensionMessage union)

- [ ] **Step 1: Add `backend:request` and `backend:select` to WebviewMessage**

In `src/types.ts`, add two new variants to the `WebviewMessage` union after line 18 (the `menu:openSettings` line):

```typescript
  | { type: 'backend:request'; payload: Record<string, never> }
  | { type: 'backend:select'; payload: { backend: string } }
```

The full WebviewMessage type should end with:

```typescript
  | { type: 'menu:openSettings'; payload: Record<string, never> }
  | { type: 'backend:request'; payload: Record<string, never> }
  | { type: 'backend:select'; payload: { backend: string } };
```

- [ ] **Step 2: Add `backend:state` and `theme:update` to ExtensionMessage**

In `src/types.ts`, add two new variants to the `ExtensionMessage` union after line 27 (the `toast` line):

```typescript
  | { type: 'backend:state'; payload: { active: string; available: Record<string, boolean> } }
  | { type: 'theme:update'; payload: { kind: 'dark' | 'light' } }
```

The full ExtensionMessage type should end with:

```typescript
  | { type: 'toast'; payload: { message: string; toastType: 'success' | 'error' } }
  | { type: 'backend:state'; payload: { active: string; available: Record<string, boolean> } }
  | { type: 'theme:update'; payload: { kind: 'dark' | 'light' } };
```

- [ ] **Step 3: Verify the build compiles**

```bash
node esbuild.config.js
```

Expected: `Build complete` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add backend:request, backend:select, backend:state, theme:update message types"
```

---

### Task 3: Handle backend messages in `src/extension.ts`

**Files:**
- Modify: `src/extension.ts:71-91` (message handler), `src/extension.ts:93-104` (config listener), `src/extension.ts:64` (activate function)

**Testing note:** The `getBackendState` function and message handling are tightly coupled to VS Code APIs (`vscode.workspace.getConfiguration`, `panelManager.postMessage`) and the adapter instances, making them difficult to unit test in isolation without extracting them into a testable module. Since the existing codebase does not unit test `extension.ts` (only adapters and context extractor are tested), we defer unit tests: the message handling will be verified via the manual testing checklist in Task 8.

- [ ] **Step 1: Add `getBackendState` helper function to `extension.ts`**

Add this function after the `getAdapter()` function (after line 23):

```typescript
async function getBackendState(): Promise<{ active: string; available: Record<string, boolean> }> {
  const config = vscode.workspace.getConfiguration('browserChat');
  const active = config.get<string>('backend') || 'clipboard';

  const available: Record<string, boolean> = {};
  const timeout = (ms: number) => new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms));

  await Promise.all(
    Object.entries(adapters).map(async ([name, adapter]) => {
      try {
        available[name] = await Promise.race([adapter.isAvailable(), timeout(3000)]);
      } catch {
        available[name] = false;
      }
    })
  );

  return { active, available };
}
```

- [ ] **Step 2: Add `backend:request` and `backend:select` handling to the message switch**

In the `panelManager.onMessage` callback (around line 71), add new cases inside the switch statement, before the closing `}`:

```typescript
      case 'backend:request': {
        getBackendState().then((state) => {
          panelManager?.postMessage({ type: 'backend:state', payload: state });
        });
        break;
      }
      case 'backend:select': {
        const newBackend = message.payload.backend;
        if (adapters[newBackend]) {
          const config = vscode.workspace.getConfiguration('browserChat');
          config.update('backend', newBackend, vscode.ConfigurationTarget.Global).then(() => {
            getBackendState().then((state) => {
              panelManager?.postMessage({ type: 'backend:state', payload: state });
            });
          });
        }
        break;
      }
```

Note: These new message types are not handled by `BrowserPanelManager.handleMessage()`, so they fall through to the `default` case which forwards them to the external `messageHandler` (i.e., the callback registered via `panelManager.onMessage()`). No changes needed in `BrowserPanelManager.handleMessage()`.

- [ ] **Step 3: Add `backend:state` to the config change listener**

Update the config change listener callback (inside the existing `context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(...))` at lines 94-104) to also send `backend:state` after the existing `config:update` message. The full updated callback becomes:

```typescript
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('browserChat.backend')) {
        const adapter = getAdapter();
        panelManager?.postMessage({
          type: 'config:update',
          payload: { backend: adapter.name },
        });
        // Also send backend:state for the toolbar selector
        getBackendState().then((state) => {
          panelManager?.postMessage({ type: 'backend:state', payload: state });
        });
      }
    })
  );
```

- [ ] **Step 4: Register `onDidChangeActiveColorTheme` listener in activate()**

Add this inside the `activate` function, after the config change listener subscription (after line 104):

```typescript
  // Listen for theme changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      const kind = theme.kind === vscode.ColorThemeKind.Light ||
                   theme.kind === vscode.ColorThemeKind.HighContrastLight
        ? 'light' : 'dark';
      panelManager?.postMessage({ type: 'theme:update', payload: { kind } });
    })
  );
```

- [ ] **Step 5: Verify the build compiles**

```bash
node esbuild.config.js
```

Expected: `Build complete` with no errors.

- [ ] **Step 6: Run all tests to check nothing is broken**

```bash
npx vitest run
```

Expected: All existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/extension.ts
git commit -m "feat: handle backend:request, backend:select messages and theme change listener"
```

---

### Task 4: Update `BrowserPanelManager` — localResourceRoots, icon URIs, data-theme

**Files:**
- Modify: `src/panel/BrowserPanelManager.ts:45-48` (localResourceRoots), `src/panel/BrowserPanelManager.ts:162-197` (getHtmlForWebview)

- [ ] **Step 1: Add `media/icons` to `localResourceRoots`**

In `src/panel/BrowserPanelManager.ts`, update the `localResourceRoots` array (line 45-48) to include the icons directory:

```typescript
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'webview'),
          vscode.Uri.joinPath(this.extensionUri, 'out'),
          vscode.Uri.joinPath(this.extensionUri, 'media', 'icons'),
        ],
```

- [ ] **Step 2: Verify `backend:request` and `backend:select` forwarding in handleMessage**

In the `handleMessage` method (line 86), the default case already forwards unknown message types to the external handler. The new `backend:request` and `backend:select` message types will fall through to the `default` case and be forwarded automatically. No code change needed — verify this by reading the switch statement.

- [ ] **Step 3: Resolve icon webview URIs and add to HTML**

In `getHtmlForWebview()` (line 162), after the existing `styleUri` resolution (line 168), add icon URI resolution:

```typescript
    // Backend icon URIs
    const iconBase = vscode.Uri.joinPath(this.extensionUri, 'media', 'icons');
    const opencodeLight = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'opencode-light.svg'));
    const opencodeDark = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'opencode-dark.svg'));
    const openchamberLight = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'openchamber-light.svg'));
    const openchamberDark = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'openchamber-dark.svg'));
```

- [ ] **Step 4: Determine theme kind for data-theme attribute**

After the icon URI resolution, add theme detection:

```typescript
    // Theme kind for icon visibility
    const themeKind = vscode.window.activeColorTheme.kind;
    const dataTheme = (themeKind === vscode.ColorThemeKind.Light ||
                       themeKind === vscode.ColorThemeKind.HighContrastLight)
      ? 'light' : 'dark';
```

- [ ] **Step 5: Update the HTML template**

Update the `<body>` tag to include `data-theme`:

```html
<body data-theme="${dataTheme}">
```

Add a hidden `<div>` with icon URI data attributes inside `<body>`, before the toolbar div:

```html
  <div id="backend-icons" hidden
    data-opencode-light="${opencodeLight}"
    data-opencode-dark="${opencodeDark}"
    data-openchamber-light="${openchamberLight}"
    data-openchamber-dark="${openchamberDark}"
  ></div>
```

The full HTML body section becomes:

```html
<body data-theme="${dataTheme}">
  <div id="backend-icons" hidden
    data-opencode-light="${opencodeLight}"
    data-opencode-dark="${opencodeDark}"
    data-openchamber-light="${openchamberLight}"
    data-openchamber-dark="${openchamberDark}"
  ></div>
  <div id="toolbar"></div>
  <div id="browser-frame">
    <iframe id="browser-iframe" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
```

- [ ] **Step 6: Verify the build compiles**

```bash
node esbuild.config.js
```

Expected: `Build complete` with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/panel/BrowserPanelManager.ts
git commit -m "feat: add icon URIs, localResourceRoots, and data-theme to BrowserPanelManager"
```

---

## Chunk 2: Webview — Toolbar, CSS, Main.ts Wiring

### Task 5: Add backend button and dropdown to `src/webview/toolbar.ts`

**Files:**
- Modify: `src/webview/toolbar.ts` (entire file — DOM template, event handlers, API)

- [ ] **Step 1: Add `onBackendRequest` and `onBackendSelect` to the callbacks parameter**

Update the `createToolbar` function signature (line 24) to include new callbacks:

```typescript
export function createToolbar(
  container: HTMLElement,
  postMessage: PostMessage,
  callbacks?: {
    onLogsRequest?: () => void;
    onScreenshotRequest?: () => void;
    onBackendRequest?: () => void;
    onBackendSelect?: (backend: string) => void;
  }
): ToolbarAPI {
```

- [ ] **Step 2: Add `setBackendState` to the ToolbarAPI interface**

Update the `ToolbarAPI` interface (line 17) to include:

```typescript
export interface ToolbarAPI {
  setUrl(url: string): void;
  setInspectActive(active: boolean): void;
  setAddElementActive(active: boolean): void;
  onStateChange(cb: (state: ToolbarState) => void): void;
  setBackendState(active: string, available: Record<string, boolean>): void;
}
```

- [ ] **Step 3: Add backend button and dropdown to the DOM template**

In the toolbar HTML template (inside `container.innerHTML`), add the backend selector between the screenshot button and the overflow menu. Replace the second `<div class="toolbar-divider"></div>` and overflow section (lines 69-88) with:

```html
      <div class="toolbar-divider"></div>
      <div style="position: relative;">
        <button class="toolbar-btn" id="btn-backend" title="Select Backend">
          <img class="backend-btn-icon backend-icon-light" id="backend-icon-light" width="18" height="18" />
          <img class="backend-btn-icon backend-icon-dark" id="backend-icon-dark" width="18" height="18" />
          <span class="material-symbols-outlined backend-btn-icon-clipboard" id="backend-icon-clipboard">content_copy</span>
        </button>
        <div class="backend-menu" id="backend-menu"></div>
      </div>
      <div style="position: relative;">
        <button class="toolbar-btn" id="btn-overflow" title="More actions">
          <span class="material-symbols-outlined">more_vert</span>
        </button>
        <div class="overflow-menu" id="overflow-menu">
          <button class="overflow-menu-item" id="menu-settings">
            <span class="material-symbols-outlined">settings</span>
            Settings
          </button>
          <button class="overflow-menu-item" id="menu-copy-html">
            <span class="material-symbols-outlined">content_copy</span>
            Copy Page HTML
          </button>
          <button class="overflow-menu-item" id="menu-clear">
            <span class="material-symbols-outlined">deselect</span>
            Clear Selection
          </button>
        </div>
      </div>
```

Note: The `<div class="toolbar-divider"></div>` that was between Screenshot and the old overflow section is kept. The new backend button group is placed before the overflow group.

- [ ] **Step 4: Get references to new elements and read icon URIs**

After the existing element references (after line 109), add:

```typescript
  const btnBackend = container.querySelector('#btn-backend') as HTMLButtonElement;
  const backendMenu = container.querySelector('#backend-menu') as HTMLElement;
  const backendIconLight = container.querySelector('#backend-icon-light') as HTMLImageElement;
  const backendIconDark = container.querySelector('#backend-icon-dark') as HTMLImageElement;
  const backendIconClipboard = container.querySelector('#backend-icon-clipboard') as HTMLElement;

  // Read icon URIs from the hidden data element
  const iconData = document.getElementById('backend-icons');
  const iconUris: Record<string, { light: string; dark: string }> = {
    opencode: {
      light: iconData?.dataset.opencodeLight || '',
      dark: iconData?.dataset.opencodeDark || '',
    },
    openchamber: {
      light: iconData?.dataset.openchamberLight || '',
      dark: iconData?.dataset.openchamberDark || '',
    },
  };
```

- [ ] **Step 5: Add backend state and icon update logic**

After the icon URI reading, add:

```typescript
  // Backend state
  let backendState: { active: string; available: Record<string, boolean> } = {
    active: 'clipboard',
    available: { clipboard: true, opencode: false, openchamber: false },
  };

  function updateBackendIcon() {
    const active = backendState.active;
    const isClipboard = active === 'clipboard';
    const uris = iconUris[active];

    backendIconLight.style.display = 'none';
    backendIconDark.style.display = 'none';
    backendIconClipboard.style.display = 'none';

    if (isClipboard) {
      backendIconClipboard.style.display = 'inline';
    } else if (uris) {
      backendIconLight.src = uris.light;
      backendIconDark.src = uris.dark;
      backendIconLight.style.display = '';
      backendIconDark.style.display = '';
      // CSS [data-theme] rules handle which one is actually visible
    }
  }

  function renderBackendMenu() {
    const backends = [
      { key: 'opencode', label: 'OpenCode' },
      { key: 'openchamber', label: 'OpenChamber' },
      { key: 'clipboard', label: 'Clipboard' },
    ];

    backendMenu.innerHTML = backends.map((b) => {
      const isActive = b.key === backendState.active;
      const isAvailable = backendState.available[b.key] !== false;
      const disabledClass = isAvailable ? '' : ' disabled';
      const activeClass = isActive ? ' active' : '';
      const icon = b.key === 'clipboard'
        ? `<span class="material-symbols-outlined" style="font-size:16px;">content_copy</span>`
        : `<img class="backend-menu-icon backend-icon-light" src="${iconUris[b.key]?.light || ''}" width="16" height="16" /><img class="backend-menu-icon backend-icon-dark" src="${iconUris[b.key]?.dark || ''}" width="16" height="16" />`;
      const check = isActive ? '<span class="material-symbols-outlined" style="font-size:16px;margin-left:auto;">check</span>' : '';

      return `<button class="backend-menu-item${activeClass}${disabledClass}" data-backend="${b.key}">
        ${icon}
        <span>${b.label}</span>
        ${check}
      </button>`;
    }).join('');

    // Attach click handlers
    backendMenu.querySelectorAll('.backend-menu-item:not(.disabled)').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const backend = (item as HTMLElement).dataset.backend!;
        callbacks?.onBackendSelect?.(backend);
        backendMenu.classList.remove('visible');
      });
    });
  }
```

- [ ] **Step 6: Add backend button click handler**

After the `renderBackendMenu` function:

```typescript
  btnBackend.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    // Close overflow menu if open
    overflowMenu.classList.remove('visible');
    // Toggle backend menu
    if (backendMenu.classList.contains('visible')) {
      backendMenu.classList.remove('visible');
    } else {
      renderBackendMenu();
      backendMenu.classList.add('visible');
      callbacks?.onBackendRequest?.();
    }
  });
```

- [ ] **Step 7: Update the document click handler to also close backend menu**

Update the existing `document.addEventListener('click')` handler (line 169) to also close the backend menu:

```typescript
  document.addEventListener('click', () => {
    overflowMenu.classList.remove('visible');
    backendMenu.classList.remove('visible');
  });
```

- [ ] **Step 8: Also close backend menu when overflow button is clicked**

Update the overflow button click handler (line 164) to close the backend menu:

```typescript
  btnOverflow.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    backendMenu.classList.remove('visible');
    overflowMenu.classList.toggle('visible');
  });
```

- [ ] **Step 9: Add `setBackendState` to the returned API object**

In the return statement (line 215), add the new method:

```typescript
    setBackendState(active: string, available: Record<string, boolean>) {
      backendState = { active, available };
      updateBackendIcon();
      // If menu is open, re-render with new state
      if (backendMenu.classList.contains('visible')) {
        renderBackendMenu();
      }
    },
```

- [ ] **Step 10: Initialize the backend icon to clipboard default**

After the `updateModeUI()` function definition, call:

```typescript
  // Initialize backend icon to default
  updateBackendIcon();
```

- [ ] **Step 11: Verify the build compiles**

```bash
node esbuild.config.js
```

Expected: `Build complete` with no errors.

- [ ] **Step 12: Commit**

```bash
git add src/webview/toolbar.ts
git commit -m "feat: add backend selector button and dropdown to toolbar"
```

---

### Task 6: Add CSS styles for backend menu in `webview/main.css`

**Files:**
- Modify: `webview/main.css` (add new classes after the overflow menu section)

- [ ] **Step 1: Add backend menu CSS**

Add the following CSS after the overflow menu section (after line 156) in `webview/main.css`:

```css
/* ── Backend selector menu ───────────────────────────────────── */

.backend-menu {
  position: absolute;
  top: 30px;
  right: 0;
  min-width: 200px;
  background: var(--vscode-menu-background, #252526);
  border: 1px solid var(--vscode-menu-border, #454545);
  border-radius: 4px;
  padding: 4px 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  display: none;
}

.backend-menu.visible {
  display: block;
}

.backend-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--vscode-menu-foreground, #cccccc);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.backend-menu-item:hover {
  background: var(--vscode-menu-selectionBackground, #094771);
  color: var(--vscode-menu-selectionForeground, #ffffff);
}

.backend-menu-item.active {
  color: var(--vscode-menu-foreground, #cccccc);
}

.backend-menu-item.disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}

/* ── Backend button icon ─────────────────────────────────────── */

.backend-btn-icon {
  width: 18px;
  height: 18px;
  vertical-align: middle;
}

.backend-menu-icon {
  width: 16px;
  height: 16px;
  vertical-align: middle;
}

/* ── Theme-based icon visibility ─────────────────────────────── */

[data-theme="dark"] .backend-icon-light { display: inline; }
[data-theme="dark"] .backend-icon-dark { display: none; }
[data-theme="light"] .backend-icon-light { display: none; }
[data-theme="light"] .backend-icon-dark { display: inline; }
```

- [ ] **Step 2: Verify the build compiles**

```bash
node esbuild.config.js
```

Expected: `Build complete` with no errors.

- [ ] **Step 3: Commit**

```bash
git add webview/main.css
git commit -m "feat: add backend selector menu and theme icon toggle CSS"
```

---

### Task 7: Wire backend messages in `src/webview/main.ts`

**Files:**
- Modify: `src/webview/main.ts:24-35` (toolbar initialization), `src/webview/main.ts:104-143` (message handler)

- [ ] **Step 1: Add backend callbacks to toolbar initialization**

Update the `createToolbar` call (lines 24-35) to include the new callbacks:

```typescript
const toolbar = createToolbar(toolbarContainer, postMessage, {
  onLogsRequest() {
    const entries: ConsoleEntry[] = consoleCapture?.getEntries() ?? [];
    postMessage({ type: 'action:addLogs', payload: { logs: entries } });
  },
  onScreenshotRequest() {
    overlay.requestScreenshot().then((dataUrl) => {
      postMessage({ type: 'action:screenshot', payload: { dataUrl } });
    });
  },
  onBackendRequest() {
    postMessage({ type: 'backend:request', payload: {} });
  },
  onBackendSelect(backend: string) {
    postMessage({ type: 'backend:select', payload: { backend } });
  },
});
```

- [ ] **Step 2: Handle `backend:state` message in the message listener**

In the `window.addEventListener('message')` switch statement (line 113), add a case for `backend:state` after the `config:update` case:

```typescript
    case 'backend:state':
      toolbar.setBackendState(msg.payload.active, msg.payload.available);
      break;
```

- [ ] **Step 3: Handle `theme:update` message**

Add a case for `theme:update` in the same switch statement:

```typescript
    case 'theme:update':
      document.body.dataset.theme = msg.payload.kind;
      break;
```

- [ ] **Step 4: Request initial backend state on load**

After the iframe error listener (after line 101), add:

```typescript
// Request initial backend state so the toolbar icon is correct from the start
postMessage({ type: 'backend:request', payload: {} });
```

- [ ] **Step 5: Verify the build compiles**

```bash
node esbuild.config.js
```

Expected: `Build complete` with no errors.

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/webview/main.ts
git commit -m "feat: wire backend selector messages in webview main"
```

---

### Task 8: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

```bash
node esbuild.config.js
```

Expected: `Build complete` with no errors.

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Verify file structure**

```bash
ls media/icons/
```

Expected: `opencode-dark.svg  opencode-light.svg  openchamber-dark.svg  openchamber-light.svg`

- [ ] **Step 4: Manual testing checklist**

Open VS Code with the extension loaded (`F5` to run Extension Development Host):

1. Open the Browser Chat panel (`Ctrl+Shift+P` -> "Browser Chat: Open")
2. Verify the backend button appears in the toolbar (rightmost group, before the overflow menu)
3. Verify it shows the clipboard icon by default (since `browserChat.backend` defaults to `clipboard`)
4. Click the backend button — verify dropdown appears with three options
5. Verify OpenCode and OpenChamber show as disabled (greyed out) if their services aren't running
6. Verify Clipboard shows a checkmark (active)
7. Click Clipboard — verify dropdown closes
8. If OpenCode is running: select OpenCode, verify the button icon changes to the OpenCode logo
9. Change `browserChat.backend` in VS Code settings — verify the toolbar button updates
10. Switch VS Code theme (dark <-> light) — verify the icon variant switches appropriately
