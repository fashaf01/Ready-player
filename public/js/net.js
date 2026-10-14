// WebSocket connection to the game server, with clock sync.

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.offset = 0; // server time - local time
    this.bestRtt = Infinity;
    this.connected = false;
    this.closedByUs = false;
    this.retry = 0;
    this.pingTimer = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) fn(msg);
  }

  now() {
    return Date.now() + this.offset;
  }

  connect() {
    this.closedByUs = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.bestRtt = Infinity;
      this.emit('open');
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 2000);
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') return this.onPong(msg);
      if (msg.t === 'welcome' || msg.t === 'me' || msg.t === 'result') this.syncFrom(msg.now);
      this.emit(msg.t, msg);
    };
    ws.onclose = (e) => {
      this.connected = false;
      clearInterval(this.pingTimer);
      this.emit('close', e);
      if (this.closedByUs || e.code === 4002) return;
      const wait = Math.min(8000, 600 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }

  close() {
    this.closedByUs = true;
    this.ws?.close();
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  ping() {
    this.send({ t: 'ping', c: Date.now() });
  }

  syncFrom(serverNow) {
    if (typeof serverNow === 'number' && this.bestRtt === Infinity) this.offset = serverNow - Date.now();
  }

  onPong(msg) {
    const now = Date.now();
    const rtt = now - msg.c;
    if (rtt <= this.bestRtt * 1.3 || rtt < 60) {
      this.bestRtt = Math.min(this.bestRtt, rtt);
      const est = msg.s + rtt / 2 - now;
      this.offset = this.bestRtt === rtt ? est : this.offset * 0.7 + est * 0.3;
    }
  }
}

export async function api(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
