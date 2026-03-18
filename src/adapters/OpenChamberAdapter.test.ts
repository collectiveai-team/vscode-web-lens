import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  commands: {
    getCommands: vi.fn().mockResolvedValue(['openchamber.addContext']),
    executeCommand: vi.fn().mockResolvedValue(undefined),
  },
  env: {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

import { OpenChamberAdapter } from './OpenChamberAdapter';
import * as vscode from 'vscode';
import type { ContextBundle } from '../types';

const mockedVscode = vi.mocked(vscode, true);

describe('OpenChamberAdapter', () => {
  let adapter: OpenChamberAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock return value
    mockedVscode.commands.getCommands.mockResolvedValue(['openchamber.addContext']);
    adapter = new OpenChamberAdapter();
  });

  it('checks availability by looking for openchamber commands', async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
    expect(mockedVscode.commands.getCommands).toHaveBeenCalled();
  });

  it('returns unavailable when openchamber commands not found', async () => {
    mockedVscode.commands.getCommands.mockResolvedValueOnce(['some.other.command']);
    const available = await adapter.isAvailable();
    expect(available).toBe(false);
  });

  it('delivers context via openchamber.addContext command', async () => {
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
    expect(mockedVscode.commands.executeCommand).toHaveBeenCalledWith(
      'openchamber.addContext',
      expect.any(Object)
    );
  });

  it('falls back to clipboard when openchamber is unavailable', async () => {
    mockedVscode.commands.getCommands.mockResolvedValue(['some.other.command']);

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
