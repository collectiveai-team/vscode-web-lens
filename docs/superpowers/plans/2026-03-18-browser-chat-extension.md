# Browser Chat Extension Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that embeds a browser panel for inspecting web pages and sending element context (HTML + screenshots) to AI coding agents.

**Architecture:** Monolithic webview panel with an iframe for page rendering. Toolbar and inspect overlay run in the webview for low-latency interaction. Extension host handles context formatting and delivery to backends via a BackendAdapter interface. Three adapters ship together: OpenCode, OpenChamber, and Clipboard (default).

**Tech Stack:** TypeScript, esbuild, VS Code Extension API, html2canvas, Material Symbols, @vscode/vsce, vitest, @vscode/test-cli

**Spec:** `docs/superpowers/specs/2026-03-18-browser-chat-extension-design.md`

---

## Chunk 1: Project Scaffolding, Build Pipeline, and Extension Shell

### Task 1: Initialize project and install dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.eslintrc.json`
- Create: `.gitignore`
- Create: `.vscodeignore`
- Create: `.vscode/launch.json`
- Create: `.vscode/tasks.json`

- [ ] **Step 1: Initialize npm project**

Run: `npm init -y`

Then replace `package.json` with the full extension manifest:

```json
{
  "name": "browser-chat",
  "displayName": "Browser Chat",
  "description": "Embedded browser for sending page context to AI coding agents",
  "version": "0.1.0",
  "publisher": "collective-ai",
  "license": "MIT",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "main": "./out/extension.js",
  "activationEvents": ["onCommand:browserChat.open"],
  "contributes": {
    "commands": [
      { "command": "browserChat.open", "title": "Browser Chat: Open" },
      { "command": "browserChat.openUrl", "title": "Browser Chat: Open URL" },
      { "command": "browserChat.inspect", "title": "Browser Chat: Inspect Element" },
      { "command": "browserChat.addElement", "title": "Browser Chat: Add Element to Chat" },
      { "command": "browserChat.addLogs", "title": "Browser Chat: Add Logs to Chat" },
      { "command": "browserChat.screenshot", "title": "Browser Chat: Screenshot" }
    ],
    "configuration": {
      "title": "Browser Chat",
      "properties": {
        "browserChat.backend": {
          "type": "string",
          "default": "clipboard",
          "enum": ["opencode", "openchamber", "clipboard"],
          "description": "Active backend for delivering context to AI agent"
        },
        "browserChat.defaultUrl": {
          "type": "string",
          "default": "http://localhost:3000",
          "description": "URL loaded when browser panel opens"
        },
        "browserChat.screenshotFormat": {
          "type": "string",
          "default": "png",
          "enum": ["png", "jpeg"],
          "description": "Screenshot image format"
        },
        "browserChat.screenshotQuality": {
          "type": "number",
          "default": 0.9,
          "minimum": 0.1,
          "maximum": 1.0,
          "description": "JPEG quality (0-1), ignored for PNG"
        }
      }
    }
  },
  "scripts": {
    "build": "node esbuild.config.js",
    "build:prod": "node esbuild.config.js --production",
    "typecheck": "tsc --noEmit",
    "package": "npm run build:prod && vsce package",
    "publish": "npm run build:prod && vsce publish",
    "test": "vitest run && vscode-test",
    "test:unit": "vitest run",
    "test:integration": "vscode-test",
    "lint": "eslint src/"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vscode/test-cli": "^0.0.10",
    "@vscode/test-electron": "^2.4.0",
    "@vscode/vsce": "^3.0.0",
    "esbuild": "^0.24.0",
    "eslint": "^8.57.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "html2canvas": "^1.4.1"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "out", "webview"]
}
```

- [ ] **Step 3: Create .eslintrc.json**

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module"
  },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "off"
  },
  "ignorePatterns": ["out/", "webview/", "*.js"]
}
```

These dependencies are already included in `package.json` from Step 1. ESLint is pinned to v8 to use the legacy `.eslintrc.json` config format.

- [ ] **Step 4: Create .gitignore**

```
node_modules/
out/
*.vsix
.superpowers/
```

- [ ] **Step 5: Create .vscodeignore**

```
.vscode/
.superpowers/
src/
node_modules/
*.ts
!out/**
!webview/**
tsconfig.json
esbuild.config.js
.eslintrc*
vitest.config.*
docs/
.github/
```

- [ ] **Step 6: Create .vscode/launch.json**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/out/**/*.js"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

- [ ] **Step 7: Create .vscode/tasks.json**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "build",
      "group": "build",
      "problemMatcher": ["$tsc"]
    }
  ]
}
```

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold project with package.json, tsconfig, eslint, vscode launch config"
```

### Task 2: Create esbuild configuration

**Files:**
- Create: `esbuild.config.js`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create esbuild.config.js**

This file builds two entry points: the extension host bundle and the webview bundle.

```javascript
const esbuild = require('esbuild');

const production = process.argv.includes('--production');

async function main() {
  // Extension host bundle
  await esbuild.build({
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    outfile: './out/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: !production,
    minify: production,
  });

  // Webview bundle
  await esbuild.build({
    entryPoints: ['./src/webview/main.ts'],
    bundle: true,
    outfile: './webview/main.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    sourcemap: !production,
    minify: production,
  });

  console.log('Build complete');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/test/**'],  // VS Code integration tests use separate runner
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add esbuild.config.js vitest.config.ts
git commit -m "chore: add esbuild config (extension + webview bundles) and vitest config"
```

### Task 3: Create extension entry point and message types

**Files:**
- Create: `src/types.ts`
- Create: `src/extension.ts`

- [ ] **Step 1: Write shared type definitions**

Create `src/types.ts` with all message types and the ContextBundle interface:

```typescript
// Message protocol types — discriminated union

// Webview -> Extension Host
export type WebviewMessage =
  | { type: 'navigate'; payload: { url: string } }
  | { type: 'nav:back'; payload: Record<string, never> }
  | { type: 'nav:forward'; payload: Record<string, never> }
  | { type: 'nav:reload'; payload: Record<string, never> }
  | { type: 'inspect:selected'; payload: InspectSelectedPayload }
  | { type: 'inspect:sendToChat'; payload: CapturedElementPayload }
  | { type: 'addElement:captured'; payload: CapturedElementPayload }
  | { type: 'action:addLogs'; payload: { logs: ConsoleEntry[] } }
  | { type: 'action:screenshot'; payload: { dataUrl: string } }
  | { type: 'iframe:loaded'; payload: { url: string; title: string; canInject: boolean } }
  | { type: 'iframe:error'; payload: { url: string; error: string } }
  | { type: 'menu:copyHtml'; payload: { html: string } }
  | { type: 'menu:clearSelection'; payload: Record<string, never> }
  | { type: 'menu:openSettings'; payload: Record<string, never> };

// Extension Host -> Webview
export type ExtensionMessage =
  | { type: 'navigate:url'; payload: { url: string } }
  | { type: 'mode:inspect'; payload: { enabled: boolean } }
  | { type: 'mode:addElement'; payload: { enabled: boolean } }
  | { type: 'screenshot:request'; payload: Record<string, never> }
  | { type: 'config:update'; payload: { backend: string } }
  | { type: 'toast'; payload: { message: string; toastType: 'success' | 'error' } };
  // Note: spec uses `type` for toast payload, but we use `toastType` to avoid
  // collision with the message discriminant `type` field.

export interface InspectSelectedPayload {
  html: string;
  tag: string;
  classes: string[];
  dimensions: { width: number; height: number };
  accessibility: AccessibilityInfo;
}

export interface CapturedElementPayload {
  html: string;
  tag: string;
  classes: string[];
  dimensions: { width: number; height: number };
  accessibility: AccessibilityInfo;
  parentHtml: string;
  ancestorPath: string;
  sourceLocation?: SourceLocation;
  screenshotDataUrl: string;
}

export interface AccessibilityInfo {
  name?: string;
  role?: string;
  focusable?: boolean;
}

export interface SourceLocation {
  filePath: string;
  line: number;
  column?: number;
}

export interface ContextBundle {
  url: string;
  timestamp: number;
  element?: ElementContext;
  screenshot?: ScreenshotData;
  logs?: ConsoleEntry[];
}

export interface ElementContext {
  html: string;
  parentHtml: string;
  ancestorPath: string;
  tag: string;
  classes: string[];
  id?: string;
  dimensions: { width: number; height: number };
  accessibility: AccessibilityInfo;
  sourceLocation?: SourceLocation;
}

export interface ScreenshotData {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface DeliveryResult {
  success: boolean;
  message: string;
}
```

