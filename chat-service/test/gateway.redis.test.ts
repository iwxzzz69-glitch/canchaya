import assert from 'node:assert/strict';
import http from 'http';
import { AddressInfo } from 'net';
import { describe, it } from 'node:test';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { createChatServer } from '../src/gateway';
import { MemoryChatStore } from '../src/store/memory';
import { ask, bookingEvent, connect, nextEvent, SECRET, silent, tokenFor } from './helpers';

/**
 * Dos instancias del chat conectadas por Redis: el jugador está en la instancia A y el dueño en la
 * B, y aun así se ven los mensajes y la presencia. Solo corre con REDIS_URL.
 */
async function until(condition: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
}

describe('Varias instancias del chat con Redis', { skip: !process.env.REDIS_URL }, () => {
  it('un mensaje enviado en una instancia llega a los clientes de la otra', async () => {
    const store = new MemoryChatStore(); // en producción ambas leen la misma MongoDB
    await store.applyBookingEvent(bookingEvent('booking.confirmed', 'b1'));
    const clients: ReturnType<typeof createClient>[] = [];
    const nodes = [];
    for (let i = 0; i < 2; i++) {
      const httpServer = http.createServer();
      const { io } = createChatServer({ httpServer, store, jwtSecret: SECRET, corsOrigin: '*', log: silent });
      const pub = createClient({ url: process.env.REDIS_URL });
      const sub = pub.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      clients.push(pub, sub);
      io.adapter(createAdapter(pub, sub));
      await new Promise<void>((r) => httpServer.listen(0, r));
      nodes.push({ io, url: `http://localhost:${(httpServer.address() as AddressInfo).port}` });
    }
    const player = await connect(nodes[0].url, tokenFor('p1'));
    const owner = await connect(nodes[1].url, tokenFor('o1', 'owner'));
    try {
      await ask(player, 'room:join', 'b1');
      const presence = nextEvent(player, 'presence:update');
      const joined = await ask(owner, 'room:join', 'b1');
      assert.deepEqual([...(await presence).online].sort(), ['o1', 'p1']); // presencia entre instancias
      assert.deepEqual([...joined.online].sort(), ['o1', 'p1']);

      const arrives = nextEvent(owner, 'message:new');
      await ask(player, 'message:send', { roomId: 'b1', text: 'hola desde la instancia A' });
      assert.equal((await arrives).text, 'hola desde la instancia A');
    } finally {
      player.close();
      owner.close();
      // Al desconectarse, cada instancia anuncia la presencia por Redis. Hay que esperar a que esas
      // publicaciones salgan antes de cerrar los clientes de Redis (si no, el adaptador publica en uno cerrado).
      await until(() => nodes.every((n) => n.io.sockets.sockets.size === 0));
      await new Promise<void>((r) => setImmediate(r));
      await Promise.all(clients.map((c) => c.ping())); // Redis atiende en orden: tras el ping ya salieron
      await Promise.all(nodes.map((n) => new Promise<void>((r) => void n.io.close(() => r()))));
      await Promise.all(clients.map((c) => c.quit().catch(() => undefined)));
    }
  });
});
