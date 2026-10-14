// One race. The server owns the clock, THE CLOCK, the AI runners and the
// one hidden thing on the course. Players move on their own screens and
// report where they are; the server checks those reports against what is
// physically possible.

import crypto from 'node:crypto';
import { TRACK, SPEED, CLOCK, ROOM, PHYS, AVATAR_COLORS, clockSchedule, laneX } from '../shared/constants.js';
import { generateCourse, deckAt, hitTest } from '../shared/course.js';
import { makeRunner, stepRunner, runnerFlags, FLAG } from '../shared/runner.js';
import { mulberry32 } from '../shared/rng.js';
import { BOT_NAMES, makeBrain, botInput } from './bots.js';
import { CONFIG } from './config.js';

const TICK = 50; // ms
const BOT_DT = 0.025; // s
const PANELS = Math.ceil(TRACK.LENGTH / TRACK.PANEL_LEN);
const r2 = (v) => Math.round(v * 100) / 100;

function randInt(lo, hi) {
  return lo + crypto.randomInt(hi - lo + 1);
}

// Where the hidden spot is this race. Server only.
function chooseSpot(course) {
  for (let i = 0; i < 200; i++) {
    const side = crypto.randomInt(2) ? 1 : -1;
    const panel = randInt(10, 32);
    const z0 = panel * TRACK.PANEL_LEN;
    const z1 = z0 + TRACK.PANEL_LEN;
    const landing = course.crashes.some(
      (c) => c.z1 > z0 + 16 && c.z0 < z0 + 52 && (side > 0 ? c.x1 > 1 : c.x0 < -1),
    );
    const piston = course.pistons.some((p) => p.side === side && Math.abs(p.z - (z0 + 2)) < 7);
    if (!landing && !piston) return { side, panel, z0, z1 };
  }
  return { side: 1, panel: 12, z0: 48, z1: 52 };
}

