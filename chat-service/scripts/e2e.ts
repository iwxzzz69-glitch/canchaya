/**
 * Prueba de punta a punta de la Fase 4. Se ejecuta DENTRO del contenedor del chat, con el stack real:
 *   docker compose exec chat-service npx tsx scripts/e2e.ts
 *
 * Recorre: monolito (reserva + pago) -> bandeja de salida -> RabbitMQ -> chat-service -> MongoDB
 * -> Socket.IO. Usa la pasarela simulada del monolito, así que no cobra nada.
 */
import { io, Socket } from 'socket.io-client';

const API = process.env.E2E_API_URL ?? 'http://backend:3001';
const CHAT = process.env.E2E_CHAT_URL ?? 'http://localhost:3002';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  OK    ${name}`);
  } else {
    fail++;
    console.log(`  FALLA ${name} ${extra}`);
  }
};

async function call(base: string, method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    await sleep(300);
  }
  return undefined;
}

async function register(name: string, role: 'player' | 'owner') {
  const email = `${name.replace(/\s/g, '').toLowerCase()}${Date.now()}${Math.floor(Math.random() * 1e4)}@e2e.test`;
  const r = await call(API, 'POST', '/auth/register', undefined, { email, password: 'Clave12345', name, role });
  if (r.status !== 201 && r.status !== 200) throw new Error(`No se pudo registrar ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.accessToken as string, id: r.body.user.id as string };
}

