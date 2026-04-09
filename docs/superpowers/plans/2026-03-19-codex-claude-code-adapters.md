# Codex and Claude Code Adapters Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new `BackendAdapter` implementations — `CodexAdapter` and `ClaudeCodeAdapter` — so captured browser context can be delivered to Codex (OpenAI) and Claude Code (Anthropic) via their VS Code extension commands.

**Architecture:** Both adapters reuse the existing shared file utilities (`saveContextFiles`, `cleanupOldFiles`, `buildAtReferences` from `src/adapters/contextFiles.ts`) to save context files to `.tmp/`, then inject `@` file references via each tool's VS Code command. Both fall back to `ClipboardAdapter` on failure, matching the pattern of existing adapters.

**Tech Stack:** TypeScript, VS Code extension API, vitest

**Spec:** `docs/superpowers/specs/2026-03-19-codex-claude-code-adapters-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/adapters/CodexAdapter.ts` | Delivers context to Codex via `chatgpt.addToThread` command (temp-file-open-select pattern) |
| Create | `src/adapters/CodexAdapter.test.ts` | Unit tests for CodexAdapter |
| Create | `src/adapters/ClaudeCodeAdapter.ts` | Delivers context to Claude Code via `claude-vscode.insertAtMention` command (per-file mention) |
| Create | `src/adapters/ClaudeCodeAdapter.test.ts` | Unit tests for ClaudeCodeAdapter |
| Modify | `src/extension.ts:1-17` | Import and register both new adapters |
| Modify | `package.json:26-31` | Add `codex` and `claudecode` to the `browserChat.backend` enum |

---

## Chunk 1: CodexAdapter

### Task 1: Write CodexAdapter tests

**Files:**
- Create: `src/adapters/CodexAdapter.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  commands: {
    getCommands: vi.fn().mockResolvedValue(['chatgpt.addToThread', 'chatgpt.addFileToThread']),
    executeCommand: vi.fn().mockResolvedValue(undefined),
  },
  workspace: {
    openTextDocument: vi.fn().mockResolvedValue({
      positionAt: vi.fn().mockReturnValue({ line: 0, character: 0 }),
      getText: vi.fn().mockReturnValue('test content'),
    }),
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue('.tmp'),
    }),
    workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
  },
  window: {
    activeTextEditor: null,
    showTextDocument: vi.fn().mockResolvedValue({
      selection: null,
    }),
  },
  env: {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  },
  ViewColumn: { Active: 1 },
  Range: vi.fn().mockImplementation((start: any, end: any) => ({ start, end })),
  Selection: vi.fn().mockImplementation((start: any, end: any) => ({ start, end, isEmpty: false })),
}));

vi.mock('os', () => ({
  tmpdir: vi.fn().mockReturnValue('/tmp'),
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
}));

import { CodexAdapter } from './CodexAdapter';
import * as vscode from 'vscode';
import type { ContextBundle } from '../types';

const mockedVscode = vi.mocked(vscode, true);

const testBundle: ContextBundle = {
  url: 'http://localhost:3000',
  timestamp: Date.now(),
  element: {
    html: '<button>Click</button>',
    parentHtml: '<div><button>Click</button></div>',
    ancestorPath: 'body > div > button',
    tag: 'button',
    classes: [],
    dimensions: { top: 0, left: 0, width: 120, height: 34 },
    accessibility: { name: 'Click', role: 'button' },
  },
};

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedVscode.commands.getCommands.mockResolvedValue([
      'chatgpt.addToThread',
      'chatgpt.addFileToThread',
    ]);
    adapter = new CodexAdapter();
  });

  it('checks availability by looking for chatgpt.addToThread command', async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('returns unavailable when Codex extension not installed', async () => {
    mockedVscode.commands.getCommands.mockResolvedValue(['some.other.command']);
    const available = await adapter.isAvailable();
    expect(available).toBe(false);
  });

  it('calls chatgpt.addToThread with @ file references', async () => {
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Added to Codex thread');
    expect(mockedVscode.commands.executeCommand).toHaveBeenCalledWith('chatgpt.addToThread');
  });

  it('falls back to clipboard when Codex extension not installed', async () => {
    mockedVscode.commands.getCommands.mockResolvedValue(['some.other.command']);
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toContain('not installed');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });

  it('falls back to clipboard when command execution fails', async () => {
    mockedVscode.commands.executeCommand.mockRejectedValueOnce(new Error('Command failed'));
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toContain('fell back to clipboard');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/CodexAdapter.test.ts`
Expected: FAIL — `Cannot find module './CodexAdapter'`

