import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  commands: {
    getCommands: vi.fn().mockResolvedValue(['chatgpt.addToThread', 'chatgpt.focusChat']),
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
      'chatgpt.focusChat',
    ]);
    adapter = new CodexAdapter();
  });

  it('checks availability by looking for addToThread command', async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('returns unavailable when extension not installed', async () => {
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

  it('falls back to clipboard when extension not installed', async () => {
    mockedVscode.commands.getCommands.mockResolvedValue(['some.other.command']);
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toContain('not installed');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });

  it('falls back to clipboard when command execution fails', async () => {
    mockedVscode.commands.getCommands.mockResolvedValue([
      'chatgpt.addToThread',
    ]);
    mockedVscode.workspace.openTextDocument.mockRejectedValueOnce(new Error('command failed'));
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Codex error, fell back to clipboard');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });
});