function connect(token?: string): Promise<{ socket: Socket; error?: string }> {
  return new Promise((resolve) => {
    const socket = io(CHAT, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
    socket.on('connect', () => resolve({ socket }));
    socket.on('connect_error', (e) => {
      socket.close();
      resolve({ socket, error: e.message });
    });
  });
}
const emit = (socket: Socket, event: string, payload: unknown): Promise<any> =>
  new Promise((resolve) => socket.timeout(5000).emit(event, payload, (err: Error | null, res: unknown) => resolve(err ? { ok: false, error: 'timeout' } : res)));
const waitFor = (socket: Socket, event: string, ms = 5000) =>
  new Promise<any>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

async function main() {
  console.log('# Preparación (monolito)');
  const owner = await register('Dueno E2E', 'owner');
  const player = await register('Ana E2E', 'player');
  const stranger = await register('Intruso E2E', 'player');
  const venue = (await call(API, 'POST', '/venues', owner.token, { name: 'Local E2E', address: 'Av. 1', zone: 'Miraflores' })).body;
  const court = (await call(API, 'POST', `/venues/${venue.id}/courts`, owner.token, { name: 'Cancha E2E', sport: 'football', pricePerHour: 80 })).body;
  const day = new Date(Date.now() + 3 * 86_400_000 - 5 * 3_600_000).toISOString().slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  const startsAt = new Date(Date.UTC(y, m - 1, d, 20 + 5)).toISOString(); // 20:00 hora de Lima
  const booking = (await call(API, 'POST', '/bookings', player.token, { courtId: court.id, startsAt })).body;
  check('reserva creada (pending)', booking.status === 'pending', JSON.stringify(booking));

  console.log('# Sin pagar no hay chat');
  const before = await call(CHAT, 'GET', '/rooms', player.token);
  check('el jugador aún no tiene salas', before.status === 200 && before.body.length === 0, JSON.stringify(before.body));

  console.log('# Pago -> evento -> chat');
  const paid = await call(API, 'POST', `/bookings/${booking.id}/pay`, player.token, { tokenId: 'tkn_test_ok' });
  check('pago aprobado, reserva confirmed', paid.status === 200 && paid.body.booking.status === 'confirmed', JSON.stringify(paid.body));
  const room = await until(async () => {
    const r = await call(CHAT, 'GET', '/rooms', player.token);
    return r.body.find?.((x: any) => x.id === booking.id);
  });
  check('la sala aparece en el chat (bandeja de salida -> RabbitMQ -> chat -> MongoDB)', !!room);
  check('la sala está abierta y sabe local y cancha', room?.status === 'open' && room?.venueName === 'Local E2E' && room?.courtName === 'Cancha E2E', JSON.stringify(room));
  const ownerRooms = await call(CHAT, 'GET', '/rooms', owner.token);
  check('el dueño también ve la sala', ownerRooms.body.some?.((x: any) => x.id === booking.id));
  check('un tercero no ve la sala', (await call(CHAT, 'GET', '/rooms', stranger.token)).body.length === 0);
  check('sin token -> 401', (await call(CHAT, 'GET', '/rooms')).status === 401);

  console.log('# Tiempo real (Socket.IO)');
  const anon = await connect();
  check('conexión sin token rechazada', anon.error === 'unauthorized', String(anon.error));
  const bad = await connect('token-falso');
  check('conexión con token falso rechazada', bad.error === 'unauthorized', String(bad.error));

  const p = await connect(player.token);
  const o = await connect(owner.token);
  const s = await connect(stranger.token);
  check('jugador, dueño e intruso conectan con su JWT', !p.error && !o.error && !s.error);

  check('el intruso no puede entrar a la sala', (await emit(s.socket, 'room:join', booking.id)).error === 'forbidden');
  const joinP = await emit(p.socket, 'room:join', booking.id);
  check('el jugador entra y recibe la sala con su historial vacío', joinP.ok && joinP.messages.length === 0, JSON.stringify(joinP));
  const presence = waitFor(p.socket, 'presence:update');
  const joinO = await emit(o.socket, 'room:join', booking.id);
  check('el dueño entra y aparecen ambos en línea', joinO.ok && joinO.online.length === 2, JSON.stringify(joinO));
  const pr = await presence;
  check('el jugador es avisado de la presencia del dueño', pr?.online?.length === 2, JSON.stringify(pr));

  const incoming = waitFor(o.socket, 'message:new');
  const sent = await emit(p.socket, 'message:send', { roomId: booking.id, text: 'Hola, ¿hay balones?' });
  check('el jugador envía un mensaje', sent.ok && sent.message.text === 'Hola, ¿hay balones?', JSON.stringify(sent));
  const got = await incoming;
  check('el dueño lo recibe al instante', got?.text === 'Hola, ¿hay balones?' && got?.senderId === player.id, JSON.stringify(got));
  const replied = await emit(o.socket, 'message:send', { roomId: booking.id, text: 'Sí, te los dejamos listos.' });
  check('el dueño responde', replied.ok);
  check('mensaje vacío rechazado', (await emit(p.socket, 'message:send', { roomId: booking.id, text: '   ' })).error === 'invalid_message');
  check('mensaje demasiado largo rechazado', (await emit(p.socket, 'message:send', { roomId: booking.id, text: 'x'.repeat(1001) })).error === 'invalid_message');
  check('el intruso no puede escribir', (await emit(s.socket, 'message:send', { roomId: booking.id, text: 'hola' })).ok === false);

  console.log('# Historial persistido (MongoDB)');
  const history = await call(CHAT, 'GET', `/rooms/${booking.id}/messages`, player.token);
  check('el historial tiene los 2 mensajes en orden', history.status === 200 && history.body.messages.map((x: any) => x.text).join('|') === 'Hola, ¿hay balones?|Sí, te los dejamos listos.', JSON.stringify(history.body));
  check('el intruso recibe 403 en el historial', (await call(CHAT, 'GET', `/rooms/${booking.id}/messages`, stranger.token)).status === 403);

  console.log('# Cancelar cierra la sala');
  const closed = waitFor(o.socket, 'room:closed');
  const cancel = await call(API, 'POST', `/bookings/${booking.id}/cancel`, player.token);
  check('cancelación aceptada y reembolsada', cancel.status === 200 && cancel.body.refund === 'refunded', JSON.stringify(cancel.body));
  const notice = await closed;
  check('el dueño recibe room:closed en tiempo real', notice?.roomId === booking.id, JSON.stringify(notice));
  const closedRoom = await until(async () => {
    const r = await call(CHAT, 'GET', `/rooms/${booking.id}/messages`, player.token);
    return r.body.room?.status === 'closed' ? r.body.room : undefined;
  });
  check('la sala queda cerrada en el chat', !!closedRoom);
  check('ya no se puede escribir en una sala cerrada', (await emit(p.socket, 'message:send', { roomId: booking.id, text: '¿sigue en pie?' })).error === 'room_closed');
  const after = await call(CHAT, 'GET', `/rooms/${booking.id}/messages`, player.token);
  check('el historial se conserva tras cerrar', after.body.messages.length === 2);

  for (const c of [p, o, s]) c.socket.close();
  console.log(`\nResultado: ${pass} OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(`E2E abortado: ${(error as Error).message}`);
  process.exit(2);
});