---

### Task 2: Implement CodexAdapter

**Files:**
- Create: `src/adapters/CodexAdapter.ts`

- [ ] **Step 3: Write the implementation**

```typescript
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';
import { saveContextFiles, cleanupOldFiles, buildAtReferences } from './contextFiles';

/**
 * Delivers browser context to Codex (openai.chatgpt).
 *
 * Strategy: Write @ file references to a temp file, open it in an editor
 * with all text selected, then call `chatgpt.addToThread` which reads the
 * active editor selection and adds it as context for the current thread.
 *
 * Same pattern as the OpenChamber adapter.
 */
export class CodexAdapter implements BackendAdapter {
  readonly name = 'codex';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const hasExtension = await this.isAvailable();
    if (!hasExtension) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `Codex not installed — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const saveResult = await saveContextFiles(bundle);
      cleanupOldFiles(saveResult.dir); // fire-and-forget
      const refs = buildAtReferences(saveResult);
      await this.sendViaAddToThread(refs);
      return { success: true, message: 'Added to Codex thread' };
    } catch (err) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `Codex error, fell back to clipboard`,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const commands = await vscode.commands.getCommands(true);
      return commands.includes('chatgpt.addToThread');
    } catch {
      return false;
    }
  }

  /**
   * Write refs to a temp file, open it, select all, call chatgpt.addToThread,
   * then close the temp editor and clean up the file.
   */
  private async sendViaAddToThread(text: string): Promise<void> {
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `browser-context.html`);
    fs.writeFileSync(tmpFile, text, 'utf8');

    try {
      const previousEditor = vscode.window.activeTextEditor;

      const doc = await vscode.workspace.openTextDocument(tmpFile);
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus: false,
        preview: true,
      });

      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(doc.getText().length)
      );
      editor.selection = new vscode.Selection(fullRange.start, fullRange.end);

      await vscode.commands.executeCommand('chatgpt.addToThread');

      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      if (previousEditor?.document) {
        await vscode.window.showTextDocument(previousEditor.document, {
          viewColumn: previousEditor.viewColumn,
          preserveFocus: false,
        });
      }
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/adapters/CodexAdapter.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/adapters/CodexAdapter.ts src/adapters/CodexAdapter.test.ts
git commit -m "feat: add CodexAdapter for delivering context to Codex via addToThread"
```

---

## Chunk 2: ClaudeCodeAdapter

### Task 3: Write ClaudeCodeAdapter tests

**Files:**
- Create: `src/adapters/ClaudeCodeAdapter.test.ts`

- [ ] **Step 7: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  commands: {
    getCommands: vi.fn().mockResolvedValue(['claude-vscode.insertAtMention']),
    executeCommand: vi.fn().mockResolvedValue(undefined),
  },
  workspace: {
    openTextDocument: vi.fn().mockResolvedValue({
      positionAt: vi.fn().mockReturnValue({ line: 0, character: 0 }),
      getText: vi.fn().mockReturnValue('test content'),
    }),
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue('.tmp'),
    }),
    workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
  },
  window: {
    activeTextEditor: null,
    showTextDocument: vi.fn().mockResolvedValue({
      selection: null,
    }),
  },
  env: {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  },
  ViewColumn: { Active: 1 },
  Selection: vi.fn().mockImplementation((start: any, end: any) => ({ start, end, isEmpty: true })),
  Position: vi.fn().mockImplementation((line: number, char: number) => ({ line, character: char })),
}));

vi.mock('os', () => ({
  tmpdir: vi.fn().mockReturnValue('/tmp'),
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
}));

import { ClaudeCodeAdapter } from './ClaudeCodeAdapter';
import * as vscode from 'vscode';
import type { ContextBundle } from '../types';

const mockedVscode = vi.mocked(vscode, true);

const testBundle: ContextBundle = {
  url: 'http://localhost:3000',
  timestamp: Date.now(),
  element: {
    html: '<button>Click</button>',
    parentHtml: '<div><button>Click</button></div>',
    ancestorPath: 'body > div > button',
    tag: 'button',
    classes: [],
    dimensions: { top: 0, left: 0, width: 120, height: 34 },
    accessibility: { name: 'Click', role: 'button' },
  },
};

const testBundleWithScreenshot: ContextBundle = {
  ...testBundle,
  screenshot: {
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 800,
    height: 600,
  },
};

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedVscode.commands.getCommands.mockResolvedValue([
      'claude-vscode.insertAtMention',
    ]);
    adapter = new ClaudeCodeAdapter();
  });

  it('checks availability by looking for claude-vscode.insertAtMention command', async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('returns unavailable when Claude Code extension not installed', async () => {
    mockedVscode.commands.getCommands.mockResolvedValue(['some.other.command']);
    const available = await adapter.isAvailable();
    expect(available).toBe(false);
  });

  it('calls insertAtMention for context file', async () => {
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Added to Claude Code chat');
    expect(mockedVscode.commands.executeCommand).toHaveBeenCalledWith(
      'claude-vscode.insertAtMention'
    );
  });

  it('calls insertAtMention for each file when screenshot exists', async () => {
    const result = await adapter.deliver(testBundleWithScreenshot);
    expect(result.success).toBe(true);
    // Should attempt insertAtMention for both screenshot and context file
    const insertCalls = mockedVscode.commands.executeCommand.mock.calls.filter(
      (call) => call[0] === 'claude-vscode.insertAtMention'
    );
    expect(insertCalls.length).toBe(2);
  });

  it('succeeds even if screenshot mention fails', async () => {
    // First call (screenshot) fails, second call (context) succeeds
    mockedVscode.commands.executeCommand
      .mockRejectedValueOnce(new Error('Cannot mention binary file'))
      .mockResolvedValueOnce(undefined);

    const result = await adapter.deliver(testBundleWithScreenshot);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Added to Claude Code chat');
  });

  it('falls back to clipboard when Claude Code extension not installed', async () => {
    mockedVscode.commands.getCommands.mockResolvedValue(['some.other.command']);
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toContain('not installed');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });

  it('falls back to clipboard when all mentions fail', async () => {
    mockedVscode.commands.executeCommand.mockRejectedValue(new Error('All failed'));
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toContain('fell back to clipboard');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run src/adapters/ClaudeCodeAdapter.test.ts`
Expected: FAIL — `Cannot find module './ClaudeCodeAdapter'`

