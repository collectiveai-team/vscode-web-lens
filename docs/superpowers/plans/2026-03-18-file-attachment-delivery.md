# File Attachment Delivery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inline text delivery with `@` file references so browser context appears as proper file attachments in OpenCode and OpenChamber.

**Architecture:** Save context data and screenshots to a configurable workspace directory (`.tmp/` by default), then inject short `@path` references via each adapter's delivery mechanism. Shared file utilities handle saving, formatting, and cleanup. Webview capture is expanded to include attributes, dimensions, inner text, and computed styles.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, Node.js `fs`/`path`/`os`

**Spec:** `docs/superpowers/specs/2026-03-18-file-attachment-delivery-design.md`

---

## Chunk 1: Types, Shared Utilities, and Setting

### File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts` | Modify | Widen `dimensions`, add new fields to `CapturedElementPayload` and `ElementContext` |
| `src/adapters/contextFiles.ts` | Create | `resolveContextDir()`, `saveContextFiles()`, `formatContextFile()`, `cleanupOldFiles()`, `buildAtReferences()` |
| `src/adapters/contextFiles.test.ts` | Create | Unit tests for all shared utilities |
| `package.json` | Modify | Add `browserChat.contextDirectory` setting |

---

### Task 1: Widen types for expanded element data

**Files:**
- Modify: `src/types.ts:39-85`
- Modify: `src/context/ContextExtractor.test.ts`

- [ ] **Step 1: Update `CapturedElementPayload` type**

In `src/types.ts`, widen `dimensions` and add new optional fields:

```typescript
// src/types.ts lines 43-53 — replace with:
export interface CapturedElementPayload {
  html: string;
  tag: string;
  classes: string[];
  dimensions: { top: number; left: number; width: number; height: number };
  accessibility: AccessibilityInfo;
  parentHtml: string;
  ancestorPath: string;
  sourceLocation?: SourceLocation;
  screenshotDataUrl: string;
  attributes?: Record<string, string>;
  innerText?: string;
  computedStyles?: Record<string, string>;
}
```

- [ ] **Step 2: Update `InspectSelectedPayload` type**

In `src/types.ts`, widen dimensions (backward-compatible — tooltip only reads width/height):

```typescript
// src/types.ts lines 35-41 — replace with:
export interface InspectSelectedPayload {
  html: string;
  tag: string;
  classes: string[];
  dimensions: { top: number; left: number; width: number; height: number };
  accessibility: AccessibilityInfo;
}
```

- [ ] **Step 3: Update `ElementContext` type**

In `src/types.ts`, widen dimensions and add new fields:

```typescript
// src/types.ts lines 75-85 — replace with:
export interface ElementContext {
  html: string;
  parentHtml: string;
  ancestorPath: string;
  tag: string;
  classes: string[];
  id?: string;
  dimensions: { top: number; left: number; width: number; height: number };
  accessibility: AccessibilityInfo;
  sourceLocation?: SourceLocation;
  attributes?: Record<string, string>;
  innerText?: string;
  computedStyles?: Record<string, string>;
}
```

- [ ] **Step 4: Update test fixtures for widened dimensions**

The widened `dimensions` type now requires `{ top, left, width, height }`. Update all test fixtures in these files:

- `src/context/ContextExtractor.test.ts` — all `dimensions: { width: X, height: Y }` → `dimensions: { top: 0, left: 0, width: X, height: Y }`
- `src/adapters/OpenCodeAdapter.test.ts` — same update (line 50)
- `src/adapters/OpenChamberAdapter.test.ts` — same update (line 54)
- `src/adapters/ClipboardAdapter.test.ts` — same update (lines 35, 63)

