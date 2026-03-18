# Browser Chat — VS Code Extension Design

## Overview

A VS Code extension that embeds a browser panel in the editor, enabling developers to browse their running application, inspect elements, capture context (HTML + screenshots), and send it directly to an AI coding agent. Primary use cases: web development feedback loops and visual QA/bug reporting.

## Architecture

**Approach: Monolithic Webview with iframe.**

A single webview panel contains a minimal toolbar at the top and an iframe below it that loads the target URL. All inspection logic runs inside the webview for low-latency interaction. Heavy operations (formatting context, delivering to backends) delegate to the extension host via `postMessage`.

### System Components

**Extension Host (Node.js):**

- **BrowserPanelManager** — creates and manages the webview panel lifecycle, handles commands, persists state across panel hide/show
- **ContextExtractor** — receives raw DOM data and screenshots from the webview, assembles them into a `ContextBundle`
- **BackendAdapter** (interface) — abstract interface for delivering context to AI agents. Method: `deliver(bundle: ContextBundle): Promise<void>`

**Backend Adapters (all shipped together):**

- **OpenCodeAdapter** — targets OpenCode's VS Code SDK context hooks
- **OpenChamberAdapter** — targets OpenChamber's VS Code integration
- **ClipboardAdapter** — universal fallback, copies formatted markdown to clipboard. This is the default

The user selects the active backend via `browserChat.backend` in extension settings.

**Webview Panel:**

- **Toolbar** — minimal chrome: back/forward/reload icons, URL bar, action icons (inspect, add element to chat, add logs to chat, screenshot, overflow menu). Icon-only buttons using Material icons, matching VS Code's dark theme
- **iframe** — loads the target URL
- **InspectOverlay.js** — injected into same-origin iframes. Provides hover-highlight and click-select behavior for element inspection

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Extension Host (Node.js)                                │
│                                                         │
│  ┌─────────────────────┐  ┌──────────────────────────┐  │
│  │ BrowserPanelManager │  │ ContextExtractor         │  │
│  │                     │  │                          │  │
│  │ - panel lifecycle   │  │ - assembles ContextBundle│  │
│  │ - command handling  │  │ - graceful degradation   │  │
│  │ - state persistence │  │                          │  │
│  └─────────────────────┘  └──────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ BackendAdapter (interface)                          ││
│  │  ├── OpenCodeAdapter                               ││
│  │  ├── OpenChamberAdapter                            ││
│  │  └── ClipboardAdapter (default)                    ││
│  └─────────────────────────────────────────────────────┘│
└──────────────────┬──────────────────────────────────────┘
                   │ postMessage protocol
┌──────────────────▼──────────────────────────────────────┐
│ Webview Panel (Editor Tab)                              │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Toolbar                                            ││
│  │ [←] [→] [↻]  [ URL bar                ] [actions] ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │ iframe (target URL)                                ││
│  │                                                    ││
│  │   ┌─────────────────────────┐                      ││
│  │   │ InspectOverlay.js       │ (same-origin only)   ││
│  │   │ - hover highlight       │                      ││
│  │   │ - click select          │                      ││
│  │   │ - DOM extraction        │                      ││
│  │   │ - source location lookup│                      ││
│  │   └─────────────────────────┘                      ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

## Panel UI

### Toolbar

Minimal icon-only toolbar (~34px height) matching VS Code's dark theme:

**Left group:** back, forward, reload (Material icons: `arrow_back`, `arrow_forward`, `refresh`)

**Center:** URL bar — editable input, Enter to navigate, displays current iframe URL

**Right group:** action icons separated by a thin divider from the overflow menu:
- `select` — Inspect element (toggle)
- `add_comment` — Add element to chat (toggle, one-shot)
- `terminal` — Add logs to chat
- `screenshot_monitor` — Screenshot visible panel
- `more_vert` — Overflow menu (settings, copy HTML, clear selection)

All icons are borderless, 28x28px hit area. Hover shows subtle background. Active state uses VS Code accent blue (`#007acc`) background tint and icon color.

### Theme

