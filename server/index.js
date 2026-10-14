import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { CONFIG } from './config.js';
import { openStore } from './store/index.js';
import { authRouter, userFromCookie } from './auth.js';
import { Hub } from './hub.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// store options: { databaseUrl } for Postgres, { sqliteFile } for SQLite.
export async function createServer(storeOptions = {}) {
  const db = await openStore(storeOptions);
  const hub = new Hub(db);
  await hub.refreshBoard();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/api', authRouter(db, hub));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use('/vendor/three', express.static(path.join(root, 'node_modules/three'), { maxAge: '7d' }));
  app.use(express.static(path.join(root, 'public')));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

  server.on('upgrade', async (req, socket, head) => {
    if (!req.url.startsWith('/ws')) return socket.destroy();
    // Only accept sockets opened by our own pages.
    const origin = req.headers.origin;
    if (origin) {
      let host = null;
      try {
        host = new URL(origin).host;
      } catch {}
      if (host !== req.headers.host) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        return socket.destroy();
      }
    }
    let user = null;
    try {
      user = await userFromCookie(db, req.headers.cookie);
    } catch (e) {
      console.error('[ws] session lookup failed:', e.message);
    }
    if (!user || socket.destroyed) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => hub.connect(ws, user));
  });

  return {
    app,
    server,
    db,
    hub,
    async close() {
      hub.stop();
      for (const c of wss.clients) c.terminate();
      const done = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await done;
      await db.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, db } = await createServer();
  server.listen(CONFIG.PORT, () => {
    console.log(`THE HUNT is running on http://localhost:${CONFIG.PORT} (storage: ${db.kind})`);
    if (CONFIG.LOCKOUT_MINUTES !== 60) console.log(`  lockout: ${CONFIG.LOCKOUT_MINUTES} min`);
    if (CONFIG.DEBUG_SECRET) console.log('  DEBUG_SECRET is on: hidden spots are printed below. Never use this in production.');
  });
}
