import http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import amqp from 'amqplib';

const PORT = Number(process.env.PORT ?? 3002);
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const RABBITMQ_URL = process.env.RABBITMQ_URL ?? '';

const app = express();
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'canchaya-chat' });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Valida el mismo JWT que emite el monolito (sin llamadas síncronas a él).
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('unauthorized'));
    socket.data.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.on('room:join', (roomId: string) => socket.join(roomId));
  socket.on('message:send', ({ roomId, text }: { roomId: string; text: string }) => {
    io.to(roomId).emit('message:new', {
      roomId,
      text,
      from: socket.data.user?.sub,
      at: new Date().toISOString(),
    });
  });
});

// Consumidor de eventos del monolito (Fase 4: crear/cerrar salas por reserva).
async function consumeEvents() {
  if (!RABBITMQ_URL) return;
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();
  await ch.assertQueue('chat.booking-events', { durable: true });
  ch.consume('chat.booking-events', (msg) => {
    if (!msg) return;
    console.log('Evento recibido:', msg.content.toString());
    ch.ack(msg);
  });
}

server.listen(PORT, () => console.log(`chat-service escuchando en :${PORT}`));
consumeEvents().catch((err) => console.error('RabbitMQ no disponible:', err.message));
