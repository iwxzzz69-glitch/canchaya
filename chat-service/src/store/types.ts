import { BookingEvent, MatchEvent, Message, Room } from '../types';

export const MAX_MESSAGE_LENGTH = 1000;

/** Resultado de aplicar un evento de partido; el gateway lo usa para avisar a los clientes. */
export interface MatchApplyResult {
  /** false si el evento era viejo o repetido (versión ya aplicada o superada): no hubo cambios. */
  applied: boolean;
  room: Room;
  addedIds: string[];
  removedIds: string[];
  /** La sala pasó de abierta a cerrada con este evento. */
  closedNow: boolean;
  /** Aviso generado ("Luis se unió al partido"), ya guardado en el historial. */
  systemMessage: Message | null;
}

/** Todo lo que el chat guarda. Hay una versión en memoria (tests) y otra en MongoDB. */
export interface ChatStore {
  init(): Promise<void>;
  /**
   * Aplica un evento de reserva. Es idempotente y no depende del orden de llegada:
   *  - booking.confirmed abre la sala (si ya estaba cerrada, sigue cerrada: una reserva
   *    cancelada nunca vuelve a confirmarse).
   *  - booking.cancelled cierra la sala, aunque el "confirmed" no haya llegado todavía.
   */
  applyBookingEvent(event: BookingEvent): Promise<{ closedMatchRooms: Room[] }>;
  /**
   * Aplica un evento de partido. Cada evento trae el estado completo y una versión: solo se aplica
   * si su versión es mayor que la guardada, así que repeticiones y llegadas desordenadas dan el
   * mismo resultado final. Una sala cerrada nunca se reabre.
   */
  applyMatchEvent(event: MatchEvent): Promise<MatchApplyResult>;
  getRoom(roomId: string): Promise<Room | null>;
  listRoomsFor(userId: string): Promise<Room[]>;
  addMessage(input: { roomId: string; senderId: string; text: string; kind?: 'user' | 'system' }): Promise<Message>;
  /** Mensajes en orden cronológico; `before` es el id del mensaje más antiguo que ya se tiene. */
  listMessages(roomId: string, options: { before?: string; limit: number }): Promise<Message[]>;
  close(): Promise<void>;
}

/** Texto del aviso que se deja en la sala cuando cambia el partido; null si no merece aviso. */
export function systemText(event: MatchEvent): string | null {
  const name = event.data.changedPlayer?.name;
  if (event.type === 'match.player_joined' && name) return `${name} se unió al partido`;
  if (event.type === 'match.player_left' && name) return `${name} salió del partido`;
  if (event.type === 'match.cancelled') return 'El organizador canceló el partido';
  return null;
}

let lastMs = 0;
let counter = 0;

/**
 * Id de mensaje ordenable: milisegundos (15 dígitos) + contador + sufijo aleatorio. El contador
 * hace que los mensajes creados en el mismo milisegundo por este proceso conserven su orden
 * (con solo el sufijo aleatorio, "dos" podía aparecer antes que "uno"). Si el reloj retrocede se
 * sigue usando el último instante, para que los ids nunca disminuyan. Sirve de cursor de paginación.
 */
export function newMessageId(random: string, now: number = Date.now()): { id: string; createdAt: Date } {
  const ms = Math.max(now, lastMs);
  counter = ms === lastMs ? counter + 1 : 0;
  lastMs = ms;
  return { id: `${String(ms).padStart(15, '0')}-${String(counter).padStart(6, '0')}-${random}`, createdAt: new Date(ms) };
}
