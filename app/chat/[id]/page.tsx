'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatDay, formatTime } from '../../_lib/format';
import { useChat } from '../../_lib/use-chat';
import { useSession } from '../../_lib/session';
import type { ChatMessage, Room } from '../../_lib/types';
import { Loading, Notice, RequireAuth } from '../../_components/ui';

const MAX = 1000;

function senderName(room: Room | null, id: string): string {
  const named = room?.members.find((m) => m.id === id)?.name;
  if (named) return named;
  if (room?.kind === 'booking') return id === room.ownerId ? 'El local' : 'Jugador';
  return 'Jugador';
}

function Bubble({ m, mine, name, showName }: { m: ChatMessage; mine: boolean; name: string; showName: boolean }) {
  if (m.kind === 'system') {
    return <li className="my-2 text-center"><span className="rounded-full border px-3 py-1 text-sm text-mute" style={{ borderWidth: 1.5 }}>{m.text}</span></li>;
  }
  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'} ${showName ? 'mt-3' : 'mt-1'}`}>
      {showName && !mine && <span className="mb-0.5 px-1 text-sm text-mute">{name}</span>}
      <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 sm:max-w-[70%] ${mine ? 'rounded-br-md bg-lamp text-lamp-ink' : 'rounded-bl-md border bg-pitch-raised'}`} style={mine ? undefined : { borderWidth: 1.5 }}>
        {m.text}
        <span className={`num ml-2 text-sm ${mine ? 'text-lamp-ink/70' : 'text-mute'}`}>{formatTime(m.createdAt)}</span>
      </div>
    </li>
  );
}

function Conversation() {
  const raw = useParams<{ id: string }>().id;
  const roomId = (() => { try { return decodeURIComponent(raw); } catch { return raw; } })();
  const { user } = useSession();
  const chat = useChat(roomId);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);
  useEffect(() => { stick.current = true; }, [roomId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setProblem('');
    stick.current = true;
    const err = await chat.send(t);
    if (err) setProblem(err); else setText('');
    setSending(false);
  }

  const { state, room } = chat;
  if (state === 'connecting' && !room) return <Loading label="Entrando a la conversación…" />;
  if (state === 'forbidden' || state === 'missing') {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <h1 className="font-display text-4xl font-extrabold tracking-wide">{state === 'missing' ? 'Esta conversación aún no está lista' : 'No tienes acceso a esta conversación'}</h1>
        <p className="mt-2 text-mute">{state === 'missing' ? 'Se crea unos segundos después de pagar la reserva o abrir el partido. Vuelve a intentarlo en un momento.' : 'Solo participan quienes reservaron o están en el partido.'}</p>
        <Link href="/chat" className="btn-line mt-5">Ver mis conversaciones</Link>
      </div>
    );
  }
  const names = room && room.kind === 'match' ? room.members.map((m) => m.name).join(', ') : room ? 'Tú y el local' : '';
  const closed = state === 'closed';

  return (
    <div className="mx-auto flex h-[calc(100dvh-10.5rem)] max-w-3xl flex-col md:h-[calc(100dvh-8rem)]">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/chat" className="text-sm text-mute hover:text-chalk">‹ Conversaciones</Link>
          <h1 className="truncate font-display text-3xl font-extrabold leading-tight tracking-wide">{room?.venueName}</h1>
          <p className="truncate text-sm text-mute">{room?.courtName} · <span className="cap-first inline-block">{room ? formatDay(room.startsAt) : ''}</span> {room ? formatTime(room.startsAt) : ''} · {names}</p>
        </div>
        <span className={`mt-5 shrink-0 text-sm ${state === 'ready' && chat.online.length > 1 ? 'text-free' : 'text-mute'}`}>
          {state === 'offline' ? 'Reconectando…' : `${chat.online.length} en línea`}
        </span>
      </header>

      <div ref={list} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="line-card flex-1 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="Mensajes">
        {chat.hasMore && <div className="text-center"><button className="btn-quiet" onClick={() => { stick.current = false; chat.loadOlder(); }}>Ver mensajes anteriores</button></div>}
        {!chat.messages.length ? <p className="py-10 text-center text-mute">Todavía no hay mensajes. Escribe el primero.</p> : (
          <ul>{chat.messages.map((m, i) => {
            const prev = chat.messages[i - 1];
            return <Bubble key={m.id} m={m} mine={m.senderId === user?.id} name={senderName(room, m.senderId)} showName={!prev || prev.senderId !== m.senderId || prev.kind === 'system'} />;
          })}</ul>
        )}
      </div>

      <div className="mt-3">
        {closed ? <Notice tone="info">Esta conversación está cerrada. Puedes leer el historial, pero ya no se puede escribir.</Notice> : (
          <form onSubmit={submit} className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="msg" className="sr-only">Mensaje</label>
              <textarea id="msg" className="field max-h-32 min-h-[48px] resize-none" rows={1} placeholder="Escribe un mensaje…" value={text} maxLength={MAX + 50}
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
              {text.length > MAX - 100 && <p className={`mt-1 text-sm ${text.length > MAX ? 'text-alert' : 'text-mute'}`}>{text.length}/{MAX}</p>}
            </div>
            <button className="btn-lamp" disabled={sending || state !== 'ready' || !text.trim() || text.length > MAX}>Enviar</button>
          </form>
        )}
        {problem && <div className="mt-2"><Notice tone="error">{problem}</Notice></div>}
      </div>
    </div>
  );
}
export default function Page() { return <RequireAuth><Conversation /></RequireAuth>; }
