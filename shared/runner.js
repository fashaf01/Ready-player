// One runner's movement and collisions for one step. The browser uses this
// for the local player and the server uses it for the AI runners, so both
// move by exactly the same rules.
//
// Axes: +z is down the track, +y is up, x is across the track. Facing down
// the track, +x is on your left.

import { TRACK, SPEED, PHYS, KNOCK } from './constants.js';
import { deckAt, hitTest } from './course.js';

export function makeRunner(x = 0, z = -1) {
  return {
    x, y: 0, z, pz: z,
    vx: 0, vy: 0, vz: 0,
    onGround: true,
    slide: 0, slideCd: 0,
    down: 0, inv: 0,
    stamina: 100, exhausted: false,
    skates: false,
    speedMul: 1,
    overEdge: false,
    ledge: null,
    arc: null,
    finished: false,
    dead: null,
    h: PHYS.HEIGHT,
    lastHit: null,
  };
}

function approach(v, target, rate, dt) {
  if (v < target) return Math.min(target, v + rate * dt);
  return Math.max(target, v - rate * dt);
}

function groundY(course, t, R) {
  const L = R.ledge;
  if (L && R.z >= L.z0 && R.z <= L.z1) {
    const sx = R.x * L.side;
    if (sx >= L.xin && sx <= L.xout) return L.y;
  }
  if (!R.overEdge && deckAt(course, t, R.x, R.z)) return 0;
  return null;
}

