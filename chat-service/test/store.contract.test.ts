import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { MemoryChatStore } from '../src/store/memory';
import { MongoChatStore } from '../src/store/mongo';
import { ChatStore } from '../src/store/types';
import { bookingEvent, matchEvent, Who } from './helpers';

/**
 * Las mismas pruebas para las dos implementaciones del almacén. La de memoria corre siempre; la de
 * MongoDB solo si hay MONGO_URL (en Docker: `docker compose exec chat-service npm test`).
 * Con MongoDB usa su propia base `chat_test_<n>` y la borra al terminar.
 */
function suite(name: string, make: () => Promise<{ store: ChatStore; cleanup(): Promise<void> }>) {
  describe(`ChatStore: ${name}`, () => {
    let store: ChatStore;
    let cleanup: () => Promise<void>;
    before(async () => {
      ({ store, cleanup } = await make());
    });
    after(async () => cleanup());

    it('booking.confirmed abre una sala con los datos de la reserva', async () => {
      await store.applyBookingEvent(bookingEvent('booking.confirmed', 'room-open'));
      const room = await store.getRoom('room-open');
      assert.ok(room);
      assert.equal(room.status, 'open');
      assert.deepEqual([room.playerId, room.ownerId, room.venueName, room.courtName], ['p1', 'o1', 'Complejo Sol', 'Cancha 1']);
      assert.equal(room.startsAt, '2026-11-20T20:00:00.000Z');
    });

    it('una sala inexistente devuelve null', async () => {
      assert.equal(await store.getRoom('no-existe'), null);
    });

    it('repetir el mismo evento no cambia nada (idempotente)', async () => {
      const e = bookingEvent('booking.confirmed', 'room-dup');
      await store.applyBookingEvent(e);
      const first = await store.getRoom('room-dup');
      await store.applyBookingEvent(e);
      await store.applyBookingEvent(e);
      assert.deepEqual(await store.getRoom('room-dup'), first);
    });

    it('booking.cancelled cierra la sala', async () => {
      await store.applyBookingEvent(bookingEvent('booking.confirmed', 'room-close'));
      await store.applyBookingEvent(bookingEvent('booking.cancelled', 'room-close'));
      assert.equal((await store.getRoom('room-close'))?.status, 'closed');
    });

    it('si el cancelled llega antes que el confirmed, la sala queda cerrada igual', async () => {
      await store.applyBookingEvent(bookingEvent('booking.cancelled', 'room-order'));
      assert.equal((await store.getRoom('room-order'))?.status, 'closed');
      await store.applyBookingEvent(bookingEvent('booking.confirmed', 'room-order'));
      assert.equal((await store.getRoom('room-order'))?.status, 'closed');
    });

    it('un confirmed repetido no reabre una sala cancelada', async () => {
      const confirmed = bookingEvent('booking.confirmed', 'room-reopen');
      await store.applyBookingEvent(confirmed);
      await store.applyBookingEvent(bookingEvent('booking.cancelled', 'room-reopen'));
      await store.applyBookingEvent(confirmed); // reentrega tardía del bus
      assert.equal((await store.getRoom('room-reopen'))?.status, 'closed');
    });

    it('aplicar eventos de la misma reserva en paralelo termina en un estado coherente', async () => {
      const results = await Promise.allSettled([
        store.applyBookingEvent(bookingEvent('booking.confirmed', 'room-race')),
        store.applyBookingEvent(bookingEvent('booking.cancelled', 'room-race')),
        store.applyBookingEvent(bookingEvent('booking.confirmed', 'room-race')),
      ]);
      assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results));
      assert.equal((await store.getRoom('room-race'))?.status, 'closed');
    });

    it('listRoomsFor devuelve solo las salas donde participa, la más próxima primero', async () => {
      await store.applyBookingEvent(bookingEvent('booking.confirmed', 'l1', { playerId: 'ana', ownerId: 'dueno', startsAt: '2026-12-01T20:00:00.000Z', endsAt: '2026-12-01T21:00:00.000Z' }));
      await store.applyBookingEvent(bookingEvent('booking.confirmed', 'l2', { playerId: 'ana', ownerId: 'otro', startsAt: '2026-12-05T20:00:00.000Z', endsAt: '2026-12-05T21:00:00.000Z' }));
      await store.applyBookingEvent(bookingEvent('booking.confirmed', 'l3', { playerId: 'luis', ownerId: 'dueno' }));
      assert.deepEqual((await store.listRoomsFor('ana')).map((r) => r.id), ['l2', 'l1']);
      assert.deepEqual((await store.listRoomsFor('dueno')).map((r) => r.id).sort(), ['l1', 'l3']);
      assert.deepEqual(await store.listRoomsFor('nadie'), []);
    });

    it('guarda mensajes y los devuelve en orden cronológico', async () => {
      const ids: string[] = [];
      for (const text of ['uno', 'dos', 'tres']) ids.push((await store.addMessage({ roomId: 'm1', senderId: 'p1', text })).id);
      const list = await store.listMessages('m1', { limit: 50 });
      assert.deepEqual(list.map((m) => m.text), ['uno', 'dos', 'tres']);
      assert.deepEqual(list.map((m) => m.id), ids);
      assert.equal(list[0].senderId, 'p1');
      assert.ok(!Number.isNaN(new Date(list[0].createdAt).getTime()));
    });

    it('los mensajes de una sala no aparecen en otra', async () => {
      await store.addMessage({ roomId: 'aislada-a', senderId: 'x', text: 'secreto' });
      assert.deepEqual(await store.listMessages('aislada-b', { limit: 50 }), []);
    });

    it('pagina hacia atrás con `before` sin repetir ni saltar mensajes', async () => {
      for (let i = 1; i <= 25; i++) await store.addMessage({ roomId: 'pag', senderId: 'p1', text: `m${i}` });
      const last10 = await store.listMessages('pag', { limit: 10 });
      assert.deepEqual(last10.map((m) => m.text), Array.from({ length: 10 }, (_, i) => `m${i + 16}`));
      const prev10 = await store.listMessages('pag', { limit: 10, before: last10[0].id });
      assert.deepEqual(prev10.map((m) => m.text), Array.from({ length: 10 }, (_, i) => `m${i + 6}`));
      const rest = await store.listMessages('pag', { limit: 10, before: prev10[0].id });
      assert.deepEqual(rest.map((m) => m.text), ['m1', 'm2', 'm3', 'm4', 'm5']);
    });

    it('mensajes enviados a la vez conservan un orden estable y no se pierden', async () => {
      await Promise.all(Array.from({ length: 30 }, (_, i) => store.addMessage({ roomId: 'conc', senderId: 'p1', text: `c${i}` })));
      const list = await store.listMessages('conc', { limit: 100 });
      assert.equal(list.length, 30);
      assert.equal(new Set(list.map((m) => m.id)).size, 30);
      assert.deepEqual(list.map((m) => m.id), [...list.map((m) => m.id)].sort());
    });
    describe('salas de partido', () => {
      const ANA: Who = ['ana', 'Ana'];
      const LUIS: Who = ['luis', 'Luis'];
      const MARTA: Who = ['marta', 'Marta'];
      const texts = async (roomId: string) => (await store.listMessages(roomId, { limit: 50 })).map((m) => `${m.kind}:${m.text}`);

      it('match.opened crea la sala con el organizador como único miembro', async () => {
        const r = await store.applyMatchEvent(matchEvent('match.opened', 'pm-open', 1, [ANA]));
        assert.equal(r.applied, true);
        assert.deepEqual(r.addedIds, ['ana']);
        const room = await store.getRoom('match:pm-open');
        assert.ok(room);
        assert.deepEqual([room.kind, room.status, room.version, room.bookingId], ['match', 'open', 1, 'bk-pm-open']);
        assert.deepEqual(room.memberIds, ['ana']);
        assert.deepEqual(room.members, [{ id: 'ana', name: 'Ana' }]);
        assert.deepEqual([room.playerId, room.ownerId], ['ana', null]);
        assert.deepEqual(await texts('match:pm-open'), []); // abrir no genera aviso
      });

      it('entrar suma al miembro y deja un aviso; salir lo quita y deja otro', async () => {
        await store.applyMatchEvent(matchEvent('match.opened', 'pm-flow', 1, [ANA]));
        const joined = await store.applyMatchEvent(matchEvent('match.player_joined', 'pm-flow', 2, [ANA, LUIS], { changed: LUIS }));
        assert.deepEqual([joined.addedIds, joined.removedIds], [['luis'], []]);
        assert.equal(joined.systemMessage?.text, 'Luis se unió al partido');
        assert.equal(joined.systemMessage?.kind, 'system');
        assert.deepEqual((await store.getRoom('match:pm-flow'))?.memberIds, ['ana', 'luis']);

        const left = await store.applyMatchEvent(matchEvent('match.player_left', 'pm-flow', 3, [ANA], { changed: LUIS }));
        assert.deepEqual([left.addedIds, left.removedIds], [[], ['luis']]);
        assert.deepEqual((await store.getRoom('match:pm-flow'))?.memberIds, ['ana']);
        assert.deepEqual(await texts('match:pm-flow'), ['system:Luis se unió al partido', 'system:Luis salió del partido']);
      });

      it('un evento repetido o viejo no cambia nada ni duplica avisos', async () => {
        await store.applyMatchEvent(matchEvent('match.opened', 'pm-dup', 1, [ANA]));
        const joined = matchEvent('match.player_joined', 'pm-dup', 2, [ANA, LUIS], { changed: LUIS });
        assert.equal((await store.applyMatchEvent(joined)).applied, true);
        const again = await store.applyMatchEvent(joined);
        assert.equal(again.applied, false);
        assert.equal(again.systemMessage, null);
        assert.equal((await store.applyMatchEvent(matchEvent('match.opened', 'pm-dup', 1, [ANA]))).applied, false); // más viejo
        assert.deepEqual((await store.getRoom('match:pm-dup'))?.memberIds, ['ana', 'luis']);
        assert.deepEqual(await texts('match:pm-dup'), ['system:Luis se unió al partido']);
      });

      it('si llegan desordenados gana la versión más alta, no la última recibida', async () => {
        await store.applyMatchEvent(matchEvent('match.player_left', 'pm-order', 4, [ANA, MARTA], { changed: LUIS }));
        const stale = await store.applyMatchEvent(matchEvent('match.player_joined', 'pm-order', 3, [ANA, MARTA, LUIS], { changed: LUIS }));
        assert.equal(stale.applied, false);
        await store.applyMatchEvent(matchEvent('match.opened', 'pm-order', 1, [ANA]));
        assert.deepEqual((await store.getRoom('match:pm-order'))?.memberIds, ['ana', 'marta']);
        assert.equal((await store.getRoom('match:pm-order'))?.version, 4);
      });

      it('versiones aplicadas en paralelo y en cualquier orden terminan en la más alta', async () => {
        const members: Who[][] = [[ANA], [ANA, LUIS], [ANA, LUIS, MARTA], [ANA, MARTA], [ANA, MARTA, LUIS]];
        const events = members.map((m, i) => matchEvent(i === 0 ? 'match.opened' : 'match.player_joined', 'pm-race', i + 1, m, { changed: i ? m[m.length - 1] : null }));
        const shuffled = [events[3], events[0], events[4], events[2], events[1], events[4], events[3]];
        const results = await Promise.allSettled(shuffled.map((e) => store.applyMatchEvent(e)));
        assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results));
        const room = await store.getRoom('match:pm-race');
        assert.equal(room?.version, 5);
        assert.deepEqual(room?.memberIds, ['ana', 'marta', 'luis']);
      });

      it('match.cancelled cierra la sala y avisa una sola vez', async () => {
        await store.applyMatchEvent(matchEvent('match.opened', 'pm-cancel', 1, [ANA]));
        const r = await store.applyMatchEvent(matchEvent('match.cancelled', 'pm-cancel', 2, [ANA], { status: 'cancelled' }));
        assert.equal(r.closedNow, true);
        assert.equal((await store.getRoom('match:pm-cancel'))?.status, 'closed');
        assert.deepEqual(await texts('match:pm-cancel'), ['system:El organizador canceló el partido']);
      });

      it('una sala cerrada no se reabre aunque llegue un evento posterior que diga "open"', async () => {
        await store.applyMatchEvent(matchEvent('match.cancelled', 'pm-sticky', 5, [ANA], { status: 'cancelled' }));
        const r = await store.applyMatchEvent(matchEvent('match.player_joined', 'pm-sticky', 6, [ANA, LUIS], { changed: LUIS }));
        assert.equal(r.closedNow, false);
        assert.equal((await store.getRoom('match:pm-sticky'))?.status, 'closed');
      });

      it('cancelar la reserva cierra la sala del partido (y avisa cuáles se cerraron)', async () => {
        await store.applyMatchEvent(matchEvent('match.opened', 'pm-book', 1, [ANA], { bookingId: 'rsv-1' }));
        await store.applyMatchEvent(matchEvent('match.player_joined', 'pm-book', 2, [ANA, LUIS], { bookingId: 'rsv-1', changed: LUIS }));
        const { closedMatchRooms } = await store.applyBookingEvent(bookingEvent('booking.cancelled', 'rsv-1'));
        assert.deepEqual(closedMatchRooms.map((r) => [r.id, r.status, r.memberIds]), [['match:pm-book', 'closed', ['ana', 'luis']]]);
        assert.equal((await store.getRoom('match:pm-book'))?.status, 'closed');
        assert.deepEqual((await store.applyBookingEvent(bookingEvent('booking.cancelled', 'rsv-1'))).closedMatchRooms, []); // repetido: nada que avisar
      });

      it('si la reserva se canceló antes de que llegara el partido, este nace cerrado', async () => {
        await store.applyBookingEvent(bookingEvent('booking.cancelled', 'rsv-2'));
        await store.applyMatchEvent(matchEvent('match.opened', 'pm-late', 1, [ANA], { bookingId: 'rsv-2' }));
        assert.equal((await store.getRoom('match:pm-late'))?.status, 'closed');
      });

      it('quien sale deja de verla en su lista; quien entra la ve; el resto nunca', async () => {
        await store.applyMatchEvent(matchEvent('match.opened', 'pm-list', 1, [ANA]));
        await store.applyMatchEvent(matchEvent('match.player_joined', 'pm-list', 2, [ANA, LUIS], { changed: LUIS }));
        const ids = async (u: string) => (await store.listRoomsFor(u)).map((r) => r.id).filter((x) => x === 'match:pm-list');
        assert.deepEqual([await ids('ana'), await ids('luis'), await ids('marta')], [['match:pm-list'], ['match:pm-list'], []]);
        await store.applyMatchEvent(matchEvent('match.player_left', 'pm-list', 3, [ANA], { changed: LUIS }));
        assert.deepEqual(await ids('luis'), []);
      });

      it('las salas de reserva siguen igual: dos miembros, sin versión', async () => {
        await store.applyBookingEvent(bookingEvent('booking.confirmed', 'rsv-3', { playerId: 'ana', ownerId: 'dueno' }));
        const room = await store.getRoom('rsv-3');
        assert.deepEqual([room?.kind, room?.memberIds, room?.version, room?.members], ['booking', ['ana', 'dueno'], null, []]);
      });

      it('los mensajes normales llevan kind "user"', async () => {
        const m = await store.addMessage({ roomId: 'match:pm-kind', senderId: 'ana', text: 'hola' });
        assert.equal(m.kind, 'user');
      });
    });
  });
}

suite('memoria', async () => ({ store: new MemoryChatStore(), cleanup: async () => {} }));

if (process.env.MONGO_URL) {
  suite('MongoDB real', async () => {
    const url = new URL(process.env.MONGO_URL as string);
    url.pathname = `/chat_test_${Date.now()}`;
    const store = new MongoChatStore(url.toString());
    await store.init();
    const { MongoClient } = await import('mongodb');
    return {
      store,
      cleanup: async () => {
        const client = await MongoClient.connect(url.toString());
        await client.db().dropDatabase();
        await client.close();
        await store.close();
      },
    };
  });
} else {
  describe('ChatStore: MongoDB real', () => {
    it('omitido: define MONGO_URL para ejecutarlo', { skip: true }, () => {});
  });
}