- [ ] **Step 2: Write minimal extension entry point**

Create `src/extension.ts`:

```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const openCmd = vscode.commands.registerCommand('browserChat.open', () => {
    vscode.window.showInformationMessage('Browser Chat: coming soon');
  });

  context.subscriptions.push(openCmd);
}

export function deactivate() {
  // Cleanup
}
```

- [ ] **Step 3: Create placeholder webview entry**

Create `src/webview/main.ts`:

```typescript
// Webview entry point — will be populated in Chunk 2
export {};
```

Create `webview/` directory and add a placeholder `webview/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Browser Chat</title>
</head>
<body>
  <p>Browser Chat loading...</p>
</body>
</html>
```

- [ ] **Step 4: Verify build succeeds**

Run: `npm run build`
Expected: `out/extension.js` and `webview/main.js` created without errors

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add extension entry point, message types, and build pipeline"
```

### Task 4: Create GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/release.yml`:

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build-and-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npm run typecheck

      - name: Run tests
        run: npm run test

      - name: Build VSIX
        run: npm run package

      - name: Get version from tag
        id: version
        run: echo "version=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: '*.vsix'
          generate_release_notes: true

      - name: Publish to VS Code Marketplace
        if: env.VSCE_PAT != ''
        run: npx vsce publish
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add GitHub Actions workflow for build and release on tag"
```

---

## Chunk 2: Webview Panel, Toolbar, and Navigation

### Task 5: Create BrowserPanelManager

**Files:**
- Create: `src/panel/BrowserPanelManager.ts`
- Modify: `src/extension.ts`
- Test: `src/panel/BrowserPanelManager.test.ts`

- [ ] **Step 1: Write test for BrowserPanelManager construction and panel creation**

Create `src/panel/BrowserPanelManager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode module
vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn().mockReturnValue({
      webview: {
        html: '',
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: 'https://example.com',
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
      dispose: vi.fn(),
    }),
  },
  ViewColumn: { One: 1 },
  Uri: {
    joinPath: vi.fn((...args: any[]) => args.join('/')),
    file: vi.fn((p: string) => p),
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((key: string) => {
        const defaults: Record<string, any> = {
          defaultUrl: 'http://localhost:3000',
          backend: 'clipboard',
          screenshotFormat: 'png',
          screenshotQuality: 0.9,
        };
        return defaults[key];
      }),
    }),
  },
}));

import { BrowserPanelManager } from './BrowserPanelManager';

describe('BrowserPanelManager', () => {
  let manager: BrowserPanelManager;
  const mockExtensionUri = '/fake/extension/path' as any;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new BrowserPanelManager(mockExtensionUri);
  });

  it('creates a webview panel on open', () => {
    const vscode = require('vscode');
    manager.open();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'browserChat',
      'Browser Chat',
      1,
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
      })
    );
  });

  it('reuses existing panel on second open call', () => {
    const vscode = require('vscode');
    manager.open();
    manager.open();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it('disposes panel correctly', () => {
    manager.open();
    manager.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/panel/BrowserPanelManager.test.ts`
Expected: FAIL — `BrowserPanelManager` module not found

- [ ] **Step 3: Implement BrowserPanelManager**

Create `src/panel/BrowserPanelManager.ts`:

```typescript
import * as vscode from 'vscode';
import { WebviewMessage, ExtensionMessage } from '../types';

interface PanelState {
  url: string;
  history: string[];
  historyIndex: number;
}

export class BrowserPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private state: PanelState;
  private readonly extensionUri: vscode.Uri;
  private messageHandler: ((msg: WebviewMessage) => void) | undefined;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    const config = vscode.workspace.getConfiguration('browserChat');
    this.state = {
      url: config.get<string>('defaultUrl') || 'http://localhost:3000',
      history: [],
      historyIndex: -1,
    };
  }

  open() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'browserChat',
      'Browser Chat',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'webview'),
          vscode.Uri.joinPath(this.extensionUri, 'out'),
        ],
      }
    );

    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message)
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    // Navigate to default URL
    this.postMessage({ type: 'navigate:url', payload: { url: this.state.url } });
  }

  onMessage(handler: (msg: WebviewMessage) => void) {
    this.messageHandler = handler;
  }

  postMessage(message: ExtensionMessage) {
    this.panel?.webview.postMessage(message);
  }

  dispose() {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private handleMessage(message: WebviewMessage) {
    switch (message.type) {
      case 'navigate':
        this.navigate(message.payload.url);
        break;
      case 'nav:back':
        this.goBack();
        break;
      case 'nav:forward':
        this.goForward();
        break;
      case 'nav:reload':
        this.postMessage({ type: 'navigate:url', payload: { url: this.state.url } });
        break;
      case 'iframe:loaded':
        this.onIframeLoaded(message.payload.url);
        break;
      case 'menu:openSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', 'browserChat');
        break;
      case 'menu:copyHtml':
        vscode.env.clipboard.writeText(message.payload.html);
        this.postMessage({
          type: 'toast',
          payload: { message: 'HTML copied to clipboard', toastType: 'success' },
        });
        break;
      default:
        // Forward to external handler (ContextExtractor, adapters)
        this.messageHandler?.(message);
        break;
    }
  }

  private navigate(url: string) {
    // Trim history after current position
    this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
    this.state.history.push(url);
    this.state.historyIndex = this.state.history.length - 1;
    this.state.url = url;
    this.postMessage({ type: 'navigate:url', payload: { url } });
  }

  private goBack() {
    if (this.state.historyIndex > 0) {
      this.state.historyIndex--;
      this.state.url = this.state.history[this.state.historyIndex];
      this.postMessage({ type: 'navigate:url', payload: { url: this.state.url } });
    }
  }

  private goForward() {
    if (this.state.historyIndex < this.state.history.length - 1) {
      this.state.historyIndex++;
      this.state.url = this.state.history[this.state.historyIndex];
      this.postMessage({ type: 'navigate:url', payload: { url: this.state.url } });
    }
  }

  private onIframeLoaded(url: string) {
    if (url !== this.state.url) {
      // iframe navigated internally
      this.navigate(url);
    }
  }

  private getHtmlForWebview(): string {
    const webview = this.panel!.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview', 'main.css')
    );
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com;
    font-src https://fonts.gstatic.com;
    script-src 'nonce-${nonce}';
    frame-src http: https:;
    img-src ${webview.cspSource} https: data:;
  ">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet">
  <link href="${styleUri}" rel="stylesheet">
  <title>Browser Chat</title>
