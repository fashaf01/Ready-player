// Numbers shared by the browser and the server. Both sides must agree on
// these or the race drifts apart, so change them in one place only.

export const TRACK = {
  LENGTH: 400,        // metres from start line to finish line
  LANES: 10,
  LANE_W: 1.6,
  HALF_W: 8.0,        // inner face of the side rail
  EDGE_X: 8.3,        // the deck ends here; beyond is open sky
  RAIL_H: 0.55,       // top of the rail
  PANEL_LEN: 4,       // rail panels are this long
  PLAZA_START: -36,   // start plaza behind the line
  RUNOUT_END: 440,    // deck keeps going a bit after the finish
  DECK_T: 0.7,
};

export const SPEED = {
  RUN: 7.4,
  SPRINT: 9.2,
  SKATE: 15.5,
  LATERAL: 6.2,
  SKATE_LATERAL: 7.6,
};

export const PHYS = {
  G: 21,
  JUMP_V: 7.4,
  BODY_R: 0.32,
  HEIGHT: 1.8,
  SLIDE_H: 0.85,
  SLIDE_TIME: 0.75,
  ACCEL: 7,
  SKATE_ACCEL: 10,
  STAMINA_DRAIN: 18,
  STAMINA_REGEN: 11,
};

export const CLOCK = {
  TIME: 38,           // seconds THE CLOCK needs for the full 400 m
  START_Z: 2,
  LEAD: 5,            // it never lets an ordinary runner closer than this
};

export const ROOM = {
  LOBBY_WAIT: 20,     // seconds a room waits for more players
  COUNTDOWN: 5,       // seconds from line-up to GO
  MAX_RUNNERS: 10,
  AFTER_RACE: 6,      // seconds the room lingers after the race ends
};

export const KNOCK = {
  BALL: 2.0,
  BALL_SKATES: 3.2,
  BLOCK: 1.4,
  LASER: 1.4,
  TRAP: 1.6,
  PISTON: 1.6,
  INVULN: 0.9,
};

export function laneX(i) {
  return -TRACK.HALF_W + TRACK.LANE_W * (i + 0.5);
}

export function clockSchedule(t) {
  if (t <= 0) return CLOCK.START_Z;
  return Math.min(TRACK.LENGTH, CLOCK.START_Z + (TRACK.LENGTH - CLOCK.START_Z) * (t / CLOCK.TIME));
}

export const AVATAR_COLORS = ['#00e5ff', '#ff2bd6', '#ffd400', '#39ff14', '#ff6a00', '#8a5cff', '#ff3355', '#00ffa3'];
