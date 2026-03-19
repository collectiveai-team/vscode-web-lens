import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the ProxyServer module
vi.mock('../proxy/ProxyServer', () => ({
  ProxyServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(9876),
    stop: vi.fn().mockResolvedValue(undefined),
    getPort: vi.fn().mockReturnValue(9876),
    getProxiedUrl: vi.fn((url: string) => `http://127.0.0.1:9876/?url=${encodeURIComponent(url)}`),
  })),
}));

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
    activeColorTheme: { kind: 2 },
  },
  ColorThemeKind: {
    Light: 1,
    Dark: 2,
    HighContrast: 3,
    HighContrastLight: 4,
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
  const mockExtensionUri = { fsPath: '/fake/extension/path' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new BrowserPanelManager(mockExtensionUri);
  });

  it('creates a webview panel on open', async () => {
    await manager.open();
    expect(mockedVscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'webLens',
      'Web Lens',
      1,
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
      })
    );
  });

  it('reuses existing panel on second open call', async () => {
    await manager.open();
    await manager.open();
    expect(mockedVscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it('disposes panel correctly', async () => {
    await manager.open();
    manager.dispose();
  });
});
