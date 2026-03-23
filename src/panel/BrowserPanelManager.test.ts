import { describe, it, expect, vi, beforeEach } from 'vitest';

type WebviewMessageHandler = (message: { type: string; payload: Record<string, unknown> }) => void;

const mockState = vi.hoisted(() => ({
  proxyServerMock: vi.fn(),
  createWebviewPanelMock: vi.fn(),
  lastMessageHandler: undefined as WebviewMessageHandler | undefined,
}));

// Mock the ProxyServer module
vi.mock('../proxy/ProxyServer', () => ({
  ProxyServer: mockState.proxyServerMock.mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(9876),
    stop: vi.fn().mockResolvedValue(undefined),
    getPort: vi.fn().mockReturnValue(9876),
    getProxiedUrl: vi.fn((url: string) => {
      const parsed = new URL(url);
      return `http://127.0.0.1:9876${parsed.pathname}${parsed.search}${parsed.hash}`;
    }),
    getOriginalUrl: vi.fn((url: string) => url),
    getTargetOrigin: vi.fn().mockReturnValue('http://localhost:3000'),
  })),
}));

// Mock vscode module
vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: mockState.createWebviewPanelMock.mockImplementation(() => ({
      webview: {
        html: '',
        onDidReceiveMessage: vi.fn((handler: WebviewMessageHandler) => {
          mockState.lastMessageHandler = handler;
        }),
        postMessage: vi.fn(),
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: 'https://example.com',
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
      dispose: vi.fn(),
    })),
    createOutputChannel: vi.fn().mockReturnValue({
      appendLine: vi.fn(),
      show: vi.fn(),
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
    mockState.lastMessageHandler = undefined;
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

  it('constructs the proxy server with the default target url', () => {
    expect(mockState.proxyServerMock).toHaveBeenCalledWith(
      '/fake/extension/path',
      'http://localhost:3000'
    );
  });

  it('includes the target origin in the webview body attributes', async () => {
    await manager.open();

    const panel = mockedVscode.window.createWebviewPanel.mock.results[0]?.value;
    expect(panel?.webview.html).toContain('data-target-origin="http://localhost:3000"');
  });

  it('resolves iframe relative URLs against the target origin', async () => {
    await manager.open();

    const panel = mockedVscode.window.createWebviewPanel.mock.results[0]?.value;
    const postMessage = panel?.webview.postMessage as ReturnType<typeof vi.fn>;
    postMessage.mockClear();

    mockState.lastMessageHandler?.({
      type: 'iframe:loaded',
      payload: { url: '/docs?page=1#intro' },
    });

    expect(postMessage).not.toHaveBeenCalled();
    expect((manager as any).state.url).toBe('http://localhost:3000/docs?page=1#intro');
  });

  it('updates history for iframe-driven navigation without forcing a reload', async () => {
    await manager.open();

    const panel = mockedVscode.window.createWebviewPanel.mock.results[0]?.value;
    const postMessage = panel?.webview.postMessage as ReturnType<typeof vi.fn>;
    postMessage.mockClear();

    mockState.lastMessageHandler?.({
      type: 'iframe:loaded',
      payload: { url: '/docs?page=1#intro' },
    });

    expect(postMessage).not.toHaveBeenCalled();
    expect((manager as any).state.url).toBe('http://localhost:3000/docs?page=1#intro');
    expect((manager as any).state.history).toEqual([
      'http://localhost:3000/docs?page=1#intro',
    ]);
    expect((manager as any).state.historyIndex).toBe(0);
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