- [ ] **Step 5: Run tests to verify no breakage**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/context/ContextExtractor.test.ts src/adapters/OpenCodeAdapter.test.ts src/adapters/OpenChamberAdapter.test.ts src/adapters/ClipboardAdapter.test.ts
git commit -m "feat: widen types for expanded element data capture"
```

---

### Task 2: Add `browserChat.contextDirectory` setting

**Files:**
- Modify: `package.json:23-51` (contributes.configuration section)

- [ ] **Step 1: Add the setting to package.json**

Add after the `browserChat.screenshotQuality` entry in the `contributes.configuration.properties` object:

```json
"browserChat.contextDirectory": {
  "type": "string",
  "default": ".tmp",
  "description": "Directory for context files (screenshots and element data). Relative paths resolve from workspace root. Absolute paths used as-is."
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "feat: add browserChat.contextDirectory setting"
```

---

### Task 3: Create shared file utilities — `formatContextFile()`

**Files:**
- Create: `src/adapters/contextFiles.ts`
- Create: `src/adapters/contextFiles.test.ts`

- [ ] **Step 1: Write failing test for `formatContextFile()` with element bundle**

```typescript
// src/adapters/contextFiles.test.ts
import { describe, it, expect } from 'vitest';
import { formatContextFile } from './contextFiles';
import type { ContextBundle } from '../types';

describe('formatContextFile', () => {
  it('formats element bundle with all fields', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<div class="banner">Hello</div>',
        parentHtml: '<main><div class="banner">Hello</div></main>',
        ancestorPath: 'body > main > div.banner',
        tag: 'div',
        classes: ['banner'],
        dimensions: { top: 86, left: 252, width: 789, height: 71 },
        accessibility: { role: 'alert' },
        attributes: { class: 'banner', role: 'alert' },
        innerText: 'Hello',
        computedStyles: { display: 'flex', color: 'rgb(0, 0, 0)' },
      },
    };

    const text = formatContextFile(bundle);

    expect(text).toContain('Browser Chat Context from http://localhost:3000');
    expect(text).toContain('Element: div.banner');
    expect(text).toContain('Selector: body > main > div.banner');
    expect(text).toContain('Attributes:');
    expect(text).toContain('- class: banner');
    expect(text).toContain('- role: alert');
    expect(text).toContain('Dimensions:');
    expect(text).toContain('- top: 86px');
    expect(text).toContain('- width: 789px');
    expect(text).toContain('Inner Text:');
    expect(text).toContain('Hello');
    expect(text).toContain('Computed Styles:');
    expect(text).toContain('- display: flex');
    expect(text).toContain('Element HTML:');
    expect(text).toContain('<div class="banner">Hello</div>');
    expect(text).toContain('Parent HTML:');
    expect(text).toContain('<main><div class="banner">Hello</div></main>');
  });

  it('formats element label with id when present', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<div id="main">Test</div>',
        parentHtml: '<body><div id="main">Test</div></body>',
        ancestorPath: 'body > div#main',
        tag: 'div',
        classes: [],
        id: 'main',
        dimensions: { top: 0, left: 0, width: 100, height: 50 },
        accessibility: {},
      },
    };

    const text = formatContextFile(bundle);
    expect(text).toContain('Element: div#main');
  });

  it('includes source location when available', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<button>Click</button>',
        parentHtml: '<div><button>Click</button></div>',
        ancestorPath: 'body > div > button',
        tag: 'button',
        classes: [],
        dimensions: { top: 0, left: 0, width: 100, height: 34 },
        accessibility: {},
        sourceLocation: { filePath: 'src/App.tsx', line: 42 },
      },
    };

    const text = formatContextFile(bundle);
    expect(text).toContain('Source: @src/App.tsx#L42');
  });

  it('omits sections when data is missing', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<p>Test</p>',
        parentHtml: '<div><p>Test</p></div>',
        ancestorPath: 'body > div > p',
        tag: 'p',
        classes: [],
        dimensions: { top: 0, left: 0, width: 100, height: 20 },
        accessibility: {},
        // No attributes, innerText, computedStyles, sourceLocation
      },
    };

    const text = formatContextFile(bundle);
    expect(text).not.toContain('Attributes:');
    expect(text).not.toContain('Inner Text:');
    expect(text).not.toContain('Computed Styles:');
    expect(text).not.toContain('Source:');
  });

  it('includes console logs when present', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      logs: [
        { level: 'error', message: 'Uncaught TypeError', timestamp: 1000 },
        { level: 'warn', message: 'Deprecated API', timestamp: 1001 },
      ],
    };

    const text = formatContextFile(bundle);
    expect(text).toContain('Console Logs:');
    expect(text).toContain('[ERROR] Uncaught TypeError');
    expect(text).toContain('[WARN] Deprecated API');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/contextFiles.test.ts`

Expected: FAIL — `formatContextFile` not found.

- [ ] **Step 3: Implement `formatContextFile()`**

```typescript
// src/adapters/contextFiles.ts
import type { ContextBundle } from '../types';

/**
 * Formats a ContextBundle as a plain text context file.
 * Follows the structured format from the Integrated Browser reference.
 */