---

### Task 4: Implement ClaudeCodeAdapter

**Files:**
- Create: `src/adapters/ClaudeCodeAdapter.ts`

- [ ] **Step 9: Write the implementation**

```typescript
import * as vscode from 'vscode';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';
import { saveContextFiles, cleanupOldFiles } from './contextFiles';

/**
 * Delivers browser context to Claude Code (anthropic.claude-code).
 *
 * Strategy: Open each saved context file in the editor and invoke
 * `claude-vscode.insertAtMention` which inserts an @ reference to
 * the currently-open file into Claude Code's chat input.
 *
 * The insertAtMention command reads from vscode.window.activeTextEditor.
 * For binary files (PNG screenshots), activeTextEditor is undefined and
 * the mention may fail silently — this is expected and handled gracefully.
 */
export class ClaudeCodeAdapter implements BackendAdapter {
  readonly name = 'claudecode';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const hasExtension = await this.isAvailable();
    if (!hasExtension) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `Claude Code not installed — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const saveResult = await saveContextFiles(bundle);
      cleanupOldFiles(saveResult.dir); // fire-and-forget

      // Build list of files to mention: screenshot first, then context
      const filesToMention: string[] = [];
      if (saveResult.screenshotPath) {
        filesToMention.push(saveResult.screenshotPath);
      }
      filesToMention.push(saveResult.contextPath);

      const mentionedCount = await this.mentionFiles(filesToMention);

      if (mentionedCount === 0) {
        throw new Error('No files were successfully mentioned');
      }

      return { success: true, message: 'Added to Claude Code chat' };
    } catch (err) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `Claude Code error, fell back to clipboard`,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const commands = await vscode.commands.getCommands(true);
      return commands.includes('claude-vscode.insertAtMention');
    } catch {
      return false;
    }
  }

  /**
   * Open each file and invoke insertAtMention to inject an @ reference
   * into the current Claude Code session. Returns count of successful mentions.
   */
  private async mentionFiles(filePaths: string[]): Promise<number> {
    const previousEditor = vscode.window.activeTextEditor;
    let mentionedCount = 0;

    try {
      for (const filePath of filePaths) {
        try {
          const doc = await vscode.workspace.openTextDocument(filePath);
          const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Active,
            preserveFocus: false,
            preview: true,
          });

          // Clear selection to avoid line numbers in the @ reference
          const zeroPos = new vscode.Position(0, 0);
          editor.selection = new vscode.Selection(zeroPos, zeroPos);

          await vscode.commands.executeCommand('claude-vscode.insertAtMention');
          mentionedCount++;

          // Small delay to allow EventEmitter to fire before next file
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch {
          // Binary files (PNG) will fail — continue with remaining files
        }
      }
    } finally {
      // Close the preview tab
      if (mentionedCount > 0 || filePaths.length > 0) {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      }

      // Restore previous editor
      if (previousEditor?.document) {
        await vscode.window.showTextDocument(previousEditor.document, {
          viewColumn: previousEditor.viewColumn,
          preserveFocus: false,
        });
      }
    }

    return mentionedCount;
  }
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run src/adapters/ClaudeCodeAdapter.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 11: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 12: Commit**

