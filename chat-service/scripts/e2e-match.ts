/**
 * Prueba de punta a punta de la Fase 5b: el chat grupal de un partido. Se ejecuta DENTRO del contenedor
 * del chat, con el stack real:
 *   docker compose exec chat-service npx tsx scripts/e2e-match.ts
 *
 * Recorre: monolito (reserva, pago, partido, entrar/salir/cancelar) -> bandeja de salida -> RabbitMQ
 * -> chat-service -> MongoDB -> Socket.IO. Usa la pasarela simulada del monolito: no cobra nada.
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
  const ana = await register('Ana E2E', 'player');
  const luis = await register('Luis E2E', 'player');
  const marta = await register('Marta E2E', 'player');
  const venue = (await call(API, 'POST', '/venues', owner.token, { name: 'Local Partido', address: 'Av. 2', zone: 'Surco' })).body;
  const court = (await call(API, 'POST', `/venues/${venue.id}/courts`, owner.token, { name: 'Cancha P', sport: 'football', pricePerHour: 90 })).body;
  const day = new Date(Date.now() + 4 * 86_400_000 - 5 * 3_600_000).toISOString().slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  const startsAt = new Date(Date.UTC(y, m - 1, d, 21 + 5)).toISOString(); // 21:00 hora de Lima
  const booking = (await call(API, 'POST', '/bookings', ana.token, { courtId: court.id, startsAt })).body;
  const paid = await call(API, 'POST', `/bookings/${booking.id}/pay`, ana.token, { tokenId: 'tkn_test_ok' });
  check('reserva pagada', paid.status === 200 && paid.body.booking.status === 'confirmed', JSON.stringify(paid.body));
  const match = (await call(API, 'POST', '/matches', ana.token, { bookingId: booking.id, spots: 3 })).body;
  check('partido abierto', !!match.id, JSON.stringify(match));
  const ROOM = `match:${match.id}`;

  console.log('# La sala del partido nace con el organizador');
  const room = await until(async () => (await call(CHAT, 'GET', '/rooms', ana.token)).body.find?.((x: any) => x.id === ROOM));
  check('la sala aparece (bandeja de salida -> RabbitMQ -> chat -> MongoDB)', !!room);
  check('es una sala de partido abierta con Ana como única miembro', room?.kind === 'match' && room?.status === 'open' && room?.memberIds?.length === 1, JSON.stringify(room));
  check('quien no está en el partido no la ve', (await call(CHAT, 'GET', '/rooms', luis.token)).body.every((x: any) => x.id !== ROOM));
  check('el dueño del local tampoco (es chat de jugadores)', (await call(CHAT, 'GET', '/rooms', owner.token)).body.every((x: any) => x.id !== ROOM));

  console.log('# Entrar al partido');
  const a = await connect(ana.token);
  const l = await connect(luis.token);
  const mt = await connect(marta.token);
  check('tres conexiones con su JWT', !a.error && !l.error && !mt.error);
  check('Ana entra a la sala', (await emit(a.socket, 'room:join', ROOM)).ok === true);
  check('Luis aún no puede entrar', (await emit(l.socket, 'room:join', ROOM)).error === 'forbidden');

  const opened = waitFor(l.socket, 'room:opened');
  const notice = waitFor(a.socket, 'message:new');
  const joined = await call(API, 'POST', `/matches/${match.id}/join`, luis.token);
  check('Luis se une al partido', joined.status === 201 || joined.status === 200, JSON.stringify(joined.body));
  const op = await opened;
  check('Luis recibe en vivo la sala nueva', op?.roomId === ROOM && op?.kind === 'match', JSON.stringify(op));
  const n = await notice;
  check('Ana ve el aviso "Luis se unió al partido"', n?.kind === 'system' && n?.text === 'Luis se unió al partido', JSON.stringify(n));

  const joinL = await emit(l.socket, 'room:join', ROOM);
  check('ahora Luis entra y ve el aviso en el historial', joinL.ok && joinL.messages.some((x: any) => x.text === 'Luis se unió al partido'), JSON.stringify(joinL));
  check('la sala sabe los nombres de los miembros', joinL.room?.members?.map((x: any) => x.name).join() === 'Ana,Luis', JSON.stringify(joinL.room));

  console.log('# Chatear');
  const incoming = waitFor(a.socket, 'message:new');
  check('Luis escribe', (await emit(l.socket, 'message:send', { roomId: ROOM, text: '¿Llevo balón?' })).ok === true);
  check('Ana lo recibe al instante', (await incoming)?.text === '¿Llevo balón?');
  check('Marta (sin unirse) no puede escribir ni entrar', (await emit(mt.socket, 'message:send', { roomId: ROOM, text: 'hola' })).ok === false && (await emit(mt.socket, 'room:join', ROOM)).error === 'forbidden');
  check('Marta recibe 403 en el historial', (await call(CHAT, 'GET', `/rooms/${ROOM}/messages`, marta.token)).status === 403);

  console.log('# Salir del partido');
  const left = waitFor(l.socket, 'room:left');
  const leaveNotice = waitFor(a.socket, 'message:new');
  const out = await call(API, 'POST', `/matches/${match.id}/leave`, luis.token);
  check('Luis sale del partido', out.status === 200 || out.status === 201, JSON.stringify(out.body));
  check('Luis es sacado de la sala al instante', (await left)?.roomId === ROOM);
  check('Ana ve "Luis salió del partido"', (await leaveNotice)?.text === 'Luis salió del partido');
  check('Luis ya no puede escribir ni volver a entrar', (await emit(l.socket, 'message:send', { roomId: ROOM, text: 'hola?' })).ok === false && (await emit(l.socket, 'room:join', ROOM)).error === 'forbidden');
  check('la sala sale de su lista', (await call(CHAT, 'GET', '/rooms', luis.token)).body.every((x: any) => x.id !== ROOM));

  console.log('# Cancelar el partido cierra la sala');
  await call(API, 'POST', `/matches/${match.id}/join`, marta.token);
  await until(async () => (await call(CHAT, 'GET', '/rooms', marta.token)).body.some?.((x: any) => x.id === ROOM));
  await emit(mt.socket, 'room:join', ROOM);
  const closed = waitFor(mt.socket, 'room:closed');
  const cancel = await call(API, 'DELETE', `/matches/${match.id}`, ana.token);
  check('Ana cancela el partido', cancel.status === 200, JSON.stringify(cancel.body));
  check('Marta recibe room:closed en tiempo real', (await closed)?.roomId === ROOM);
  const state = await until(async () => {
    const r = await call(CHAT, 'GET', `/rooms/${ROOM}/messages`, ana.token);
    return r.body.room?.status === 'closed' ? r.body : undefined;
  });
  check('la sala queda cerrada y conserva el historial', !!state && state.messages.length >= 3, JSON.stringify(state));
  check('ya no se puede escribir', (await emit(a.socket, 'message:send', { roomId: ROOM, text: '¿sigue?' })).error === 'room_closed');

  for (const c of [a, l, mt]) c.socket.close();
  console.log(`\nResultado: ${pass} OK, ${fail} fallas`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(`E2E abortado: ${(error as Error).message}`);
  process.exit(2);
});