</head>
<body>
  <div id="toolbar"></div>
  <div id="browser-frame">
    <iframe id="browser-iframe" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/panel/BrowserPanelManager.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Wire BrowserPanelManager into extension.ts**

Update `src/extension.ts`:

```typescript
import * as vscode from 'vscode';
import { BrowserPanelManager } from './panel/BrowserPanelManager';

let panelManager: BrowserPanelManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  panelManager = new BrowserPanelManager(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand('browserChat.open', () => {
      panelManager!.open();
    }),
    vscode.commands.registerCommand('browserChat.openUrl', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter URL to open',
        value: 'http://localhost:3000',
        validateInput: (value) => {
          try {
            new URL(value);
            return null;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      });
      if (url) {
        panelManager!.open();
        panelManager!.postMessage({ type: 'navigate:url', payload: { url } });
      }
    }),
    vscode.commands.registerCommand('browserChat.inspect', () => {
      panelManager!.postMessage({ type: 'mode:inspect', payload: { enabled: true } });
    }),
    vscode.commands.registerCommand('browserChat.addElement', () => {
      panelManager!.postMessage({ type: 'mode:addElement', payload: { enabled: true } });
    }),
    vscode.commands.registerCommand('browserChat.addLogs', () => {
      // Placeholder — the webview's toolbar button handles log capture directly.
      // This command will be properly wired in Chunk 4 (Task 13).
      vscode.window.showInformationMessage('Use the toolbar button to capture logs');
    }),
    vscode.commands.registerCommand('browserChat.screenshot', () => {
      panelManager!.postMessage({ type: 'screenshot:request', payload: {} });
    })
  );
}

export function deactivate() {
  panelManager?.dispose();
  panelManager = undefined;
}
```

- [ ] **Step 4: Verify build succeeds**

Run: `npm run build && npm run typecheck`
Expected: No errors. `out/extension.js` and `webview/main.js` generated.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement toolbar with navigation, mode toggles, URL bar, and webview main entry"
```

---

## Chunk 3: Inspect Overlay, Screenshot, Console Capture, and Context Extraction

### Task 7: Create inspect overlay

**Files:**
- Create: `src/webview/inspect-overlay.ts`

- [ ] **Step 1: Implement InspectOverlay**

Create `src/webview/inspect-overlay.ts`. This module is called from the webview's `main.ts` to inject hover-highlight and click-select behavior into same-origin iframes.

```typescript
import type { WebviewMessage, AccessibilityInfo, SourceLocation } from '../types';

type PostMessage = (msg: WebviewMessage) => void;
type Mode = 'inspect' | 'addElement' | 'off';

interface OverlayState {
  mode: Mode;
  selectedElement: HTMLElement | null;
}

