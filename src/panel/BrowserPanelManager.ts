import * as vscode from 'vscode';
import { WebviewMessage, ExtensionMessage } from '../types';
import { ProxyServer } from '../proxy/ProxyServer';

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
  private proxyServer: ProxyServer;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    const config = vscode.workspace.getConfiguration('browserChat');
    this.state = {
      url: config.get<string>('defaultUrl') || 'http://localhost:3000',
      history: [],
      historyIndex: -1,
    };
    this.proxyServer = new ProxyServer(extensionUri.fsPath);
  }

  async open() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    // Start the proxy server before creating the panel
    await this.proxyServer.start();

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
          vscode.Uri.joinPath(this.extensionUri, 'media', 'icons'),
        ],
      }
    );

    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message)
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.proxyServer.stop().catch(() => {
        // Ignore stop errors on dispose
      });
    });

    // Navigate to default URL (through proxy)
    const proxiedUrl = this.proxyServer.getProxiedUrl(this.state.url);
    this.postMessage({ type: 'navigate:url', payload: { url: proxiedUrl } });
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
    this.proxyServer.stop().catch(() => {
      // Ignore stop errors on dispose
    });
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
        this.reload();
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

    // Route through proxy
    const proxiedUrl = this.proxyServer.getProxiedUrl(url);
    this.postMessage({ type: 'navigate:url', payload: { url: proxiedUrl } });
  }

  private goBack() {
    if (this.state.historyIndex > 0) {
      this.state.historyIndex--;
      this.state.url = this.state.history[this.state.historyIndex];
      const proxiedUrl = this.proxyServer.getProxiedUrl(this.state.url);
      this.postMessage({ type: 'navigate:url', payload: { url: proxiedUrl } });
    }
  }

  private goForward() {
    if (this.state.historyIndex < this.state.history.length - 1) {
      this.state.historyIndex++;
      this.state.url = this.state.history[this.state.historyIndex];
      const proxiedUrl = this.proxyServer.getProxiedUrl(this.state.url);
      this.postMessage({ type: 'navigate:url', payload: { url: proxiedUrl } });
    }
  }

  private reload() {
    const proxiedUrl = this.proxyServer.getProxiedUrl(this.state.url);
    this.postMessage({ type: 'navigate:url', payload: { url: proxiedUrl } });
  }

  private onIframeLoaded(url: string) {
    if (url !== this.state.url) {
      // iframe navigated internally — update history with the original URL
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
    // Backend icon URIs
    const iconBase = vscode.Uri.joinPath(this.extensionUri, 'media', 'icons');
    const opencodeLight = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'opencode-light.svg'));
    const opencodeDark = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'opencode-dark.svg'));
    const openchamberLight = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'openchamber-light.svg'));
    const openchamberDark = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'openchamber-dark.svg'));

    // Theme kind for icon visibility
    const themeKind = vscode.window.activeColorTheme.kind;
    const dataTheme = (themeKind === vscode.ColorThemeKind.Light ||
                       themeKind === vscode.ColorThemeKind.HighContrastLight)
      ? 'light' : 'dark';

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
    connect-src http: https:;
  ">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet">
  <link href="${styleUri}" rel="stylesheet">
  <title>Browser Chat</title>
</head>
<body data-theme="${dataTheme}">
  <div id="backend-icons" hidden
    data-opencode-light="${opencodeLight}"
    data-opencode-dark="${opencodeDark}"
    data-openchamber-light="${openchamberLight}"
    data-openchamber-dark="${openchamberDark}"
  ></div>
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
