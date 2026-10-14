// The race course. Everything here is built from a seed, so the browser and
// the server create exactly the same obstacles at exactly the same times.
// The race clock `t` is seconds since GO.

import { mulberry32 } from './rng.js';
import { TRACK, PHYS, SPEED, KNOCK, laneX } from './constants.js';

export const OBST = {
  BALL_DROP: 0.6,
  BLOCK_DROP: 0.9,
  BLOCK_LIFE: 5.5,
  BLOCK_SIZE: 2.4,
  CRASH_WARN: 1.6,
  CRASH_FALL: 1.6,
  PISTON_REACH: 5.2,
  PISTON_DEPTH: 1.6,
  TRAP_LEN: 6,
  TRAP_ON: 0.7,
  TRAP_WARN: 0.45,
  LASER_THICK: 0.07,
};

const { HALF_W, LANE_W, LANES } = TRACK;

function mod(a, n) {
  return ((a % n) + n) % n;
}

function rectsOverlap(ax0, ax1, az0, az1, bx0, bx1, bz0, bz1) {
  return ax0 < bx1 && ax1 > bx0 && az0 < bz1 && az1 > bz0;
}

export function generateCourse(seed) {
  const rnd = mulberry32(seed);
  const r = (a, b) => a + (b - a) * rnd();
  const ri = (a, b) => Math.floor(a + (b - a + 1) * rnd());

  // Road crashes: chunks of road that crack and fall away mid-race.
  const crashes = [];
  let z = r(64, 84);
  while (z < 362) {
    const len = r(7, 11);
    const n = ri(4, 6);
    const where = rnd();
    let start;
    if (where < 0.35) start = 0;
    else if (where < 0.7) start = LANES - n;
    else start = ri(1, LANES - n - 1);
    const x0 = -HALF_W + start * LANE_W;
    crashes.push({
      id: crashes.length,
      z0: z,
      z1: z + len,
      x0,
      x1: x0 + n * LANE_W,
      tCrash: Math.max(4, z / 8.2 + r(-2.6, 0.2)),
    });
    z += len + r(38, 62);
  }
  const inCrashZ = (zz, pad) => crashes.some((c) => zz > c.z0 - pad && zz < c.z1 + pad);

  // Laser gates across the full width: jump the low ones, slide the high ones,
  // time the sweeping ones.
  const gates = [];
  z = r(38, 48);
  while (z < 388) {
    if (inCrashZ(z, 3)) {
      z += 5;
      continue;
    }
    const roll = rnd();
    const type = roll < 0.4 ? 'low' : roll < 0.75 ? 'high' : 'sweep';
    gates.push({ id: gates.length, z, type, w: r(2.2, 3.4), ph: r(0, Math.PI * 2) });
    z += r(30, 46);
  }

  // Trap floors: shock panels and spike panels that switch on and off.
  const traps = [];
  let tries = 0;
  while (traps.length < 12 && tries++ < 400) {
    const z0 = r(28, 386);
    const n = ri(2, 4);
    const start = ri(0, LANES - n);
    const x0 = -HALF_W + start * LANE_W;
    const x1 = x0 + n * LANE_W;
    const z1 = z0 + OBST.TRAP_LEN;
    if (crashes.some((c) => rectsOverlap(x0, x1, z0 - 2, z1 + 2, c.x0, c.x1, c.z0, c.z1))) continue;
    if (gates.some((g) => g.z > z0 - 2.5 && g.z < z1 + 2.5)) continue;
    if (traps.some((o) => rectsOverlap(x0, x1, z0 - 4, z1 + 4, o.x0, o.x1, o.z0, o.z1))) continue;
    traps.push({ z0, z1, x0, x1, kind: rnd() < 0.5 ? 'shock' : 'spike', period: r(1.8, 2.6), ph: r(0, 3) });
  }
  traps.sort((a, b) => a.z0 - b.z0).forEach((tr, i) => (tr.id = i));

  // Pistons punch in from the rails.
  const pistons = [];
  tries = 0;
  while (pistons.length < 9 && tries++ < 400) {
    const pz = r(36, 390);
    if (gates.some((g) => Math.abs(g.z - pz) < 4)) continue;
    if (pistons.some((p) => Math.abs(p.z - pz) < 14)) continue;
    pistons.push({ z: pz, side: rnd() < 0.5 ? -1 : 1, period: r(2.0, 2.8), ph: r(0, 3) });
  }
  pistons.sort((a, b) => a.z - b.z).forEach((p, i) => (p.id = i));

  // Falling blocks. Most are timed for the pack; some are timed for anyone
  // who is far faster than the pack.
  const blocks = [];
  tries = 0;
  const S = OBST.BLOCK_SIZE;
  while (blocks.length < 26 && tries++ < 600) {
    const bz = r(34, 392);
    const x = Math.max(-HALF_W + S / 2, Math.min(HALF_W - S / 2, laneX(ri(0, LANES - 1)) + r(-0.4, 0.4)));
    const fast = rnd() < 0.3;
    const tDrop = fast ? 7.5 + bz / SPEED.SKATE + r(-1.2, 1.2) : bz / 8.0 + r(-1.8, 0.8);
    if (tDrop < 2.2) continue;
    if (gates.some((g) => Math.abs(g.z - bz) < 2.5)) continue;
    if (crashes.some((c) => rectsOverlap(x - S / 2, x + S / 2, bz - S / 2, bz + S / 2, c.x0, c.x1, c.z0, c.z1) && tDrop + OBST.BLOCK_LIFE > c.tCrash - 2)) continue;
    blocks.push({ x, z: bz, tDrop, s: S });
  }
  blocks.sort((a, b) => a.tDrop - b.tDrop).forEach((b, i) => (b.id = i));

  // Rolling energy balls. They drop in all along the track and roll back
  // toward the start line.
  const balls = [];
  const makeBall = (ts, z0) => {
    const rad = r(0.85, 1.4);
    return { ts, z0, x: r(-HALF_W + rad * 0.7, HALF_W - rad * 0.7), r: rad, v: r(6, 12), life: r(4.5, 7), hue: rnd() };
  };
  for (let i = 0; i < 7; i++) balls.push(makeBall(r(0.6, 3.2), r(38, 95)));
  let ts = 1.5;
  while (ts < 41) {
    balls.push(makeBall(ts, r(30, 396)));
    ts += r(0.15, 0.26);
  }
  for (const b of balls) {
    let end = Math.min(b.ts + b.life, b.ts + (b.z0 + 6) / b.v);
    let falls = false;
    for (const c of crashes) {
      if (b.x < c.x0 || b.x > c.x1) continue;
      if (b.z0 < c.z0) continue;
      const tEnter = b.z0 > c.z1 ? b.ts + (b.z0 - c.z1) / b.v : b.ts;
      const tLeave = b.ts + (b.z0 - c.z0) / b.v;
      const td = Math.max(tEnter, c.tCrash);
      if (td <= tLeave && td < end) {
        end = td;
        falls = true;
      }
    }
    b.end = end;
    b.falls = falls;
  }
  balls.sort((a, b) => a.ts - b.ts).forEach((b, i) => (b.id = i));

  return { seed, crashes, gates, traps, pistons, blocks, balls };
}