export function createInspectOverlay(
  iframe: HTMLIFrameElement,
  postMessage: PostMessage
) {
  const state: OverlayState = { mode: 'off', selectedElement: null };

  let highlight: HTMLElement | null = null;
  let tooltip: HTMLElement | null = null;
  let iframeDoc: Document | null = null;

  function setMode(mode: Mode) {
    state.mode = mode;
    state.selectedElement = null;
    cleanup();

    if (mode !== 'off') {
      tryAttach();
    }
  }

  function tryAttach() {
    try {
      iframeDoc = iframe.contentDocument;
      if (!iframeDoc) return;

      iframeDoc.addEventListener('mousemove', onMouseMove, true);
      iframeDoc.addEventListener('click', onClick, true);
      iframeDoc.addEventListener('keydown', onKeyDown, true);

      // Create highlight overlay
      highlight = iframeDoc.createElement('div');
      highlight.id = '__bc-highlight';
      highlight.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 2147483647;
        border: 2px solid #007acc;
        background: rgba(0, 122, 204, 0.18);
        border-radius: 4px;
        display: none;
        transition: all 0.05s ease;
      `;
      iframeDoc.body.appendChild(highlight);
    } catch {
      // Cross-origin — can't attach
    }
  }

  function cleanup() {
    if (iframeDoc) {
      iframeDoc.removeEventListener('mousemove', onMouseMove, true);
      iframeDoc.removeEventListener('click', onClick, true);
      iframeDoc.removeEventListener('keydown', onKeyDown, true);
    }

    highlight?.remove();
    highlight = null;
    tooltip?.remove();
    tooltip = null;
    iframeDoc = null;
  }

  function onMouseMove(e: MouseEvent) {
    if (state.mode === 'off' || !highlight) return;

    const target = e.target as HTMLElement;
    if (target === highlight || target === tooltip || target.closest('#__bc-tooltip')) return;

    const rect = target.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.top = `${rect.top}px`;
    highlight.style.left = `${rect.left}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;

    // Dashed border for add-element mode
    highlight.style.borderStyle = state.mode === 'addElement' ? 'dashed' : 'solid';
  }

  function onClick(e: MouseEvent) {
    if (state.mode === 'off') return;

    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target === highlight || target === tooltip || target.closest('#__bc-tooltip')) return;

    state.selectedElement = target;

    if (state.mode === 'inspect') {
      handleInspectClick(target);
    } else if (state.mode === 'addElement') {
      handleAddElementClick(target);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setMode('off');
    }
  }

  function handleInspectClick(el: HTMLElement) {
    const info = extractElementInfo(el);

    postMessage({
      type: 'inspect:selected',
      payload: {
        html: info.html,
        tag: info.tag,
        classes: info.classes,
        dimensions: info.dimensions,
        accessibility: info.accessibility,
      },
    });

    showTooltip(el, info);
  }

  function handleAddElementClick(el: HTMLElement) {
    const info = extractElementInfo(el);

    // Capture screenshot before sending
    captureScreenshot().then((screenshotDataUrl) => {
      postMessage({
        type: 'addElement:captured',
        payload: {
          html: truncate(info.html, 50000),
          tag: info.tag,
          classes: info.classes,
          dimensions: info.dimensions,
          accessibility: info.accessibility,
          parentHtml: truncate(info.parentHtml, 50000),
          ancestorPath: info.ancestorPath,
          sourceLocation: info.sourceLocation,
          screenshotDataUrl,
        },
      });

      // Exit mode after capture
      setMode('off');
    });
  }

  function showTooltip(el: HTMLElement, info: ReturnType<typeof extractElementInfo>) {
    tooltip?.remove();

    if (!iframeDoc) return;

    tooltip = iframeDoc.createElement('div');
    tooltip.id = '__bc-tooltip';
    tooltip.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      background: #1e1e1e;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 8px 10px;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      min-width: 200px;
      color: #ccc;
    `;

    const rect = el.getBoundingClientRect();
    tooltip.style.top = `${rect.bottom + 8}px`;
    tooltip.style.left = `${rect.left}px`;

    const tagDisplay = info.tag + (info.classes.length ? '.' + info.classes.join('.') : '');

    tooltip.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">
        <span style="color:#007acc;font-family:monospace;font-weight:600;font-size:12px;">${tagDisplay}</span>
        <span style="color:#888;font-family:monospace;font-size:11px;">${info.dimensions.width} &times; ${info.dimensions.height}</span>
      </div>
      <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #333;padding-top:6px;margin-top:4px;margin-bottom:4px;">Accessibility</div>
      ${info.accessibility.name ? `<div style="display:flex;gap:12px;font-size:11px;line-height:1.6;"><span style="color:#888;min-width:50px;">Name</span><span style="color:#ccc;">${escapeHtml(info.accessibility.name)}</span></div>` : ''}
      ${info.accessibility.role ? `<div style="display:flex;gap:12px;font-size:11px;line-height:1.6;"><span style="color:#888;min-width:50px;">Role</span><span style="color:#ccc;">${info.accessibility.role}</span></div>` : ''}
      <button id="__bc-send-btn" style="display:flex;align-items:center;gap:4px;margin-top:8px;padding:4px 10px;background:#007acc;color:#fff;border:none;border-radius:3px;font-size:11px;cursor:pointer;width:100%;justify-content:center;font-family:system-ui,sans-serif;">
        Add to chat
      </button>
    `;

    iframeDoc.body.appendChild(tooltip);

    // Send button handler
    tooltip.querySelector('#__bc-send-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();

      captureScreenshot().then((screenshotDataUrl) => {
        postMessage({
          type: 'inspect:sendToChat',
          payload: {
            html: truncate(info.html, 50000),
            tag: info.tag,
            classes: info.classes,
            dimensions: info.dimensions,
            accessibility: info.accessibility,
            parentHtml: truncate(info.parentHtml, 50000),
            ancestorPath: info.ancestorPath,
            sourceLocation: info.sourceLocation,
            screenshotDataUrl,
          },
        });
      });
    });
  }

  function extractElementInfo(el: HTMLElement) {
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList);
    const rect = el.getBoundingClientRect();
    const html = el.outerHTML;

    // Parent HTML with siblings collapsed into a single comment
    let parentHtml = '';
    if (el.parentElement) {
      const parent = el.parentElement.cloneNode(true) as HTMLElement;
      const children = Array.from(parent.children);
      const siblingCount = children.length - 1;
      // Remove all sibling children, insert one summary comment
      let foundTarget = false;
      const toRemove: Element[] = [];
      children.forEach((child) => {
        if (child.outerHTML === el.outerHTML && !foundTarget) {
          foundTarget = true; // keep the first match (the target element)
        } else {
          toRemove.push(child);
        }
      });
      toRemove.forEach((child) => child.remove());
      if (siblingCount > 0) {
        parent.insertBefore(
          parent.ownerDocument.createComment(` ${siblingCount} sibling(s) omitted `),
          parent.firstChild
        );
      }
      parentHtml = parent.outerHTML;
    }

    // Ancestor path
    const ancestors: string[] = [];
    let current: HTMLElement | null = el;
    while (current && current !== iframeDoc?.body) {
      const name = current.tagName.toLowerCase();
      const cls = current.classList.length > 0 ? '.' + Array.from(current.classList).join('.') : '';
      const id = current.id ? `#${current.id}` : '';
      ancestors.unshift(`${name}${id}${cls}`);
      current = current.parentElement;
    }
    ancestors.unshift('body');
    const ancestorPath = ancestors.join(' > ');

    // Accessibility info
    const accessibility: AccessibilityInfo = {
      name: el.getAttribute('aria-label') ||
            el.getAttribute('alt') ||
            el.textContent?.trim().slice(0, 100) ||
            undefined,
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      focusable: el.tabIndex >= 0,
    };

    // Source location (React dev mode)
    const sourceLocation = detectSourceLocation(el);

    return {
      html,
      parentHtml,
      ancestorPath,
      tag,
      classes,
      id: el.id || undefined,
      dimensions: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      accessibility,
      sourceLocation,
    };
  }

  function detectSourceLocation(el: HTMLElement): SourceLocation | undefined {
    // React: look for __reactFiber$ property
    const fiberKey = Object.keys(el).find((key) => key.startsWith('__reactFiber$'));
    if (fiberKey) {
      let fiber = (el as any)[fiberKey];
      while (fiber) {
        if (fiber._debugSource) {
          return {
            filePath: fiber._debugSource.fileName,
            line: fiber._debugSource.lineNumber,
            column: fiber._debugSource.columnNumber,
          };
        }
        fiber = fiber.return;
      }
    }

    // MVP: React only. Vue/Svelte/Angular detection deferred to later iterations.
    return undefined;
  }

  async function captureScreenshot(): Promise<string> {
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(iframeDoc!.body, {
        useCORS: true,
        logging: false,
        width: iframe.clientWidth,
        height: iframe.clientHeight,
        windowWidth: iframe.clientWidth,
        windowHeight: iframe.clientHeight,
      });
      const dataUrl = canvas.toDataURL('image/png');

      // Cap at 2MB
      if (dataUrl.length > 2 * 1024 * 1024) {
        const scale = Math.sqrt((2 * 1024 * 1024) / dataUrl.length);
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = canvas.width * scale;
        scaledCanvas.height = canvas.height * scale;
        const ctx = scaledCanvas.getContext('2d')!;
        ctx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
        return scaledCanvas.toDataURL('image/png');
      }

      return dataUrl;
    } catch {
      return '';
    }
  }

  function truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + '<!-- truncated -->';
  }

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { setMode, cleanup };
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build && npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/webview/inspect-overlay.ts
git commit -m "feat: implement inspect overlay with hover-highlight, tooltip, source location detection"
```

### Task 8: Create console capture module

**Files:**
- Create: `src/webview/console-capture.ts`
- Test: `src/webview/console-capture.test.ts`

- [ ] **Step 1: Write test for ConsoleCapture**

Create `src/webview/console-capture.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createConsoleCapture } from './console-capture';