export function formatContextFile(bundle: ContextBundle): string {
  const lines: string[] = [];

  lines.push(`Browser Chat Context from ${bundle.url}`);
  lines.push('');

  if (bundle.element) {
    const el = bundle.element;

    // Element label: tag#id.class1.class2
    let label = el.tag;
    if (el.id) {
      label += `#${el.id}`;
    } else if (el.classes.length > 0) {
      label += '.' + el.classes.join('.');
    }
    lines.push(`Element: ${label}`);
    lines.push(`Selector: ${el.ancestorPath}`);

    if (el.sourceLocation) {
      lines.push(`Source: @${el.sourceLocation.filePath}#L${el.sourceLocation.line}`);
    }
    lines.push('');

    // Attributes
    if (el.attributes && Object.keys(el.attributes).length > 0) {
      lines.push('Attributes:');
      for (const [key, value] of Object.entries(el.attributes)) {
        lines.push(`- ${key}: ${value}`);
      }
      lines.push('');
    }

    // Dimensions
    lines.push('Dimensions:');
    lines.push(`- top: ${el.dimensions.top}px`);
    lines.push(`- left: ${el.dimensions.left}px`);
    lines.push(`- width: ${el.dimensions.width}px`);
    lines.push(`- height: ${el.dimensions.height}px`);
    lines.push('');

    // Inner text
    if (el.innerText) {
      lines.push('Inner Text:');
      lines.push(el.innerText);
      lines.push('');
    }

    // Computed styles
    if (el.computedStyles && Object.keys(el.computedStyles).length > 0) {
      lines.push('Computed Styles:');
      for (const [prop, value] of Object.entries(el.computedStyles)) {
        lines.push(`- ${prop}: ${value}`);
      }
      lines.push('');
    }

    // Element HTML
    lines.push('Element HTML:');
    lines.push(el.html);
    lines.push('');

    // Parent HTML
    if (el.parentHtml) {
      lines.push('Parent HTML:');
      lines.push(el.parentHtml);
      lines.push('');
    }
  }

  // Console logs
  if (bundle.logs && bundle.logs.length > 0) {
    lines.push('Console Logs:');
    for (const entry of bundle.logs) {
      lines.push(`[${entry.level.toUpperCase()}] ${entry.message}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/adapters/contextFiles.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/contextFiles.ts src/adapters/contextFiles.test.ts
git commit -m "feat: add formatContextFile() shared utility"
```

---

### Task 4: Create shared file utilities — `resolveContextDir()`, `saveContextFiles()`, `cleanupOldFiles()`, `buildAtReferences()`

**Files:**
- Modify: `src/adapters/contextFiles.ts`
- Modify: `src/adapters/contextFiles.test.ts`

- [ ] **Step 1: Write failing tests for the remaining utilities**

Update the imports at the top of `src/adapters/contextFiles.test.ts` to include all needed symbols, then add the new test blocks after the existing `formatContextFile` describe.

Updated imports (replace existing):

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  formatContextFile,
  resolveContextDir,
  saveContextFiles,
  cleanupOldFiles,
  buildAtReferences,
} from './contextFiles';
import type { ContextBundle } from '../types';

// Mock vscode
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue('.tmp'),
    }),
    workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
  },
}));
```

Add these test blocks after the existing `formatContextFile` describe:

```typescript
describe('resolveContextDir', () => {
  beforeEach(async () => {
    // Reset mocks to defaults before each test
    const vscode = await import('vscode');
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue('.tmp'),
    } as any);
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/mock/workspace' } }];
  });

  it('resolves relative path against workspace root', () => {
    const result = resolveContextDir();
    expect(result.dir).toBe(path.join('/mock/workspace', '.tmp'));
    expect(result.isWorkspaceRelative).toBe(true);
  });

  it('uses absolute path as-is', async () => {
    const vscode = await import('vscode');
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue('/absolute/path'),
    } as any);

    const result = resolveContextDir();
    expect(result.dir).toBe('/absolute/path');
    expect(result.isWorkspaceRelative).toBe(false);
  });

  it('falls back to tmpdir when no workspace is open', async () => {
    const vscode = await import('vscode');
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue('.tmp'),
    } as any);
    (vscode.workspace as any).workspaceFolders = undefined;

    const result = resolveContextDir();
    expect(result.dir).toBe(os.tmpdir());
    expect(result.isWorkspaceRelative).toBe(false);
  });
});

describe('saveContextFiles', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-chat-test-'));
    const vscode = await import('vscode');
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue(tmpDir),
    } as any);
    (vscode.workspace as any).workspaceFolders = undefined; // force absolute path mode
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes context file and screenshot', async () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<div>Test</div>',
        parentHtml: '<body><div>Test</div></body>',
        ancestorPath: 'body > div',
        tag: 'div',
        classes: [],
        dimensions: { top: 0, left: 0, width: 100, height: 50 },
        accessibility: {},
      },
      screenshot: {
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        width: 100,
        height: 50,
      },
    };

    const result = await saveContextFiles(bundle);

    expect(fs.existsSync(result.contextPath)).toBe(true);
    expect(result.screenshotPath).toBeDefined();
    expect(fs.existsSync(result.screenshotPath!)).toBe(true);
    expect(result.contextPath).toContain('browser-context-');
    expect(result.screenshotPath).toContain('browser-screenshot-');

    // Both files share the same timestamp
    const contextTs = result.contextPath.match(/browser-context-(\d+)\.txt/)?.[1];
    const screenshotTs = result.screenshotPath!.match(/browser-screenshot-(\d+)\.png/)?.[1];
    expect(contextTs).toBe(screenshotTs);
  });

  it('writes context file without screenshot when none present', async () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      logs: [{ level: 'error', message: 'Test error', timestamp: 1000 }],
    };

    const result = await saveContextFiles(bundle);

    expect(fs.existsSync(result.contextPath)).toBe(true);
    expect(result.screenshotPath).toBeUndefined();
  });
});

