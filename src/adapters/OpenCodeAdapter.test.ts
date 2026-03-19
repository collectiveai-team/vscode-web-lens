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

function mockHttpSuccess(statusCode = 200) {
  const mockRes = { statusCode, resume: vi.fn() };
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
  return { mockReq, mockRes };
}

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

  it('detects opencode terminal by env port and verifies health', async () => {
    (mockedVscode.window as any).terminals = [
      {
        name: 'opencode',
        creationOptions: { env: { _EXTENSION_OPENCODE_PORT: '12345' } },
      },
    ];
    mockHttpSuccess(200);
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('falls back to clipboard when no opencode terminal found', async () => {
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toContain('not found');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });

  it('calls append-prompt with { prompt } body when terminal is available', async () => {
    (mockedVscode.window as any).terminals = [
      {
        name: 'opencode',
        creationOptions: { env: { _EXTENSION_OPENCODE_PORT: '54321' } },
      },
    ];
    const { mockReq } = mockHttpSuccess(200);

    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Added to OpenCode prompt');

    // Verify the request body uses "text" (what OpenCode server expects)
    const writeCall = mockReq.write.mock.calls[0][0];
    const body = JSON.parse(writeCall);
    expect(body).toHaveProperty('text');
    expect(body).not.toHaveProperty('prompt');
  });
});