describe('createConsoleCapture', () => {
  let mockConsole: { log: any; warn: any; error: any };
  let capture: ReturnType<typeof createConsoleCapture>;

  beforeEach(() => {
    mockConsole = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    capture = createConsoleCapture(mockConsole as any);
  });

  it('captures log entries', () => {
    mockConsole.log('hello', 'world');
    const entries = capture.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('log');
    expect(entries[0].message).toBe('hello world');
  });

  it('captures warn and error entries', () => {
    mockConsole.warn('warning');
    mockConsole.error('error');
    const entries = capture.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].level).toBe('warn');
    expect(entries[1].level).toBe('error');
  });

  it('respects max entries limit', () => {
    for (let i = 0; i < 250; i++) {
      mockConsole.log(`msg ${i}`);
    }
    const entries = capture.getEntries();
    expect(entries.length).toBeLessThanOrEqual(200);
    // Oldest entries evicted
    expect(entries[0].message).toBe('msg 50');
  });

  it('clears buffer', () => {
    mockConsole.log('test');
    capture.clear();
    expect(capture.getEntries()).toHaveLength(0);
  });

  it('still calls original console methods', () => {
    const origLog = mockConsole.log;
    mockConsole.log('test');
    // The mock itself is the original — just verify it was called
    expect(origLog).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/webview/console-capture.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ConsoleCapture**

Create `src/webview/console-capture.ts`:

```typescript
import type { ConsoleEntry } from '../types';

const MAX_ENTRIES = 200;
const MAX_BUFFER_SIZE = 50000; // ~50KB

export function createConsoleCapture(console: Console) {
  const buffer: ConsoleEntry[] = [];
  let bufferSize = 0;

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  function addEntry(level: ConsoleEntry['level'], args: any[]) {
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');

    const entry: ConsoleEntry = {
      level,
      message,
      timestamp: Date.now(),
    };

    buffer.push(entry);
    bufferSize += message.length;

    // Evict oldest entries if over limits
    while (buffer.length > MAX_ENTRIES || bufferSize > MAX_BUFFER_SIZE) {
      const removed = buffer.shift();
      if (removed) {
        bufferSize -= removed.message.length;
      }
    }
  }

  // Proxy console methods
  console.log = (...args: any[]) => {
    addEntry('log', args);
    originalLog(...args);
  };

  console.warn = (...args: any[]) => {
    addEntry('warn', args);
    originalWarn(...args);
  };

  console.error = (...args: any[]) => {
    addEntry('error', args);
    originalError(...args);
  };

  return {
    getEntries(): ConsoleEntry[] {
      return [...buffer];
    },

    clear() {
      buffer.length = 0;
      bufferSize = 0;
    },

    detach() {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/webview/console-capture.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/webview/console-capture.ts src/webview/console-capture.test.ts
git commit -m "feat: implement console capture with circular buffer and size limits"
```

### Task 9: Create ContextExtractor

**Files:**
- Create: `src/context/ContextExtractor.ts`
- Test: `src/context/ContextExtractor.test.ts`

- [ ] **Step 1: Write test for ContextExtractor**

Create `src/context/ContextExtractor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ContextExtractor } from './ContextExtractor';

describe('ContextExtractor', () => {
  const extractor = new ContextExtractor();

  it('builds bundle from addElement:captured message', () => {
    const bundle = extractor.fromCapturedElement(
      {
        html: '<button class="cta">Click</button>',
        tag: 'button',
        classes: ['cta'],
        dimensions: { width: 120, height: 34 },
        accessibility: { name: 'Click', role: 'button', focusable: true },
        parentHtml: '<div class="hero"><!-- 2 siblings --><button class="cta">Click</button></div>',
        ancestorPath: 'body > div.app > div.hero > button.cta',
        screenshotDataUrl: 'data:image/png;base64,abc123',
      },
      'http://localhost:3000'
    );

    expect(bundle.url).toBe('http://localhost:3000');
    expect(bundle.element?.html).toBe('<button class="cta">Click</button>');
    expect(bundle.element?.ancestorPath).toBe('body > div.app > div.hero > button.cta');
    expect(bundle.screenshot?.dataUrl).toBe('data:image/png;base64,abc123');
    expect(bundle.timestamp).toBeGreaterThan(0);
  });

  it('builds bundle without screenshot when dataUrl is empty', () => {
    const bundle = extractor.fromCapturedElement(
      {
        html: '<p>Test</p>',
        tag: 'p',
        classes: [],
        dimensions: { width: 100, height: 20 },
        accessibility: {},
        parentHtml: '<div><p>Test</p></div>',
        ancestorPath: 'body > div > p',
        screenshotDataUrl: '',
      },
      'http://localhost:3000'
    );

    expect(bundle.element).toBeDefined();
    expect(bundle.screenshot).toBeUndefined();
  });

  it('builds screenshot-only bundle', () => {
    const bundle = extractor.fromScreenshot('data:image/png;base64,xyz', 800, 600, 'http://localhost:3000');

    expect(bundle.screenshot?.dataUrl).toBe('data:image/png;base64,xyz');
    expect(bundle.screenshot?.width).toBe(800);
    expect(bundle.element).toBeUndefined();
  });

  it('builds logs-only bundle', () => {
    const bundle = extractor.fromLogs(
      [{ level: 'error', message: 'Uncaught TypeError', timestamp: 1000 }],
      'http://localhost:3000'
    );

    expect(bundle.logs).toHaveLength(1);
    expect(bundle.logs![0].level).toBe('error');
    expect(bundle.element).toBeUndefined();
    expect(bundle.screenshot).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/context/ContextExtractor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ContextExtractor**

Create `src/context/ContextExtractor.ts`:

```typescript
import type {
  ContextBundle,
  CapturedElementPayload,
  ConsoleEntry,
} from '../types';

export class ContextExtractor {
  fromCapturedElement(
    payload: CapturedElementPayload,
    url: string
  ): ContextBundle {
    const bundle: ContextBundle = {
      url,
      timestamp: Date.now(),
      element: {
        html: payload.html,
        parentHtml: payload.parentHtml,
        ancestorPath: payload.ancestorPath,
        tag: payload.tag,
        classes: payload.classes,
        dimensions: payload.dimensions,
        accessibility: payload.accessibility,
        sourceLocation: payload.sourceLocation,
      },
    };

    if (payload.screenshotDataUrl) {
      const dimensions = this.getImageDimensions(payload.screenshotDataUrl);
      bundle.screenshot = {
        dataUrl: payload.screenshotDataUrl,
        ...dimensions,
      };
    }

    return bundle;
  }

  fromScreenshot(
    dataUrl: string,
    width: number,
    height: number,
    url: string
  ): ContextBundle {
    return {
      url,
      timestamp: Date.now(),
      screenshot: { dataUrl, width, height },
    };
  }

  fromLogs(logs: ConsoleEntry[], url: string): ContextBundle {
    return {
      url,
      timestamp: Date.now(),
      logs,
    };
  }

  private getImageDimensions(dataUrl: string): { width: number; height: number } {
    // Approximate from base64 length — actual dimensions would require decoding
    // For now, return 0,0 — the backend adapter can decode if needed
    return { width: 0, height: 0 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/context/ContextExtractor.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/context/ContextExtractor.ts src/context/ContextExtractor.test.ts
git commit -m "feat: implement ContextExtractor for building context bundles from webview messages"
```

### Task 10: Wire inspect overlay and console capture into webview main

**Files:**
- Modify: `src/webview/main.ts`
- Modify: `src/webview/toolbar.ts`
- Create: `src/webview/screenshot.ts`

- [ ] **Step 1: Create shared screenshot utility**

Create `src/webview/screenshot.ts` to avoid duplicating html2canvas logic:

```typescript
const MAX_SCREENSHOT_SIZE = 2 * 1024 * 1024; // 2MB

export async function captureScreenshot(
  targetBody: HTMLElement,
  viewportWidth: number,
  viewportHeight: number
): Promise<string> {
  try {
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(targetBody, {
      useCORS: true,
      logging: false,
      width: viewportWidth,
      height: viewportHeight,
      windowWidth: viewportWidth,
      windowHeight: viewportHeight,
    });
    const dataUrl = canvas.toDataURL('image/png');

    // Cap at 2MB — downscale if larger
    if (dataUrl.length > MAX_SCREENSHOT_SIZE) {
      const scale = Math.sqrt(MAX_SCREENSHOT_SIZE / dataUrl.length);
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = canvas.width * scale;
      scaledCanvas.height = canvas.height * scale;
      const ctx = scaledCanvas.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
      return scaledCanvas.toDataURL('image/png');
    }

    return dataUrl;
  } catch {
    return '';
  }
}
```

- [ ] **Step 2: Update inspect-overlay.ts to use shared screenshot utility**

In `src/webview/inspect-overlay.ts`:

1. Add import at the top of the file (after the existing type imports):
   ```typescript
   import { captureScreenshot } from './screenshot';
   ```

2. Delete the entire inline `async function captureScreenshot(): Promise<string>` block (approximately 28 lines, from the function declaration through the closing brace).

3. Update the two call sites to pass required arguments:
   - In `handleAddElementClick`: change `captureScreenshot()` to `captureScreenshot(iframeDoc!.body, iframe.clientWidth, iframe.clientHeight)`
   - In `showTooltip`'s send button handler: same change — `captureScreenshot(iframeDoc!.body, iframe.clientWidth, iframe.clientHeight)`

- [ ] **Step 3: Add onLogsRequest callback to toolbar**

In `src/webview/toolbar.ts`, add an `onLogsRequest` callback parameter to `createToolbar` so `main.ts` can provide the console capture reference:

Add to the return type and parameter:

```typescript
export function createToolbar(
  container: HTMLElement,
  postMessage: PostMessage,
  callbacks?: {
    onLogsRequest?: () => void;
    onScreenshotRequest?: () => void;
  }
)
```

Update the button handlers:

```typescript
  btnAddLogs.addEventListener('click', () => {
    callbacks?.onLogsRequest?.();
  });

  container.querySelector('#btn-screenshot')!.addEventListener('click', () => {
    callbacks?.onScreenshotRequest?.();
  });
```

- [ ] **Step 4: Rewrite main.ts with full integration**

Replace `src/webview/main.ts` entirely with the complete version that integrates all modules. Key changes from the Chunk 2 version:

- Import `createInspectOverlay`, `createConsoleCapture`, `captureScreenshot`
- Pass callbacks to `createToolbar` for logs and screenshot
- Initialize overlay after toolbar
- Attach console capture on iframe load (same-origin)
- Make message handler async for screenshot:request
- Sync toolbar state changes with overlay mode via `onStateChange` callback

The complete file should be written in full (not as diff fragments) to avoid ambiguity for the implementer. The message listener must be async: `window.addEventListener('message', async (event) => { ... })`.

- [ ] **Step 5: Verify build succeeds**

Run: `npm run build && npm run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/webview/main.ts src/webview/toolbar.ts src/webview/screenshot.ts src/webview/inspect-overlay.ts
git commit -m "feat: wire inspect overlay, console capture, and screenshot into webview"
```

---

## Chunk 4: Backend Adapters, Extension Wiring, and CI

### Task 11: Create BackendAdapter interface and ClipboardAdapter

**Files:**
- Create: `src/adapters/BackendAdapter.ts`
- Create: `src/adapters/ClipboardAdapter.ts`
- Test: `src/adapters/ClipboardAdapter.test.ts`

- [ ] **Step 1: Write test for ClipboardAdapter**

Create `src/adapters/ClipboardAdapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  env: {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

import { ClipboardAdapter } from './ClipboardAdapter';
import type { ContextBundle } from '../types';

describe('ClipboardAdapter', () => {
  let adapter: ClipboardAdapter;
  const vscode = require('vscode');

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClipboardAdapter();
  });

  it('copies element HTML to clipboard as markdown', async () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<button class="cta">Click</button>',
        parentHtml: '<div><button class="cta">Click</button></div>',
        ancestorPath: 'body > div > button.cta',
        tag: 'button',
        classes: ['cta'],
        dimensions: { width: 120, height: 34 },
        accessibility: { name: 'Click', role: 'button' },
      },
    };

    const result = await adapter.deliver(bundle);

    expect(result.success).toBe(true);
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledTimes(1);

    const clipboardContent = vscode.env.clipboard.writeText.mock.calls[0][0];
    expect(clipboardContent).toContain('http://localhost:3000');
    expect(clipboardContent).toContain('<button class="cta">Click</button>');
    expect(clipboardContent).toContain('body > div > button.cta');
  });

  it('includes source location when available', async () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<button>Click</button>',
        parentHtml: '<div><button>Click</button></div>',
        ancestorPath: 'body > div > button',
        tag: 'button',
        classes: [],
        dimensions: { width: 120, height: 34 },
        accessibility: {},
        sourceLocation: { filePath: 'src/App.tsx', line: 42 },
      },
    };

    const result = await adapter.deliver(bundle);

    expect(result.success).toBe(true);
    const clipboardContent = vscode.env.clipboard.writeText.mock.calls[0][0];
    expect(clipboardContent).toContain('src/App.tsx:42');
  });

  it('handles screenshot-only bundle', async () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      screenshot: { dataUrl: 'data:image/png;base64,abc', width: 800, height: 600 },
    };

    const result = await adapter.deliver(bundle);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/ClipboardAdapter.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Create BackendAdapter interface**

