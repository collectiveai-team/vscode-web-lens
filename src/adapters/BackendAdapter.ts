import type { ContextBundle, DeliveryResult } from '../types';

export interface BackendAdapter {
  readonly name: string;
  deliver(bundle: ContextBundle): Promise<DeliveryResult>;
  isAvailable(): Promise<boolean>;
}