function hsl(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

// Rail panel looks: [color, pulse amount, pulse speed] for every panel.
function buildPanels(spot) {
  const out = { L: [], R: [] };
  for (const [key, side] of [['L', 1], ['R', -1]]) {
    for (let i = 0; i < PANELS; i++) {
      if (side === spot.side && i === spot.panel) {
        out[key].push([hsl(0.47 + Math.random() * 0.01, 1, 0.47), r2(0.13 + Math.random() * 0.04), r2(0.3 + Math.random() * 0.1)]);
      } else {
        out[key].push([hsl(0.515 + (Math.random() - 0.5) * 0.012, 1, 0.5 + (Math.random() - 0.5) * 0.04), r2(Math.random() * 0.05), r2(0.5 + Math.random())]);
      }
    }
  }
  return out;
}

export class RaceRoom {
  constructor(hub, id) {
    this.hub = hub;
    this.id = id;
    this.seed = crypto.randomInt(1, 2 ** 31 - 1);
    this.course = generateCourse(this.seed);
    this.spot = chooseSpot(this.course);
    this.panels = buildPanels(this.spot);
    this.phase = 'lobby';
    this.createdAt = Date.now();
    this.lobbyEndsAt = Date.now() + CONFIG.LOBBY_WAIT * 1000;
    this.startAt = 0;
    this.endedAt = 0;
    this.clockZ = CLOCK.START_Z;
    this.simT = 0;
    this.allowT = 0;
    this.runners = []; // index = lane
    this.spectators = new Set();
    this.rand = mulberry32(this.seed ^ 0x5bd1e995);
    this.timer = setInterval(() => this.tick(), TICK);
    this.winners = [];
    if (CONFIG.DEBUG_SECRET) {
      console.log(`[race ${id}] hidden spot: ${this.spot.side > 0 ? 'left' : 'right'} side, ${this.spot.z0}-${this.spot.z1} m`);
    }
  }

  get humans() {
    return this.runners.filter((r) => r && !r.bot);
  }

  get t() {
    return (Date.now() - this.startAt) / 1000;
  }

  canJoin() {
    return this.phase === 'lobby' && this.humans.length < ROOM.MAX_RUNNERS;
  }

  // ------------------------------------------------------------------ lobby

  addHuman(client) {
    const free = [];
    for (let i = 0; i < ROOM.MAX_RUNNERS; i++) if (!this.runners[i]) free.push(i);
    const lane = free[crypto.randomInt(free.length)];
    this.runners[lane] = {
      lane,
      bot: false,
      id: client.user.id,
      name: client.user.display_name,
      color: client.user.color,
      client,
      x: laneX(lane),
      y: 0,
      z: -12 - Math.random() * 10,
      flags: 0,
      allowedZ: 0,
      violations: 0,
      suspect: 0,
      airborne: 0,
      lastDown: -99,
      lastMsg: Date.now(),
      hidden: false,
      edgeUsed: false,
      secretOk: false,
      skates: false,
      dead: null,
      finished: false,
      done: false,
    };
    client.room = this;
    client.lane = lane;
    if (this.humans.length >= ROOM.MAX_RUNNERS) this.startCountdown();
    this.broadcastRoom();
  }

  removeHuman(client, reason) {
    const r = this.runners[client.lane];
    if (!r || r.client !== client) return;
    if (this.phase === 'lobby') {
      this.runners[client.lane] = undefined;
      client.room = null;
      client.lane = null;
      this.broadcastRoom();
      return;
    }
    // Leaving after line-up counts as a failed attempt.
    r.client = null;
    if (!r.done) this.failRunner(r, reason || 'left', client);
    client.room = null;
    client.lane = null;
  }

  lobbyPos(client, msg) {
    const r = this.runners[client.lane];
    if (!r || this.phase !== 'lobby') return;
    r.x = Math.max(-11.5, Math.min(11.5, Number(msg.x) || 0));
    r.z = Math.max(TRACK.PLAZA_START + 1, Math.min(-2, Number(msg.z) || -10));
    r.ry = Number(msg.ry) || 0;
    r.moving = !!msg.m;
  }

  startCountdown() {
    if (this.phase !== 'lobby') return;
    for (let i = 0; i < ROOM.MAX_RUNNERS; i++) {
      if (this.runners[i]) continue;
      const used = new Set(this.runners.filter(Boolean).map((r) => r.name));
      let name;
      do name = BOT_NAMES[Math.floor(this.rand() * BOT_NAMES.length)];
      while (used.has(name) && used.size < BOT_NAMES.length);
      const R = makeRunner(laneX(i), -1);
      R.speedMul = 0.93 + this.rand() * 0.07;
      this.runners[i] = {
        lane: i,
        bot: true,
        id: `bot${i}`,
        name,
        color: AVATAR_COLORS[Math.floor(this.rand() * AVATAR_COLORS.length)],
        R,
        brain: makeBrain(this.rand),
        hidden: false,
        dead: null,
        finished: false,
        done: false,
      };
    }
    for (const r of this.humans) {
      r.x = laneX(r.lane);
      r.z = -1;
      r.y = 0;
      r.lastMsg = Date.now();
    }
    Promise.all(this.humans.map((r) => this.hub.addAttempt(r.id))).then(() => this.hub.boardChanged());
    this.phase = 'countdown';
    this.startAt = Date.now() + ROOM.COUNTDOWN * 1000;
    this.broadcastRoom();
  }

  // ------------------------------------------------------------------- race

  tick() {
    const now = Date.now();
    if (this.phase === 'lobby') {
      if (this.humans.length === 0) return this.close();
      if (now >= this.lobbyEndsAt) this.startCountdown();
      else this.broadcastLobby();
      return;
    }
    if (this.phase === 'countdown') {
      if (now >= this.startAt) this.phase = 'running';
      else return;
    }
    if (this.phase === 'done') {
      if (now - this.endedAt > ROOM.AFTER_RACE * 1000) this.close();
      return;
    }

    const t = this.t;

    // AI runners catch up to the real race time in small steps, even when a
    // tick fires late.
    let steps = 0;
    while (this.simT + BOT_DT <= t && steps++ < 400) {
      this.simT += BOT_DT;
      for (const r of this.runners) {
        if (!r || !r.bot || r.done) continue;
        stepRunner(this.course, this.simT, BOT_DT, r.R, botInput(this.course, this.simT, r.R, r.brain), {
          onDeath: (_R, cause) => {
            r.dead = cause;
            r.done = true;
          },
        });
      }
    }
    if (steps >= 400) this.simT = t;

    // Players: the furthest they could possibly have got by now.
    const dt = Math.max(0, t - this.allowT);
    this.allowT = t;
    for (const r of this.humans) {
      if (r.done) continue;
      r.allowedZ += dt * (r.skates ? SPEED.SKATE * 1.12 : SPEED.SPRINT * 1.07);
      if (now - r.lastMsg > 6000) this.failRunner(r, 'lost');
    }

    // THE CLOCK. It never lets an ordinary runner get close.
    let leader = -Infinity;
    for (const r of this.runners) {
      if (!r || r.dead || r.skates || r.hidden) continue;
      const z = r.bot ? r.R.z : r.z;
      if (z > leader) leader = z;
    }
    this.clockZ = Math.max(this.clockZ, clockSchedule(t), Math.min(TRACK.LENGTH, leader + CLOCK.LEAD));

    if (this.clockZ >= TRACK.LENGTH || t > CLOCK.TIME + 20) {
      this.endRace();
      return;
    }
    if (this.humans.length === 0 && this.spectators.size === 0) {
      this.endRace();
      return;
    }
    this.broadcastState(t);
  }

  playerState(client, msg) {
    const r = this.runners[client.lane];
    if (!r || r.client !== client || r.done || this.phase !== 'running') return;
    r.lastMsg = Date.now();
    const x = Number(msg.x), y = Number(msg.y), z = Number(msg.z);
    if (![x, y, z].every(Number.isFinite)) return;
    let zz = Math.max(-2, z);
    if (zz > r.allowedZ + 4) {
      zz = r.allowedZ;
      if (++r.violations > 40) return this.failRunner(r, 'rules');
    }
    r.z = zz;
    r.x = Math.max(-14, Math.min(14, x));
    r.y = Math.max(-40, Math.min(12, y));
    r.flags = (Number(msg.f) | 0) & 63 & ~FLAG.SKATES;
    if (Math.abs(r.x) > TRACK.EDGE_X + 1 && !r.secretOk) return this.failRunner(r, 'void');
    r.maxZ = Math.max(r.maxZ || 0, Math.min(TRACK.LENGTH, r.z));
    const tt = Number(msg.tt);
    if (Number.isFinite(tt) && Math.abs(tt - this.t) < 1.5) this.checkHonest(r, tt);
  }

  // Hits are worked out in the player's browser. The course is the same on
  // both sides, so replay the reported moment here and catch anyone who has
  // switched obstacles off.
  checkHonest(r, tt) {
    if (r.flags & FLAG.DOWN) {
      r.lastDown = tt;
      r.airborne = 0;
      return;
    }
    if (r.hidden || r.z < 0 || r.z > TRACK.LENGTH) return;
    // Standing on road that is no longer there.
    if (Math.abs(r.y) < 0.02 && Math.abs(r.x) < TRACK.HALF_W && !deckAt(this.course, tt, r.x, r.z)) {
      if (++r.airborne >= 4) return this.failRunner(r, 'fall');
    } else r.airborne = 0;
    if (tt - (r.lastDown ?? -99) < 4.5) return;
    const probe = { x: r.x, y: r.y, z: r.z, pz: r.z, h: r.flags & FLAG.SLIDE ? PHYS.SLIDE_H : PHYS.HEIGHT, skates: r.skates };
    // Only count clear overlaps, not edge-of-contact rounding.
    const hit = hitTest(this.course, tt, probe, 0.08);
    if (!hit) return;
    r.suspect = (r.suspect || 0) + (hit.kind === 'kill' ? 3 : 1);
    if (r.suspect >= 6) this.failRunner(r, 'rules');
  }

  // The runner went over the side.
  playerEdge(client, msg) {
    const r = this.runners[client.lane];
    if (!r || r.client !== client || r.done || this.phase !== 'running') return;
    const z = Number(msg.z);
    const side = Math.sign(Number(msg.x));
    if (!Number.isFinite(z) || !side) return;
    r.hidden = true;
    const zc = Math.min(z, r.allowedZ + 4);
    const ok =
      !r.edgeUsed &&
      Math.abs(zc - r.z) < 8 &&
      side === this.spot.side &&
      zc >= this.spot.z0 - 1 &&
      zc <= this.spot.z1 + 2.5;
    r.edgeUsed = true;
    if (!ok) {
      client.send({ t: 'edge', ok: false });
      this.failRunner(r, 'void');
      return;
    }
    r.secretOk = true;
    r.ledgeZ = zc;
    client.send({
      t: 'edge',
      ok: true,
      g: { side, y: -4, z0: zc - 4, z1: zc + 28, xin: 6, xout: 12.5, skateZ: zc + 5, launchZ: zc + 22 },
    });
  }

  playerPick(client) {
    const r = this.runners[client.lane];
    if (!r || r.client !== client || r.done || !r.secretOk || r.skates) return;
    if (r.z < r.ledgeZ + 2) return;
    r.skates = true;
  }

  playerFinish(client) {
    const r = this.runners[client.lane];
    if (!r || r.client !== client || r.done || this.phase !== 'running') return;
    if (!r.skates || r.z < TRACK.LENGTH - 1 || this.clockZ >= TRACK.LENGTH) return;
    const time = Math.round(this.t * 100) / 100;
    r.finished = true;
    r.done = true;
    r.time = time;
    this.hub.setBest(r.id, TRACK.LENGTH);
    this.hub.recordClear({ id: r.id, display_name: r.name }, time);
    this.winners.push({ n: r.name, time });
    this.hub.sendResult(client, { outcome: 'win', time });
  }

  playerDead(client, msg) {
    const r = this.runners[client.lane];
    if (!r || r.client !== client || r.done) return;
    const cause = ['crush', 'fall', 'void'].includes(msg.cause) ? msg.cause : 'fall';
    this.failRunner(r, cause);
  }

  failRunner(r, cause, clientOverride) {
    if (r.done) return;
    r.done = true;
    if (r.maxZ) this.hub.setBest(r.id, r.maxZ);
    r.dead = cause === 'time' ? null : cause;
    const client = r.client || clientOverride;
    this.hub.lockOut(r.id);
    if (client) this.hub.sendResult(client, { outcome: cause === 'time' ? 'lose' : 'dead', cause });
  }

  endRace() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.endedAt = Date.now();
    for (const r of this.humans) if (!r.done) this.failRunner(r, 'time');
    const msg = { t: 'end', winners: this.winners, clockWon: this.winners.length === 0 };
    this.sendAll(msg);
  }

  close() {
    clearInterval(this.timer);
    if (this.phase !== 'done' && this.phase !== 'lobby') this.endRace();
    this.phase = 'closed';
    for (const r of this.humans) {
      if (r.client && r.client.room === this) {
        r.client.room = null;
        r.client.lane = null;
      }
    }
    for (const s of this.spectators) if (s.watching === this) s.watching = null;
    this.hub.roomClosed(this);
  }

  // ------------------------------------------------------------ networking

  runnerList() {
    return this.runners.map((r) =>
      r ? { i: r.lane, id: r.bot ? r.id : `u${r.id}`, n: r.name, c: r.color, bot: r.bot } : null,
    );
  }

  roomInfo(forClient) {
    return {
      t: 'room',
      id: this.id,
      phase: this.phase,
      seed: this.seed,
      startAt: this.startAt,
      lobbyEndsAt: this.lobbyEndsAt,
      you: forClient && forClient.room === this ? forClient.lane : null,
      runners: this.runnerList(),
      panels: this.panels,
    };
  }

  broadcastRoom() {
    for (const r of this.humans) if (r.client) r.client.send(this.roomInfo(r.client));
    for (const s of this.spectators) s.send(this.roomInfo(s));
  }

  broadcastLobby() {
    if ((this._lobbyTick = (this._lobbyTick || 0) + 1) % 3) return;
    const msg = {
      t: 'lobby',
      endsAt: this.lobbyEndsAt,
      p: this.humans.map((r) => [r.lane, r2(r.x), r2(r.z), r2(r.ry || 0), r.moving ? 1 : 0]),
    };
    this.sendAll(msg);
  }

  broadcastState(t) {
    const rs = [];
    const lost = [];
    for (const r of this.runners) {
      if (!r) continue;
      if (r.hidden) {
        lost.push(r.lane);
        continue;
      }
      if (r.bot) rs.push([r.lane, r2(r.R.z), r2(r.R.x), r2(r.R.y), runnerFlags(r.R)]);
      else rs.push([r.lane, r2(r.z), r2(r.x), r2(r.y), (r.flags & ~FLAG.DEAD) | (r.dead ? FLAG.DEAD : 0) | (r.finished ? FLAG.FINISHED : 0)]);
    }
    this.sendAll({ t: 'rs', tt: r2(t), clock: r2(this.clockZ), r: rs, lost });
  }

  sendAll(msg) {
    const data = JSON.stringify(msg);
    for (const r of this.humans) if (r.client) r.client.sendRaw(data);
    for (const s of this.spectators) s.sendRaw(data);
  }

  summary() {
    return {
      id: this.id,
      phase: this.phase,
      t: this.phase === 'running' ? Math.round(this.t) : 0,
      players: this.humans.map((r) => r.name),
      runners: this.runners.filter(Boolean).length || this.humans.length,
      watchers: this.spectators.size,
    };
  }
}
