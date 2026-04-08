import * as vscode from 'vscode';
import { BrowserPanelManager } from './panel/BrowserPanelManager';
import { ContextExtractor } from './context/ContextExtractor';
import type { BackendAdapter } from './adapters/BackendAdapter';
import { ClipboardAdapter } from './adapters/ClipboardAdapter';
import { OpenCodeAdapter } from './adapters/OpenCodeAdapter';
import { OpenChamberAdapter } from './adapters/OpenChamberAdapter';
import { CodexAdapter } from './adapters/CodexAdapter';
import { ClaudeCodeAdapter } from './adapters/ClaudeCodeAdapter';
import type { WebviewMessage } from './types';
import { webLensLogger } from './logging';
import { CookieStore } from './cookies/CookieStore';

let panelManager: BrowserPanelManager | undefined;
let contextExtractor: ContextExtractor;

export function activate(context: vscode.ExtensionContext) {
  const adapters: Record<string, BackendAdapter> = {
    clipboard: new ClipboardAdapter(),
    opencode: new OpenCodeAdapter(),
    openchamber: new OpenChamberAdapter(),
    codex: new CodexAdapter(),
    claudecode: new ClaudeCodeAdapter(),
  };

  function getAdapter(): BackendAdapter {
    const config = vscode.workspace.getConfiguration('webLens');
    const backendName = config.get<string>('backend') || 'clipboard';
    return adapters[backendName] || adapters.clipboard;
  }

  async function getBackendState(): Promise<{ active: string; available: Record<string, boolean> }> {
    const config = vscode.workspace.getConfiguration('webLens');
    const active = config.get<string>('backend') || 'clipboard';

    const available: Record<string, boolean> = {};
    const timeout = (ms: number) => new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms));

    await Promise.all(
      Object.entries(adapters).map(async ([name, adapter]) => {
        try {
          available[name] = await Promise.race([adapter.isAvailable(), timeout(3000)]);
        } catch {
          available[name] = false;
        }
      })
    );

    return { active, available };
  }

  async function deliverContext(message: WebviewMessage, url: string) {
    const adapter = getAdapter();
    let result;

    switch (message.type) {
      case 'inspect:sendToChat':
      case 'addElement:captured': {
        const bundle = contextExtractor.fromCapturedElement(message.payload, url);
        result = await adapter.deliver(bundle);
        break;
      }
      case 'action:addLogs': {
        const bundle = contextExtractor.fromLogs(message.payload.logs, url);
        result = await adapter.deliver(bundle);
        break;
      }
      case 'action:screenshot': {
        const bundle = contextExtractor.fromScreenshot(
          message.payload.dataUrl,
          0,
          0,
          url
        );
        result = await adapter.deliver(bundle);
        break;
      }
      default:
        return;
    }

    panelManager?.postMessage({
      type: 'toast',
      payload: {
        message: result.message,
        toastType: result.success ? 'success' : 'error',
      },
    });
  }

  const packageJson = context.extension.packageJSON as { displayName?: string; version?: string };
  webLensLogger.info('Extension activated', {
    displayName: packageJson.displayName || 'Web Lens Debug',
    extensionId: context.extension.id,
    version: packageJson.version || 'unknown',
  });
  contextExtractor = new ContextExtractor();
  const workspaceFolderUri = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
  const cookieStore = new CookieStore(context.secrets, workspaceFolderUri);
  panelManager = new BrowserPanelManager(context.extensionUri, cookieStore);

  // Handle messages from webview that need context delivery
  let currentUrl = 'http://localhost:3000';

  panelManager.onMessage((message: WebviewMessage) => {
    switch (message.type) {
      case 'iframe:loaded':
        currentUrl = message.payload.url;
        break;
      case 'iframe:error':
        webLensLogger.error('Iframe load error', message.payload);
        panelManager?.postMessage({
          type: 'toast',
          payload: { message: `Failed to load: ${message.payload.error}`, toastType: 'error' },
        });
        break;
      case 'diagnostic:log': {
        const logMessage = `${message.payload.source}: ${message.payload.message}`;
        if (message.payload.level === 'error') {
          webLensLogger.error(logMessage, message.payload.details);
        } else if (message.payload.level === 'warn') {
          webLensLogger.warn(logMessage, message.payload.details);
        } else {
          webLensLogger.info(logMessage, message.payload.details);
        }
        break;
      }
      case 'inspect:sendToChat':
      case 'addElement:captured':
      case 'action:addLogs':
      case 'action:screenshot':
        deliverContext(message, currentUrl).catch((err) => {
          console.error('Web Lens: delivery error', err);
          webLensLogger.error('Context delivery error', err);
        });
        break;
      case 'backend:request': {
        getBackendState().then((state) => {
          panelManager?.postMessage({ type: 'backend:state', payload: state });
        }).catch((err) => {
          webLensLogger.error('backend:request state error', err);
        });
        break;
      }
      case 'backend:select': {
        const newBackend = message.payload.backend;
        if (adapters[newBackend]) {
          const config = vscode.workspace.getConfiguration('webLens');
          Promise.resolve(config.update('backend', newBackend, vscode.ConfigurationTarget.Global))
            .then(() => getBackendState())
            .then((state) => {
              panelManager?.postMessage({ type: 'backend:state', payload: state });
            })
            .catch((err: unknown) => {
              webLensLogger.error('backend:select error', err);
            });
        }
        break;
      }
    }
  });

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('webLens.backend')) {
        const adapter = getAdapter();
        panelManager?.postMessage({
          type: 'config:update',
          payload: { backend: adapter.name },
        });
        // Also send backend:state for the toolbar selector
        getBackendState().then((state) => {
          panelManager?.postMessage({ type: 'backend:state', payload: state });
        }).catch((err) => {
          webLensLogger.error('config change backend state error', err);
        });
      }
      if (e.affectsConfiguration('webLens.storeCookies')) {
        panelManager?.refreshStorageState();
      }
    })
  );

  // Listen for theme changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      const kind = theme.kind === vscode.ColorThemeKind.Light ||
                   theme.kind === vscode.ColorThemeKind.HighContrastLight
        ? 'light' : 'dark';
      panelManager?.postMessage({ type: 'theme:update', payload: { kind } });
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('webLens.open', async () => {
      webLensLogger.info('Open command invoked');
      await panelManager!.open();
    }),
    vscode.commands.registerCommand('webLens.openUrl', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter URL to open',
        value: 'http://localhost:3000',
        validateInput: (value) => {
          try {
            new URL(value);
            return null;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      });
      if (url) {
        await panelManager!.open();
        panelManager!.postMessage({ type: 'navigate:url', payload: { url } });
      }
    }),
    vscode.commands.registerCommand('webLens.inspect', () => {
      panelManager?.postMessage({ type: 'mode:inspect', payload: { enabled: true } });
    }),
    vscode.commands.registerCommand('webLens.addElement', () => {
      panelManager?.postMessage({ type: 'mode:addElement', payload: { enabled: true } });
    }),
    vscode.commands.registerCommand('webLens.addLogs', () => {
      panelManager?.postMessage({ type: 'addLogs:request', payload: {} });
    }),
    vscode.commands.registerCommand('webLens.screenshot', () => {
      panelManager?.postMessage({ type: 'screenshot:request', payload: {} });
    }),
    vscode.commands.registerCommand('webLens.showLogs', () => {
      webLensLogger.show();
    })
  );
}

export function deactivate() {
  panelManager?.dispose();
  panelManager = undefined;
  webLensLogger.info('Extension deactivated');
  webLensLogger.dispose();
}
