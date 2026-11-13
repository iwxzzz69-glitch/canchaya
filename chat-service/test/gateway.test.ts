import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Socket } from 'socket.io-client';
import { HISTORY_ON_JOIN } from '../src/gateway';
import { ask, bookingEvent, connect, nextEvent, noEvent, startServer, TestServer, tokenFor } from './helpers';

describe('Chat en tiempo real (Socket.IO real)', () => {
  let server: TestServer;
  let sockets: Socket[];
  const open = async (id: string, role: 'player' | 'owner' | 'admin' = 'player') => {
    const s = await connect(server.url, tokenFor(id, role));
    sockets.push(s);
    return s;
  };

  beforeEach(async () => {
    sockets = [];
    server = await startServer();
    await server.store.applyBookingEvent(bookingEvent('booking.confirmed', 'b1')); // jugador p1, dueño o1
  });
  afterEach(async () => {
    sockets.forEach((s) => s.close());
    await server.close();
  });

  describe('autenticación', () => {
    it('rechaza la conexión sin token, con token inválido o firmado con otro secreto', async () => {
      await assert.rejects(connect(server.url), /unauthorized/);
      await assert.rejects(connect(server.url, 'basura'), /unauthorized/);
      await assert.rejects(connect(server.url, tokenFor('p1', 'player', 'otro-secreto')), /unauthorized/);
    });
    it('acepta un token del monolito', async () => {
      const s = await open('p1');
      assert.equal(s.connected, true);
    });
  });

  describe('entrar a una sala', () => {
    it('el jugador y el dueño entran y reciben la sala, el historial y quién está en línea', async () => {
      const p = await open('p1');
      const res = await ask(p, 'room:join', 'b1');
      assert.equal(res.ok, true);
      assert.equal(res.room.venueName, 'Complejo Sol');
      assert.equal(res.room.status, 'open');
      assert.deepEqual(res.messages, []);
      assert.deepEqual(res.online, ['p1']);
      assert.equal((await ask(await open('o1', 'owner'), 'room:join', 'b1')).ok, true);
    });
    it('un tercero no entra, y tampoco un admin (privacidad)', async () => {
      assert.deepEqual(await ask(await open('x1'), 'room:join', 'b1'), { ok: false, error: 'forbidden' });
      assert.deepEqual(await ask(await open('admin1', 'admin'), 'room:join', 'b1'), { ok: false, error: 'forbidden' });
    });
    it('sala inexistente o id inválido', async () => {
      const p = await open('p1');
      assert.deepEqual(await ask(p, 'room:join', 'nope'), { ok: false, error: 'room_not_found' });
      for (const bad of [undefined, 5, '', {}, 'x'.repeat(101)]) {
        assert.deepEqual(await ask(p, 'room:join', bad), { ok: false, error: 'invalid_room' });
      }
    });
    it('no revela datos de la sala a quien no participa', async () => {
      const res = await ask(await open('x1'), 'room:join', 'b1');
      assert.deepEqual(Object.keys(res).sort(), ['error', 'ok']);
    });
  });

  describe('mensajes', () => {
    it('lo que escribe uno le llega al otro al instante, y quien envía recibe su confirmación', async () => {
      const [p, o] = [await open('p1'), await open('o1', 'owner')];
      await ask(p, 'room:join', 'b1');
      await ask(o, 'room:join', 'b1');
      const arrives = nextEvent(o, 'message:new');
      const res = await ask(p, 'message:send', { roomId: 'b1', text: '  Hola, ¿hay cancha techada?  ' });
      const msg = await arrives;
      assert.equal(res.ok, true);
      assert.equal(msg.text, 'Hola, ¿hay cancha techada?'); // recortado
      assert.equal(msg.senderId, 'p1'); // lo fija el servidor, no el cliente
      assert.equal(msg.id, res.message.id);
    });
    it('el remitente no se puede falsificar', async () => {
      const [p, o] = [await open('p1'), await open('o1', 'owner')];
      await ask(p, 'room:join', 'b1');
      await ask(o, 'room:join', 'b1');
      const arrives = nextEvent(o, 'message:new');
      await ask(p, 'message:send', { roomId: 'b1', text: 'hola', senderId: 'o1' });
      assert.equal((await arrives).senderId, 'p1');
    });
    it('quien entra después ve el historial en orden', async () => {
      const p = await open('p1');
      await ask(p, 'room:join', 'b1');
      for (const t of ['uno', 'dos', 'tres']) await ask(p, 'message:send', { roomId: 'b1', text: t });
      const res = await ask(await open('o1', 'owner'), 'room:join', 'b1');
      assert.deepEqual(res.messages.map((m: any) => m.text), ['uno', 'dos', 'tres']);
    });
    it('el historial al entrar se limita a los últimos mensajes', async () => {
      for (let i = 0; i < HISTORY_ON_JOIN + 5; i++) await server.store.addMessage({ roomId: 'b1', senderId: 'p1', text: `m${i}` });
      const res = await ask(await open('p1'), 'room:join', 'b1');
      assert.equal(res.messages.length, HISTORY_ON_JOIN);
      assert.equal(res.messages.at(-1).text, `m${HISTORY_ON_JOIN + 4}`);
    });
    it('no se puede escribir sin haber entrado a la sala', async () => {
      assert.deepEqual(await ask(await open('p1'), 'message:send', { roomId: 'b1', text: 'hola' }), { ok: false, error: 'not_joined' });
    });
    it('rechaza mensajes vacíos, solo espacios, demasiado largos o mal formados', async () => {
      const p = await open('p1');
      await ask(p, 'room:join', 'b1');
      for (const bad of [{ roomId: 'b1', text: '' }, { roomId: 'b1', text: '   ' }, { roomId: 'b1', text: 'x'.repeat(1001) }, { roomId: 'b1', text: 42 }, { roomId: 5, text: 'a' }, {}, null, 'hola']) {
        assert.deepEqual(await ask(p, 'message:send', bad), { ok: false, error: 'invalid_message' }, JSON.stringify(bad));
      }
      assert.equal((await ask(p, 'message:send', { roomId: 'b1', text: 'x'.repeat(1000) })).ok, true); // el límite exacto sí
    });
    it('el texto se entrega tal cual, sin interpretarse (nada de HTML)', async () => {
      const p = await open('p1');
      await ask(p, 'room:join', 'b1');
      const res = await ask(p, 'message:send', { roomId: 'b1', text: '<script>alert(1)</script>' });
      assert.equal(res.message.text, '<script>alert(1)</script>');
    });
    it('quien no está en la sala no recibe sus mensajes', async () => {
      const [p, x] = [await open('p1'), await open('x1')];
      await ask(p, 'room:join', 'b1');
      await ask(x, 'room:join', 'b1'); // rechazado
      const quiet = noEvent(x, 'message:new');
      await ask(p, 'message:send', { roomId: 'b1', text: 'privado' });
      assert.equal(await quiet, true);
    });
    it('al salir de la sala ya no se puede escribir ni se reciben mensajes', async () => {
      const [p, o] = [await open('p1'), await open('o1', 'owner')];
      await ask(p, 'room:join', 'b1');
      await ask(o, 'room:join', 'b1');
      await ask(o, 'room:leave', 'b1');
      const quiet = noEvent(o, 'message:new');
      await ask(p, 'message:send', { roomId: 'b1', text: 'hola' });
      assert.equal(await quiet, true);
      assert.equal((await ask(o, 'message:send', { roomId: 'b1', text: 'x' })).error, 'not_joined');
    });
  });

  describe('límite de velocidad', () => {
    it('tras superar el límite responde rate_limited, por conexión', async () => {
      await server.close();
      server = await startServer({ rateLimit: { limit: 3, windowMs: 10_000 } });
      await server.store.applyBookingEvent(bookingEvent('booking.confirmed', 'b1'));
      const [p, o] = [await open('p1'), await open('o1', 'owner')];
      await ask(p, 'room:join', 'b1');
      await ask(o, 'room:join', 'b1');
      const results = [];
      for (let i = 0; i < 5; i++) results.push((await ask(p, 'message:send', { roomId: 'b1', text: `m${i}` })).error);
      assert.deepEqual(results, [undefined, undefined, undefined, 'rate_limited', 'rate_limited']);
      assert.equal((await ask(o, 'message:send', { roomId: 'b1', text: 'yo sí puedo' })).ok, true); // el otro no se ve afectado
      assert.equal((await server.store.listMessages('b1', { limit: 50 })).length, 4); // los bloqueados no se guardan
    });
  });

  describe('reserva cancelada', () => {
    it('la sala se cierra: ambos reciben el aviso, el historial se conserva y ya no se puede escribir', async () => {
      const [p, o] = [await open('p1'), await open('o1', 'owner')];
      await ask(p, 'room:join', 'b1');
      await ask(o, 'room:join', 'b1');
      await ask(p, 'message:send', { roomId: 'b1', text: 'nos vemos' });

      const closedForP = nextEvent(p, 'room:closed');
      const closedForO = nextEvent(o, 'room:closed');
      const cancelled = bookingEvent('booking.cancelled', 'b1');
      await server.store.applyBookingEvent(cancelled);
      server.notify(cancelled);

      assert.deepEqual(await closedForP, { roomId: 'b1' });
      assert.deepEqual(await closedForO, { roomId: 'b1' });
      assert.deepEqual(await ask(p, 'message:send', { roomId: 'b1', text: 'ya no' }), { ok: false, error: 'room_closed' });
      const history = await ask(o, 'room:join', 'b1');
      assert.equal(history.ok, true);
      assert.equal(history.room.status, 'closed');
      assert.deepEqual(history.messages.map((m: any) => m.text), ['nos vemos']);
    });
  });

  describe('avisos personales', () => {
    it('una reserva confirmada avisa al jugador y al dueño conectados (room:opened), y a nadie más', async () => {
      const [p, o, x] = [await open('p1'), await open('o1', 'owner'), await open('x1')];
      const [forP, forO, quiet] = [nextEvent(p, 'room:opened'), nextEvent(o, 'room:opened'), noEvent(x, 'room:opened')];
      server.notify(bookingEvent('booking.confirmed', 'b2'));
      assert.equal((await forP).roomId, 'b2');
      assert.equal((await forO).venueName, 'Complejo Sol');
      assert.equal(await quiet, true);
    });
  });

  describe('presencia', () => {
    it('informa quién está en línea al entrar y al salir o desconectarse', async () => {
      const p = await open('p1');
      await ask(p, 'room:join', 'b1');
      const bJoins = nextEvent(p, 'presence:update');
      const o = await open('o1', 'owner');
      await ask(o, 'room:join', 'b1');
      assert.deepEqual([...(await bJoins).online].sort(), ['o1', 'p1']);

      const bLeaves = nextEvent(p, 'presence:update');
      o.close();
      assert.deepEqual((await bLeaves).online, ['p1']);
    });
    it('el mismo usuario con dos pestañas cuenta una sola vez', async () => {
      const [p1, p2] = [await open('p1'), await open('p1')];
      await ask(p1, 'room:join', 'b1');
      const res = await ask(p2, 'room:join', 'b1');
      assert.deepEqual(res.online, ['p1']);
    });
  });
});