// ---------------------------------------------------------------------------
// State of each obstacle at race time t (used for drawing and for hits).

export function ballState(b, t) {
  if (t < b.ts - OBST.BALL_DROP || t > b.end + 0.8) return null;
  if (t < b.ts) {
    const k = (b.ts - t) / OBST.BALL_DROP;
    return { x: b.x, z: b.z0, y: b.r + 22 * k * k, roll: 0, phase: 'drop', k };
  }
  const tt = Math.min(t, b.end) - b.ts;
  const z = b.z0 - b.v * tt;
  const roll = (b.v * tt) / b.r;
  if (t <= b.end) return { x: b.x, z, y: b.r, roll, phase: 'roll', k: 0 };
  const after = t - b.end;
  if (b.falls) return { x: b.x, z: z - b.v * after, y: b.r - 0.5 * PHYS.G * after * after, roll, phase: 'fall', k: after / 0.8 };
  return { x: b.x, z, y: b.r, roll, phase: 'fade', k: after / 0.8 };
}

export function blockState(b, t) {
  const start = b.tDrop - OBST.BLOCK_DROP;
  const end = b.tDrop + OBST.BLOCK_LIFE;
  if (t < start || t > end + 0.5) return null;
  if (t < b.tDrop) {
    const k = (b.tDrop - t) / OBST.BLOCK_DROP;
    return { y: b.s / 2 + 26 * k * k, phase: 'drop', k, scale: 1 };
  }
  if (t <= end) return { y: b.s / 2, phase: 'down', k: 0, scale: 1 };
  return { y: b.s / 2, phase: 'fade', k: (t - end) / 0.5, scale: 1 - (t - end) / 0.5 };
}

export function gateHeight(g, t) {
  if (g.type === 'low') return 0.38;
  if (g.type === 'high') return 1.2;
  return 0.35 + 0.9 * (0.5 + 0.5 * Math.sin(g.w * t + g.ph));
}

export function trapState(tr, t) {
  const u = mod(t + tr.ph, tr.period);
  if (u < OBST.TRAP_ON) return 'on';
  if (u > tr.period - OBST.TRAP_WARN) return 'warn';
  return 'off';
}

