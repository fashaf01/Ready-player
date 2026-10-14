// Everyone who is connected: the Gate Hall, the race rooms and the people
// watching races.

import { RaceRoom } from './race.js';
import { publicProfile } from './db.js';
import { CONFIG } from './config.js';

const num = (v, lo, hi, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

class Client {
  constructor(hub, ws, user) {
    this.hub = hub;
    this.ws = ws;
    this.user = user;
    this.room = null;
    this.lane = null;
    this.watching = null;
    this.mode = 'hall';
    this.hall = { x: (Math.random() - 0.5) * 6, z: 8 + Math.random() * 4, ry: 0, m: 0 };
    this.msgWindow = Date.now();
    this.msgCount = 0;
  }
  send(obj) {
    this.sendRaw(JSON.stringify(obj));
  }
  sendRaw(data) {
    if (this.ws.readyState === 1) this.ws.send(data);
  }
}

export class Hub {
  constructor(db) {
    this.db = db;
    this.clients = new Map();
    this.rooms = new Map();
    this.nextRoomId = 1;
    this.boardTimer = null;
    this.hallTimer = setInterval(() => this.hallTick(), 160);
  }

  stop() {
    clearInterval(this.hallTimer);
    for (const room of this.rooms.values()) clearInterval(room.timer);
  }

  connect(ws, user) {
    const old = this.clients.get(user.id);
    if (old) {
      old.send({ t: 'kicked', reason: 'You opened the game somewhere else.' });
      this.disconnect(old);
      old.ws.close(4002, 'opened elsewhere');
    }
    const client = new Client(this, ws, user);
    this.clients.set(user.id, client);
    ws.on('message', (data) => {
      if (!this.rateOk(client)) return;
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg && typeof msg.t === 'string') this.onMessage(client, msg);
    });
    ws.on('close', () => this.disconnect(client));
    client.send({ t: 'welcome', me: publicProfile(user), now: Date.now() });
    client.send({ t: 'board', ...this.db.board(1), online: this.clients.size });
  }

  rateOk(client) {
    const now = Date.now();
    if (now - client.msgWindow > 1000) {
      client.msgWindow = now;
      client.msgCount = 0;
    }
    return ++client.msgCount <= 80;
  }

  disconnect(client) {
    if (client.room) client.room.removeHuman(client, 'left');
    this.stopWatching(client);
    if (this.clients.get(client.user.id) === client) this.clients.delete(client.user.id);
  }

  freshUser(client) {
    client.user = this.db.userById(client.user.id);
    return client.user;
  }

  onMessage(c, m) {
    switch (m.t) {
      case 'ping':
        return c.send({ t: 'pong', c: m.c, s: Date.now() });
      case 'hall':
        return this.toHall(c);
      case 'hp':
        c.hall = { x: num(m.x, -40, 40), z: num(m.z, -40, 40), ry: num(m.ry, -10, 10), m: m.m ? 1 : 0 };
        return;
      case 'join':
        return this.join(c);
      case 'leave':
        if (c.room && c.room.phase === 'lobby') c.room.removeHuman(c);
        c.mode = 'hall';
        return;
      case 'lp':
        return c.room?.lobbyPos(c, m);
      case 'st':
        return c.room?.playerState(c, m);
      case 'edge':
        return c.room?.playerEdge(c, m);
      case 'pick':
        return c.room?.playerPick(c);
      case 'fin':
        return c.room?.playerFinish(c);
      case 'dead':
        return c.room?.playerDead(c, m);
      case 'races':
        return c.send({ t: 'races', list: this.liveRaces() });
      case 'watch':
        return this.watch(c, m.id);
      case 'unwatch':
        this.stopWatching(c);
        c.mode = 'hall';
        return;
      case 'me':
        return c.send({ t: 'me', me: publicProfile(this.freshUser(c)), now: Date.now() });
    }
  }

  toHall(c) {
    if (c.room) c.room.removeHuman(c, 'left');
    this.stopWatching(c);
    c.mode = 'hall';
    c.send({ t: 'me', me: publicProfile(this.freshUser(c)), now: Date.now() });
  }

  join(c) {
    if (c.room) return;
    const user = this.freshUser(c);
    if (user.locked_until > Date.now()) {
      return c.send({ t: 'error', code: 'locked', until: user.locked_until, msg: 'You are locked out of the race.' });
    }
    this.stopWatching(c);
    let room = [...this.rooms.values()].find((r) => r.canJoin());
    if (!room) {
      room = new RaceRoom(this, this.nextRoomId++);
      this.rooms.set(room.id, room);
    }
    c.mode = 'room';
    room.addHuman(c);
  }

  watch(c, id) {
    if (c.room) return;
    const room = this.rooms.get(Number(id));
    if (!room || room.phase === 'closed') return c.send({ t: 'error', code: 'gone', msg: 'That race is over.' });
    this.stopWatching(c);
    room.spectators.add(c);
    c.watching = room;
    c.mode = 'watch';
    c.send(room.roomInfo(c));
  }

  stopWatching(c) {
    if (c.watching) {
      c.watching.spectators.delete(c);
      c.watching = null;
    }
  }

  liveRaces() {
    return [...this.rooms.values()].filter((r) => r.phase !== 'closed').map((r) => r.summary());
  }

  lockOut(userId) {
    const until = Date.now() + CONFIG.LOCKOUT_MINUTES * 60000;
    this.db.setLockedUntil(userId, until);
  }

  sendResult(client, res) {
    const user = this.freshUser(client);
    client.send({ t: 'result', ...res, me: publicProfile(user), now: Date.now() });
  }

  boardChanged() {
    if (this.boardTimer) return;
    this.boardTimer = setTimeout(() => {
      this.boardTimer = null;
      const msg = JSON.stringify({ t: 'board', ...this.db.board(1), online: this.clients.size });
      for (const c of this.clients.values()) c.sendRaw(msg);
    }, 300);
  }

  roomClosed(room) {
    this.rooms.delete(room.id);
  }

  hallTick() {
    const inHall = [...this.clients.values()].filter((c) => c.mode === 'hall');
    if (!inHall.length) return;
    const list = inHall.map((c) => [c.user.id, c.user.display_name, c.user.color, c.hall.x, c.hall.z, c.hall.ry, c.hall.m]);
    const msg = JSON.stringify({ t: 'hallp', p: list, races: this.rooms.size });
    for (const c of inHall) c.sendRaw(msg);
  }
}
