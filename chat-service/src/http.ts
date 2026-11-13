import express, { NextFunction, Request, Response } from 'express';
import { bearerToken, verifyToken } from './auth';
import { isParticipant, publicRoom } from './gateway';
import { ChatStore } from './store/types';
import { AuthUser } from './types';

interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function createApp(store: ChatStore, jwtSecret: string, corsOrigin: string) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'canchaya-chat' });
  });

  const auth = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const user = verifyToken(bearerToken(req.headers.authorization), jwtSecret);
    if (!user) return void res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  };

  // Mis conversaciones (como jugador o como dueño del local).
  app.get('/rooms', auth, async (req: AuthedRequest, res, next) => {
    try {
      const rooms = await store.listRoomsFor((req.user as AuthUser).id);
      res.json(rooms.map(publicRoom));
    } catch (error) {
      next(error);
    }
  });

  // Historial paginado hacia atrás: ?limit=50&before=<id del mensaje más antiguo que ya tienes>
  app.get('/rooms/:id/messages', auth, async (req: AuthedRequest, res, next) => {
    try {
      const room = await store.getRoom(req.params.id);
      if (!room) return void res.status(404).json({ error: 'room_not_found' });
      if (!isParticipant(room, (req.user as AuthUser).id)) return void res.status(403).json({ error: 'forbidden' });
      const limit = Math.min(Math.max(parseInt(String(req.query.limit), 10) || 50, 1), 100);
      const before = typeof req.query.before === 'string' && req.query.before.length <= 100 ? req.query.before : undefined;
      res.json({ room: publicRoom(room), messages: await store.listMessages(room.id, { before, limit }) });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(`Error en HTTP: ${error.message}`);
    res.status(500).json({ error: 'internal' });
  });

  return app;
}