export function pistonExt(p, t) {
  const u = mod(t + p.ph, p.period);
  const R = OBST.PISTON_REACH;
  if (u < 0.18) return { ext: R * (u / 0.18), windup: false };
  if (u < 0.55) return { ext: R, windup: false };
  if (u < 1.15) return { ext: R * (1 - (u - 0.55) / 0.6), windup: false };
  return { ext: 0, windup: u > p.period - 0.35 };
}

export function crashState(c, t) {
  const warnAt = c.tCrash - OBST.CRASH_WARN;
  if (t < warnAt) return { phase: 'intact', p: 0 };
  if (t < c.tCrash) return { phase: 'warn', p: (t - warnAt) / OBST.CRASH_WARN };
  if (t < c.tCrash + OBST.CRASH_FALL) return { phase: 'fall', p: (t - c.tCrash) / OBST.CRASH_FALL };
  return { phase: 'gone', p: 1 };
}

// ---------------------------------------------------------------------------
// Ground and hits.

// Is there solid deck under (x, z) at time t? (The plaza behind the line is wider.)
export function deckAt(course, t, x, z) {
  if (z < TRACK.PLAZA_START || z > TRACK.RUNOUT_END) return false;
  if (z < -1) return Math.abs(x) <= 12;
  if (Math.abs(x) > TRACK.EDGE_X) return false;
  for (const c of course.crashes) {
    if (t >= c.tCrash && x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return false;
  }
  return true;
}

// Checks one runner against every obstacle. Runner: {x, y, z, pz, h, skates}.
// Returns null, {kind:'kill', cause}, or {kind:'knock', cause, dur, x?, z?}.
// `margin` shrinks the body (the server uses it to ignore rounding).
export function hitTest(course, t, R, margin = 0) {
  const BR = PHYS.BODY_R - margin;
  const top = R.y + R.h;

  for (const b of course.blocks) {
    if (t < b.tDrop - 0.05 || t > b.tDrop + OBST.BLOCK_LIFE) continue;
    const half = b.s / 2;
    const dx = R.x - b.x;
    const dz = R.z - b.z;
    if (t <= b.tDrop + 0.12) {
      if (Math.abs(dx) < half + BR * 0.4 && Math.abs(dz) < half + BR * 0.4 && R.y < b.s) {
        return { kind: 'kill', cause: 'crush' };
      }
      continue;
    }
    if (Math.abs(dx) < half + BR && Math.abs(dz) < half + BR && R.y < b.s) {
      const penX = half + BR - Math.abs(dx);
      const penZ = half + BR - Math.abs(dz);
      if (penZ < penX) return { kind: 'knock', cause: 'block', dur: KNOCK.BLOCK, z: b.z + Math.sign(dz || -1) * (half + BR + 0.05) };
      return { kind: 'knock', cause: 'block', dur: KNOCK.BLOCK, x: b.x + Math.sign(dx || 1) * (half + BR + 0.05) };
    }
  }

  for (const b of course.balls) {
    if (b.ts - 0.12 > t) break;
    if (t > b.end) continue;
    const s = ballState(b, t);
    if (!s) continue;
    const dx = R.x - s.x;
    const dz = R.z - s.z;
    const rr = b.r + BR;
    if (dx * dx + dz * dz < rr * rr && R.y + margin < s.y + b.r && top - margin > s.y - b.r) {
      return { kind: 'knock', cause: 'ball', dur: R.skates ? KNOCK.BALL_SKATES : KNOCK.BALL };
    }
  }

  for (const g of course.gates) {
    if (!(R.pz < g.z && R.z >= g.z)) continue;
    const h = gateHeight(g, t);
    if (h + OBST.LASER_THICK > R.y && h - OBST.LASER_THICK < top) {
      return { kind: 'knock', cause: 'laser', dur: KNOCK.LASER };
    }
  }

  if (R.y < 0.08) {
    for (const tr of course.traps) {
      if (R.z < tr.z0 || R.z > tr.z1 || R.x < tr.x0 || R.x > tr.x1) continue;
      if (trapState(tr, t) === 'on') return { kind: 'knock', cause: tr.kind, dur: KNOCK.TRAP };
    }
  }

  for (const p of course.pistons) {
    if (Math.abs(R.z - p.z) > OBST.PISTON_DEPTH / 2 + BR) continue;
    const { ext } = pistonExt(p, t);
    if (ext < 0.2 || R.y > 1.7) continue;
    const front = HALF_W - ext;
    if (p.side * R.x > front - BR) {
      return { kind: 'knock', cause: 'piston', dur: KNOCK.PISTON, x: p.side * (front - BR - 0.1) };
    }
  }
  return null;
}
