<p align="center">
  <img src="media/logo/weblens-logo-banner.png" alt="Web Lens for VS Code" style="width:600px; max-width:100%; height:auto;" />
</p>

<p align="center">
  <em>Inspect elements, annotate screenshots, record user flows, and capture console logs, all without leaving VS Code.</em>
</p>

<p align="center">
  <a href="https://github.com/collectiveai-team/vscode-web-lens/releases"><img alt="Release" src="https://img.shields.io/github/v/release/collectiveai-team/vscode-web-lens?logo=github" /></a>
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/VS%20Code-^1.85.0-blue?logo=visualstudiocode" alt="VS Code"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

---
**VS Code Marketplace**: [Web Lens](https://marketplace.visualstudio.com/items?itemName=collectiveai.web-lens) 

**Source Code**: [https://github.com/collectiveai-team/vscode-web-lens](https://github.com/collectiveai-team/vscode-web-lens)


---

<!-- Embedded browser for sending page context to AI coding agents — inspect elements, annotate screenshots, record user flows, and capture console logs, all without leaving VS Code. -->
WebLens is an embedded browser for sending page context to AI coding agents 

The key features are:
- **Embedded browser panel** — Browse your web app inside a VS Code tab with full navigation (back, forward, reload, URL bar)
- **Inspect Element** — Click any element to see its tag, classes, dimensions, and accessibility info
- **Add Element to Chat** — Send an element's full context (HTML, styles, attributes, ancestor path, React source location) to your AI agent
- **Annotate Screenshot** — Draw arrows, shapes, callouts, and text on top of a screenshot, then send the annotated image with a prompt to your AI agent
- **Record User Actions** — Capture clicks, inputs, scroll, and navigation as a structured JSON event log — ready to feed to an AI agent for generating automated tests
- **Add Logs to Chat** — Capture console output (log, warn, error) from the embedded page and deliver it as context
- **Screenshot** — Take a screenshot of the current page and send it to your AI agent
- **Multi-agent support** — Deliver context to [OpenCode](https://opencode.ai), [OpenChamber](https://github.com/AiCodeCraft/openchamber), [Claude Code](https://claude.ai/code), [Codex](https://chatgpt.com/codex), or the clipboard
- **Theme-aware UI** — Adapts to your VS Code light/dark theme

## How It Works

Web Lens runs a local reverse proxy that loads your web app inside a VS Code webview iframe:

1. A local HTTP proxy fetches target pages and injects an inspection script
2. The inject script enables element selection, DOM extraction, console capture, screenshot capture, and user action recording inside the target page
3. When you inspect, annotate, or capture context, the extension bundles it (HTML, styles, screenshot, logs) and delivers it to your selected AI agent
4. Context is saved as temporary files (`.txt` and `.png`) in a configurable directory, auto-cleaned after 1 hour

The proxy strips `Content-Security-Policy` and `X-Frame-Options` headers so pages render correctly in the iframe.

## Agent Integrations

Web Lens integrates with five backends. The toolbar shows availability status for each — if the selected backend is unavailable, it falls back to the clipboard.

| Agent | Extension | Delivery Method |
|-------|-----------|-----------------|
| **OpenCode** | `anomalyco.opencode` | HTTP API with `@file` references |
| **OpenChamber** | `fedaykindev.openchamber` | `openchamber.addToContext` command |
| **Claude Code** | `anthropic.claude-code` | `claude-vscode.insertAtMention` command |
| **Codex** | `openai.chatgpt` | `chatgpt.addToThread` command |
| **Clipboard** | — | Copies file paths to clipboard (always available) |

## Requirements

- VS Code 1.85.0+
- A running web app to inspect (defaults to `http://localhost:3000`)

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `webLens.backend` | `"clipboard"` | Active backend: `opencode`, `openchamber`, `claudecode`, `codex`, `clipboard` |
| `webLens.defaultUrl` | `"http://localhost:3000"` | URL loaded when the browser panel opens |
| `webLens.screenshotFormat` | `"png"` | Screenshot format: `png` or `jpeg` |
| `webLens.screenshotQuality` | `0.9` | JPEG quality (0.1–1.0), ignored for PNG |
| `webLens.contextDirectory` | `".tmp"` | Directory for context files (relative paths resolve from workspace root) |

## Commands

| Command | Description |
|---------|-------------|
| **Web Lens: Open** | Open the browser panel |
| **Web Lens: Open URL** | Open a specific URL in the browser panel |
| **Web Lens: Inspect Element** | Enter element inspection mode |
| **Web Lens: Add Element to Chat** | Click an element to send its context to your AI agent |
| **Web Lens: Add Logs to Chat** | Send captured console logs to your AI agent |
| **Web Lens: Screenshot** | Take a screenshot and send it to your AI agent |
| **Web Lens: Toggle Recording** | Start or stop a user action recording session |

The **Annotate Screenshot** button is available directly in the browser panel toolbar.

## Recording User Actions

Use **Web Lens: Toggle Recording** (or the record button in the toolbar) to capture what you do in the embedded browser. When you stop, the session is saved as a JSON file in `.weblens-recordings/` at your workspace root:

```
.weblens-recordings/
  1712345678-localhost.json   ← clicks, inputs, scroll, navigation events
```

Feed this file to your AI agent to generate automated tests, reproduce bugs, or document flows.

## Troubleshooting

### Panel shows a blank page
- Check if your web app is running at the configured URL
- Some pages with strict CSP may not render correctly through the proxy

### Element inspection not working
- Ensure the page has fully loaded before entering inspect mode
- Pages with aggressive iframe-busting scripts may interfere with the inject script

### Context not delivered to AI agent
- Verify the target extension is installed and active
- Check the backend selector dropdown for availability status
- The clipboard fallback always works — check your clipboard if delivery fails

## Development

```bash
npm install        # Install dependencies
npm run build      # Build extension + webview + inject script
npm run typecheck  # Run TypeScript type checking
npm run lint       # Run ESLint
npm run test:unit  # Run unit tests (vitest)
npm run test       # Run all tests (unit + integration)
npm run package    # Build and package as .vsix
```

## License

MIT
