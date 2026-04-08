import * as vscode from 'vscode';
import { WebviewMessage, ExtensionMessage } from '../types';
import { ProxyServer } from '../proxy/ProxyServer';
import { webLensLogger } from '../logging';
import type { CookieStore } from '../cookies/CookieStore';
import * as crypto from 'crypto';

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

  constructor(extensionUri: vscode.Uri, private readonly cookieStore?: CookieStore) {
    this.extensionUri = extensionUri;
    const config = vscode.workspace.getConfiguration('webLens');
    this.state = {
      url: config.get<string>('defaultUrl') || 'http://localhost:3000',
      history: [],
      historyIndex: -1,
    };
    this.proxyServer = new ProxyServer(extensionUri.fsPath, this.state.url);
    if (cookieStore) {
      this.proxyServer.setCookieStore(cookieStore);
    }
  }

  async open() {
    if (this.panel) {
      webLensLogger.info('Revealing existing panel');
      this.panel.reveal();
      return;
    }

    // Start the proxy server before creating the panel
    await this.proxyServer.start();
    webLensLogger.info('Opening browser panel', { url: this.state.url });

    this.panel = vscode.window.createWebviewPanel(
      'webLens',
      'Web Lens Debug',
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
      webLensLogger.info('Browser panel disposed');
      this.panel = undefined;
      this.proxyServer.stop().catch(() => {
        // Ignore stop errors on dispose
      });
    });

    // Navigate to default URL (through proxy)
    const proxiedUrl = this.proxyServer.getProxiedUrl(this.state.url);
    this.postMessage({ type: 'navigate:url', payload: { url: proxiedUrl } });
    this.sendStorageState().catch((err) => {
      webLensLogger.warn('BrowserPanelManager: failed to send initial storage state', String(err));
    });
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
        vscode.commands.executeCommand('workbench.action.openSettings', 'webLens');
        break;
      case 'menu:copyHtml':
        vscode.env.clipboard.writeText(message.payload.html);
        this.postMessage({
          type: 'toast',
          payload: { message: 'HTML copied to clipboard', toastType: 'success' },
        });
        break;
      case 'storage:setEnabled': {
        const target = vscode.workspace.workspaceFolders
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
        Promise.resolve(
          vscode.workspace
            .getConfiguration('webLens')
            .update('storeCookies', message.payload.enabled, target)
        )
          .then(() => this.sendStorageState())
          .catch((err: unknown) => {
            webLensLogger.warn('BrowserPanelManager: failed to update storeCookies', String(err));
          });
        break;
      }
      case 'storage:openView': {
        if (!this.cookieStore) break;
        const origin = this.proxyServer.getTargetOrigin();
        this.cookieStore.listNames(origin).then((names) => {
          this.postMessage({ type: 'storage:view', payload: { origin, names } });
        }).catch((err) => {
          webLensLogger.warn('BrowserPanelManager: failed to list cookie names', String(err));
        });
        break;
      }
      case 'storage:clear': {
        if (!this.cookieStore) break;
        this.cookieStore.clear(message.payload.origin).then(() => this.sendStorageState()).catch((err) => {
          webLensLogger.warn('BrowserPanelManager: failed to clear cookies', String(err));
        });
        break;
      }
      case 'storage:deleteEntries': {
        if (!this.cookieStore) break;
        const { origin, names } = message.payload;
        this.cookieStore.remove(origin, names).then(async () => {
          const remaining = await this.cookieStore!.listNames(origin);
          this.postMessage({ type: 'storage:view', payload: { origin, names: remaining } });
          await this.sendStorageState();
        }).catch((err) => {
          webLensLogger.warn('BrowserPanelManager: failed to delete cookie entries', String(err));
        });
        break;
      }
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
    webLensLogger.info('Navigating browser panel', { url });

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
    webLensLogger.info('Reloading browser panel', { url: this.state.url });
    const proxiedUrl = this.proxyServer.getProxiedUrl(this.state.url);
    this.postMessage({ type: 'navigate:url', payload: { url: proxiedUrl } });
  }

  private onIframeLoaded(url: string) {
    webLensLogger.info('Iframe reported load', { url });
    const fullUrl = url.startsWith('/')
      ? `${this.proxyServer.getTargetOrigin()}${url}`
      : url;
    if (fullUrl !== this.state.url) {
      this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
      this.state.history.push(fullUrl);
      this.state.historyIndex = this.state.history.length - 1;
      this.state.url = fullUrl;
    }
    // Send storage state so the webview toolbar can update
    this.sendStorageState().catch((err) => {
      webLensLogger.warn('BrowserPanelManager: failed to send storage state after load', String(err));
    });
  }

  /** Send current storage state to the webview. Called on navigation and config changes. */
  async sendStorageState(): Promise<void> {
    if (!this.cookieStore) return;
    const origin = this.proxyServer.getTargetOrigin();
    const enabled = this.cookieStore.isEnabled();
    const names = enabled ? await this.cookieStore.listNames(origin) : [];
    this.postMessage({
      type: 'storage:state',
      payload: { origin, enabled, hasData: names.length > 0 },
    });
  }

  /** Called by extension.ts when webLens.storeCookies config changes. */
  refreshStorageState(): void {
    this.sendStorageState().catch((err) => {
      webLensLogger.warn('BrowserPanelManager: failed to refresh storage state', String(err));
    });
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
    const codexLight = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'codex-light.svg'));
    const codexDark = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'codex-dark.svg'));
    const claudecodeLight = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'claudecode-light.svg'));
    const claudecodeDark = webview.asWebviewUri(vscode.Uri.joinPath(iconBase, 'claudecode-dark.svg'));

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
  <title>Web Lens Debug</title>
</head>
<body data-theme="${dataTheme}" data-target-origin="${this.proxyServer.getTargetOrigin()}">
  <div id="backend-icons" hidden
    data-opencode-light="${opencodeLight}"
    data-opencode-dark="${opencodeDark}"
    data-openchamber-light="${openchamberLight}"
    data-openchamber-dark="${openchamberDark}"
    data-codex-light="${codexLight}"
    data-codex-dark="${codexDark}"
    data-claudecode-light="${claudecodeLight}"
    data-claudecode-dark="${claudecodeDark}"
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
    return crypto.randomBytes(16).toString('base64url');
  }
}
