# Contributing to Web Lens

Thanks for your interest in contributing to Web Lens! This guide covers everything you need to get started.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [VS Code](https://code.visualstudio.com/) 1.85 or later
- npm (comes with Node.js)

### Setup

```bash
git clone <repo-url>
cd vscode-browser-chat
npm install
npm run build
```

### Running the Extension

Press **F5** in VS Code to launch the Extension Development Host with the extension loaded. This runs the `npm run build` task automatically before launching.

## Development Workflow

### Available Scripts

| Script | Description |
|---|---|
| `npm run build` | Build extension + webview + inject script (dev mode, with sourcemaps) |
| `npm run build:prod` | Production build (minified, no sourcemaps) |
| `npm run typecheck` | Run TypeScript type checking for both extension host and webview code |
| `npm run lint` | Run ESLint on `src/` |
| `npm test` | Run all tests (unit + integration) |
| `npm run test:unit` | Run unit tests only (vitest) |
| `npm run test:integration` | Run VS Code integration tests only |
| `npm run package` | Production build + package as `.vsix` |

### Build System

The project uses [esbuild](https://esbuild.github.io/) to produce three bundles:

1. **Extension host** -- `src/extension.ts` -> `out/extension.js` (Node.js, CJS)
2. **Webview** -- `src/webview/main.ts` -> `webview/main.js` (browser, IIFE)
3. **Inject script** -- `src/webview/inject.ts` -> `out/inject.js` (browser, IIFE)

### Project Structure

```
src/
  extension.ts          # Extension entry point
  types.ts              # Shared type definitions
  adapters/             # Backend delivery adapters (one per AI tool)
  context/              # Page context extraction logic
  panel/                # Webview panel management
  proxy/                # Local reverse proxy server
  webview/              # Code running in the webview and injected pages
webview/                # Webview HTML/CSS (and built JS output)
media/icons/            # Backend selector SVG icons
```

## Code Style

- **TypeScript** with `strict: true` enabled
- **ESLint** with `@typescript-eslint` rules -- run `npm run lint` to check
- Prefix unused function parameters with `_` (e.g., `_event`)
- No Prettier or EditorConfig is configured -- follow the style of surrounding code

## Testing

Unit tests are colocated with source files using the `*.test.ts` naming convention and run with [vitest](https://vitest.dev/).

```bash
# Run unit tests
npm run test:unit

# Run all tests (unit + integration)
npm test
```

When adding new functionality, include unit tests alongside the source file. For example, if you add `src/adapters/FooAdapter.ts`, add `src/adapters/FooAdapter.test.ts` next to it.

Tests mock the `vscode` module using `vi.mock('vscode', ...)`.

## Making Changes

1. **Create a branch** off `main` for your work.
2. **Make your changes** -- keep commits focused and well-described.
3. **Run checks before submitting:**
   ```bash
   npm run lint
   npm run typecheck
   npm test
   ```
   These same checks run in CI on release tags.
4. **Open a pull request** against `main` with a clear description of what changed and why.

## Architecture Overview

- **BackendAdapter interface** (`src/adapters/BackendAdapter.ts`) -- each AI backend implements `name`, `deliver()`, and `isAvailable()`. To add a new backend, create a new adapter implementing this interface.
- **ContextBundle** (`src/types.ts`) -- the data structure passed to backends, containing URL, timestamp, element data, screenshot, and console logs.
- **ProxyServer** (`src/proxy/ProxyServer.ts`) -- a local reverse proxy that strips CSP/X-Frame-Options headers so pages render in the VS Code webview iframe.
- **Inject script** (`src/webview/inject.ts`) -- injected into target pages by the proxy to enable element inspection, DOM extraction, console capture, and screenshots.

## Reporting Issues

If you find a bug or have a feature request, please open an issue with:

- A clear description of the problem or suggestion
- Steps to reproduce (for bugs)
- Your VS Code version and OS

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
