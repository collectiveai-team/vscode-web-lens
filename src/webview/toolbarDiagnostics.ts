import type { RecordOptions, WebviewMessage } from '../types';

interface ToolbarStateSnapshot {
  inspectActive: boolean;
  addElementActive: boolean;
  annotateActive: boolean;
}

export function createToolbarDiagnostic(message: string, details?: string): WebviewMessage {
  return {
    type: 'diagnostic:log',
    payload: {
      source: 'webview.toolbar',
      level: 'info',
      message,
      details,
    },
  };
}

export function getInstructionBannerHtml(state: ToolbarStateSnapshot): string {
  let message = '';

  if (state.inspectActive) {
    message = 'Inspect mode active - hover elements, click to inspect';
  } else if (state.addElementActive) {
    message = 'Click any element to add it to chat';
  } else if (state.annotateActive) {
    message = 'Annotation mode active - draw, then press Send to attach to chat';
  }

  if (!message) {
    return '';
  }

  return `${message} &nbsp; <kbd>ESC</kbd> to cancel`;
}

export function getRecordConfigBannerHtml(opts: RecordOptions): string {
  const checked = (val: boolean) => (val ? ' checked' : '');
  return `
    <span class="record-config-label">Also capture:</span>
    <label class="record-config-check">
      <input type="checkbox" data-record-opt="captureConsole"${checked(opts.captureConsole)} />
      Console
    </label>
    <label class="record-config-check">
      <input type="checkbox" data-record-opt="captureScroll"${checked(opts.captureScroll)} />
      Scroll
    </label>
    <label class="record-config-check">
      <input type="checkbox" data-record-opt="captureHover"${checked(opts.captureHover)} />
      Hover
    </label>
    <button class="record-start-btn" data-record-start>&#9210; Start</button>
    <button class="record-cancel-btn" data-record-cancel>&#x2715;</button>
  `.trim();
}

export function getRecordActiveBannerHtml(eventCount: number, elapsedSeconds: number): string {
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = String(elapsedSeconds % 60).padStart(2, '0');
  return `
    <span class="record-dot"></span>
    <span class="record-status-text">Recording&hellip; ${eventCount} event${eventCount !== 1 ? 's' : ''} &nbsp;|&nbsp; ${mins}:${secs}</span>
    <button class="record-stop-btn" data-record-stop>&#9632; Stop &amp; Save</button>
  `.trim();
}
