// The whole game server inside one Durable Object: every player's live
// connection, the Gate Hall, all race rooms, and the accounts API.
//
// Sockets are accepted WITHOUT hibernation on purpose: races tick 20 times a
// second in memory, so the object must stay awake while anyone is connected.
// When nobody is connected it may be unloaded; accounts live in its SQLite
// storage and survive that.

import { Hub } from '../server/core/hub.js';
import { handleApi, userFromAuth, WS_PROTOCOL } from '../server/core/api.js';
import { openDoStore } from './store-do.js';
import { openKvStore } from './store-kv.js';

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const MAX_MESSAGE = 8 * 1024;

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
  });
}

// Give a Workers WebSocket the small surface the hub expects (Node `ws` style).
function adapt(ws) {
  const handlers = { message: [], close: [] };
  let closed = false;
  ws.addEventListener('message', (ev) => {
    const d = ev.data;
    if (typeof d !== 'string' || d.length > MAX_MESSAGE) return;
    for (const f of handlers.message) f(d);
  });
  const onClose = () => {
    if (closed) return;
    closed = true;
    for (const f of handlers.close) f();
  };
  ws.addEventListener('close', onClose);
  ws.addEventListener('error', onClose);
  return {
    get readyState() {
      return ws.readyState;
    },
    send(d) {
      try {
        ws.send(d);
      } catch {}
    },
    close(code, reason) {
      try {
        ws.close(code, reason);
      } catch {}
    },
    on(ev, f) {
      handlers[ev]?.push(f);
    },
  };
}

// SQLite-backed objects have ctx.storage.sql; older key-value ones do not.
function sqlAvailable(storage) {
  try {
    storage.sql.exec('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function createWorld(ctx, env) {
  const devMode = env.HF_ENV === 'dev';
  const config = {
    LOCKOUT_MINUTES: num(env.LOCKOUT_MINUTES, 60),
    LOBBY_WAIT: num(env.LOBBY_WAIT, 20),
    // Only ever on for local development; production always runs HF_ENV=production.
    DEBUG_SECRET: devMode && env.DEBUG_SECRET === '1',
  };
  const db = sqlAvailable(ctx.storage) && env.FORCE_KV !== '1' ? openDoStore(ctx.storage.sql) : openKvStore(ctx.storage);
  console.log(`[world] storage: ${db.kind}`);
  const hub = new Hub(db, config);
  ctx.blockConcurrencyWhile(() => hub.refreshBoard());

  async function api(request, url) {
    let body = null;
    if (request.method === 'POST') {
      const text = await request.text();
      if (text.length > 4096) return json(413, { error: 'Request too large.' });
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        return json(400, { error: 'Bad request.' });
      }
    }
    const path = url.pathname.slice('/api'.length);
    if (config.DEBUG_SECRET && path === '/_debug/spots') {
      return json(200, Object.fromEntries([...hub.rooms.values()].map((r) => [r.id, r.spot])));
    }
    try {
      const out = await handleApi(db, hub, {
        method: request.method,
        path,
        body,
        contentType: request.headers.get('Content-Type') || '',
        cookie: request.headers.get('Cookie') || '',
        huntToken: request.headers.get('X-Hunt-Token') || '',
        ip: request.headers.get('CF-Connecting-IP') || 'local',
        secure: url.protocol === 'https:',
      });
      return json(out.status, out.json, out.setCookie ? { 'set-cookie': out.setCookie } : {});
    } catch (e) {
      console.error('[api]', e);
      return json(500, { error: 'Server error. Try again.' });
    }
  }

  async function upgrade(request, url) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket upgrade', { status: 426 });
    // Only accept sockets opened by our own pages.
    const origin = request.headers.get('Origin');
    if (origin) {
      let host = null;
      try {
        host = new URL(origin).host;
      } catch {}
      if (host !== url.host) return new Response('forbidden', { status: 403 });
    }
    const protocols = request.headers.get('Sec-WebSocket-Protocol') || '';
    const user = await userFromAuth(db, { cookie: request.headers.get('Cookie') || '', protocols });
    if (!user) return new Response('unauthorized', { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    hub.connect(adapt(server), user);
    const headers = protocols.split(',').map((s) => s.trim()).includes(WS_PROTOCOL) ? { 'Sec-WebSocket-Protocol': WS_PROTOCOL } : {};
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/ws') return upgrade(request, url);
      if (url.pathname.startsWith('/api/')) return api(request, url);
      return new Response('not found', { status: 404 });
    },
  };
}
