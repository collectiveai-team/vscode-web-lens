import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const openCmd = vscode.commands.registerCommand('browserChat.open', () => {
    vscode.window.showInformationMessage('Browser Chat: coming soon');
  });

  context.subscriptions.push(openCmd);
}

export function deactivate() {
  // Cleanup
}