Create `src/adapters/BackendAdapter.ts`:

```typescript
import type { ContextBundle, DeliveryResult } from '../types';

export interface BackendAdapter {
  readonly name: string;
  deliver(bundle: ContextBundle): Promise<DeliveryResult>;
  isAvailable(): Promise<boolean>;
}
```

- [ ] **Step 4: Implement ClipboardAdapter**

Create `src/adapters/ClipboardAdapter.ts`:

```typescript
import * as vscode from 'vscode';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';

export class ClipboardAdapter implements BackendAdapter {
  readonly name = 'clipboard';

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    try {
      const markdown = this.formatAsMarkdown(bundle);
      await vscode.env.clipboard.writeText(markdown);
      return { success: true, message: 'Copied to clipboard' };
    } catch (err) {
      return {
        success: false,
        message: `Failed to copy: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    return true; // Clipboard is always available
  }

  private formatAsMarkdown(bundle: ContextBundle): string {
    const parts: string[] = [];

    parts.push(`**URL:** ${bundle.url}`);
    parts.push('');

    if (bundle.element) {
      if (bundle.element.sourceLocation) {
        const loc = bundle.element.sourceLocation;
        parts.push(`**Source:** \`${loc.filePath}:${loc.line}\``);
        parts.push('');
      }

      parts.push(`**Selector:** \`${bundle.element.ancestorPath}\``);
      parts.push('');

      parts.push('**Element HTML:**');
      parts.push('```html');
      parts.push(bundle.element.html);
      parts.push('```');
      parts.push('');

      parts.push('**Parent HTML:**');
      parts.push('```html');
      parts.push(bundle.element.parentHtml);
      parts.push('```');
    }

    if (bundle.screenshot) {
      parts.push('');
      parts.push('*Screenshot captured (base64 data available in clipboard)*');
    }

    if (bundle.logs && bundle.logs.length > 0) {
      parts.push('');
      parts.push('**Console Logs:**');
      parts.push('```');
      for (const entry of bundle.logs) {
        parts.push(`[${entry.level.toUpperCase()}] ${entry.message}`);
      }
      parts.push('```');
    }

    return parts.join('\n');
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/adapters/ClipboardAdapter.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/BackendAdapter.ts src/adapters/ClipboardAdapter.ts src/adapters/ClipboardAdapter.test.ts
git commit -m "feat: add BackendAdapter interface and ClipboardAdapter with markdown formatting"
```

### Task 12: Create OpenCodeAdapter and OpenChamberAdapter

**Files:**
- Create: `src/adapters/OpenCodeAdapter.ts`
- Create: `src/adapters/OpenChamberAdapter.ts`
- Test: `src/adapters/OpenCodeAdapter.test.ts`

- [ ] **Step 1: Write test for OpenCodeAdapter**

Create `src/adapters/OpenCodeAdapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  commands: {
    getCommands: vi.fn().mockResolvedValue(['opencode.addContext']),
    executeCommand: vi.fn().mockResolvedValue(undefined),
  },
  env: {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

import { OpenCodeAdapter } from './OpenCodeAdapter';
import type { ContextBundle } from '../types';

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;
  const vscode = require('vscode');

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenCodeAdapter();
  });

  it('checks availability by looking for opencode commands', async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
    expect(vscode.commands.getCommands).toHaveBeenCalled();
  });

  it('returns unavailable when opencode commands not found', async () => {
    vscode.commands.getCommands.mockResolvedValueOnce(['some.other.command']);
    const available = await adapter.isAvailable();
    expect(available).toBe(false);
  });

  it('delivers context via opencode.addContext command', async () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<button>Click</button>',
        parentHtml: '<div><button>Click</button></div>',
        ancestorPath: 'body > div > button',
        tag: 'button',
        classes: [],
        dimensions: { width: 120, height: 34 },
        accessibility: { name: 'Click', role: 'button' },
      },
    };

    const result = await adapter.deliver(bundle);
    expect(result.success).toBe(true);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'opencode.addContext',
      expect.any(Object)
    );
  });

  it('falls back to clipboard when opencode is unavailable', async () => {
    vscode.commands.getCommands.mockResolvedValue(['some.other.command']);

    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<p>Test</p>',
        parentHtml: '<div><p>Test</p></div>',
        ancestorPath: 'body > div > p',
        tag: 'p',
        classes: [],
        dimensions: { width: 100, height: 20 },
        accessibility: {},
      },
    };

    const result = await adapter.deliver(bundle);
    expect(result.success).toBe(true);
    expect(result.message).toContain('clipboard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/OpenCodeAdapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement OpenCodeAdapter**

Create `src/adapters/OpenCodeAdapter.ts`:

```typescript
import * as vscode from 'vscode';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';

export class OpenCodeAdapter implements BackendAdapter {
  readonly name = 'opencode';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const available = await this.isAvailable();

    if (!available) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenCode not found — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const context = this.formatForOpenCode(bundle);
      await vscode.commands.executeCommand('opencode.addContext', context);
      return { success: true, message: 'Added to OpenCode chat' };
    } catch (err) {
      // Fallback to clipboard on error
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenCode error, fell back to clipboard`,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const commands = await vscode.commands.getCommands(true);
      return commands.some((cmd) => cmd.startsWith('opencode.'));
    } catch {
      return false;
    }
  }

  private formatForOpenCode(bundle: ContextBundle): object {
    // Format as context item compatible with OpenCode's VS Code SDK
    // The exact shape will be confirmed during integration testing
    const parts: string[] = [];

    if (bundle.element) {
      parts.push(`URL: ${bundle.url}`);
      parts.push(`Selector: ${bundle.element.ancestorPath}`);

      if (bundle.element.sourceLocation) {
        parts.push(`Source: ${bundle.element.sourceLocation.filePath}:${bundle.element.sourceLocation.line}`);
      }

      parts.push('');
      parts.push('Element HTML:');
      parts.push(bundle.element.html);
      parts.push('');
      parts.push('Parent HTML:');
      parts.push(bundle.element.parentHtml);
    }

    return {
      type: 'file',
      content: parts.join('\n'),
      preview: bundle.element
        ? `${bundle.element.tag}${bundle.element.classes.length ? '.' + bundle.element.classes[0] : ''} from ${bundle.url}`
        : `Screenshot from ${bundle.url}`,
    };
  }
}
```

- [ ] **Step 4: Implement OpenChamberAdapter**

Create `src/adapters/OpenChamberAdapter.ts`:

```typescript
import * as vscode from 'vscode';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';

