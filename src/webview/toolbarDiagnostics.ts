import type { WebviewMessage } from '../types';

interface ToolbarStateSnapshot {
  inspectActive: boolean;
  addElementActive: boolean;
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
  }

  if (!message) {
    return '';
  }

  return `${message} &nbsp; <kbd>ESC</kbd> to cancel`;
}
