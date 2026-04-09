# Version Badge in Overflow Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the extension version (e.g. `v0.2.11`) as a non-interactive footer at the bottom of the overflow menu in the webview toolbar.

**Architecture:** esbuild injects `__EXTENSION_VERSION__` as a compile-time string constant read from `package.json`. `toolbar.ts` references that constant in the overflow menu HTML template. CSS styles the footer as muted, non-interactive metadata.

**Tech Stack:** esbuild (build config in `esbuild.config.js`), TypeScript (`src/webview/toolbar.ts`), plain CSS (`webview/main.css`).

---

## File Map

| File | Change |
|---|---|
| `esbuild.config.js` | Read `package.json`, add `define: { __EXTENSION_VERSION__: ... }` to the webview bundle config |
| `src/webview/toolbar.ts` | Declare `__EXTENSION_VERSION__` ambient constant; append version footer to `#overflow-menu` HTML |
| `webview/main.css` | Add `.overflow-menu-version` style rule at end of overflow-menu section |

---

### Task 1: Inject version constant via esbuild

**Files:**
- Modify: `esbuild.config.js:1` (top of file) and `esbuild.config.js:76-84` (webview bundle config)

- [ ] **Step 1: Add package.json read and define to webview config**

Open `esbuild.config.js`. At the very top (line 1, before any existing code), add:

```js
const pkg = require('./package.json');
```

Then inside the webview bundle config object (the one with `entryPoints: ['./src/webview/main.ts']`), add a `define` property:

```js
    {
      entryPoints: ['./src/webview/main.ts'],
      bundle: true,
      outfile: './webview/main.js',
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      define: {
        __EXTENSION_VERSION__: JSON.stringify(pkg.version),
      },
      plugins: [makeNotifyPlugin()],
      ...shared,
    },
```

The full updated top of the file will look like:

```js
const pkg = require('./package.json');
const esbuild = require('esbuild');
const http = require('http');
const path = require('path');
```

- [ ] **Step 2: Verify build still succeeds**

```bash
npm run build
```

Expected: `Build complete` with no errors. The file `webview/main.js` is updated.

- [ ] **Step 3: Commit**

```bash
git add esbuild.config.js
git commit -m "build: inject __EXTENSION_VERSION__ constant into webview bundle"
```

---

### Task 2: Add version footer to overflow menu HTML

**Files:**
- Modify: `src/webview/toolbar.ts:1` (top of file) and `src/webview/toolbar.ts:148-160` (end of overflow-menu div)

- [ ] **Step 1: Declare the ambient constant**

At the very top of `src/webview/toolbar.ts`, after the existing import statements (after line 8), add:

```typescript
declare const __EXTENSION_VERSION__: string;
```

- [ ] **Step 2: Append version footer inside `#overflow-menu`**

In `toolbar.ts`, find the closing `</div>` of `#overflow-menu` (currently after the `menu-storage-view` button, around line 160). Replace that closing `</div>` with:

```html
          <div class="overflow-menu-separator"></div>
          <div class="overflow-menu-version">v${__EXTENSION_VERSION__}</div>
        </div>
```

The full `#overflow-menu` block should now end like this:

```html
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
          <div class="overflow-menu-separator"></div>
          <button class="overflow-menu-item" id="menu-storage-toggle">
            <span class="material-symbols-outlined">cookie</span>
            <span id="menu-storage-label">Storage Data</span>
            <span class="overflow-menu-check" id="menu-storage-check" style="display:none;">
              <span class="material-symbols-outlined" style="font-size:16px;margin-left:auto;">check</span>
            </span>
          </button>
          <button class="overflow-menu-item" id="menu-storage-view" style="display:none;">
            <span class="material-symbols-outlined">manage_search</span>
            View Storage Data
          </button>
          <div class="overflow-menu-separator"></div>
          <div class="overflow-menu-version">v${__EXTENSION_VERSION__}</div>
        </div>
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: `Build complete` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/webview/toolbar.ts
git commit -m "feat: add version footer to overflow menu"
```

---

### Task 3: Style the version footer

**Files:**
- Modify: `webview/main.css:483-487` (after `.overflow-menu-separator` block at end of overflow-menu section)

- [ ] **Step 1: Add CSS rule after `.overflow-menu-separator`**

In `webview/main.css`, after the `.overflow-menu-separator` rule (which ends at line 487), add:

```css

.overflow-menu-version {
  padding: 4px 12px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  text-align: center;
  user-select: none;
  cursor: default;
}
```

- [ ] **Step 2: Run build to ensure CSS is included**

```bash
npm run build
```

Expected: `Build complete` with no errors.

- [ ] **Step 3: Commit**

```bash
git add webview/main.css
git commit -m "style: add .overflow-menu-version muted footer style"
```

---

### Task 4: Verify visually

- [ ] **Step 1: Run the extension**

Press `F5` in VS Code to launch the Extension Development Host, or run via the existing launch config. Open the Web Lens panel, click the three-dot (`more_vert`) button in the toolbar.

Expected: The overflow menu appears with the existing items (Settings, Copy Page HTML, Clear Selection, separator, Storage Data, View Storage Data) followed by a new separator and `v0.2.11` in small muted text at the bottom.

- [ ] **Step 2: Confirm non-interactivity**

Hover over the version text. Expected: no background highlight (unlike menu items). The cursor should remain the default arrow.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass (no existing tests cover toolbar HTML structure, so this is a sanity check that nothing regressed).
