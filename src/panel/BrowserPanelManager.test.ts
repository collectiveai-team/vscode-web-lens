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
    setCookieStore: vi.fn(),
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
          storeCookies: false,
        };
        return defaults[key];
      }),
      update: vi.fn().mockResolvedValue(undefined),
    }),
    workspaceFolders: [{ uri: { toString: () => 'file:///test' } }],
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
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
      'Web Lens Debug',
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

  it('restores from saved URL without creating a new panel', async () => {
    const mockPanel = {
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
    };

    await manager.restore(mockPanel as any, 'http://localhost:3000/saved-path');

    // Must NOT create a new panel
    expect(mockedVscode.window.createWebviewPanel).not.toHaveBeenCalled();
    // Must store the saved URL
    expect((manager as any).state.url).toBe('http://localhost:3000/saved-path');
    // Must navigate via proxy
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'navigate:url',
        payload: { url: 'http://127.0.0.1:9876/saved-path' },
      })
    );
  });

  it('generates unique cryptographically-safe nonces', () => {
    const nonce1 = (manager as any).getNonce() as string;
    const nonce2 = (manager as any).getNonce() as string;
    // Two calls must produce different values
    expect(nonce1).not.toBe(nonce2);
    // crypto.randomBytes(16).toString('base64url') produces exactly 22 characters
    expect(nonce1).toHaveLength(22);
    // base64url alphabet: A-Z a-z 0-9 - _
    expect(nonce1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  describe('storage message handling', () => {
    let mockCookieStore: any;

    beforeEach(() => {
      mockCookieStore = {
        isEnabled: vi.fn().mockReturnValue(false),
        get: vi.fn().mockResolvedValue({}),
        merge: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        listNames: vi.fn().mockResolvedValue([]),
      };
    });

    it('passes cookieStore to ProxyServer via setCookieStore', () => {
      new BrowserPanelManager(mockExtensionUri, mockCookieStore);
      const allResults = mockState.proxyServerMock.mock.results;
      const proxyInstance = allResults[allResults.length - 1]?.value;
      expect(proxyInstance.setCookieStore).toHaveBeenCalledWith(mockCookieStore);
    });

    it('handles storage:clear by calling cookieStore.clear', async () => {
      manager = new BrowserPanelManager(mockExtensionUri, mockCookieStore);
      await manager.open();
      await mockState.lastMessageHandler?.({ type: 'storage:clear', payload: { origin: 'http://localhost:3000' } });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockCookieStore.clear).toHaveBeenCalledWith('http://localhost:3000');
    });

    it('handles storage:openView by posting storage:view with cookie names', async () => {
      mockCookieStore.listNames.mockResolvedValue(['session', 'csrf']);
      manager = new BrowserPanelManager(mockExtensionUri, mockCookieStore);
      await manager.open();
      const panel = mockedVscode.window.createWebviewPanel.mock.results[0]?.value;
      const postMessage = panel?.webview.postMessage as ReturnType<typeof vi.fn>;
      postMessage.mockClear();

      await mockState.lastMessageHandler?.({ type: 'storage:openView', payload: {} });
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'storage:view', payload: expect.objectContaining({ names: ['session', 'csrf'] }) })
      );
    });

    it('handles storage:setEnabled by updating vscode config', async () => {
      manager = new BrowserPanelManager(mockExtensionUri, mockCookieStore);
      await manager.open();
      const config = vi.mocked(vscode.workspace.getConfiguration)();

      await mockState.lastMessageHandler?.({ type: 'storage:setEnabled', payload: { enabled: true } });
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(config.update).toHaveBeenCalledWith('storeCookies', true, expect.any(Number));
    });

    it('handles storage:deleteEntries by removing entries and posting updated view', async () => {
      mockCookieStore.listNames.mockResolvedValue(['csrf']);
      manager = new BrowserPanelManager(mockExtensionUri, mockCookieStore);
      await manager.open();
      const panel = mockedVscode.window.createWebviewPanel.mock.results[0]?.value;
      const postMessage = panel?.webview.postMessage as ReturnType<typeof vi.fn>;
      postMessage.mockClear();

      await mockState.lastMessageHandler?.({
        type: 'storage:deleteEntries',
        payload: { origin: 'http://localhost:3000', names: ['session'] },
      });
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockCookieStore.remove).toHaveBeenCalledWith('http://localhost:3000', ['session']);
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'storage:view', payload: expect.objectContaining({ names: ['csrf'] }) })
      );
    });

    it('does nothing for storage messages when cookieStore is absent', async () => {
      manager = new BrowserPanelManager(mockExtensionUri); // no cookieStore
      await manager.open();
      // Should not throw
      await mockState.lastMessageHandler?.({ type: 'storage:clear', payload: { origin: 'http://localhost:3000' } });
      await mockState.lastMessageHandler?.({ type: 'storage:openView', payload: {} });
      await mockState.lastMessageHandler?.({ type: 'storage:deleteEntries', payload: { origin: 'http://localhost:3000', names: ['x'] } });
    });
  });
});
