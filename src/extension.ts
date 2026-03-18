import * as vscode from 'vscode';
import { BrowserPanelManager } from './panel/BrowserPanelManager';
import { ContextExtractor } from './context/ContextExtractor';
import type { BackendAdapter } from './adapters/BackendAdapter';
import { ClipboardAdapter } from './adapters/ClipboardAdapter';
import { OpenCodeAdapter } from './adapters/OpenCodeAdapter';
import { OpenChamberAdapter } from './adapters/OpenChamberAdapter';
import type { WebviewMessage } from './types';

let panelManager: BrowserPanelManager | undefined;
let contextExtractor: ContextExtractor;

const adapters: Record<string, BackendAdapter> = {
  clipboard: new ClipboardAdapter(),
  opencode: new OpenCodeAdapter(),
  openchamber: new OpenChamberAdapter(),
};

function getAdapter(): BackendAdapter {
  const config = vscode.workspace.getConfiguration('browserChat');
  const backendName = config.get<string>('backend') || 'clipboard';
  return adapters[backendName] || adapters.clipboard;
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

export function activate(context: vscode.ExtensionContext) {
  contextExtractor = new ContextExtractor();
  panelManager = new BrowserPanelManager(context.extensionUri);

  // Handle messages from webview that need context delivery
  let currentUrl = 'http://localhost:3000';

  panelManager.onMessage((message: WebviewMessage) => {
    switch (message.type) {
      case 'iframe:loaded':
        currentUrl = message.payload.url;
        break;
      case 'iframe:error':
        panelManager?.postMessage({
          type: 'toast',
          payload: { message: `Failed to load: ${message.payload.error}`, toastType: 'error' },
        });
        break;
      case 'inspect:sendToChat':
      case 'addElement:captured':
      case 'action:addLogs':
      case 'action:screenshot':
        deliverContext(message, currentUrl).catch((err) => {
          console.error('Browser Chat: delivery error', err);
        });
        break;
    }
  });

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('browserChat.backend')) {
        const adapter = getAdapter();
        panelManager?.postMessage({
          type: 'config:update',
          payload: { backend: adapter.name },
        });
      }
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('browserChat.open', async () => {
      await panelManager!.open();
    }),
    vscode.commands.registerCommand('browserChat.openUrl', async () => {
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
    vscode.commands.registerCommand('browserChat.inspect', () => {
      panelManager?.postMessage({ type: 'mode:inspect', payload: { enabled: true } });
    }),
    vscode.commands.registerCommand('browserChat.addElement', () => {
      panelManager?.postMessage({ type: 'mode:addElement', payload: { enabled: true } });
    }),
    vscode.commands.registerCommand('browserChat.addLogs', () => {
      // The webview toolbar button handles log capture directly via the
      // console capture buffer. This command palette entry triggers the
      // same flow by simulating the toolbar button click.
      // Note: A dedicated `addLogs:request` message could be added if
      // command palette -> webview log capture is needed. For MVP, the
      // toolbar button is the primary UX.
      panelManager?.postMessage({
        type: 'toast',
        payload: { message: 'Use the toolbar button to capture logs', toastType: 'success' },
      });
    }),
    vscode.commands.registerCommand('browserChat.screenshot', () => {
      panelManager?.postMessage({ type: 'screenshot:request', payload: {} });
    })
  );
}

export function deactivate() {
  panelManager?.dispose();
  panelManager = undefined;
}
