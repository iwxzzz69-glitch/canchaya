// Contrato de quien entrega eventos al bus. El relevo solo conoce esta interfaz.
export const EVENT_PUBLISHER = 'EVENT_PUBLISHER';

export interface PublishedEnvelope {
  eventId: string;
  type: string;
  occurredAt: string;
  version: 1;
  data: Record<string, unknown>;
}

export interface EventPublisher {
  /** Resuelve solo cuando el bus confirmó la recepción; lanza si no. */
  publish(envelope: PublishedEnvelope): Promise<void>;
  close?(): Promise<void>;
}
