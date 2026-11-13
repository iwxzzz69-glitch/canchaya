import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Socket } from 'socket.io-client';
import { MatchEvent } from '../src/types';
import { ask, bookingEvent, connect, matchEvent, nextEvent, noEvent, startServer, TestServer, tokenFor, Who } from './helpers';

const ANA: Who = ['ana', 'Ana'];
const LUIS: Who = ['luis', 'Luis'];
const ROOM = 'match:m1';

describe('Chat grupal de un partido (Socket.IO real)', () => {
  let server: TestServer;
  let sockets: Socket[];
  const open = async (id: string) => {
    const s = await connect(server.url, tokenFor(id));
    sockets.push(s);
    return s;
  };
  /** Lo mismo que hace el consumidor: aplicar al almacén y avisar a los clientes conectados. */
  const deliver = async (e: MatchEvent) => {
    const result = await server.store.applyMatchEvent(e);
    await server.notifyMatch(e, result);
    return result;
  };

  beforeEach(async () => {
    sockets = [];
    server = await startServer();
    await deliver(matchEvent('match.opened', 'm1', 1, [ANA]));
  });
  afterEach(async () => {
    sockets.forEach((s) => s.close());
    await server.close();
  });

  it('solo los miembros entran; un tercero no, ni siquiera sabiendo el id', async () => {
    assert.equal((await ask(await open('ana'), 'room:join', ROOM)).ok, true);
    assert.deepEqual(await ask(await open('luis'), 'room:join', ROOM), { ok: false, error: 'forbidden' });
    assert.deepEqual(await ask(await open('admin1'), 'room:join', ROOM), { ok: false, error: 'forbidden' });
  });

  it('quien se une recibe la sala nueva, entra, ve el aviso en el historial y todos chatean', async () => {
    const [ana, luis] = [await open('ana'), await open('luis')];
    await ask(ana, 'room:join', ROOM);
    const [opened, notice] = [nextEvent(luis, 'room:opened'), nextEvent(ana, 'message:new')];
    await deliver(matchEvent('match.player_joined', 'm1', 2, [ANA, LUIS], { changed: LUIS }));
    assert.deepEqual(await opened, { roomId: ROOM, kind: 'match', venueName: 'Complejo Sol', courtName: 'Cancha 1', startsAt: '2026-11-20T20:00:00.000Z' });
    const n = await notice;
    assert.deepEqual([n.kind, n.senderId, n.text], ['system', 'system', 'Luis se unió al partido']);

    const join = await ask(luis, 'room:join', ROOM);
    assert.equal(join.ok, true);
    assert.deepEqual(join.room.members, [{ id: 'ana', name: 'Ana' }, { id: 'luis', name: 'Luis' }]);
    assert.deepEqual(join.messages.map((m: any) => m.text), ['Luis se unió al partido']);

    const incoming = nextEvent(ana, 'message:new');
    assert.equal((await ask(luis, 'message:send', { roomId: ROOM, text: '¿Llevo balón?' })).ok, true);
    assert.deepEqual([(await incoming).senderId, (await incoming).kind], ['luis', 'user']);
  });

  it('un mensaje repetido del bus no vuelve a avisar a los clientes', async () => {
    const ana = await open('ana');
    await ask(ana, 'room:join', ROOM);
    const joined = matchEvent('match.player_joined', 'm1', 2, [ANA, LUIS], { changed: LUIS });
    const first = nextEvent(ana, 'message:new');
    await deliver(joined);
    await first;
    const quiet = noEvent(ana, 'message:new');
    assert.equal((await deliver(joined)).applied, false);
    assert.equal(await quiet, true);
  });

  it('al salir, se le saca de la sala al instante: no recibe más, no escribe, no vuelve a entrar', async () => {
    const [ana, luis, luis2] = [await open('ana'), await open('luis'), await open('luis')]; // luis con dos pestañas
    await deliver(matchEvent('match.player_joined', 'm1', 2, [ANA, LUIS], { changed: LUIS }));
    for (const s of [ana, luis, luis2]) assert.equal((await ask(s, 'room:join', ROOM)).ok, true);

    const [left1, left2, notice] = [nextEvent(luis, 'room:left'), nextEvent(luis2, 'room:left'), nextEvent(ana, 'message:new')];
    await deliver(matchEvent('match.player_left', 'm1', 3, [ANA], { changed: LUIS }));
    assert.equal((await left1).roomId, ROOM);
    assert.equal((await left2).roomId, ROOM);
    assert.equal((await notice).text, 'Luis salió del partido');

    const quiet = [noEvent(luis, 'message:new'), noEvent(luis2, 'message:new')];
    assert.equal((await ask(ana, 'message:send', { roomId: ROOM, text: 'seguimos' })).ok, true);
    assert.deepEqual(await Promise.all(quiet), [true, true]); // ya no lo oye ninguna pestaña
    assert.deepEqual(await ask(luis, 'message:send', { roomId: ROOM, text: 'hola?' }), { ok: false, error: 'not_joined' });
    assert.deepEqual(await ask(luis, 'room:join', ROOM), { ok: false, error: 'forbidden' });
  });

  it('aunque su conexión siguiera dentro de la sala, un ex miembro no puede escribir', async () => {
    const luis = await open('luis');
    await deliver(matchEvent('match.player_joined', 'm1', 2, [ANA, LUIS], { changed: LUIS }));
    await ask(luis, 'room:join', ROOM);
    // El almacén ya lo sacó, pero el aviso por socket todavía no llegó (se simula sin notificar).
    await server.store.applyMatchEvent(matchEvent('match.player_left', 'm1', 3, [ANA], { changed: LUIS }));
    assert.deepEqual(await ask(luis, 'message:send', { roomId: ROOM, text: 'me cuelo' }), { ok: false, error: 'forbidden' });
  });

  it('cancelar el partido cierra la sala para todos y ya no se puede escribir', async () => {
    const [ana, luis] = [await open('ana'), await open('luis')];
    await deliver(matchEvent('match.player_joined', 'm1', 2, [ANA, LUIS], { changed: LUIS }));
    await ask(ana, 'room:join', ROOM);
    await ask(luis, 'room:join', ROOM);
    const [a, l] = [nextEvent(ana, 'room:closed'), nextEvent(luis, 'room:closed')];
    await deliver(matchEvent('match.cancelled', 'm1', 3, [ANA, LUIS], { status: 'cancelled' }));
    assert.equal((await a).roomId, ROOM);
    assert.equal((await l).roomId, ROOM);
    assert.deepEqual(await ask(ana, 'message:send', { roomId: ROOM, text: '¿alguien?' }), { ok: false, error: 'room_closed' });
    const history = await ask(luis, 'room:join', ROOM); // el historial se conserva para los miembros
    assert.equal(history.ok, true);
    assert.equal(history.messages.at(-1).text, 'El organizador canceló el partido');
  });

  it('cancelar la reserva cierra la sala del partido, avisa a sus miembros y a nadie más', async () => {
    await deliver(matchEvent('match.opened', 'm7', 1, [ANA], { bookingId: 'rsv-9' }));
    await deliver(matchEvent('match.player_joined', 'm7', 2, [ANA, LUIS], { changed: LUIS, bookingId: 'rsv-9' }));
    const [ana, luis, otro] = [await open('ana'), await open('luis'), await open('otro')];
    await ask(ana, 'room:join', 'match:m7');
    const [a, l, quiet] = [nextEvent(ana, 'room:closed'), nextEvent(luis, 'room:closed'), noEvent(otro, 'room:closed')];
    // La reserva es de otras personas (ana organiza el partido con la reserva de un amigo): solo se cierra el partido para sus miembros.
    const event = bookingEvent('booking.cancelled', 'rsv-9', { playerId: 'amigo', ownerId: 'dueno' });
    const { closedMatchRooms } = await server.store.applyBookingEvent(event);
    assert.deepEqual(closedMatchRooms.map((r) => r.id), ['match:m7']);
    server.notify(event, closedMatchRooms);
    assert.equal((await a).roomId, 'match:m7');
    assert.equal((await l).roomId, 'match:m7');
    assert.equal(await quiet, true);
    assert.equal((await server.store.getRoom('match:m7'))?.status, 'closed');
    assert.deepEqual(await ask(ana, 'message:send', { roomId: 'match:m7', text: '¿y ahora?' }), { ok: false, error: 'room_closed' });
  });
});
