'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, CHAT_URL, sessionStore } from './api';
import type { ChatMessage, Room } from './types';

export type ChatState = 'connecting' | 'ready' | 'closed' | 'forbidden' | 'missing' | 'offline';

const SEND_ERRORS: Record<string, string> = {
  invalid_message: 'El mensaje está vacío o es demasiado largo (máximo 1000 caracteres).',
  rate_limited: 'Estás escribiendo muy rápido. Espera unos segundos.',
  room_closed: 'Esta conversación ya está cerrada.',
  forbidden: 'Ya no formas parte de esta conversación.',
  not_joined: 'Se perdió la conexión con la sala. Recarga la página.',
  timeout: 'No hubo respuesta del servidor. Inténtalo de nuevo.',
};

/** Conexión en tiempo real a una sala: historial, mensajes nuevos, presencia y cierre. */
export function useChat(roomId: string) {
  const [state, setState] = useState<ChatState>('connecting');
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = sessionStore.read()?.accessToken;
    if (!token) return setState('forbidden');
    setState('connecting');
    const socket = io(CHAT_URL, { auth: { token }, transports: ['websocket'] });
    socketRef.current = socket;

    const join = () =>
      socket.timeout(8000).emit('room:join', roomId, (err: Error | null, res: any) => {
        if (err) return setState('offline');
        if (!res?.ok) return setState(res?.error === 'room_not_found' ? 'missing' : 'forbidden');
        setRoom(res.room);
        setMessages(res.messages);
        setHasMore(res.messages.length >= 50);
        setOnline(res.online);
        setState(res.room.status === 'closed' ? 'closed' : 'ready');
      });

    socket.on('connect', join); // también al reconectar: vuelve a entrar y recupera lo que se perdió
    socket.on('connect_error', (e) => setState(e.message === 'unauthorized' ? 'forbidden' : 'offline'));
    socket.on('disconnect', () => setState((s) => (s === 'closed' ? s : 'offline')));
    socket.on('message:new', (m: ChatMessage) => {
      if (m.roomId === roomId) setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    });
    socket.on('presence:update', (p: { roomId: string; online: string[] }) => p.roomId === roomId && setOnline(p.online));
    socket.on('room:closed', (p: { roomId: string }) => {
      if (p.roomId === roomId) {
        setState('closed');
        setRoom((r) => (r ? { ...r, status: 'closed' } : r));
      }
    });
    socket.on('room:left', (p: { roomId: string }) => p.roomId === roomId && setState('forbidden'));
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [roomId]);

  /** Devuelve un texto de error para mostrar, o null si se envió. */
  const send = useCallback(
    (text: string) =>
      new Promise<string | null>((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) return resolve('Sin conexión. Inténtalo en un momento.');
        socket.timeout(8000).emit('message:send', { roomId, text }, (err: Error | null, res: any) => {
          if (err) return resolve(SEND_ERRORS.timeout);
          if (res?.ok) {
            // Llegan dos copias (la confirmación y 'message:new'): se agrega la primera y se descarta la repetida por id.
            setMessages((prev) => (prev.some((x) => x.id === res.message.id) ? prev : [...prev, res.message]));
            return resolve(null);
          }
          resolve(SEND_ERRORS[res?.error] ?? 'No se pudo enviar el mensaje.');
        });
      }),
    [roomId],
  );

  const loadOlder = useCallback(async () => {
    const first = messages[0];
    if (!first) return;
    const r = await api<{ messages: ChatMessage[] }>(`/rooms/${encodeURIComponent(roomId)}/messages?limit=50&before=${encodeURIComponent(first.id)}`, { base: CHAT_URL });
    setMessages((prev) => [...r.messages, ...prev]);
    setHasMore(r.messages.length >= 50);
  }, [messages, roomId]);

  return { state, room, messages, online, hasMore, send, loadOlder };
}