```bash
git add src/adapters/ClaudeCodeAdapter.ts src/adapters/ClaudeCodeAdapter.test.ts
git commit -m "feat: add ClaudeCodeAdapter for delivering context via insertAtMention"
```

---

## Chunk 3: Registration and Wiring

### Task 5: Register adapters in extension.ts and package.json

**Files:**
- Modify: `src/extension.ts:1-17`
- Modify: `package.json:26-31`

- [ ] **Step 13: Add imports to extension.ts**

Add after line 7 (`import { OpenChamberAdapter } ...`):

```typescript
import { CodexAdapter } from './adapters/CodexAdapter';
import { ClaudeCodeAdapter } from './adapters/ClaudeCodeAdapter';
```

- [ ] **Step 14: Add adapter entries to the dictionary**

Change the `adapters` dictionary (lines 13-17) from:

```typescript
const adapters: Record<string, BackendAdapter> = {
  clipboard: new ClipboardAdapter(),
  opencode: new OpenCodeAdapter(),
  openchamber: new OpenChamberAdapter(),
};
```

To:

```typescript
const adapters: Record<string, BackendAdapter> = {
  clipboard: new ClipboardAdapter(),
  opencode: new OpenCodeAdapter(),
  openchamber: new OpenChamberAdapter(),
  codex: new CodexAdapter(),
  claudecode: new ClaudeCodeAdapter(),
};
```

- [ ] **Step 15: Update the backend enum in package.json**

Change the `browserChat.backend` setting (line 29) from:

```json
"enum": ["opencode", "openchamber", "clipboard"],
```

To:

```json
"enum": ["opencode", "openchamber", "codex", "claudecode", "clipboard"],
```

- [ ] **Step 16: Run all tests**

Run: `npm run test:unit`
Expected: All tests pass (existing + new)

- [ ] **Step 17: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 18: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 19: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: register CodexAdapter and ClaudeCodeAdapter in extension and config"
```