All accent colors use VS Code blue `#007acc` consistently:
- Active toolbar icons: `rgba(0, 122, 204, 0.15)` background, `#007acc` icon color
- Toolbar bottom border in active mode: `#007acc`
- Page selection overlay: 2px solid `#007acc` border, `rgba(0, 122, 204, 0.18)` background tint
- Tooltip tag name text: `#007acc`

## Inspect Modes

Two modes share the same hover-highlight overlay but differ in click behavior:

### Inspect Element Mode

Activated by the `select` toolbar icon. For exploring and examining the DOM.

1. Hover highlights elements with solid `#007acc` border + light blue tint
2. Click selects the element and shows a **tooltip popover** anchored below the element
3. Tooltip shows: `tag.class` identifier, dimensions, accessibility metadata (name, role, focusable)
4. Tooltip includes an "Add to chat" button that captures HTML + screenshot and sends to the active backend
5. Stays in inspect mode after sending — user can keep inspecting or sending multiple elements
6. ESC or clicking the toolbar icon again exits the mode

### Add Element to Chat Mode

Activated by the `add_comment` toolbar icon. For quick one-shot capture.

1. Blue instruction banner appears below toolbar: "Click any element to add it to chat" with "ESC to cancel"
2. Hover highlights elements with **dashed** `#007acc` border + light blue tint (visual distinction from inspect mode)
3. Click immediately captures HTML + screenshot, sends to the active backend, and auto-exits the mode
4. No tooltip — the action is immediate

### Element Tooltip

Dark popover (`#1e1e1e` background) positioned below the selected element:
- **Line 1:** `tag.classname` in monospace blue + dimensions in gray (e.g., `button.cta-button  120 x 34`)
- **Accessibility section:** key-value rows for name, role, focusable status
- **"Add to chat" button:** full-width blue button at the bottom (inspect mode only)

## Message Protocol

All messages use a discriminated union: `{ type: string, payload: T }`.

### Webview -> Extension Host

| Type | Payload | Trigger |
|------|---------|---------|
| `navigate` | `{ url: string }` | URL bar submission |
| `nav:back` | `{}` | Back button |
| `nav:forward` | `{}` | Forward button |
| `nav:reload` | `{}` | Reload button |
| `inspect:selected` | `{ html, tag, classes, dimensions, accessibility }` | Click in inspect mode |
| `inspect:sendToChat` | `{ html, metadata }` | Tooltip "Add to chat" button |
| `addElement:captured` | `{ html, tag, classes, dimensions, accessibility, screenshotDataUrl }` | Click in add-element mode |
| `action:addLogs` | `{ logs: ConsoleEntry[] }` | "Add logs" button |
| `action:screenshot` | `{ dataUrl: string }` | "Screenshot" button |
| `iframe:loaded` | `{ url, title, canInject: boolean }` | iframe load complete |
| `iframe:error` | `{ url, error: string }` | iframe load failure |

### Extension Host -> Webview

| Type | Payload | Trigger |
|------|---------|---------|
| `navigate:url` | `{ url: string }` | Extension commands navigation |
| `mode:inspect` | `{ enabled: boolean }` | Toggle inspect mode |
| `mode:addElement` | `{ enabled: boolean }` | Toggle add-element mode |
| `screenshot:request` | `{}` | Request screenshot capture |
| `config:update` | `{ backend: string }` | Backend setting changed |
| `toast` | `{ message, type: 'success' \| 'error' }` | Feedback after actions |

## Context Bundle

The data package sent to the AI agent:

```typescript
interface ContextBundle {
  url: string;
  timestamp: number;

  element?: {
    html: string;           // outerHTML of selected element
    parentHtml: string;     // parent outerHTML, siblings collapsed to <!-- N siblings -->
    ancestorPath: string;   // "body > div.app > main > section.hero > button.cta"
    tag: string;
    classes: string[];
    id?: string;
    dimensions: { width: number; height: number };
    accessibility: {
      name?: string;
      role?: string;
      focusable?: boolean;
    };
    sourceLocation?: {
      filePath: string;     // "src/components/Hero.tsx"
      line: number;
      column?: number;
    };
  };

  screenshot: {
    dataUrl: string;        // base64 PNG
    width: number;
    height: number;
  };

  logs?: ConsoleEntry[];
}

interface ConsoleEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  timestamp: number;
}
```

