// Message protocol types — discriminated union

// ── Recording types ────────────────────────────────────────

export type RecordedEvent =
  | {
      type: 'click';
      timestamp: number;
      selector: string;
      selectorType: string;
      text: string;
      position: { x: number; y: number };
    }
  | {
      type: 'input';
      timestamp: number;
      selector: string;
      selectorType: string;
      value: string;
    }
  | {
      type: 'navigation';
      timestamp: number;
      url: string;
      trigger: 'pushState' | 'replaceState' | 'popstate' | 'load';
    }
  | { type: 'scroll'; timestamp: number; x: number; y: number }
  | { type: 'hover'; timestamp: number; selector: string; selectorType: string }
  | { type: 'console'; timestamp: number; level: string; message: string };

export interface RecordOptions {
  captureConsole: boolean;
  captureScroll: boolean;
  captureHover: boolean;
}

// Webview -> Extension Host
export type WebviewMessage =
  | { type: 'navigate'; payload: { url: string } }
  | { type: 'nav:back'; payload: Record<string, never> }
  | { type: 'nav:forward'; payload: Record<string, never> }
  | { type: 'nav:reload'; payload: Record<string, never> }
  | { type: 'inspect:selected'; payload: InspectSelectedPayload }
  | { type: 'inspect:sendToChat'; payload: CapturedElementPayload }
  | { type: 'annotate:sendToChat'; payload: { imageDataUrl: string; prompt: string } }
  | { type: 'addElement:captured'; payload: CapturedElementPayload }
  | { type: 'action:addLogs'; payload: { logs: ConsoleEntry[] } }
  | { type: 'action:screenshot'; payload: { dataUrl: string } }
  | { type: 'iframe:loaded'; payload: { url: string; title: string; canInject: boolean } }
  | { type: 'iframe:error'; payload: { url: string; error: string } }
  | { type: 'menu:copyHtml'; payload: { html: string } }
  | { type: 'menu:clearSelection'; payload: Record<string, never> }
  | { type: 'menu:openSettings'; payload: Record<string, never> }
  | { type: 'diagnostic:log'; payload: DiagnosticPayload }
  | { type: 'backend:request'; payload: Record<string, never> }
  | { type: 'backend:select'; payload: { backend: string } }
  | { type: 'storage:setEnabled'; payload: { enabled: boolean } }
  | { type: 'storage:openView'; payload: Record<string, never> }
  | { type: 'storage:clear'; payload: { origin: string } }
  | { type: 'storage:deleteEntries'; payload: { origin: string; names: string[] } }
  | { type: 'recording:start'; payload: RecordOptions }
  | { type: 'recording:stop' }
  | { type: 'recording:event'; payload: RecordedEvent };

// Extension Host -> Webview
export type ExtensionMessage =
  | { type: 'navigate:url'; payload: { url: string } }
  | { type: 'mode:inspect'; payload: { enabled: boolean } }
  | { type: 'mode:addElement'; payload: { enabled: boolean } }
  | { type: 'screenshot:request'; payload: Record<string, never> }
  | { type: 'config:update'; payload: { backend: string } }
  | { type: 'toast'; payload: { message: string; toastType: 'success' | 'error' } }
  | { type: 'backend:state'; payload: { active: string; available: Record<string, boolean> } }
  | { type: 'theme:update'; payload: { kind: 'dark' | 'light' } }
  | { type: 'storage:state'; payload: { origin: string; enabled: boolean; hasData: boolean } }
  | { type: 'storage:view'; payload: { origin: string; names: string[] } }
  | { type: 'addLogs:request'; payload: Record<string, never> }
  | { type: 'recording:started' }
  | { type: 'recording:stopped'; payload: { filePath: string } }
  | { type: 'recording:initOptions'; payload: RecordOptions }
  | { type: 'mode:record'; payload: { enabled: boolean } };
  // Note: spec uses `type` for toast payload, but we use `toastType` to avoid
  // collision with the message discriminant `type` field.

export interface InspectSelectedPayload {
  html: string;
  tag: string;
  classes: string[];
  dimensions: { top: number; left: number; width: number; height: number };
  accessibility: AccessibilityInfo;
}

export interface CapturedElementPayload {
  html: string;
  tag: string;
  classes: string[];
  dimensions: { top: number; left: number; width: number; height: number };
  accessibility: AccessibilityInfo;
  parentHtml: string;
  ancestorPath: string;
  sourceLocation?: SourceLocation;
  screenshotDataUrl: string;
  attributes?: Record<string, string>;
  innerText?: string;
  computedStyles?: Record<string, string>;
}

export interface AccessibilityInfo {
  name?: string;
  role?: string;
  focusable?: boolean;
}

export interface SourceLocation {
  filePath: string;
  line: number;
  column?: number;
}

export interface ContextBundle {
  url: string;
  timestamp: number;
  element?: ElementContext;
  screenshot?: ScreenshotData;
  logs?: ConsoleEntry[];
  annotation?: string;
}

export interface ElementContext {
  html: string;
  parentHtml: string;
  ancestorPath: string;
  tag: string;
  classes: string[];
  id?: string;
  dimensions: { top: number; left: number; width: number; height: number };
  accessibility: AccessibilityInfo;
  sourceLocation?: SourceLocation;
  attributes?: Record<string, string>;
  innerText?: string;
  computedStyles?: Record<string, string>;
}

export interface ScreenshotData {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface DiagnosticPayload {
  source: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  details?: string;
}

export interface DeliveryResult {
  success: boolean;
  message: string;
}
