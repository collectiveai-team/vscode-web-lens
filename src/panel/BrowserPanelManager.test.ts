import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode module
vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn().mockReturnValue({
      webview: {
        html: '',
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: 'https://example.com',
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
      dispose: vi.fn(),
    }),
  },
  ViewColumn: { One: 1 },
  Uri: {
    joinPath: vi.fn((...args: any[]) => args.join('/')),
    file: vi.fn((p: string) => p),
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn((key: string) => {
        const defaults: Record<string, any> = {
          defaultUrl: 'http://localhost:3000',
          backend: 'clipboard',
          screenshotFormat: 'png',
          screenshotQuality: 0.9,
        };
        return defaults[key];
      }),
    }),
  },
}));

import { BrowserPanelManager } from './BrowserPanelManager';
import * as vscode from 'vscode';

const mockedVscode = vi.mocked(vscode, true);

describe('BrowserPanelManager', () => {
  let manager: BrowserPanelManager;
  const mockExtensionUri = '/fake/extension/path' as any;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new BrowserPanelManager(mockExtensionUri);
  });

  it('creates a webview panel on open', () => {
    manager.open();
    expect(mockedVscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'browserChat',
      'Browser Chat',
      1,
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
      })
    );
  });

  it('reuses existing panel on second open call', () => {
    manager.open();
    manager.open();
    expect(mockedVscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it('disposes panel correctly', () => {
    manager.open();
    manager.dispose();
  });
});
