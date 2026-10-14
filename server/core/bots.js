// AI runners. They see the same obstacles a player sees and try to dodge
// them, with a skill level that decides how often they react in time.
// They never leave the track.

import { TRACK, laneX } from '../../shared/constants.js';
import { ballState, blockState, crashState, gateHeight, trapState, pistonExt, OBST } from '../../shared/course.js';

export const BOT_NAMES = [
  'VECTOR', 'NYX', 'B1T_RUNNER', 'HALCYON', 'ZERO_K', 'PIXELWOLF', 'ORBITAL', 'VANTA',
  'NEON_JACK', 'MIRAGE', 'KAIJU', 'SYNTH', 'ECHO-9', 'RAVEN', 'TURBO_LUX', 'QUASAR',
  'GHOSTLINE', 'R3TRO', 'NOVA_SIX', 'HEXA',
];

export function makeBrain(rand) {
  return {
    skill: 0.5 + rand() * 0.38,
    sprintBias: rand(),
    targetX: null,
    nextThink: 0,
    jumpAt: -1,
    slideAt: -1,
    rand,
  };
}

const LIM = TRACK.HALF_W - 0.9;

// Danger score for standing in column x over the next ~1.3 s.
function danger(course, t, R, x) {
  let d = 0;
  const vz = Math.max(R.vz, 5);
  for (const b of course.balls) {
    if (b.ts - 1.4 > t) break;
    if (t > b.end) continue;
    if (Math.abs(b.x - x) > b.r + 0.75) continue;
    for (let k = 0.1; k <= 1.3; k += 0.15) {
      const s = ballState(b, t + k);
      if (!s || s.phase !== 'roll') continue;
      const myZ = R.z + vz * k;
      if (Math.abs(s.z - myZ) < b.r + 0.6) {
        d += 3 - k;
        break;
      }
    }
  }
  for (const b of course.blocks) {
    const s = blockState(b, t + 0.6);
    if (!s) continue;
    if (Math.abs(b.x - x) < b.s / 2 + 0.6 && b.z - R.z > -1.5 && b.z - R.z < 14) d += 4;
  }
  for (const c of course.crashes) {
    const st = crashState(c, t + (c.z0 - R.z) / vz);
    if (st.phase === 'intact') continue;
    if (x > c.x0 - 0.5 && x < c.x1 + 0.5 && c.z1 - R.z > -1 && c.z0 - R.z < 26) d += 6;
  }
  for (const tr of course.traps) {
    if (x < tr.x0 - 0.4 || x > tr.x1 + 0.4) continue;
    const ahead = tr.z0 - R.z;
    if (ahead < -OBST.TRAP_LEN || ahead > 10) continue;
    const s = trapState(tr, t + Math.max(0, ahead) / vz);
    if (s !== 'off') d += 2;
  }
  for (const p of course.pistons) {
    const ahead = p.z - R.z;
    if (ahead < -1 || ahead > 10) continue;
    if (p.side * x > TRACK.HALF_W - OBST.PISTON_REACH - 0.6) {
      const { ext, windup } = pistonExt(p, t + Math.max(0, ahead) / vz);
      if (ext > 0.2 || windup) d += 2;
    }
  }
  return d;
}

export function botInput(course, t, R, brain) {
  const input = { fwd: true, sprint: false, dx: 0, jump: false, slide: false };
  if (R.dead || R.finished) return input;

  // Stamina: some bots burn it early, some save it.
  input.sprint = R.stamina > (brain.sprintBias > 0.5 ? 10 : 55) && brain.rand() < 0.97;

  if (brain.targetX === null) brain.targetX = R.x;

  if (t >= brain.nextThink) {
    brain.nextThink = t + 0.12 + (1 - brain.skill) * 0.25;
    if (brain.rand() < brain.skill + 0.1) {
      const here = danger(course, t, R, brain.targetX);
      if (here > 0) {
        let best = brain.targetX;
        let bestD = here;
        for (let lane = 0; lane < TRACK.LANES; lane++) {
          const x = Math.max(-LIM, Math.min(LIM, laneX(lane)));
          const travel = Math.abs(x - R.x);
          if (travel > 6.5) continue;
          const dd = danger(course, t, R, x) + travel * 0.15;
          if (dd < bestD) {
            bestD = dd;
            best = x;
          }
        }
        brain.targetX = best;
      } else if (brain.rand() < 0.02) {
        brain.targetX = Math.max(-LIM, Math.min(LIM, R.x + (brain.rand() - 0.5) * 4));
      }
    }
  }

  // Lasers: jump or slide when one is about to reach us.
  const vz = Math.max(R.vz, 1);
  for (const g of course.gates) {
    const ahead = g.z - R.z;
    if (ahead < 0 || ahead > vz * 0.5) continue;
    if (brain.decided === g.id) break;
    brain.decided = g.id;
    if (brain.rand() > brain.skill + 0.15) break;
    const h = gateHeight(g, t + ahead / vz);
    if (h < 0.8) brain.jumpAt = t + Math.max(0, ahead / vz - 0.3);
    else brain.slideAt = t + Math.max(0, ahead / vz - 0.35);
    break;
  }
  if (brain.jumpAt >= 0 && t >= brain.jumpAt) {
    input.jump = true;
    brain.jumpAt = -1;
  }
  if (brain.slideAt >= 0 && t >= brain.slideAt) {
    input.slide = true;
    brain.slideAt = -1;
  }

  const dx = brain.targetX - R.x;
  if (Math.abs(dx) > 0.12) input.dx = Math.sign(dx);
  return input;
}
