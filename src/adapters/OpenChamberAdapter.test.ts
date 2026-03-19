import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  commands: {
    getCommands: vi.fn().mockResolvedValue(['openchamber.addToContext', 'openchamber.focusChat']),
    executeCommand: vi.fn().mockResolvedValue(undefined),
  },
  workspace: {
    openTextDocument: vi.fn().mockResolvedValue({
      positionAt: vi.fn().mockReturnValue({ line: 0, character: 0 }),
      getText: vi.fn().mockReturnValue('test content'),
    }),
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
}));

import { OpenChamberAdapter } from './OpenChamberAdapter';
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

describe('OpenChamberAdapter', () => {
  let adapter: OpenChamberAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedVscode.commands.getCommands.mockResolvedValue([
      'openchamber.addToContext',
      'openchamber.focusChat',
    ]);
    adapter = new OpenChamberAdapter();
  });

  it('checks availability by looking for addToContext command', async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('returns unavailable when extension not installed', async () => {
    mockedVscode.commands.getCommands.mockResolvedValue(['some.other.command']);
    const available = await adapter.isAvailable();
    expect(available).toBe(false);
  });

  it('calls openchamber.addToContext command', async () => {
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Added to OpenChamber chat');
    expect(mockedVscode.commands.executeCommand).toHaveBeenCalledWith('openchamber.addToContext');
  });

  it('falls back to clipboard when extension not installed', async () => {
    mockedVscode.commands.getCommands.mockResolvedValue(['some.other.command']);
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toContain('not installed');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });
});