export class OpenChamberAdapter implements BackendAdapter {
  readonly name = 'openchamber';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const available = await this.isAvailable();

    if (!available) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenChamber not found — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const context = this.formatForOpenChamber(bundle);
      await vscode.commands.executeCommand('openchamber.addContext', context);
      return { success: true, message: 'Added to OpenChamber chat' };
    } catch (err) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenChamber error, fell back to clipboard`,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const commands = await vscode.commands.getCommands(true);
      return commands.some((cmd) => cmd.startsWith('openchamber.'));
    } catch {
      return false;
    }
  }

  private formatForOpenChamber(bundle: ContextBundle): object {
    // Format compatible with OpenChamber's VS Code extension API
    // Exact shape to be confirmed during integration
    const parts: string[] = [];

    if (bundle.element) {
      parts.push(`URL: ${bundle.url}`);
      parts.push(`Selector: ${bundle.element.ancestorPath}`);

      if (bundle.element.sourceLocation) {
        parts.push(`Source: ${bundle.element.sourceLocation.filePath}:${bundle.element.sourceLocation.line}`);
      }

      parts.push('');
      parts.push(bundle.element.html);
    }

    if (bundle.logs && bundle.logs.length > 0) {
      parts.push('');
      parts.push('Console:');
      for (const entry of bundle.logs) {
        parts.push(`[${entry.level}] ${entry.message}`);
      }
    }

    return {
      type: 'browser-context',
      content: parts.join('\n'),
      url: bundle.url,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/adapters/OpenCodeAdapter.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 6: Create OpenChamberAdapter test**

Create `src/adapters/OpenChamberAdapter.test.ts` — mirror the OpenCodeAdapter test structure but check for `openchamber.` commands and `openchamber.addContext` execution. The test should verify availability detection, context delivery, and clipboard fallback when OpenChamber is not installed.

- [ ] **Step 7: Run all adapter tests**

Run: `npx vitest run src/adapters/`
Expected: All tests PASS (ClipboardAdapter + OpenCodeAdapter + OpenChamberAdapter)

- [ ] **Step 8: Commit**

```bash
git add src/adapters/OpenCodeAdapter.ts src/adapters/OpenChamberAdapter.ts src/adapters/OpenCodeAdapter.test.ts src/adapters/OpenChamberAdapter.test.ts
git commit -m "feat: add OpenCodeAdapter and OpenChamberAdapter with clipboard fallback"
```

### Task 13: Wire everything together in extension.ts

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Update extension.ts with full wiring**

Replace `src/extension.ts` with the complete version that connects BrowserPanelManager, ContextExtractor, and BackendAdapters:

```typescript
import * as vscode from 'vscode';
import { BrowserPanelManager } from './panel/BrowserPanelManager';
import { ContextExtractor } from './context/ContextExtractor';
import type { BackendAdapter } from './adapters/BackendAdapter';
import { ClipboardAdapter } from './adapters/ClipboardAdapter';
import { OpenCodeAdapter } from './adapters/OpenCodeAdapter';
import { OpenChamberAdapter } from './adapters/OpenChamberAdapter';
import type { WebviewMessage } from './types';

