import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  unlinkSync: vi.fn(),
}));

import { ClipboardAdapter } from './ClipboardAdapter';
import * as vscode from 'vscode';
import type { ContextBundle } from '../types';

const mockedVscode = vi.mocked(vscode, true);

describe('ClipboardAdapter', () => {
  let adapter: ClipboardAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClipboardAdapter();
  });

  it('copies file paths to clipboard', async () => {
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
    expect(result.message).toBe('File paths copied to clipboard');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalledTimes(1);

    const clipboardContent = (mockedVscode.env.clipboard.writeText as any).mock.calls[0][0];
    expect(clipboardContent).toContain('Context:');
    expect(clipboardContent).toMatch(/browser-context-\d+\.txt/);
  });

  it('includes screenshot path when screenshot is present', async () => {
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
      },
      screenshot: { dataUrl: 'data:image/png;base64,abc', width: 800, height: 600 },
    };

    const result = await adapter.deliver(bundle);

    expect(result.success).toBe(true);
    const clipboardContent = (mockedVscode.env.clipboard.writeText as any).mock.calls[0][0];
    expect(clipboardContent).toContain('Screenshot:');
    expect(clipboardContent).toMatch(/browser-screenshot-\d+\.png/);
    expect(clipboardContent).toContain('Context:');
  });

  it('handles screenshot-only bundle', async () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      screenshot: { dataUrl: 'data:image/png;base64,abc', width: 800, height: 600 },
    };

    const result = await adapter.deliver(bundle);
    expect(result.success).toBe(true);
    expect(result.message).toBe('File paths copied to clipboard');

    const clipboardContent = (mockedVscode.env.clipboard.writeText as any).mock.calls[0][0];
    expect(clipboardContent).toContain('Screenshot:');
    expect(clipboardContent).toContain('Context:');
  });
});
