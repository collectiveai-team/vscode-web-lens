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
  Uri: { file: vi.fn().mockImplementation((p: string) => ({ fsPath: p, scheme: 'file' })) },
  Position: vi.fn().mockImplementation((line: number, char: number) => ({ line, character: char })),
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
    // Default: showTextDocument returns an editor-like object
    mockedVscode.window.showTextDocument.mockResolvedValue({
      selection: null,
    } as any);
    adapter = new ClaudeCodeAdapter();
  });

  it('checks availability by looking for insertAtMention command', async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
    expect(mockedVscode.commands.getCommands).toHaveBeenCalledWith(true);
  });

  it('returns unavailable when extension not installed', async () => {
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

  it('calls insertAtMention for each file when screenshot exists (2 calls)', async () => {
    const result = await adapter.deliver(testBundleWithScreenshot);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Added to Claude Code chat');
    // Should be called for screenshot + context file
    const mentionCalls = mockedVscode.commands.executeCommand.mock.calls.filter(
      (call) => call[0] === 'claude-vscode.insertAtMention'
    );
    expect(mentionCalls).toHaveLength(2);
  });

  it('succeeds even if screenshot mention fails (first call fails, second succeeds)', async () => {
    // First executeCommand call (screenshot) fails, second (context) succeeds
    mockedVscode.commands.executeCommand
      .mockRejectedValueOnce(new Error('activeTextEditor is undefined'))
      .mockResolvedValueOnce(undefined) // close preview
      .mockResolvedValueOnce(undefined); // insertAtMention for context file

    const result = await adapter.deliver(testBundleWithScreenshot);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Added to Claude Code chat');
  });

  it('falls back to clipboard when extension not installed', async () => {
    mockedVscode.commands.getCommands.mockResolvedValue(['some.other.command']);
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Claude Code not installed');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });

  it('falls back to clipboard when all mentions fail', async () => {
    mockedVscode.commands.executeCommand.mockRejectedValue(
      new Error('activeTextEditor is undefined')
    );

    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Claude Code error, fell back to clipboard');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });
});
