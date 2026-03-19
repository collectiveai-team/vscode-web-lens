import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  env: {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  },
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

  it('copies element HTML to clipboard as markdown', async () => {
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
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalledTimes(1);

    const clipboardContent = (mockedVscode.env.clipboard.writeText as any).mock.calls[0][0];
    expect(clipboardContent).toContain('http://localhost:3000');
    expect(clipboardContent).toContain('<button class="cta">Click</button>');
    expect(clipboardContent).toContain('body > div > button.cta');
  });

  it('includes source location when available', async () => {
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
    };

    const result = await adapter.deliver(bundle);

    expect(result.success).toBe(true);
    const clipboardContent = (mockedVscode.env.clipboard.writeText as any).mock.calls[0][0];
    expect(clipboardContent).toContain('src/App.tsx:42');
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
});
