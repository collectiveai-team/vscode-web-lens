import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    terminals: [] as any[],
  },
  env: {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('http', () => ({
  request: vi.fn(),
}));

import { OpenCodeAdapter } from './OpenCodeAdapter';
import * as vscode from 'vscode';
import * as http from 'http';
import type { ContextBundle } from '../types';

const mockedVscode = vi.mocked(vscode, true);
const mockedHttp = vi.mocked(http);

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockedVscode.window as any).terminals = [];
    adapter = new OpenCodeAdapter();
  });

  it('returns unavailable when no opencode terminal exists', async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(false);
  });

  it('detects opencode terminal by env port', async () => {
    (mockedVscode.window as any).terminals = [
      {
        name: 'opencode',
        creationOptions: {
          env: { _EXTENSION_OPENCODE_PORT: '12345' },
        },
      },
    ];
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('falls back to clipboard when no opencode terminal found', async () => {
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
    expect(result.message).toContain('not found');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });

  it('calls append-prompt when opencode terminal is available', async () => {
    (mockedVscode.window as any).terminals = [
      {
        name: 'opencode',
        creationOptions: {
          env: { _EXTENSION_OPENCODE_PORT: '54321' },
        },
      },
    ];

    const mockRes = { statusCode: 200, resume: vi.fn() };
    const mockReq = {
      on: vi.fn().mockReturnThis(),
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    };
    mockedHttp.request.mockImplementation((_opts: any, callback: any) => {
      callback(mockRes);
      return mockReq as any;
    });

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
    expect(result.message).toBe('Added to OpenCode prompt');
    expect(mockedHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'localhost',
        port: 54321,
        path: '/tui/append-prompt',
        method: 'POST',
      }),
      expect.any(Function)
    );
  });
});