describe('cleanupOldFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-chat-cleanup-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes files older than maxAge', () => {
    const oldTs = Date.now() - 7200000; // 2 hours ago
    const newTs = Date.now() - 60000; // 1 minute ago

    fs.writeFileSync(path.join(tmpDir, `browser-context-${oldTs}.txt`), 'old');
    fs.writeFileSync(path.join(tmpDir, `browser-screenshot-${oldTs}.png`), 'old');
    fs.writeFileSync(path.join(tmpDir, `browser-context-${newTs}.txt`), 'new');

    cleanupOldFiles(tmpDir, 3600000);

    expect(fs.existsSync(path.join(tmpDir, `browser-context-${oldTs}.txt`))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, `browser-screenshot-${oldTs}.png`))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, `browser-context-${newTs}.txt`))).toBe(true);
  });

  it('does not throw on errors', () => {
    expect(() => cleanupOldFiles('/nonexistent/path')).not.toThrow();
  });
});

describe('buildAtReferences', () => {
  it('builds workspace-relative references', () => {
    const refs = buildAtReferences({
      contextPath: '/workspace/.tmp/browser-context-123.txt',
      screenshotPath: '/workspace/.tmp/browser-screenshot-123.png',
      dir: '/workspace/.tmp',
      isWorkspaceRelative: true,
      timestamp: 123,
      workspaceRoot: '/workspace',
    });

    expect(refs).toBe('@.tmp/browser-screenshot-123.png @.tmp/browser-context-123.txt');
  });

  it('builds absolute references when not workspace-relative', () => {
    const refs = buildAtReferences({
      contextPath: '/tmp/browser-context-123.txt',
      screenshotPath: '/tmp/browser-screenshot-123.png',
      dir: '/tmp',
      isWorkspaceRelative: false,
      timestamp: 123,
    });

    expect(refs).toBe('@/tmp/browser-screenshot-123.png @/tmp/browser-context-123.txt');
  });

  it('omits screenshot reference when no screenshot', () => {
    const refs = buildAtReferences({
      contextPath: '/workspace/.tmp/browser-context-123.txt',
      dir: '/workspace/.tmp',
      isWorkspaceRelative: true,
      timestamp: 123,
      workspaceRoot: '/workspace',
    });

    expect(refs).toBe('@.tmp/browser-context-123.txt');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/adapters/contextFiles.test.ts`

Expected: FAIL — `resolveContextDir`, `saveContextFiles`, `cleanupOldFiles`, `buildAtReferences` not exported.

- [ ] **Step 3: Implement the remaining utilities**

Add to `src/adapters/contextFiles.ts`:

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ContextBundle } from '../types';

export interface ContextDirInfo {
  dir: string;
  isWorkspaceRelative: boolean;
}

export interface SaveResult extends ContextDirInfo {
  contextPath: string;
  screenshotPath?: string;
  timestamp: number;
  workspaceRoot?: string;
}

/**
 * Resolves the context directory from the browserChat.contextDirectory setting.
 * Falls back to os.tmpdir() when no workspace is open.
 */
export function resolveContextDir(): ContextDirInfo {
  const config = vscode.workspace.getConfiguration('browserChat');
  const configured = config.get<string>('contextDirectory') || '.tmp';
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (path.isAbsolute(configured)) {
    return { dir: configured, isWorkspaceRelative: false };
  }

  if (!workspaceRoot) {
    console.warn('Browser Chat: No workspace open, saving context files to system temp directory.');
    return { dir: os.tmpdir(), isWorkspaceRelative: false };
  }

  return { dir: path.join(workspaceRoot, configured), isWorkspaceRelative: true };
}

/**
 * Saves context file and optional screenshot to the configured directory.
 * Creates directory and updates .gitignore if needed.
 */
export async function saveContextFiles(bundle: ContextBundle): Promise<SaveResult> {
  const { dir, isWorkspaceRelative } = resolveContextDir();
  const timestamp = Date.now();

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Add to .gitignore if workspace-relative
  if (isWorkspaceRelative) {
    const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
    ensureGitignore(workspaceRoot, dir);
  }

  // Write context file
  const contextFilename = `browser-context-${timestamp}.txt`;
  const contextPath = path.join(dir, contextFilename);
  const contextContent = formatContextFile(bundle);
  fs.writeFileSync(contextPath, contextContent, 'utf8');

  // Write screenshot if present
  let screenshotPath: string | undefined;
  if (bundle.screenshot?.dataUrl) {
    const screenshotFilename = `browser-screenshot-${timestamp}.png`;
    screenshotPath = path.join(dir, screenshotFilename);
    const base64Data = bundle.screenshot.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(screenshotPath, Buffer.from(base64Data, 'base64'));
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return { contextPath, screenshotPath, timestamp, dir, isWorkspaceRelative, workspaceRoot };
}

/**
 * Deletes context and screenshot files older than maxAgeMs.
 * Fire-and-forget — errors are logged but do not propagate.
 */
export function cleanupOldFiles(dir: string, maxAgeMs = 3600000): void {
  try {
    const files = fs.readdirSync(dir);
    const now = Date.now();

    for (const file of files) {
      const match = file.match(/^browser-(?:context|screenshot)-(\d+)\.\w+$/);
      if (match) {
        const fileTs = parseInt(match[1], 10);
        if (now - fileTs > maxAgeMs) {
          try {
            fs.unlinkSync(path.join(dir, file));
          } catch {
            // Ignore individual file deletion errors
          }
        }
      }
    }
  } catch {
    // Ignore directory read errors (e.g., directory doesn't exist)
  }
}

/**
 * Builds @ file references for injection into chat input.
 * Screenshot reference comes first for visual prominence.
 */
export function buildAtReferences(result: SaveResult): string {
  const refs: string[] = [];

  if (result.screenshotPath) {
    const ref = result.isWorkspaceRelative && result.workspaceRoot
      ? path.relative(result.workspaceRoot, result.screenshotPath)
      : result.screenshotPath;
    refs.push(`@${ref}`);
  }

  const contextRef = result.isWorkspaceRelative && result.workspaceRoot
    ? path.relative(result.workspaceRoot, result.contextPath)
    : result.contextPath;
  refs.push(`@${contextRef}`);

  return refs.join(' ');
}

/**
 * Ensures the context directory is listed in .gitignore.
 */
function ensureGitignore(workspaceRoot: string, contextDir: string): void {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  const relativePath = path.relative(workspaceRoot, contextDir);
  const entry = relativePath + '/';

  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf8');
    }
    if (!content.split('\n').some(line => line.trim() === entry || line.trim() === relativePath)) {
      const separator = content.endsWith('\n') || content === '' ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${separator}${entry}\n`);
    }
  } catch {
    // Ignore .gitignore errors — not critical
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/adapters/contextFiles.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/contextFiles.ts src/adapters/contextFiles.test.ts
git commit -m "feat: add shared file utilities for context delivery"
```

---

## Chunk 2: Adapter Changes and ContextExtractor

### File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/context/ContextExtractor.ts` | Modify | Map new payload fields to ElementContext |
| `src/context/ContextExtractor.test.ts` | Modify | Test new field mapping |
| `src/adapters/OpenCodeAdapter.ts` | Modify | Use shared utilities + `@` references |
| `src/adapters/OpenCodeAdapter.test.ts` | Modify | Update tests for new delivery |
| `src/adapters/OpenChamberAdapter.ts` | Modify | Use shared utilities + `@` references |
| `src/adapters/OpenChamberAdapter.test.ts` | Modify | Update tests for new delivery |
| `src/adapters/ClipboardAdapter.ts` | Modify | Use shared utilities + file path summary |
| `src/adapters/ClipboardAdapter.test.ts` | Modify | Update tests for new delivery |

---

### Task 5: Update ContextExtractor for new fields

**Files:**
- Modify: `src/context/ContextExtractor.ts:8-36`
- Modify: `src/context/ContextExtractor.test.ts`

- [ ] **Step 1: Write failing test for new field mapping**

Add to `src/context/ContextExtractor.test.ts`:

```typescript
it('maps attributes, innerText, computedStyles from payload', () => {
  const bundle = extractor.fromCapturedElement(
    {
      html: '<div class="banner" role="alert">Hello</div>',
      tag: 'div',
      classes: ['banner'],
      dimensions: { top: 86, left: 252, width: 789, height: 71 },
      accessibility: { role: 'alert' },
      parentHtml: '<main><div class="banner" role="alert">Hello</div></main>',
      ancestorPath: 'body > main > div.banner',
      screenshotDataUrl: '',
      attributes: { class: 'banner', role: 'alert' },
      innerText: 'Hello',
      computedStyles: { display: 'flex', color: 'rgb(0, 0, 0)' },
    },
    'http://localhost:3000'
  );

  expect(bundle.element?.attributes).toEqual({ class: 'banner', role: 'alert' });
  expect(bundle.element?.innerText).toBe('Hello');
  expect(bundle.element?.computedStyles).toEqual({ display: 'flex', color: 'rgb(0, 0, 0)' });
  expect(bundle.element?.dimensions).toEqual({ top: 86, left: 252, width: 789, height: 71 });
});
```

Also update the existing test fixtures to use the widened dimensions shape: `dimensions: { top: 0, left: 0, width: X, height: Y }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/context/ContextExtractor.test.ts`

Expected: FAIL — new fields not mapped.

- [ ] **Step 3: Update ContextExtractor to map new fields**

In `src/context/ContextExtractor.ts`, update `fromCapturedElement()` (lines 15-24):

```typescript
element: {
  html: payload.html,
  parentHtml: payload.parentHtml,
  ancestorPath: payload.ancestorPath,
  tag: payload.tag,
  classes: payload.classes,
  dimensions: payload.dimensions,
  accessibility: payload.accessibility,
  sourceLocation: payload.sourceLocation,
  attributes: payload.attributes,
  innerText: payload.innerText,
  computedStyles: payload.computedStyles,
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/context/ContextExtractor.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/context/ContextExtractor.ts src/context/ContextExtractor.test.ts
git commit -m "feat: map expanded element fields in ContextExtractor"
```

---

### Task 6: Refactor OpenCodeAdapter to use shared utilities

**Files:**
- Modify: `src/adapters/OpenCodeAdapter.ts`
- Modify: `src/adapters/OpenCodeAdapter.test.ts`

- [ ] **Step 1: Update test expectations**

In `src/adapters/OpenCodeAdapter.test.ts`, update the test `'calls append-prompt with { prompt } body when terminal is available'`:

```typescript
// After the existing assertions, add:
// Verify the body contains @ file references instead of inline text
expect(body.text).toMatch(/@.*browser-context-\d+\.txt/);
expect(body.text).not.toContain('[Browser Chat] Context from');
```

Add mock for vscode.workspace:

```typescript
// In the vi.mock('vscode') block, add:
workspace: {
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue('.tmp'),
  }),
  workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
},
```

Add mock for fs (since saveContextFiles writes to disk):

```typescript
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  unlinkSync: vi.fn(),
}));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/OpenCodeAdapter.test.ts`

Expected: FAIL — body still contains inline text.

- [ ] **Step 3: Refactor OpenCodeAdapter.deliver()**

Replace the `deliver()` method in `src/adapters/OpenCodeAdapter.ts`:

```typescript
import { saveContextFiles, cleanupOldFiles, buildAtReferences } from './contextFiles';

async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
  const port = await this.discoverPort();
  if (!port) {
    const result = await this.fallback.deliver(bundle);
    return {
      success: result.success,
      message: `OpenCode not found — ${result.message.toLowerCase()}`,
    };
  }

  try {
    const result = await saveContextFiles(bundle);
    cleanupOldFiles(result.dir); // fire-and-forget
    const refs = buildAtReferences(result);
    await this.appendPrompt(port, refs);
    return { success: true, message: 'Added to OpenCode prompt' };
  } catch (err) {
    const result = await this.fallback.deliver(bundle);
    return {
      success: result.success,
      message: `OpenCode error, fell back to clipboard`,
    };
  }
}
```

Remove the `formatContext()` method entirely. Remove unused imports (`os`, `path`, `fs`). Keep all other methods unchanged: `isAvailable()`, `discoverPort()`, `isReachable()`, `appendPrompt()`.

**Note:** This task depends on Chunk 1 being fully complete (type widening + test fixture updates).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/adapters/OpenCodeAdapter.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/OpenCodeAdapter.ts src/adapters/OpenCodeAdapter.test.ts
git commit -m "refactor: OpenCodeAdapter uses shared file utilities and @ references"
```

---

### Task 7: Refactor OpenChamberAdapter to use shared utilities

**Files:**
- Modify: `src/adapters/OpenChamberAdapter.ts`
- Modify: `src/adapters/OpenChamberAdapter.test.ts`

- [ ] **Step 1: Update test expectations**

In `src/adapters/OpenChamberAdapter.test.ts`:

1. Add `workspace.getConfiguration` and `workspaceFolders` to the existing vscode mock:

```typescript
// Add to the vi.mock('vscode') block:
workspace: {
  ...existing workspace mock...,
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue('.tmp'),
  }),
  workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
},
```

2. Expand the `vi.mock('fs')` block to include all fs methods used by `saveContextFiles`:

```typescript
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
}));
```

3. Update the `'calls openchamber.addToContext command'` test to verify the temp file contains `@` references:

```typescript
it('calls openchamber.addToContext with @ file references', async () => {
  const result = await adapter.deliver(testBundle);
  expect(result.success).toBe(true);
  expect(result.message).toBe('Added to OpenChamber chat');
  expect(mockedVscode.commands.executeCommand).toHaveBeenCalledWith('openchamber.addToContext');

  // Verify the temp file written by sendViaAddToContext contains @ references
  const fsModule = await import('fs');
  const writeCall = vi.mocked(fsModule.writeFileSync).mock.calls.find(
    call => String(call[0]).includes('browser-context.html')
  );
  expect(writeCall).toBeDefined();
  const content = String(writeCall![1]);
  expect(content).toMatch(/@.*browser-context-\d+\.txt/);
  expect(content).not.toContain('[Browser Chat] Context from');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/OpenChamberAdapter.test.ts`

Expected: FAIL — temp file still contains inline text.

- [ ] **Step 3: Refactor OpenChamberAdapter.deliver()**

Replace the `deliver()` method:

```typescript
import { saveContextFiles, cleanupOldFiles, buildAtReferences } from './contextFiles';

async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
  const hasExtension = await this.isAvailable();
  if (!hasExtension) {
    const result = await this.fallback.deliver(bundle);
    return {
      success: result.success,
      message: `OpenChamber not installed — ${result.message.toLowerCase()}`,
    };
  }

  try {
    const saveResult = await saveContextFiles(bundle);
    cleanupOldFiles(saveResult.dir); // fire-and-forget
    const refs = buildAtReferences(saveResult);
    await this.sendViaAddToContext(refs);
    return { success: true, message: 'Added to OpenChamber chat' };
  } catch (err) {
    const result = await this.fallback.deliver(bundle);
    return {
      success: result.success,
      message: `OpenChamber error, fell back to clipboard`,
    };
  }
}
```

Remove the `formatContext()` method. Remove unused imports (`os`, `path`, `fs` — but `os`/`path`/`fs` may still be needed by `sendViaAddToContext`). Keep `sendViaAddToContext()` unchanged (it still uses temp file mechanism, but now the text is short).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/adapters/OpenChamberAdapter.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/OpenChamberAdapter.ts src/adapters/OpenChamberAdapter.test.ts
git commit -m "refactor: OpenChamberAdapter uses shared file utilities and @ references"
```

---

### Task 8: Refactor ClipboardAdapter to use shared utilities

**Files:**
- Modify: `src/adapters/ClipboardAdapter.ts`
- Modify: `src/adapters/ClipboardAdapter.test.ts`

- [ ] **Step 1: Update test expectations**

In `src/adapters/ClipboardAdapter.test.ts`:

1. Expand the vscode mock to include workspace:

```typescript
vi.mock('vscode', () => ({
  env: {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue('.tmp'),
    }),
    workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
  },
}));
```

2. Add fs mock:

```typescript
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  unlinkSync: vi.fn(),
}));
```

3. Rewrite all three tests:

```typescript
it('copies file paths to clipboard after saving element context', async () => {
  const bundle: ContextBundle = {
    url: 'http://localhost:3000',
    timestamp: Date.now(),
    element: {
      html: '<button class="cta">Click</button>',
      parentHtml: '<div><button class="cta">Click</button></div>',
      ancestorPath: 'body > div > button.cta',
      tag: 'button',
      classes: ['cta'],
      dimensions: { top: 0, left: 0, width: 120, height: 34 },
      accessibility: { name: 'Click', role: 'button' },
    },
  };

  const result = await adapter.deliver(bundle);

  expect(result.success).toBe(true);
  const clipboardContent = (mockedVscode.env.clipboard.writeText as any).mock.calls[0][0];
  expect(clipboardContent).toContain('Context:');
  expect(clipboardContent).toContain('browser-context-');
  expect(clipboardContent).toContain('.txt');
});

it('includes screenshot path when available', async () => {
  const bundle: ContextBundle = {
    url: 'http://localhost:3000',
    timestamp: Date.now(),
    element: {
      html: '<button>Click</button>',
      parentHtml: '<div><button>Click</button></div>',
      ancestorPath: 'body > div > button',
      tag: 'button',
      classes: [],
      dimensions: { top: 0, left: 0, width: 120, height: 34 },
      accessibility: {},
      sourceLocation: { filePath: 'src/App.tsx', line: 42 },
    },
    screenshot: { dataUrl: 'data:image/png;base64,abc', width: 800, height: 600 },
  };

  const result = await adapter.deliver(bundle);

  expect(result.success).toBe(true);
  const clipboardContent = (mockedVscode.env.clipboard.writeText as any).mock.calls[0][0];
  expect(clipboardContent).toContain('Screenshot:');
  expect(clipboardContent).toContain('browser-screenshot-');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/ClipboardAdapter.test.ts`

Expected: FAIL.

- [ ] **Step 3: Refactor ClipboardAdapter.deliver()**

```typescript
import { saveContextFiles, cleanupOldFiles } from './contextFiles';

async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
  try {
    const result = await saveContextFiles(bundle);
    cleanupOldFiles(result.dir); // fire-and-forget

    const lines = ['[Browser Chat] Context saved to:'];
    if (result.screenshotPath) {
      lines.push(`  Screenshot: ${result.screenshotPath}`);
    }
    lines.push(`  Context: ${result.contextPath}`);

    await vscode.env.clipboard.writeText(lines.join('\n'));
    return { success: true, message: 'File paths copied to clipboard' };
  } catch (err) {
    return { success: false, message: `Failed to save context files` };
  }
}
```

Remove `formatAsMarkdown()` method.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/adapters/ClipboardAdapter.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/ClipboardAdapter.ts src/adapters/ClipboardAdapter.test.ts
git commit -m "refactor: ClipboardAdapter uses shared file utilities"
```

---

## Chunk 3: Webview Changes

### File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/webview/inject.ts` | Modify | Capture attributes, widened dimensions, innerText, computedStyles |
| `src/webview/inspect-overlay.ts` | Modify | Thread new fields through relay |

---

### Task 9: Expand element capture in inject.ts

**Files:**
- Modify: `src/webview/inject.ts:274-360` (`extractElementInfo()`)
- Modify: `src/webview/inject.ts:12-35` (local type defs)

- [ ] **Step 1: Update local `ElementInfo` type**

In `src/webview/inject.ts`, the local type definitions (lines 12-35) duplicate types from `types.ts`. Update the `ElementInfo` interface to include new fields:

```typescript
interface ElementInfo {
  html: string;
  parentHtml: string;
  ancestorPath: string;
  tag: string;
  classes: string[];
  dimensions: { top: number; left: number; width: number; height: number };
  accessibility: AccessibilityInfo;
  sourceLocation?: SourceLocation;
  attributes?: Record<string, string>;
  innerText?: string;
  computedStyles?: Record<string, string>;
}
```

- [ ] **Step 2: Update `extractElementInfo()` to capture new data**

In `src/webview/inject.ts`, modify the `extractElementInfo()` function (around line 274). Add the new capture code **just before the return statement** (around line 346), after the `sourceLocation` assignment:

```typescript
// Collect all attributes
const attributes: Record<string, string> = {};
for (let i = 0; i < el.attributes.length; i++) {
  const attr = el.attributes[i];
  attributes[attr.name] = attr.value;
}

// Collect all computed styles
const computedStyle = window.getComputedStyle(el);
const computedStyles: Record<string, string> = {};
for (let i = 0; i < computedStyle.length; i++) {
  const prop = computedStyle[i];
  computedStyles[prop] = computedStyle.getPropertyValue(prop);
}

// Inner text
const innerText = el.innerText;
```

Update the return statement (around line 347):

```typescript
return {
  html,
  parentHtml,
  ancestorPath,
  tag,
  classes,
  dimensions: {
    top: Math.round(rect.top),
    left: Math.round(rect.left),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  },
  accessibility,
  sourceLocation,
  attributes,
  innerText,
  computedStyles,
};
```

- [ ] **Step 3: Build to verify no TypeScript errors**

Run: `npx tsc --noEmit`

Expected: No errors (or only pre-existing ones).

- [ ] **Step 4: Commit**

```bash
git add src/webview/inject.ts
git commit -m "feat: capture attributes, dimensions, innerText, computedStyles in inject.ts"
```

---

### Task 10: Thread new fields through inspect-overlay.ts

**Files:**
- Modify: `src/webview/inspect-overlay.ts:38-89`

- [ ] **Step 1: Verify `bc:elementSelected` handler (lines 38-48)**

No code changes needed for this handler — it already passes `data.payload.dimensions` through directly. The widened shape is backward-compatible. Just verify TypeScript compiles after the type changes from Chunk 1.

- [ ] **Step 2: Update `bc:sendToChat` handler (lines 51-68)**

Add the new fields:

```typescript
case 'bc:sendToChat':
  requestScreenshot().then((screenshotDataUrl) => {
    postMessage({
      type: 'inspect:sendToChat',
      payload: {
        html: data.payload.html,
        tag: data.payload.tag,
        classes: data.payload.classes,
        dimensions: data.payload.dimensions,
        accessibility: data.payload.accessibility,
        parentHtml: data.payload.parentHtml,
        ancestorPath: data.payload.ancestorPath,
        sourceLocation: data.payload.sourceLocation,
        screenshotDataUrl,
        attributes: data.payload.attributes,
        innerText: data.payload.innerText,
        computedStyles: data.payload.computedStyles,
      },
    });
  });
  break;
```

- [ ] **Step 3: Update `bc:addElementCaptured` handler (lines 71-89)**

Same new fields:

```typescript
case 'bc:addElementCaptured':
  requestScreenshot().then((screenshotDataUrl) => {
    postMessage({
      type: 'addElement:captured',
      payload: {
        html: data.payload.html,
        tag: data.payload.tag,
        classes: data.payload.classes,
        dimensions: data.payload.dimensions,
        accessibility: data.payload.accessibility,
        parentHtml: data.payload.parentHtml,
        ancestorPath: data.payload.ancestorPath,
        sourceLocation: data.payload.sourceLocation,
        screenshotDataUrl,
        attributes: data.payload.attributes,
        innerText: data.payload.innerText,
        computedStyles: data.payload.computedStyles,
      },
    });
  });
  break;
```

- [ ] **Step 4: Build to verify no TypeScript errors**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/webview/inspect-overlay.ts
git commit -m "feat: thread new element fields through inspect-overlay relay"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 2: Build the extension**

Run: `npm run compile` or `npx tsc`

Expected: No errors.

- [ ] **Step 3: Clean up any remaining spike test files**

If the `.tmp/` directory contains spike test files from the brainstorming phase, remove them:

```bash
rm -f .tmp/browser-context-1234567890.txt .tmp/browser-screenshot-1234567890.png
```

If no spike files exist, skip this step.

- [ ] **Step 4: Final commit (only if there are changes to commit)**

```bash
git status
# Only commit if there are actual changes
git add .tmp/ 2>/dev/null; git diff --cached --quiet || git commit -m "chore: clean up spike test files"
```