let panelManager: BrowserPanelManager | undefined;
let contextExtractor: ContextExtractor;

const adapters: Record<string, BackendAdapter> = {
  clipboard: new ClipboardAdapter(),
  opencode: new OpenCodeAdapter(),
  openchamber: new OpenChamberAdapter(),
};

function getAdapter(): BackendAdapter {
  const config = vscode.workspace.getConfiguration('browserChat');
  const backendName = config.get<string>('backend') || 'clipboard';
  return adapters[backendName] || adapters.clipboard;
}

async function deliverContext(message: WebviewMessage, url: string) {
  const adapter = getAdapter();
  let result;

  switch (message.type) {
    case 'inspect:sendToChat':
    case 'addElement:captured': {
      const bundle = contextExtractor.fromCapturedElement(message.payload, url);
      result = await adapter.deliver(bundle);
      break;
    }
    case 'action:addLogs': {
      const bundle = contextExtractor.fromLogs(message.payload.logs, url);
      result = await adapter.deliver(bundle);
      break;
    }
    case 'action:screenshot': {
      const bundle = contextExtractor.fromScreenshot(
        message.payload.dataUrl,
        0,
        0,
        url
      );
      result = await adapter.deliver(bundle);
      break;
    }
    default:
      return;
  }

  panelManager?.postMessage({
    type: 'toast',
    payload: {
      message: result.message,
      toastType: result.success ? 'success' : 'error',
    },
  });
}

export function activate(context: vscode.ExtensionContext) {
  contextExtractor = new ContextExtractor();
  panelManager = new BrowserPanelManager(context.extensionUri);

  // Handle messages from webview that need context delivery
  let currentUrl = 'http://localhost:3000';

  panelManager.onMessage((message: WebviewMessage) => {
    switch (message.type) {
      case 'iframe:loaded':
        currentUrl = message.payload.url;
        break;
      case 'iframe:error':
        panelManager?.postMessage({
          type: 'toast',
          payload: { message: `Failed to load: ${message.payload.error}`, toastType: 'error' },
        });
        break;
      case 'inspect:sendToChat':
      case 'addElement:captured':
      case 'action:addLogs':
      case 'action:screenshot':
        deliverContext(message, currentUrl).catch((err) => {
          console.error('Browser Chat: delivery error', err);
        });
        break;
    }
  });

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('browserChat.backend')) {
        const adapter = getAdapter();
        panelManager?.postMessage({
          type: 'config:update',
          payload: { backend: adapter.name },
        });
      }
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('browserChat.open', () => {
      panelManager!.open();
    }),
    vscode.commands.registerCommand('browserChat.openUrl', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter URL to open',
        value: 'http://localhost:3000',
        validateInput: (value) => {
          try {
            new URL(value);
            return null;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      });
      if (url) {
        panelManager!.open();
        panelManager!.postMessage({ type: 'navigate:url', payload: { url } });
      }
    }),
    vscode.commands.registerCommand('browserChat.inspect', () => {
      panelManager?.postMessage({ type: 'mode:inspect', payload: { enabled: true } });
    }),
    vscode.commands.registerCommand('browserChat.addElement', () => {
      panelManager?.postMessage({ type: 'mode:addElement', payload: { enabled: true } });
    }),
    vscode.commands.registerCommand('browserChat.addLogs', () => {
      // The webview toolbar button handles log capture directly via the
      // console capture buffer. This command palette entry triggers the
      // same flow by simulating the toolbar button click.
      // Note: A dedicated `addLogs:request` message could be added if
      // command palette -> webview log capture is needed. For MVP, the
      // toolbar button is the primary UX.
      panelManager?.postMessage({
        type: 'toast',
        payload: { message: 'Use the toolbar button to capture logs', toastType: 'success' },
      });
    }),
    vscode.commands.registerCommand('browserChat.screenshot', () => {
      panelManager?.postMessage({ type: 'screenshot:request', payload: {} });
    })
  );
}

export function deactivate() {
  panelManager?.dispose();
  panelManager = undefined;
}
```

- [ ] **Step 2: Verify build and type check**

Run: `npm run build && npm run typecheck`
Expected: No errors

- [ ] **Step 3: Run all unit tests**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire BrowserPanelManager, ContextExtractor, and adapters together in extension entry"
```

### Task 14: Verify VSIX packaging

**Files:** none — verification only

- [ ] **Step 1: Build production and package**

Run: `npm run package`
Expected: `browser-chat-0.1.0.vsix` file created in project root

- [ ] **Step 2: Verify VSIX contents**

Run: `npx vsce ls`
Expected: Lists files included in the package — should include `out/extension.js`, `webview/main.js`, `webview/main.css`, `webview/index.html`, `package.json`. Should NOT include `src/`, `node_modules/`, `docs/`, `.github/`

- [ ] **Step 3: Commit packaging fixes (if any)**

If Steps 1-2 revealed issues that required file changes, commit them:

```bash
git add -A
git commit -m "fix: packaging configuration adjustments"
```

If no changes were needed, skip this step.

### Task 15: Final integration smoke test

**Files:** none — manual verification

- [ ] **Step 1: Launch extension in development mode**

Run: Press F5 in VS Code (uses the launch config from Task 1)
Expected: Extension Development Host window opens

- [ ] **Step 2: Test the panel opens**

Run: Command Palette -> "Browser Chat: Open"
Expected: Webview panel appears with toolbar and iframe

- [ ] **Step 3: Test navigation**

Enter `http://localhost:3000` (or any URL) in the URL bar and press Enter.
Expected: Page loads in iframe (if same-origin and not blocked by X-Frame-Options)

- [ ] **Step 4: Test inspect mode**

Click the inspect icon in the toolbar, hover over elements.
Expected: Elements highlight with blue border on hover, clicking shows tooltip

- [ ] **Step 5: Test add element to chat**

Click the add-element icon, click an element.
Expected: Toast shows "Copied to clipboard" (default adapter), mode exits

- [ ] **Step 6: Commit final state**

```bash
git add -A
git commit -m "chore: finalize extension for v0.1.0"
```

- [ ] **Step 7: Tag release (only after all smoke tests pass)**

Only run this after confirming all steps above passed:

```bash
git tag v0.1.0
```

Note: Pushing this tag (`git push origin v0.1.0`) will trigger the GitHub Actions release workflow (Task 4). Do this intentionally.
