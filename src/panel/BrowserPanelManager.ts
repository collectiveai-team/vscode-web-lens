import * as vscode from 'vscode';
import { WebviewMessage, ExtensionMessage } from '../types';

interface PanelState {
  url: string;
  history: string[];
  historyIndex: number;
}

export class BrowserPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private state: PanelState;
  private readonly extensionUri: vscode.Uri;
  private messageHandler: ((msg: WebviewMessage) => void) | undefined;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    const config = vscode.workspace.getConfiguration('browserChat');
    this.state = {
      url: config.get<string>('defaultUrl') || 'http://localhost:3000',
      history: [],
      historyIndex: -1,
    };
  }

  open() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'browserChat',
      'Browser Chat',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'webview'),
          vscode.Uri.joinPath(this.extensionUri, 'out'),
        ],
      }
    );

    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message)
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    // Navigate to default URL
    this.postMessage({ type: 'navigate:url', payload: { url: this.state.url } });
  }

  onMessage(handler: (msg: WebviewMessage) => void) {
    this.messageHandler = handler;
  }

  postMessage(message: ExtensionMessage) {
    this.panel?.webview.postMessage(message);
  }

  dispose() {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private handleMessage(message: WebviewMessage) {
    switch (message.type) {
      case 'navigate':
        this.navigate(message.payload.url);
        break;
      case 'nav:back':
        this.goBack();
        break;
      case 'nav:forward':
        this.goForward();
        break;
      case 'nav:reload':
        this.postMessage({ type: 'navigate:url', payload: { url: this.state.url } });
        break;
      case 'iframe:loaded':
        this.onIframeLoaded(message.payload.url);
        break;
      case 'menu:openSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', 'browserChat');
        break;
      case 'menu:copyHtml':
        vscode.env.clipboard.writeText(message.payload.html);
        this.postMessage({
          type: 'toast',
          payload: { message: 'HTML copied to clipboard', toastType: 'success' },
        });
        break;
      default:
        // Forward to external handler (ContextExtractor, adapters)
        this.messageHandler?.(message);
        break;
    }
  }

  private navigate(url: string) {
    // Trim history after current position
    this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
    this.state.history.push(url);
    this.state.historyIndex = this.state.history.length - 1;
    this.state.url = url;
    this.postMessage({ type: 'navigate:url', payload: { url } });
  }

  private goBack() {
    if (this.state.historyIndex > 0) {
      this.state.historyIndex--;
      this.state.url = this.state.history[this.state.historyIndex];
      this.postMessage({ type: 'navigate:url', payload: { url: this.state.url } });
    }
  }

  private goForward() {
    if (this.state.historyIndex < this.state.history.length - 1) {
      this.state.historyIndex++;
      this.state.url = this.state.history[this.state.historyIndex];
      this.postMessage({ type: 'navigate:url', payload: { url: this.state.url } });
    }
  }

  private onIframeLoaded(url: string) {
    if (url !== this.state.url) {
      // iframe navigated internally
      this.navigate(url);
    }
  }

  private getHtmlForWebview(): string {
    const webview = this.panel!.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview', 'main.css')
    );
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com;
    font-src https://fonts.gstatic.com;
    script-src 'nonce-${nonce}';
    frame-src http: https:;
    img-src ${webview.cspSource} https: data:;
  ">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet">
  <link href="${styleUri}" rel="stylesheet">
  <title>Browser Chat</title>
</head>
<body>
  <div id="toolbar"></div>
  <div id="browser-frame">
    <iframe id="browser-iframe" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