// input: { fwd, sprint, dx (-1..1 along world x), jump, slide }
// hooks: { onEdge, onHit, onDeath, onSkates, onFinish } (all optional)
export function stepRunner(course, t, dt, R, input, hooks = {}) {
  if (R.dead) return;

  // Scripted hop back up onto the track from below.
  if (R.arc) {
    const A = R.arc;
    A.t += dt;
    const p = Math.min(1, A.t / A.dur);
    const e = p * p * (3 - 2 * p);
    R.pz = R.z;
    R.x = A.x0 + (A.x1 - A.x0) * e;
    R.z = A.z0 + (A.z1 - A.z0) * p;
    R.y = A.y0 + (A.y1 - A.y0) * e + A.peak * Math.sin(Math.PI * p);
    if (p >= 1) {
      R.arc = null;
      R.overEdge = false;
      R.onGround = true;
      R.y = 0;
      R.vy = 0;
      R.vx = 0;
    }
    return;
  }

  const canAct = R.down <= 0 && !R.finished;
  const onLedge = !!R.ledge && R.overEdge;

  // Forward speed.
  let target = 0;
  if (canAct && input.fwd) {
    if (R.skates) target = SPEED.SKATE;
    else if (input.sprint && !R.exhausted && R.stamina > 0) target = SPEED.SPRINT * R.speedMul;
    else target = SPEED.RUN * R.speedMul;
  }
  const sprinting = canAct && input.fwd && input.sprint && !R.skates && !R.exhausted && R.stamina > 0;
  if (R.onGround || R.skates) {
    const up = R.skates ? PHYS.SKATE_ACCEL : PHYS.ACCEL;
    R.vz = approach(R.vz, target, target > R.vz ? up : (R.finished ? 6 : 14), dt);
  }

  if (sprinting) {
    R.stamina = Math.max(0, R.stamina - PHYS.STAMINA_DRAIN * dt);
    if (R.stamina <= 0) R.exhausted = true;
  } else {
    R.stamina = Math.min(100, R.stamina + PHYS.STAMINA_REGEN * dt);
    if (R.exhausted && R.stamina > 30) R.exhausted = false;
  }

  // Sideways.
  const lat = R.skates ? SPEED.SKATE_LATERAL : SPEED.LATERAL;
  // Once over the side there is no more steering; air drag bleeds off the
  // sideways speed.
  const wantVx = canAct && !R.overEdge ? Math.max(-1, Math.min(1, input.dx || 0)) * lat : 0;
  R.vx = approach(R.vx, wantVx, R.onGround ? 40 : 14, dt);

  // Jump and slide.
  if (canAct && input.jump && R.onGround && R.slide <= 0) {
    R.vy = PHYS.JUMP_V;
    R.onGround = false;
  }
  if (canAct && input.slide && R.onGround && R.slide <= 0 && R.slideCd <= 0) {
    R.slide = PHYS.SLIDE_TIME;
    R.slideCd = PHYS.SLIDE_TIME + 0.25;
  }

  // Move.
  R.pz = R.z;
  R.z += R.vz * dt;
  R.x += R.vx * dt;
  if (!R.onGround) R.vy -= PHYS.G * dt;
  R.y += R.vy * dt;

  // Rails and the edge of the deck.
  const onTrack = R.z >= -1 && R.z <= TRACK.RUNOUT_END;
  if (!R.overEdge && onTrack) {
    const lim = TRACK.HALF_W - PHYS.BODY_R;
    if (Math.abs(R.x) > lim && R.y < TRACK.RAIL_H) {
      R.x = Math.sign(R.x) * lim;
      R.vx = 0;
    }
    if (Math.abs(R.x) > TRACK.EDGE_X + 0.15) {
      R.overEdge = true;
      R.onGround = false;
      hooks.onEdge?.(R);
    }
  } else if (!R.overEdge && R.z < -1) {
    R.x = Math.max(-11.6, Math.min(11.6, R.x));
  }

  // Ground.
  const g = groundY(course, t, R);
  if (g !== null && R.y <= g + 0.001 && R.y > g - 0.8 && R.vy <= 0) {
    R.y = g;
    R.vy = 0;
    R.onGround = true;
  } else if (R.onGround && (g === null || R.y > g + 0.001)) {
    R.onGround = false;
  }

  // Below the track.
  if (onLedge || R.ledge) {
    const L = R.ledge;
    if (L && R.onGround && R.y === L.y) {
      const sx = R.x * L.side;
      const cl = Math.max(L.xin + PHYS.BODY_R, Math.min(L.xout - PHYS.BODY_R, sx));
      R.x = cl * L.side;
      R.vx = 0;
      if (!R.skates && R.z >= L.skateZ - 0.8) {
        R.skates = true;
        R.vz *= 0.4;
        hooks.onSkates?.(R);
      }
      if (R.z >= L.launchZ) {
        R.arc = { t: 0, dur: 0.85, x0: R.x, y0: R.y, z0: R.z, x1: L.side * 5, y1: 0, z1: R.z + 15, peak: 2.6 };
        R.vz = Math.max(R.vz, SPEED.SKATE * 0.85);
      }
    }
  }

  if (R.overEdge && !R.ledge && R.y < -14) {
    R.dead = 'void';
    hooks.onDeath?.(R, 'void');
    return;
  }
  if (!R.overEdge && R.y < -3) {
    R.dead = 'fall';
    hooks.onDeath?.(R, 'fall');
    return;
  }

  // Timers.
  R.down = Math.max(0, R.down - dt);
  R.inv = Math.max(0, R.inv - dt);
  R.slide = Math.max(0, R.slide - dt);
  R.slideCd = Math.max(0, R.slideCd - dt);
  R.h = R.down > 0 ? 0.6 : R.slide > 0 ? PHYS.SLIDE_H : PHYS.HEIGHT;

  // Obstacles (only up on the track).
  if (!R.overEdge && R.z >= -1 && !R.finished) {
    const hit = hitTest(course, t, R);
    if (hit) {
      if (hit.kind === 'kill') {
        R.dead = hit.cause;
        hooks.onDeath?.(R, hit.cause);
        return;
      }
      if (hit.x !== undefined) R.x = hit.x;
      if (hit.z !== undefined) {
        R.z = hit.z;
        R.pz = Math.min(R.pz, R.z);
      }
      if (R.inv <= 0 && R.down <= 0) {
        R.down = hit.dur;
        R.inv = hit.dur + KNOCK.INVULN;
        R.vz = hit.cause === 'ball' ? -2.5 : 0;
        R.vx = 0;
        R.slide = 0;
        R.lastHit = hit.cause;
        hooks.onHit?.(R, hit);
      }
    }
  }
  if (R.down > 0 && R.onGround) R.vz = approach(R.vz, 0, 10, dt);

  // Finish line.
  if (!R.finished && R.z >= TRACK.LENGTH) {
    R.finished = true;
    hooks.onFinish?.(R);
  }
  if (R.z > TRACK.RUNOUT_END - 2) {
    R.z = TRACK.RUNOUT_END - 2;
    R.vz = 0;
  }
}

// Bit flags packed into network updates for drawing other runners.
export const FLAG = { DOWN: 1, SLIDE: 2, AIR: 4, FINISHED: 8, DEAD: 16, SKATES: 32 };

export function runnerFlags(R) {
  let f = 0;
  if (R.down > 0) f |= FLAG.DOWN;
  if (R.slide > 0) f |= FLAG.SLIDE;
  if (!R.onGround) f |= FLAG.AIR;
  if (R.finished) f |= FLAG.FINISHED;
  if (R.dead) f |= FLAG.DEAD;
  if (R.skates) f |= FLAG.SKATES;
  return f;
}
