import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    }),
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

import { OpenChamberAdapter } from './OpenChamberAdapter';
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

function mockHttpError() {
  const mockReq = {
    on: vi.fn((event: string, handler: any) => {
      if (event === 'error') handler(new Error('ECONNREFUSED'));
      return mockReq;
    }),
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
  };
  mockedHttp.request.mockImplementation(() => mockReq as any);
  return mockReq;
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
    dimensions: { width: 120, height: 34 },
    accessibility: { name: 'Click', role: 'button' },
  },
};

describe('OpenChamberAdapter', () => {
  let adapter: OpenChamberAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenChamberAdapter();
  });

  it('checks availability via health endpoint', async () => {
    mockHttpSuccess(200);
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
    expect(mockedHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/health' }),
      expect.any(Function)
    );
  });

  it('returns unavailable when server not reachable', async () => {
    mockHttpError();
    const available = await adapter.isAvailable();
    expect(available).toBe(false);
  });

  it('delivers context via append-prompt', async () => {
    mockHttpSuccess(200);
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Added to OpenChamber prompt');
  });

  it('falls back to clipboard when server not reachable', async () => {
    mockHttpError();
    const result = await adapter.deliver(testBundle);
    expect(result.success).toBe(true);
    expect(result.message).toContain('not reachable');
    expect(mockedVscode.env.clipboard.writeText).toHaveBeenCalled();
  });
});
