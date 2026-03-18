import * as vscode from 'vscode';
import { BrowserPanelManager } from './panel/BrowserPanelManager';

let panelManager: BrowserPanelManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  panelManager = new BrowserPanelManager(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand('browserChat.open', () => {
      panelManager!.open();
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
        panelManager!.open();
        panelManager!.postMessage({ type: 'navigate:url', payload: { url } });
      }
    }),
    vscode.commands.registerCommand('browserChat.inspect', () => {
      panelManager!.postMessage({ type: 'mode:inspect', payload: { enabled: true } });
    }),
    vscode.commands.registerCommand('browserChat.addElement', () => {
      panelManager!.postMessage({ type: 'mode:addElement', payload: { enabled: true } });
    }),
    vscode.commands.registerCommand('browserChat.addLogs', () => {
      // Placeholder — the webview's toolbar button handles log capture directly.
      // This command will be properly wired in Chunk 4 (Task 13).
      vscode.window.showInformationMessage('Use the toolbar button to capture logs');
    }),
    vscode.commands.registerCommand('browserChat.screenshot', () => {
      panelManager!.postMessage({ type: 'screenshot:request', payload: {} });
    })
  );
}

export function deactivate() {
  panelManager?.dispose();
  panelManager = undefined;
}