### Source Location Detection

The injected InspectOverlay script attempts to read framework debug metadata from DOM nodes — a simple property lookup, not inference:

- **React:** `__reactFiber$*` property -> `_debugSource.fileName` + `_debugSource.lineNumber`
- **Vue:** `__vue__` or `__vueParentComponent` -> `__file` property
- **Svelte:** dev-mode source annotations
- **Angular:** `ng.getComponent()` debug info

This works only in development builds (where frameworks annotate DOM nodes with source info) and only for same-origin iframes. The field is optional — if detection fails, it's omitted silently. MVP implements React detection; others follow in later iterations.

### Extraction by Origin

| Scenario | HTML | Screenshot | Console | Source location |
|----------|------|------------|---------|-----------------|
| Same-origin | Full outerHTML + parent | html2canvas on iframe | console.* proxy | Framework metadata lookup |
| Cross-origin | `document.activeElement` only | html2canvas on webview | Not available | Not available |
| iframe blocked | None | Screenshot of error state | Not available | Not available |

The system always captures what it can. Partial bundles are valid — the backend adapter formats whatever is available.

## Extension Configuration

### Settings (`contributes.configuration`)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `browserChat.backend` | `enum` | `"clipboard"` | `"opencode"`, `"openchamber"`, `"clipboard"` |
| `browserChat.defaultUrl` | `string` | `"http://localhost:3000"` | URL loaded on panel open |
| `browserChat.screenshotFormat` | `enum` | `"png"` | `"png"` or `"jpeg"` |
| `browserChat.screenshotQuality` | `number` | `0.9` | JPEG quality (0-1) |

### Commands (`contributes.commands`)

| Command | Title |
|---------|-------|
| `browserChat.open` | Browser Chat: Open |
| `browserChat.openUrl` | Browser Chat: Open URL |
| `browserChat.inspect` | Browser Chat: Inspect Element |
| `browserChat.addElement` | Browser Chat: Add Element to Chat |
| `browserChat.addLogs` | Browser Chat: Add Logs to Chat |
| `browserChat.screenshot` | Browser Chat: Screenshot |

### Activation

`onCommand:browserChat.open` — extension activates only when the user first opens the panel.

## Known Limitations

1. **iframe restrictions:** Sites with `X-Frame-Options: DENY` or restrictive CSP headers won't load in the iframe. This is acceptable for the primary use case (localhost dev servers) where the developer controls headers.
2. **Cross-origin DOM access:** Script injection and full HTML extraction only work for same-origin iframes. Cross-origin falls back to limited `document.activeElement` + screenshot.
3. **Console log capture:** Only available for same-origin iframes where the console proxy can be injected.
4. **Source location:** Only available in development builds of supported frameworks (React for MVP). Production builds strip debug annotations.
5. **Screenshot fidelity:** html2canvas renders an approximation of the page — complex CSS (filters, backdrop-blur, some transforms) may not render perfectly.

## Project Structure

```
vscode-browser-chat/
├── src/
│   ├── extension.ts              # Entry point, command registration
│   ├── panel/
│   │   └── BrowserPanelManager.ts
│   ├── context/
│   │   └── ContextExtractor.ts
│   ├── adapters/
│   │   ├── BackendAdapter.ts     # Interface
│   │   ├── OpenCodeAdapter.ts
│   │   ├── OpenChamberAdapter.ts
│   │   └── ClipboardAdapter.ts
│   └── webview/
│       ├── toolbar.ts
│       ├── inspect-overlay.ts
│       └── console-capture.ts
├── webview/                       # Static assets served to webview
│   ├── index.html
│   ├── main.css
│   └── main.js
├── package.json                   # Extension manifest
├── tsconfig.json
└── esbuild.config.js
```

## Technology Choices

- **Language:** TypeScript
- **Bundler:** esbuild (fast, standard for VS Code extensions)
- **Screenshot:** html2canvas (no external deps, runs in webview)
- **Icons:** Material Symbols Outlined (loaded in webview, codicons for extension-level UI)
- **Testing:** @vscode/test-cli + Mocha for integration tests, vitest for unit tests
