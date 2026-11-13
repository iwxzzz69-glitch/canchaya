import http from 'http';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { startConsumer, Logger } from './consumer';
import { createChatServer } from './gateway';
import { createApp } from './http';
import { MongoChatStore } from './store/mongo';

const log: Logger = {
  info: (m) => console.log(`[chat] ${m}`),
  warn: (m) => console.warn(`[chat] WARN ${m}`),
  error: (m) => console.error(`[chat] ERROR ${m}`),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const PORT = Number(process.env.PORT ?? 3002);
  const JWT_SECRET = process.env.JWT_SECRET ?? '';
  const MONGO_URL = process.env.MONGO_URL ?? '';
  const CORS_ORIGIN = process.env.CHAT_CORS_ORIGIN ?? 'http://localhost:3000';

  // Sin secreto no hay forma segura de validar tokens: mejor no arrancar que aceptar cualquiera.
  if (!JWT_SECRET) throw new Error('Falta JWT_SECRET (debe ser el mismo que usa el monolito)');
  if (!MONGO_URL) throw new Error('Falta MONGO_URL');

  const store = new MongoChatStore(MONGO_URL);
  for (let attempt = 1; ; attempt++) {
    try {
      await store.init();
      break;
    } catch (error) {
      if (attempt >= 10) throw error;
      log.warn(`MongoDB no disponible (${(error as Error).message}); reintento ${attempt}/10`);
      await sleep(2000);
    }
  }

  const app = createApp(store, JWT_SECRET, CORS_ORIGIN);
  const server = http.createServer(app);
  const { io, notifyBookingEvent, notifyMatchEvent } = createChatServer({ httpServer: server, store, jwtSecret: JWT_SECRET, corsOrigin: CORS_ORIGIN, log });

  // Redis permite varias instancias del chat: los mensajes y la presencia llegan a todos los clientes.
  const redisUrl = process.env.REDIS_URL;
  const redisClients: ReturnType<typeof createClient>[] = [];
  if (redisUrl) {
    try {
      const pub = createClient({ url: redisUrl, socket: { reconnectStrategy: false } });
      const sub = pub.duplicate();
      pub.on('error', (e) => log.warn(`Redis: ${e.message}`));
      sub.on('error', (e) => log.warn(`Redis: ${e.message}`));
      await Promise.all([pub.connect(), sub.connect()]);
      io.adapter(createAdapter(pub, sub));
      redisClients.push(pub, sub);
      log.info('Adaptador de Redis activo (varias instancias)');
    } catch (error) {
      log.warn(`Redis no disponible (${(error as Error).message}); el chat funciona en una sola instancia`);
    }
  }

  const rabbitUrl = process.env.RABBITMQ_URL;
  const consumer = rabbitUrl ? startConsumer({ url: rabbitUrl, store, log, onApplied: notifyBookingEvent, onMatchApplied: notifyMatchEvent }) : undefined;
  if (!rabbitUrl) log.warn('RABBITMQ_URL no definida: no se recibirán eventos de reservas ni de partidos');

  server.listen(PORT, () => log.info(`chat-service escuchando en :${PORT}`));

  const shutdown = async () => {
    log.info('Apagando...');
    await consumer?.close();
    io.close();
    await Promise.all(redisClients.map((c) => c.quit().catch(() => undefined)));
    await store.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(`[chat] No se pudo iniciar: ${(error as Error).message}`);
  process.exit(1);
});
