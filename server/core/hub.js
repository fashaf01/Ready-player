// Everyone who is connected: the Gate Hall, the race rooms and the people
// watching races.

import { RaceRoom } from './race.js';
import { publicProfile } from './profile.js';

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

const DEFAULTS = { LOCKOUT_MINUTES: 60, LOBBY_WAIT: 20, DEBUG_SECRET: false };

export class Hub {
  constructor(db, config = {}) {
    this.db = db;
    this.config = { ...DEFAULTS, ...config };
    this.clients = new Map();
    this.rooms = new Map();
    this.nextRoomId = 1;
    this.boardTimer = null;
    this.board = { clears: [], stats: { attempts: 0, clears: 0, players: 0 } };
    // Lockouts not yet confirmed written, so a quick reconnect can't skip one.
    this.pendingLocks = new Map();
    this.hallTimer = setInterval(() => this.hallTick(), 160);
  }

  // Database writes happen in the background; the connected player's copy
  // of their profile is updated right away.
  write(what, promise) {
    return promise.catch((e) => console.error(`[db] ${what} failed:`, e.message));
  }

  patchUser(userId, fn) {
    const c = this.clients.get(userId);
    if (c) fn(c.user);
  }

  get lockoutOn() {
    return this.config.LOCKOUT_MINUTES > 0;
  }

  withPendingLock(user) {
    // Lockout switched off: nobody is locked, whatever is stored.
    if (!this.lockoutOn) return user.locked_until ? { ...user, locked_until: 0 } : user;
    const lock = this.pendingLocks.get(user.id);
    if (lock && lock > user.locked_until) return { ...user, locked_until: lock };
    return user;
  }


  addAttempt(userId) {
    this.patchUser(userId, (u) => u.attempts++);
    return this.write('attempt', this.db.addAttempt(userId));
  }

  setBest(userId, d) {
    this.patchUser(userId, (u) => (u.best_distance = Math.max(u.best_distance, d)));
    return this.write('best', this.db.setBestDistance(userId, d));
  }

  recordClear(user, time) {
    this.patchUser(user.id, (u) => (u.shards |= 1));
    return this.write(
      'clear',
      this.db.recordClear(1, user, time).then(() => this.boardChanged()),
    );
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.boardTimer);
    clearInterval(this.hallTimer);
    for (const room of this.rooms.values()) clearInterval(room.timer);
  }

  connect(ws, dbUser) {
    const user = this.withPendingLock(dbUser);
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
    client.send({ t: 'welcome', me: publicProfile(user), now: Date.now(), lockoutMinutes: this.config.LOCKOUT_MINUTES });
    client.send({ t: 'board', ...this.board, online: this.clients.size });
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
      case 'ready':
        return c.room?.setReady(c, m.on !== false);
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
        return c.send({ t: 'me', me: publicProfile(c.user), now: Date.now() });
    }
  }

  toHall(c) {
    if (c.room) c.room.removeHuman(c, 'left');
    this.stopWatching(c);
    c.mode = 'hall';
    c.send({ t: 'me', me: publicProfile(c.user), now: Date.now() });
  }

  join(c) {
    if (c.room) return;
    const user = c.user;
    if (this.lockoutOn && user.locked_until > Date.now()) {
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
    if (!this.lockoutOn) return;
    const until = Date.now() + this.config.LOCKOUT_MINUTES * 60000;
    this.pendingLocks.set(userId, until);
    this.patchUser(userId, (u) => (u.locked_until = until));
    const attempt = (n) =>
      this.db.setLockedUntil(userId, until).then(
        () => {
          if (this.pendingLocks.get(userId) === until) this.pendingLocks.delete(userId);
        },
        (e) => {
          if (n < 3) setTimeout(() => attempt(n + 1), 2000 * (n + 1));
          else console.error('[db] lockout failed:', e.message);
        },
      );
    attempt(0);
  }

  sendResult(client, res) {
    client.send({ t: 'result', ...res, me: publicProfile(client.user), now: Date.now() });
  }

  async refreshBoard() {
    try {
      this.board = await this.db.board(1);
    } catch (e) {
      console.error('[db] board failed:', e.message);
    }
  }

  boardChanged() {
    if (this.boardTimer || this.stopped) return;
    this.boardTimer = setTimeout(async () => {
      this.boardTimer = null;
      await this.refreshBoard();
      const msg = JSON.stringify({ t: 'board', ...this.board, online: this.clients.size });
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
