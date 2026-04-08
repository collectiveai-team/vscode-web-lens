import type { ContextExtractor } from '../context/ContextExtractor';
import type { ExtensionMessage, WebviewMessage } from '../types';

type BroadcastMessage =
  | ExtensionMessage
  | { type: 'copyToClipboard'; text: string }
  | { type: '__standalone_reload' };

interface DeliveryDeps {
  contextExtractor: ContextExtractor;
  currentUrl: string;
  broadcast(message: BroadcastMessage): void;
}

export function handleStandaloneContextDelivery(
  message: WebviewMessage,
  { contextExtractor, currentUrl, broadcast }: DeliveryDeps
): boolean {
  switch (message.type) {
    case 'inspect:sendToChat':
    case 'addElement:captured': {
      const bundle = contextExtractor.fromCapturedElement(message.payload, currentUrl);
      broadcast({ type: 'copyToClipboard', text: JSON.stringify(bundle, null, 2) });
      broadcast({ type: 'toast', payload: { message: 'Context copied to clipboard', toastType: 'success' } });
      return true;
    }
    case 'annotate:sendToChat': {
      const bundle = contextExtractor.fromAnnotation(
        message.payload.imageDataUrl,
        message.payload.prompt,
        currentUrl
      );
      broadcast({ type: 'copyToClipboard', text: JSON.stringify(bundle, null, 2) });
      broadcast({ type: 'toast', payload: { message: 'Context copied to clipboard', toastType: 'success' } });
      return true;
    }
    case 'action:addLogs': {
      const bundle = contextExtractor.fromLogs(message.payload.logs, currentUrl);
      broadcast({ type: 'copyToClipboard', text: JSON.stringify(bundle, null, 2) });
      broadcast({ type: 'toast', payload: { message: 'Logs copied to clipboard', toastType: 'success' } });
      return true;
    }
    case 'action:screenshot': {
      const bundle = contextExtractor.fromScreenshot(message.payload.dataUrl, currentUrl);
      broadcast({ type: 'copyToClipboard', text: JSON.stringify(bundle, null, 2) });
      broadcast({ type: 'toast', payload: { message: 'Screenshot copied to clipboard', toastType: 'success' } });
      return true;
    }
    default:
      return false;
  }
}
