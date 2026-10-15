// The race. Third person while waiting at the start; the camera drops into
// first person on its own during the countdown. Also used for watching
// other people's races.

import * as THREE from 'three';
import { TRACK, CLOCK, PHYS, laneX, clockSchedule } from '/shared/constants.js';
import { generateCourse } from '/shared/course.js';
import { makeRunner, stepRunner, runnerFlags, FLAG } from '/shared/runner.js';
import { Avatar } from '../gfx/avatar.js';
import { textPlane, neon, toon, damp, clamp, lerp } from '../gfx/common.js';
import { esc } from '../ui.js';

const STEP = 1 / 120;
const INTERP_DELAY = 0.12;

function fmtClock(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`;
}

export class RaceScene {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    app.scene.add(this.group);
    this.avatars = new Map();
    this.active = false;

    this.clockAv = new Avatar({ color: '#ffcf33', ghost: true, scale: 1.35 });
    this.group.add(this.clockAv.root);
    this.sky = textPlane('00:38.00', { w: 22, h: 5, px: 220, color: '#ffcf33', glow: 14, boost: 0.9 });
    this.sky.rotation.y = Math.PI;
    this.group.add(this.sky);

    // First person arms.
    this.arms = new THREE.Group();
    const armGeo = new THREE.CapsuleGeometry(0.05, 0.32, 4, 8);
    for (const sx of [-1, 1]) {
      const a = new THREE.Group();
      const m = new THREE.Mesh(armGeo, toon({ color: 0x1a1d33, metalness: 0.4, roughness: 0.5 }));
      m.rotation.x = Math.PI / 2;
      a.add(m);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.018, 0.105), neon('#00e5ff', 0.9, { unique: true }));
      band.position.z = -0.1;
      a.add(band);
      a.position.set(sx * 0.26, -0.3, -0.42);
      a.userData.sx = sx;
      a.userData.band = band;
      this.arms.add(a);
    }
    this.arms.visible = false;
    app.camera.add(this.arms);
    this.group.visible = false;
  }

  // ----------------------------------------------------------------- setup

  enter(room, mode) {
    const app = this.app;
    this.active = true;
    this.mode = mode;
    this.group.visible = true;
    app.track.group.visible = true;
    this.room = room;
    this.course = generateCourse(room.seed);
    app.track.build(this.course, room.panels);
    this.clearAvatars();
    this.snaps = [];
    this.lost = new Set();
    this.serverClock = CLOCK.START_Z;
    this.clockZ = CLOCK.START_Z;
    this.status = room.phase === 'lobby' ? 'lobby' : room.phase === 'done' ? 'over' : room.phase;
    this.R = null;
    this.myLane = room.you;
    this.myReady = false;
    this.readyLanes = new Set();
    this.yaw = 0;
    this.pitch = -0.04;
    this.camBlend = 0;
    this.shake = 0;
    this.roll = 0;
    this.fov = 70;
    this.eyeH = 1.62;
    this.sendTimer = 0;
    this.lastT = null;
    this.edgePending = false;
    this.voidFall = false;
    this.result = null;
    this.ended = null;
    this.deadAt = 0;
    this.finishedAt = 0;
    this.lastCount = 99;
    this.stepPhase = 0;
    this.followLane = null;
    this.lostShown = 0;
    this.camPos = new THREE.Vector3(0, 6, -40);
    this.camLook = new THREE.Vector3(0, 1, 0);
    this.lobbyPos = new THREE.Vector3(laneX(room.you ?? 4), 0, -14);
    this.lobbyHeading = 0;
    this.lobbyYaw = 0;
    this.lobbyPitch = -0.2;
    this.lobbySend = 0;
    this.lobbyOthers = new Map();
    app.track.removeLedge();

    if (mode === 'play') {
      const me = app.me;
      this.myAv = new Avatar({ color: me.color, name: null });
      this.group.add(this.myAv.root);
      this.myAv.root.position.copy(this.lobbyPos);
      for (const a of this.arms.children) a.userData.band.material.color.set(me.color).multiplyScalar(0.9);
    }
    this.syncRunners(room.runners);
    if (this.status !== 'lobby') this.lineUp();
    // Keep reporting even if frames stall (background tab, slow machine).
    clearInterval(this.keepAlive);
    this.keepAlive = setInterval(() => this.sendState(), 1000);
    app.ui.showRaceHud(true);
    app.ui.setKeysHint(mode === 'watch' ? '← / → switch runner · Esc menu' : 'W run · Shift sprint · A/D move · Space jump · S slide · Mouse look');
    app.audio.setMusic(this.status === 'lobby' ? 'hall' : 'race');
  }

  exit() {
    this.active = false;
    clearInterval(this.keepAlive);
    this.group.visible = false;
    this.app.track.group.visible = false;
    this.arms.visible = false;
    this.clearAvatars();
    if (this.myAv) {
      this.group.remove(this.myAv.root);
      this.myAv.dispose();
      this.myAv = null;
    }
    this.app.track.removeLedge();
    this.app.ui.showRaceHud(false);
  }

  clearAvatars() {
    for (const a of this.avatars.values()) {
      this.group.remove(a.av.root);
      a.av.dispose();
    }
    this.avatars.clear();
  }

  syncRunners(list) {
    this.runnerInfo = list;
    for (const r of list) {
      if (!r || r.i === this.myLane && this.mode === 'play') continue;
      if (this.avatars.has(r.i)) continue;
      const av = new Avatar({ color: r.c, name: r.n });
      av.root.position.set(laneX(r.i), 0, -1);
      this.group.add(av.root);
      this.avatars.set(r.i, { av, info: r, x: laneX(r.i), y: 0, z: -1, f: 0, speed: 0, visible: true, gone: false, dead: false });
    }
  }

  lineUp() {
    if (this.mode === 'play' && !this.R) {
      this.R = makeRunner(laneX(this.myLane), -1);
      this.myAv.root.position.set(this.R.x, 0, this.R.z);
      this.myAv.root.rotation.y = 0;
    }
    for (const a of this.avatars.values()) {
      a.x = laneX(a.info.i);
      a.z = -1;
      a.av.root.position.set(a.x, 0, a.z);
      a.av.root.rotation.y = 0;
    }
  }

  // ------------------------------------------------------------ network in

  onRoom(msg) {
    this.room = msg;
    this.syncRunners(msg.runners);
    if (msg.phase === 'countdown' && this.status === 'lobby') {
      this.status = 'countdown';
      this.lineUp();
      this.app.audio.setMusic('race');
      this.app.input.lock();
    }
  }

  onLobby(msg) {
    this.room.lobbyEndsAt = msg.endsAt;
    const seen = new Set();
    this.readyLanes = new Set();
    for (const [lane, x, z, ry, m, ready] of msg.p) {
      if (ready) this.readyLanes.add(lane);
      if (this.mode === 'play' && lane === this.myLane) {
        if (performance.now() - (this.readySentAt || 0) > 600) this.myReady = !!ready;
        continue;
      }
      seen.add(lane);
      const a = this.avatars.get(lane);
      if (!a) continue;
      a.tx = x;
      a.tz = z;
      a.ry = ry;
      a.m = m;
    }
    this.lobbyCount = msg.p.length;
  }

  onState(msg) {
    this.serverClock = msg.clock;
    this.lost = new Set(msg.lost);
    const map = new Map();
    for (const e of msg.r) map.set(e[0], e);
    this.snaps.push({ tt: msg.tt, map });
    if (this.snaps.length > 40) this.snaps.shift();
    if (this.status === 'countdown' && msg.tt >= 0) this.status = 'running';
  }

  onEdge(msg) {
    this.edgePending = false;
    if (msg.ok && this.R) {
      const g = msg.g;
      this.R.ledge = g;
      if (this.R.y < g.y) this.R.y = g.y;
      this.app.track.addLedge(g);
    } else {
      this.voidFall = true;
    }
  }

  onResult(msg) {
    this.result = msg;
    const app = this.app;
    if (msg.outcome === 'win') {
      this.status = 'won';
      this.finishedAt = performance.now();
      app.track.breakFinishClock(app.fx);
      app.audio.play('shatter');
      app.audio.play('win');
      app.ui.center('THE CLOCK IS BROKEN', 'gold', 3500);
    } else if (msg.outcome === 'dead') {
      if (this.status !== 'dead') this.die(msg.cause, true);
    }
  }

  onEnd(msg) {
    this.ended = msg;
    if (this.status === 'running' || this.status === 'countdown') this.status = 'over';
    const app = this.app;
    if (this.mode === 'watch' || this.status === 'dead' || this.status === 'over') {
      if (msg.clockWon) {
        app.ui.center('TIME WINS', 'red', 2500);
        app.audio.play('lose');
      } else {
        app.track.breakFinishClock(app.fx);
        app.audio.play('shatter');
        app.ui.center('THE CLOCK IS BROKEN', 'gold', 2500);
      }
    }
    setTimeout(() => this.active && this.showResults(), msg.clockWon ? 2200 : 3200);
  }

  showResults() {
    const app = this.app;
    const res = this.result;
    const winners = this.ended?.winners || [];
    const winnerText = winners.length ? `${winners.map((w) => esc(w.n)).join(', ')} beat THE CLOCK.` : 'Nobody beat THE CLOCK.';
    if (this.mode === 'watch' || !res) {
      app.ui.results({ title: winners.length ? 'THE CLOCK IS BROKEN' : 'TIME WINS', tone: winners.length ? 'gold' : 'red', sub: winnerText, me: app.me, watchMode: true });
      return;
    }
    if (res.outcome === 'win') {
      app.ui.results({ title: 'THE CLOCK IS BROKEN', tone: 'gold', sub: `You beat time in ${res.time.toFixed(2)} s.<br>Shard of Time acquired. Your name is on the Scoreboard.`, me: res.me });
    } else if (res.outcome === 'lose') {
      app.ui.results({ title: 'TIME WINS', tone: 'red', sub: winnerText, me: res.me });
    } else {
      const why = {
        crush: 'A falling block crushed you.',
        fall: 'The road gave way beneath you.',
        void: 'You fell off the track.',
        left: 'You left the race.',
        lost: 'Your connection dropped during the race.',
        rules: 'The system flagged impossible movement.',
      }[res.cause] || 'You were derezzed.';
      app.ui.results({ title: 'DEREZZED', tone: 'red', sub: `${why}<br>${winnerText}`, me: res.me });
    }
  }

  // ------------------------------------------------------------ local play

  hooks() {
    const app = this.app;
    return {
      onEdge: (R) => {
        this.edgePending = true;
        app.net.send({ t: 'edge', z: +R.z.toFixed(2), x: +R.x.toFixed(2) });
      },
      onSkates: () => {
        app.net.send({ t: 'pick' });
        app.track.takeLedgeItem(app.fx);
        app.audio.play('power');
        app.ui.flash('#7df9ff');
      },
      onFinish: () => {
        app.net.send({ t: 'st', z: +this.R.z.toFixed(2), x: +this.R.x.toFixed(2), y: +this.R.y.toFixed(2), f: runnerFlags(this.R), tt: +this.lastT.toFixed(3) });
        app.net.send({ t: 'fin' });
        this.status = 'finishing';
      },
      onDeath: (R, cause) => {
        app.net.send({ t: 'dead', cause });
        this.die(cause, false);
      },
      onHit: (R, hit) => {
        this.shake = 0.5;
        app.paint.impact(0.6);
        app.audio.play(hit.cause === 'laser' ? 'zap' : 'hit');
        app.ui.hurt();
      },
    };
  }

  die(cause, fromServer) {
    if (this.status === 'dead') return;
    const app = this.app;
    this.status = 'dead';
    this.deadAt = performance.now();
    const R = this.R;
    if (R) {
      R.dead = R.dead || cause;
      const p = new THREE.Vector3(R.x, R.y, R.z);
      app.fx.burst(p, app.me.color, { count: 90, speed: 6, size: 0.14 });
    }
    app.audio.play('derezz');
    app.ui.center('DEREZZED', 'red', 2600);
    app.ui.sub(app.lockoutMinutes > 0 ? 'Locked out for 1 hour · watching the rest of the race' : 'Watching the rest of the race · press R to race again', 6000);
    this.arms.visible = false;
  }

  stepLocal(t, dt) {
    const app = this.app;
    const input = app.input;
    const R = this.R;
    if (!R || R.dead) return;
    if (this.lastT === null) this.lastT = Math.max(0, t);
    const canControl = this.status === 'running' && !app.menuOpen;
    const inp = {
      fwd: canControl && input.key('KeyW', 'ArrowUp'),
      sprint: input.key('ShiftLeft', 'ShiftRight'),
      dx: canControl ? (input.key('KeyA', 'ArrowLeft') ? 1 : 0) - (input.key('KeyD', 'ArrowRight') ? 1 : 0) : 0,
      jump: false,
      slide: false,
    };
    if (canControl && input.hit('Space')) this.jumpBuf = 0.15;
    if (canControl && input.hit('KeyS', 'ArrowDown', 'KeyC', 'ControlLeft')) this.slideBuf = 0.15;
    const hooks = this.hooks();
    let steps = 0;
    while (this.lastT + STEP <= t && steps < 120) {
      this.lastT += STEP;
      steps++;
      const wasGround = R.onGround;
      inp.jump = (this.jumpBuf || 0) > 0;
      inp.slide = (this.slideBuf || 0) > 0;
      const vyBefore = R.vy;
      const slideBefore = R.slide;
      stepRunner(this.course, this.lastT, STEP, R, inp, hooks);
      if (inp.jump && R.vy > vyBefore + 1) {
        this.jumpBuf = 0;
        app.audio.play('jump');
      }
      if (inp.slide && R.slide > slideBefore) {
        this.slideBuf = 0;
        app.audio.play('slide');
      }
      if (!wasGround && R.onGround) app.audio.play('land');
      this.jumpBuf = Math.max(0, (this.jumpBuf || 0) - STEP);
      this.slideBuf = Math.max(0, (this.slideBuf || 0) - STEP);
      if (R.dead || this.status === 'dead') break;
    }
    if (steps >= 120) this.lastT = t;

    // Footsteps.
    if (R.onGround && R.vz > 1 && !R.skates) {
      const before = this.stepPhase;
      this.stepPhase += (R.vz / 2.2) * dt;
      if (Math.floor(before) !== Math.floor(this.stepPhase)) app.audio.play('step');
    }

    // Report position.
    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      this.sendTimer = 0.05;
      this.sendState();
    }
  }

  sendState() {
    const R = this.R;
    if (!this.active || this.mode !== 'play' || !R || R.dead) return;
    if (this.status !== 'running' && this.status !== 'finishing') return;
    this.app.net.send({ t: 'st', z: +R.z.toFixed(2), x: +R.x.toFixed(2), y: +R.y.toFixed(2), f: runnerFlags(R), tt: +(this.lastT ?? 0).toFixed(3) });
  }

  // ---------------------------------------------------------------- frame

  update(dt) {
    if (!this.active) return;
    const app = this.app;
    const input = app.input;
    const now = app.net.now();
    const t = (now - this.room.startAt) / 1000;
    const started = this.status !== 'lobby' && this.room.startAt > 0;

    // Countdown.
    if (this.status === 'countdown' || (this.status === 'running' && t < 1)) {
      const n = Math.ceil(-t);
      if (n !== this.lastCount) {
        this.lastCount = n;
        if (n >= 1 && n <= 3) {
          app.ui.center(String(n), '', 900);
          app.audio.play('beep');
        } else if (n <= 0 && t < 1) {
          app.ui.center('GO', '', 900);
          app.audio.play('go');
        }
      }
      if (t >= 0 && this.status === 'countdown') this.status = 'running';
    }

    if (this.mode === 'play' && started && t > -0.5) this.stepLocal(Math.max(0, t), dt);

    // THE CLOCK.
    const raceT = started ? Math.max(0, t) : 0;
    const sched = clockSchedule(raceT);
    this.clockZ = Math.max(this.clockZ, sched, this.serverClock - 1.5);
    if (this.ended || this.status === 'over') this.clockZ = Math.max(this.clockZ, this.serverClock);
    const clockZ = Math.min(TRACK.LENGTH, this.clockZ);
    const clockVis = !this.app.track.finishClock.broken || clockZ < TRACK.LENGTH;
    this.clockAv.root.visible = started && clockVis;
    this.clockAv.root.position.set(0, 0.15, clockZ);
    this.clockAv.update(dt, { speed: clockZ < TRACK.LENGTH && raceT > 0 ? 10.5 : 0, moving: clockZ < TRACK.LENGTH && raceT > 0 });
    if (started && raceT > 0 && clockZ < TRACK.LENGTH && Math.random() < 0.5) {
      app.fx.burst(new THREE.Vector3(rand(-0.4, 0.4), 0.8, clockZ - 0.5), '#ffcf33', { count: 2, speed: 1, size: 0.08, life: 0.7, gravity: -0.5, up: 0.2, spread: 0.6 });
    }
    const remaining = started ? Math.max(0, CLOCK.TIME - raceT) * (clockZ >= TRACK.LENGTH ? 0 : 1) : CLOCK.TIME;
    const clockTxt = fmtClock(remaining);
    app.ui.setClock(clockTxt, remaining < 10 && started);
    if (this._skyTick === undefined || (this._skyTick += dt) > 0.05) {
      this._skyTick = 0;
      this.sky.setText(clockTxt);
      app.track.setClockText(clockTxt, raceT / CLOCK.TIME);
    }

    // Other runners.
    this.updateOthers(dt, raceT);

    // Camera.
    if (this.mode === 'watch' || this.status === 'dead' || (this.status === 'over' && (!this.R || this.R.dead))) this.updateChaseCam(dt, input);
    else if (this.status === 'lobby') this.updateLobby(dt, input);
    else this.updatePlayCam(dt, input, t);

    // World.
    const camZ = app.camera.position.z;
    app.track.update(dt, raceT, camZ, this.R ? this.R.z : camZ);
    for (const e of app.track.soundEvents) app.audio.play(e);
    this.sky.position.set(0, 13, clamp(camZ + 46, 30, TRACK.LENGTH - 6));

    this.updateHud(raceT, clockZ);
  }

  updateOthers(dt, raceT) {
    const renderT = raceT - INTERP_DELAY;
    let a = null, b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tt <= renderT) {
        a = this.snaps[i];
        b = this.snaps[i + 1] || null;
        break;
      }
    }
    if (!a && this.snaps.length) a = this.snaps[0];
    const k = a && b ? clamp((renderT - a.tt) / Math.max(0.001, b.tt - a.tt), 0, 1) : 0;

    for (const [lane, o] of this.avatars) {
      const root = o.av.root;
      if (this.status === 'lobby') {
        if (o.tx !== undefined) {
          root.visible = true;
          root.position.x = damp(root.position.x, o.tx, 8, dt);
          root.position.z = damp(root.position.z, o.tz, 8, dt);
          root.rotation.y = o.ry;
          o.av.update(dt, { speed: o.m ? 4 : 0, moving: !!o.m });
        } else root.visible = false;
        continue;
      }
      if (!a) {
        root.visible = !o.gone;
        o.av.update(dt, { speed: 0 });
        continue;
      }
      const ea = a.map.get(lane);
      const eb = b?.map.get(lane);
      if (!ea || this.lost.has(lane)) {
        root.visible = false;
        o.visible = false;
        continue;
      }
      const z = eb ? lerp(ea[1], eb[1], k) : ea[1];
      const x = eb ? lerp(ea[2], eb[2], k) : ea[2];
      const y = eb ? lerp(ea[3], eb[3], k) : ea[3];
      const f = (eb && k > 0.5 ? eb : ea)[4];
      const vz = dt > 0 ? (z - o.z) / dt : 0;
      o.speed = damp(o.speed, Math.max(0, vz), 6, dt);
      o.x = x;
      o.y = y;
      o.z = z;
      o.f = f;
      o.visible = true;
      if (f & FLAG.DEAD) {
        if (!o.dead) {
          o.dead = true;
          this.app.fx.burst(new THREE.Vector3(x, y, z), o.info.c, { count: 70, speed: 6, size: 0.13 });
          if (Math.abs(z - this.app.camera.position.z) < 40) this.app.audio.play('derezz');
        }
        root.visible = false;
        continue;
      }
      root.visible = true;
      root.position.set(x, y, z);
      root.rotation.y = 0;
      o.av.update(dt, { speed: o.speed, air: !!(f & FLAG.AIR), slide: !!(f & FLAG.SLIDE), down: !!(f & FLAG.DOWN), moving: o.speed > 0.4 });
    }
  }

  updateLobby(dt, input) {
    const app = this.app;
    const cam = app.camera;
    if (this.mode === 'play' && !app.menuOpen && input.hit('Enter', 'NumpadEnter')) {
      this.myReady = !this.myReady;
      this.readySentAt = performance.now();
      app.net.send({ t: 'ready', on: this.myReady });
      app.audio.play('ui');
    }
    const [mx, my] = input.takeMouse();
    this.lobbyYaw -= mx * 0.0024;
    this.lobbyPitch = clamp(this.lobbyPitch - my * 0.002, -0.7, 0.4);
    const fwd = new THREE.Vector3(Math.sin(this.lobbyYaw), 0, Math.cos(this.lobbyYaw));
    const right = new THREE.Vector3(-Math.cos(this.lobbyYaw), 0, Math.sin(this.lobbyYaw));
    const mv = new THREE.Vector3();
    if (!app.menuOpen) {
      if (input.key('KeyW', 'ArrowUp')) mv.add(fwd);
      if (input.key('KeyS', 'ArrowDown')) mv.sub(fwd);
      if (input.key('KeyD', 'ArrowRight')) mv.add(right);
      if (input.key('KeyA', 'ArrowLeft')) mv.sub(right);
    }
    const moving = mv.lengthSq() > 0;
    if (moving) {
      mv.normalize();
      this.lobbyPos.addScaledVector(mv, 4.6 * dt);
      const target = Math.atan2(mv.x, mv.z);
      let d = target - this.lobbyHeading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.lobbyHeading += d * Math.min(1, dt * 12);
    }
    this.lobbyPos.x = clamp(this.lobbyPos.x, -11.4, 11.4);
    this.lobbyPos.z = clamp(this.lobbyPos.z, TRACK.PLAZA_START + 1, -2);
    if (this.myAv) {
      this.myAv.root.position.copy(this.lobbyPos);
      this.myAv.root.rotation.y = this.lobbyHeading;
      this.myAv.update(dt, { speed: moving ? 4.6 : 0, moving });
    }
    const dir = new THREE.Vector3(Math.sin(this.lobbyYaw) * Math.cos(this.lobbyPitch), Math.sin(this.lobbyPitch), Math.cos(this.lobbyYaw) * Math.cos(this.lobbyPitch));
    const target = this.lobbyPos.clone().add(new THREE.Vector3(0, 1.7, 0));
    const want = target.clone().addScaledVector(dir, -5.4);
    want.y = Math.max(0.4, want.y);
    cam.position.lerp(want, 1 - Math.exp(-dt * 14));
    cam.lookAt(target.clone().addScaledVector(dir, 3));
    this.setFov(70);
    this.camPos.copy(cam.position);
    this.lobbySend -= dt;
    if (this.mode === 'play' && this.lobbySend <= 0) {
      this.lobbySend = 0.12;
      app.net.send({ t: 'lp', x: +this.lobbyPos.x.toFixed(2), z: +this.lobbyPos.z.toFixed(2), ry: +this.lobbyHeading.toFixed(2), m: moving ? 1 : 0 });
    }
  }

  // Third person behind the runner during the countdown, then first person.
  updatePlayCam(dt, input, t) {
    const app = this.app;
    const cam = app.camera;
    const R = this.R;
    if (!R) return;
    const [mx, my] = input.takeMouse();
    const fps = this.status === 'running' || this.status === 'finishing' || this.status === 'countdown';

    // Blend from TPS to FPS over the countdown (t: -5 → -1.2).
    const blendTarget = this.status === 'won' || this.status === 'over' ? 0 : clamp((t + 4.2) / 3, 0, 1);
    this.camBlend = this.status === 'won' || this.status === 'over' ? damp(this.camBlend, 0, 2, dt) : Math.max(this.camBlend, blendTarget);
    const b = this.camBlend * this.camBlend * (3 - 2 * this.camBlend);

    if (fps && b > 0.5) {
      this.yaw = clamp(this.yaw - mx * 0.0022, -1.9, 1.9);
      this.pitch = clamp(this.pitch - my * 0.0019, -1.2, 1.0);
    }
    if (!input.locked && this.status === 'running') {
      this.yaw = damp(this.yaw, 0, 2, dt);
    }

    const eyeTarget = R.down > 0 ? 0.45 : R.slide > 0 ? 0.78 : 1.62;
    this.eyeH = damp(this.eyeH, eyeTarget, 14, dt);
    const moving = R.onGround && R.vz > 0.5 && R.down <= 0;
    this.bob = (this.bob || 0) + dt * (R.skates ? 3 : R.vz * 1.25);
    const bobAmp = moving && !R.skates ? Math.min(1, R.vz / 7) : 0;
    this.shake = Math.max(0, this.shake - dt);
    const sh = this.shake * this.shake * 0.25;
    const head = new THREE.Vector3(
      R.x + Math.cos(this.bob) * 0.025 * bobAmp + (Math.random() - 0.5) * sh,
      R.y + this.eyeH + Math.abs(Math.sin(this.bob)) * 0.05 * bobAmp + (Math.random() - 0.5) * sh,
      R.z,
    );
    const look = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));

    // Third person spot behind.
    const tps = new THREE.Vector3(R.x, R.y + 2.6, R.z - 6);
    const tpsLook = new THREE.Vector3(R.x, R.y + 1.4, R.z + 6);
    if (this.status === 'won') {
      const a = (performance.now() - this.finishedAt) / 1000;
      tps.set(R.x + Math.sin(a * 0.4) * 7, R.y + 3, R.z + Math.cos(a * 0.4) * 7);
      tpsLook.set(R.x, R.y + 1.2, R.z);
    }
    const pos = tps.clone().lerp(head, b);
    const tgt = tpsLook.clone().lerp(head.clone().add(look), b);
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(tgt);
    const wantRoll = R.down > 0 ? 0.35 : 0;
    this.roll = damp(this.roll, wantRoll, 6, dt);
    if (this.roll) cam.rotateZ(this.roll);

    const fovTarget = R.skates ? 96 : 72 + Math.min(12, Math.max(0, R.vz - 3) * 1.6);
    this.setFov(lerp(68, fovTarget, b), dt);

    // Body vs arms.
    if (this.myAv) {
      this.myAv.root.visible = b < 0.85;
      this.myAv.root.position.set(R.x, R.y, R.z);
      this.myAv.root.rotation.y = 0;
      this.myAv.showSkates(R.skates);
      this.myAv.update(dt, { speed: R.vz, air: !R.onGround, slide: R.slide > 0, down: R.down > 0, moving: R.vz > 0.4, skating: R.skates });
    }
    this.arms.visible = b >= 0.85 && R.down <= 0 && !R.dead && this.status !== 'won';
    if (this.arms.visible) {
      const sw = Math.sin(this.bob);
      for (const arm of this.arms.children) {
        const sx = arm.userData.sx;
        const amp = R.skates ? 0.05 : 0.12 * Math.min(1, R.vz / 6);
        arm.position.set(sx * 0.3, -0.38 + sx * sw * amp * 0.4, -0.46 + sx * sw * amp);
        arm.rotation.x = sx * sw * amp * 2;
      }
    }

    app.ui.speedLines(R.skates && R.vz > 8 ? 1 : R.vz > 8.8 ? 0.35 : 0);
  }

  // Following someone else (watching, or after being derezzed).
  updateChaseCam(dt, input) {
    const app = this.app;
    const cam = app.camera;
    input.takeMouse();
    this.arms.visible = false;
    if (this.myAv && this.status === 'dead') this.myAv.root.visible = false;
    const visible = [...this.avatars.entries()].filter(([, o]) => o.visible && !o.dead && o.av.root.visible);
    const sinceDeath = (performance.now() - this.deadAt) / 1000;

    // Right after dying, keep looking at the spot for a moment.
    if (this.status === 'dead' && sinceDeath < 2.2 && this.R) {
      const R = this.R;
      const fall = R.overEdge;
      if (fall && R.y > -40) {
        R.vy -= PHYS.G * dt;
        R.y += R.vy * dt;
        R.z += R.vz * dt * 0.5;
      }
      const want = new THREE.Vector3(R.x, (fall ? R.y : 0) + 1.6, R.z);
      cam.position.lerp(want, 1 - Math.exp(-dt * 10));
      cam.lookAt(R.x, (fall ? R.y : 0) - 3, R.z + 6);
      this.setFov(72, dt);
      return;
    }

    if (input.hit('ArrowRight', 'KeyD', 'ArrowLeft', 'KeyA') && visible.length) {
      const dir = input.hit('ArrowRight', 'KeyD') ? 1 : -1;
      const lanes = visible.map(([l]) => l).sort((x, y) => x - y);
      const idx = lanes.indexOf(this.followLane);
      this.followLane = lanes[(idx + dir + lanes.length) % lanes.length];
    }
    const cur = this.avatars.get(this.followLane);
    if (!cur || !cur.visible || cur.dead) {
      if (this.followLane !== null && this.lost.has(this.followLane) && this.lostShown === 0) this.lostShown = performance.now();
      if (this.lostShown && performance.now() - this.lostShown < 1500) {
        app.ui.signalLost(true);
      } else {
        this.lostShown = 0;
        app.ui.signalLost(false);
        const humans = visible.filter(([, o]) => !o.info.bot);
        const pick = (humans.length ? humans : visible).sort((p, q) => q[1].z - p[1].z)[0];
        this.followLane = pick ? pick[0] : null;
      }
    } else {
      app.ui.signalLost(false);
    }
    const o = this.avatars.get(this.followLane);
    if (o && o.visible) {
      const want = new THREE.Vector3(o.x, o.y + 3.2, o.z - 6.8);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 6));
      this.camLook.lerp(new THREE.Vector3(o.x, o.y + 1.2, o.z + 6), 1 - Math.exp(-dt * 8));
    } else {
      const cz = Math.min(TRACK.LENGTH, this.clockZ);
      this.camPos.lerp(new THREE.Vector3(0, 8, cz - 16), 1 - Math.exp(-dt * 3));
      this.camLook.lerp(new THREE.Vector3(0, 1, cz), 1 - Math.exp(-dt * 4));
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    this.setFov(70, dt);
    app.ui.speedLines(0);
  }

  setFov(f, dt = 1) {
    const cam = this.app.camera;
    const nf = dt >= 1 ? f : damp(cam.fov, f, 6, dt);
    if (Math.abs(nf - cam.fov) > 0.01) {
      cam.fov = nf;
      cam.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------ HUD

  updateHud(raceT, clockZ) {
    const ui = this.app.ui;
    const rows = [];
    rows.push({ name: 'THE CLOCK', color: '#ffcf33', z: clockZ, status: clockZ >= TRACK.LENGTH ? 'FINISHED' : `${Math.round(clockZ)} m`, clock: true });
    for (const r of this.runnerInfo || []) {
      if (!r) continue;
      if (this.mode === 'play' && r.i === this.myLane) {
        const R = this.R;
        const z = R ? R.z : -1;
        let status = `${Math.max(0, Math.round(z))} m`;
        if (this.status === 'dead') status = 'DEREZZED';
        else if (this.status === 'won') status = 'BEAT THE CLOCK';
        else if (R && R.down > 0) status = 'DOWN';
        rows.push({ name: r.n, color: r.c, z: this.status === 'dead' ? -10 : z, status, me: true });
        continue;
      }
      const o = this.avatars.get(r.i);
      if (this.status === 'lobby') {
        if (o && o.tx !== undefined) rows.push({ name: r.n, color: r.c, z: 0, status: this.readyLanes?.has(r.i) ? 'READY' : 'WAITING' });
        continue;
      }
      if (this.lost.has(r.i)) {
        rows.push({ name: r.n, color: r.c, z: -5, status: 'SIGNAL LOST', lost: true });
        continue;
      }
      if (!o) continue;
      let status = `${Math.max(0, Math.round(o.z))} m`;
      if (o.dead) status = 'DEREZZED';
      else if (o.f & FLAG.FINISHED) status = 'FINISHED';
      else if (o.f & FLAG.DOWN) status = 'DOWN';
      rows.push({ name: r.n, color: r.c, z: o.dead ? -10 : o.z, status, out: o.dead });
    }
    rows.sort((p, q) => q.z - p.z);
    ui.setRunners(rows, clockZ, this.mode === 'play' && this.R ? this.R.z : null, this.lost);

    if (this.status === 'lobby') {
      const left = Math.max(0, Math.ceil((this.room.lobbyEndsAt - this.app.net.now()) / 1000));
      const n = this.lobbyCount ?? 1;
      const me = this.mode === 'play' ? (this.myReady ? 'YOU ARE READY (Enter to cancel)' : 'PRESS ENTER WHEN READY') : 'SPECTATING';
      ui.sub(`RACE STARTS IN ${left} · ${n} ${n === 1 ? 'PLAYER' : 'PLAYERS'} · AI FILLS EMPTY LANES · ${me} · Esc to leave`, 400);
    }
    const R = this.R;
    if (this.mode === 'play' && R) ui.setDash(Math.max(0, R.z), R.vz, R.stamina, R.exhausted);
    else ui.setDash(null);
  }
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}
