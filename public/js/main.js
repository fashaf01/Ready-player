import * as THREE from 'three';
import { createRenderer } from './gfx/common.js';
import { Environment } from './gfx/env.js';
import { TrackView } from './gfx/track.js';
import { Fx } from './gfx/fx.js';
import { HallScene, fmtLeft } from './scenes/hall.js';
import { RaceScene } from './scenes/race.js';
import { Net, api } from './net.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';

const $ = (id) => document.getElementById(id);

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

class App {
  async start() {
    const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
    if (!webglOk() || touchOnly) {
      $('loading').classList.remove('show');
      $('unsupported').classList.add('show');
      return;
    }
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 2500))]);

    const { renderer, scene, camera, composer } = createRenderer($('stage'));
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = composer;
    scene.add(camera);

    this.net = new Net();
    this.input = new Input(renderer.domElement);
    this.audio = new Audio();
    this.ui = new UI(this);
    this.env = new Environment(scene);
    this.track = new TrackView(scene);
    this.track.group.visible = false;
    this.fx = new Fx(scene);
    this.hall = new HallScene(this);
    this.race = new RaceScene(this);
    this.mode = 'auth';
    this.me = null;
    this.menuOpen = false;
    this.quietUnlock = false;
    this.raceCount = 0;
    this.online = 0;

    this.wireNet();
    this.wireKeys();

    const clock = new THREE.Clock();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, clock.getDelta());
      this.frame(dt);
    };
    loop();

    let me = null;
    try {
      ({ me } = await api('me'));
    } catch {}
    if (me) this.begin(me);
    else this.showAuth();
    $('loading').classList.remove('show');
  }

  // --------------------------------------------------------------- auth

  showAuth() {
    this.mode = 'auth';
    this.input.enabled = false;
    this.hall.group.visible = true;
    this.hall.me.root.visible = false;
    this.ui.show('auth');
  }

  async login(body) {
    this.ui.authError('');
    try {
      const { me } = await api('login', body);
      this.begin(me);
    } catch (e) {
      this.ui.authError(e.message);
    }
  }

  async signup(body) {
    this.ui.authError('');
    try {
      const { me } = await api('signup', body);
      this.begin(me);
    } catch (e) {
      this.ui.authError(e.message);
    }
  }

  async logout() {
    try {
      await api('logout', {});
    } catch {}
    this.net.close();
    location.reload();
  }

  begin(me) {
    this.me = me;
    this.input.enabled = true;
    this.ui.hide('auth');
    this.ui.setMe(me);
    this.hall.setMe(me);
    this.audio.unlock();
    this.net.connect();
  }

  // --------------------------------------------------------------- network

  wireNet() {
    const n = this.net;
    n.on('welcome', (m) => {
      this.setMe(m.me);
      this.enterHall();
    });
    n.on('me', (m) => this.setMe(m.me));
    n.on('board', (m) => {
      this.online = m.online;
      this.hall.drawBoard(m);
      this.ui.setOnline(this.online, this.raceCount);
    });
    n.on('hallp', (m) => {
      this.raceCount = m.races;
      if (this.me) this.hall.setPlayers(m.p, this.me.id);
      this.ui.setOnline(Math.max(this.online, m.p.length), this.raceCount);
    });
    n.on('room', (m) => {
      if (this.mode === 'race' && this.race.room && this.race.room.id === m.id) return this.race.onRoom(m);
      if (this.mode === 'race') this.race.exit();
      this.enterRace(m, m.you !== null && m.you !== undefined ? 'play' : 'watch');
    });
    n.on('lobby', (m) => this.mode === 'race' && this.race.onLobby(m));
    n.on('rs', (m) => this.mode === 'race' && this.race.onState(m));
    n.on('edge', (m) => this.mode === 'race' && this.race.onEdge(m));
    n.on('result', (m) => {
      this.setMe(m.me);
      if (this.mode === 'race') this.race.onResult(m);
    });
    n.on('end', (m) => this.mode === 'race' && this.race.onEnd(m));
    n.on('races', (m) => this.ui.isOpen('races') && this.ui.showRaces(m.list));
    n.on('error', (m) => {
      if (m.code === 'locked') {
        this.ui.toast(`Locked out · next attempt in ${fmtLeft(m.until - this.net.now())}`);
        this.audio.play('deny');
      } else this.ui.toast(m.msg || 'Something went wrong.');
    });
    n.on('kicked', (m) => this.ui.toast(m.reason, 8000));
    n.on('close', (e) => {
      if (e.code === 4002) return;
      if (this.mode !== 'auth') this.ui.toast('Connection lost · reconnecting…');
    });
  }

  setMe(me) {
    if (!me) return;
    this.me = me;
    this.ui.setMe(me);
    this.hall.setMe(me);
  }

  // --------------------------------------------------------------- modes

  enterHall() {
    if (this.race.active) this.race.exit();
    this.ui.hide('results');
    this.mode = 'hall';
    this.hall.enter();
    this.hall.me.root.visible = true;
    this.ui.showHallHud(true);
    this.audio.setMusic('hall');
  }

  toHall() {
    this.net.send({ t: 'hall' });
    this.enterHall();
  }

  enterRace(room, mode) {
    this.closeRaces();
    this.ui.hide('results');
    this.hall.exit();
    this.ui.showHallHud(false);
    this.ui.prompt(null);
    this.mode = 'race';
    this.race.enter(room, mode);
  }

  interact(near) {
    this.audio.play('ui');
    if (near.kind === 'gate') {
      if (near.g.id !== 1) return this.ui.toast(`${near.g.name} is sealed.`);
      if (this.me.lockedUntil > this.net.now()) return this.openRaces();
      this.net.send({ t: 'join' });
    } else if (near.kind === 'terminal') {
      this.openRaces();
    } else if (near.kind === 'key') {
      const count = [0, 1, 2].filter((i) => this.me.shards & (1 << i)).length;
      this.ui.toast(count === 3 ? 'The Final Key is yours.' : `The Final Key needs all three shards (${count}/3).`);
    }
  }

  hallPrompt() {
    const near = this.hall.near;
    if (!near || this.menuOpen) return this.ui.prompt(null);
    const locked = this.me && this.me.lockedUntil > this.net.now();
    if (near.kind === 'gate' && near.g.id === 1) {
      if (locked) return this.ui.prompt(`GATE I LOCKED · ${fmtLeft(this.me.lockedUntil - this.net.now())}<small><b>E</b> watch live races</small>`);
      return this.ui.prompt(`<b>E</b> ENTER GATE I · THE RACE<small>400 m · 10 runners · beat THE CLOCK</small>`);
    }
    if (near.kind === 'gate') return this.ui.prompt(`${near.g.name} · SEALED<small>This Gate has not opened yet</small>`);
    if (near.kind === 'terminal') return this.ui.prompt(`<b>E</b> WATCH LIVE RACES`);
    if (near.kind === 'key') {
      const count = [0, 1, 2].filter((i) => this.me.shards & (1 << i)).length;
      return this.ui.prompt(`THE FINAL KEY · ${count}/3 SHARDS<small>Clear all three Gates</small>`);
    }
  }

  openRaces() {
    this.releaseMouse();
    this.ui.show('races');
    this.net.send({ t: 'races' });
    clearInterval(this.racesTimer);
    this.racesTimer = setInterval(() => this.net.send({ t: 'races' }), 2000);
  }

  closeRaces() {
    clearInterval(this.racesTimer);
    this.ui.hide('races');
  }

  watch(id) {
    this.closeRaces();
    if (this.mode === 'race') this.net.send({ t: 'hall' });
    this.net.send({ t: 'watch', id });
  }

  openMenu() {
    if (this.mode === 'auth') return;
    this.menuOpen = true;
    const alive = this.mode === 'race' && this.race.mode === 'play' && ['lobby', 'countdown', 'running', 'finishing'].includes(this.race.status);
    this.ui.menu({ inRace: this.mode === 'race', alive: alive && this.race.status !== 'lobby' });
  }

  closeMenu() {
    this.menuOpen = false;
    this.ui.hide('menu');
    this.input.lock();
  }

  leaveFromMenu() {
    this.menuOpen = false;
    this.ui.hide('menu');
    this.toHall();
  }

  releaseMouse() {
    if (this.input.locked) {
      this.quietUnlock = true;
      this.input.unlock();
    }
  }

  anyModal() {
    return ['results', 'races', 'menu', 'auth'].some((id) => this.ui.isOpen(id));
  }

  wireKeys() {
    this.input.onLockChange = (locked) => {
      if (!locked && !this.quietUnlock && (this.mode === 'hall' || this.mode === 'race') && !this.anyModal()) this.openMenu();
      this.quietUnlock = false;
    };
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.audio.unlock();
      if (e.code === 'Escape') {
        if (this.menuOpen) this.closeMenu();
        else if (this.ui.isOpen('races')) this.closeRaces();
        else if (!this.input.locked && !this.anyModal()) this.openMenu();
      }
      if (e.code === 'KeyM') this.ui.toast(this.audio.toggleMute() ? 'Sound off' : 'Sound on', 1200);
    });
    addEventListener('pointerdown', () => this.audio.unlock());
  }

  // --------------------------------------------------------------- frame

  frame(dt) {
    this.env.update(dt);
    if (this.mode === 'auth') this.hall.attract(dt);
    else if (this.mode === 'hall') {
      this.hall.update(dt);
      this.hallPrompt();
    } else if (this.mode === 'race') {
      this.race.update(dt);
      const needLock = ['countdown', 'running', 'finishing'].includes(this.race.status) && this.race.mode === 'play';
      this.ui.lockHint(needLock && !this.input.locked && !this.anyModal());
    }
    this.fx.update(dt);
    this.input.endFrame();
    this.composer.render();
  }
}

const app = new App();
window.__hunt = app;
app.start();
