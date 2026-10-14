// The Gate Hall: a floating plaza with the three Gates, the Final Key, the
// Scoreboard and a terminal for watching live races. Third person.

import * as THREE from 'three';
import { Avatar } from '../gfx/avatar.js';
import { neon, metal, canvasTex, textPlane, damp, clamp } from '../gfx/common.js';

const RADIUS = 27;
const GATES = [
  { id: 1, name: 'GATE I', title: 'THE RACE', color: '#00e5ff', pos: [0, -19], open: true },
  { id: 2, name: 'GATE II', title: 'SEALED', color: '#ff2bd6', pos: [-15.5, -11], open: false },
  { id: 3, name: 'GATE III', title: 'SEALED', color: '#ffcf33', pos: [15.5, -11], open: false },
];
const TERMINAL = [12, 3];

function portalMaterial(color, open) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(color) }, uOpen: { value: open ? 1 : 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uT; uniform vec3 uC; uniform float uOpen;
      void main(){
        vec2 p = vUv*2.0-1.0;
        float r = length(p);
        float a = atan(p.y,p.x);
        float swirl = sin(a*6.0 + r*14.0 - uT*3.0)*0.5+0.5;
        float rings = sin(r*30.0 - uT*4.0)*0.5+0.5;
        float open = mix(swirl*0.7+0.3*rings, 0.15+0.15*rings, 1.0-uOpen);
        float lock = (1.0-uOpen) * step(abs(p.x),0.04+0.0) * step(abs(p.y),0.5);
        vec3 col = uC * (open*0.62 + 0.08) + vec3(lock)*0.6;
        float alpha = smoothstep(1.0,0.85,r) * (uOpen>0.5 ? 0.75 : 0.5);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
}

export class HallScene {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    app.scene.add(this.group);
    this.others = new Map();
    this.portals = [];
    this.time = 0;
    this.yaw = Math.PI;
    this.pitch = -0.18;
    this.pos = new THREE.Vector3(0, 0, 12);
    this.heading = Math.PI;
    this.sendTimer = 0;
    this.near = null;
    this.build();
  }

  build() {
    const G = this.group;
    // Platform.
    const floorTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#080716';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,229,255,0.25)';
      g.lineWidth = 1;
      for (let i = 0; i <= w; i += 32) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, h);
        g.stroke();
        g.beginPath();
        g.moveTo(0, i);
        g.lineTo(w, i);
        g.stroke();
      }
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(5, 5);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS - 3, 1.2, 96), [
      metal(0x0d0b20),
      new THREE.MeshStandardMaterial({ map: floorTex, emissive: 0xffffff, emissiveMap: floorTex, emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 }),
      metal(0x0d0b20),
    ]);
    floor.position.y = -0.6;
    G.add(floor);
    for (const [r, c] of [[RADIUS - 0.2, '#ff2bd6'], [RADIUS * 0.62, '#00e5ff'], [RADIUS * 0.3, '#8a5cff'], [4, '#ffcf33']]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 6, 128), neon(c, 2));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.02;
      G.add(ring);
    }
    const under = new THREE.Mesh(new THREE.ConeGeometry(RADIUS - 3, 26, 64, 1, true), neon('#2a0f5c', 0.8, { side: THREE.DoubleSide }));
    under.rotation.x = Math.PI;
    under.position.y = -14;
    G.add(under);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 0.5, 200, 24, 1, true), neon('#00e5ff', 0.4, { transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = -127;
    G.add(beam);

    // Gates.
    for (const g of GATES) {
      const grp = new THREE.Group();
      grp.position.set(g.pos[0], 0, g.pos[1]);
      grp.lookAt(0, 0, 0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.28, 16, 80), neon(g.color, g.open ? 1.5 : 0.8));
      ring.position.y = 4;
      grp.add(ring);
      const mat = portalMaterial(g.color, g.open);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(3.2, 64), mat);
      disc.position.y = 4;
      grp.add(disc);
      this.portals.push(mat);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4, 0.5, 48), metal(0x15183a));
      base.position.y = 0.25;
      grp.add(base);
      const baseGlow = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.06, 6, 64), neon(g.color, 2));
      baseGlow.rotation.x = Math.PI / 2;
      baseGlow.position.y = 0.52;
      grp.add(baseGlow);
      for (const sx of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.6, 0.6), metal(0x15183a));
        pillar.position.set(sx * 4.2, 3.8, 0);
        grp.add(pillar);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 7.6, 0.62), neon(g.color, 1.3));
        strip.position.set(sx * 4.2 - sx * 0.3, 3.8, 0);
        grp.add(strip);
      }
      const label = textPlane(`${g.name}`, { w: 7, h: 1.2, px: 120, color: g.color, boost: 1.05, glow: 10 });
      label.position.set(0, 8.4, 0);
      grp.add(label);
      const sub = textPlane(g.title, { w: 7, h: 0.8, px: 100, color: g.open ? '#ffffff' : '#8fa3c7', boost: 0.9, glow: 6 });
      sub.position.set(0, 7.5, 0);
      grp.add(sub);
      if (g.id === 1) this.gate1Sub = sub;
      G.add(grp);
      g.group = grp;
    }

    // Final Key in the middle.
    const key = new THREE.Group();
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.7, 1.1, 32), metal(0x15183a));
    ped.position.y = 0.55;
    key.add(ped);
    const keyBody = new THREE.Group();
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.12, 12, 40), neon('#ffffff', 0.5, { unique: true, transparent: true, opacity: 0.35 }));
    bow.position.y = 0.9;
    keyBody.add(bow);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.6, 0.18), bow.material);
    shaft.position.y = -0.3;
    keyBody.add(shaft);
    for (const [y, w] of [[-0.85, 0.5], [-0.55, 0.35]]) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 0.16), bow.material);
      tooth.position.set(w / 2, y, 0);
      keyBody.add(tooth);
    }
    keyBody.position.y = 3;
    key.add(keyBody);
    this.keyBody = keyBody;
    this.keyMat = bow.material;
    this.shardMeshes = [];
    const shardGeo = new THREE.OctahedronGeometry(0.28);
    ['#00e5ff', '#ff2bd6', '#ffcf33'].forEach((c, i) => {
      const s = new THREE.Mesh(shardGeo, neon(c, 0.35, { unique: true, transparent: true, opacity: 0.35 }));
      s.userData.color = c;
      key.add(s);
      this.shardMeshes.push(s);
    });
    const keyLabel = textPlane('THE FINAL KEY', { w: 4.5, h: 0.6, px: 100, color: '#ffffff', boost: 0.9, glow: 6 });
    keyLabel.position.set(0, 1.45, 1.75);
    keyLabel.rotation.x = -0.35;
    key.add(keyLabel);
    this.keyLabel = keyLabel;
    G.add(key);

    // Scoreboard above Gate I.
    this.board = textPlane('', { w: 28, h: 13, px: 512, color: '#00e5ff', bg: 'rgba(6,2,22,0.75)', boost: 0.85 });
    this.board.position.set(0, 15.5, -28);
    this.board.lookAt(0, 8, 0);
    G.add(this.board);
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(28.6, 13.6), neon('#00e5ff', 1.2, { transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
    frame.position.z = -0.05;
    this.board.add(frame);
    this.drawBoard({ clears: [], stats: { attempts: 0, clears: 0, players: 0 } });

    // Live race terminal.
    const term = new THREE.Group();
    term.position.set(TERMINAL[0], 0, TERMINAL[1]);
    term.lookAt(0, 0, 4);
    const col = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 0.6), metal(0x15183a));
    col.position.y = 0.7;
    term.add(col);
    const screen = textPlane('LIVE RACES', { w: 2.6, h: 1.4, px: 160, color: '#00ffa3', bg: 'rgba(0,30,20,0.6)', boost: 1.0, glow: 8, lines: true });
    screen.position.set(0, 2.3, 0);
    term.add(screen);
    this.termScreen = screen;
    G.add(term);

    // Rotating holo ring above.
    this.topRing = new THREE.Mesh(new THREE.TorusGeometry(20, 0.12, 6, 128), neon('#8a5cff', 1.6));
    this.topRing.position.y = 22;
    this.topRing.rotation.x = Math.PI / 2;
    G.add(this.topRing);

    // Me.
    this.me = new Avatar({ color: '#00e5ff' });
    G.add(this.me.root);
  }

  drawBoard(data) {
    this.boardData = data;
    const c = this.board.canvas;
    const g = this.board.ctx;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(6,2,22,0.78)';
    g.fillRect(0, 0, W, H);
    g.textBaseline = 'middle';
    g.shadowBlur = 16;
    g.shadowColor = '#00e5ff';
    g.fillStyle = '#00e5ff';
    g.font = '900 54px Orbitron, sans-serif';
    g.textAlign = 'center';
    g.fillText('SCOREBOARD · GATE I', W / 2, 52);
    g.shadowBlur = 8;
    g.font = '700 30px Rajdhani, sans-serif';
    g.fillStyle = '#8fa3c7';
    const s = data.stats || {};
    g.fillText(`ATTEMPTS ${s.attempts ?? 0}   ·   CLEARED ${s.clears ?? 0}   ·   AVATARS ${s.players ?? 0}`, W / 2, 104);
    g.textAlign = 'left';
    const list = data.clears || [];
    if (!list.length) {
      g.textAlign = 'center';
      g.fillStyle = '#ff3355';
      g.shadowColor = '#ff3355';
      g.font = '900 46px Orbitron, sans-serif';
      g.fillText('NO ONE HAS BEATEN THE CLOCK', W / 2, H / 2 + 30);
    } else {
      list.slice(0, 10).forEach((e, i) => {
        const y = 160 + i * 34;
        g.fillStyle = i === 0 ? '#ffcf33' : '#e8f6ff';
        g.shadowColor = i === 0 ? '#ffcf33' : '#00e5ff';
        g.font = '900 28px Orbitron, sans-serif';
        g.fillText(`${String(i + 1).padStart(2, '0')}`, 60, y);
        g.font = '700 32px Rajdhani, sans-serif';
        g.fillText(e.n, 140, y);
        g.textAlign = 'right';
        g.fillText(`${e.time.toFixed(2)} s`, W - 60, y);
        g.textAlign = 'left';
      });
    }
    this.board.tex.needsUpdate = true;
  }

  setPlayers(list, myId) {
    const seen = new Set();
    for (const [id, name, color, x, z, ry, m] of list) {
      if (id === myId) continue;
      seen.add(id);
      let o = this.others.get(id);
      if (!o) {
        o = { av: new Avatar({ color, name }), x, z, ry, m, tx: x, tz: z };
        o.av.root.position.set(x, 0, z);
        this.group.add(o.av.root);
        this.others.set(id, o);
      }
      o.tx = x;
      o.tz = z;
      o.ry = ry;
      o.m = m;
    }
    for (const [id, o] of this.others) {
      if (!seen.has(id)) {
        this.group.remove(o.av.root);
        o.av.dispose();
        this.others.delete(id);
      }
    }
  }

  setMe(me) {
    if (!me) return;
    if (this.meColor !== me.color || this.meName !== me.name) {
      this.group.remove(this.me.root);
      this.me = new Avatar({ color: me.color, name: me.name });
      this.me.root.position.copy(this.pos);
      this.group.add(this.me.root);
      this.meColor = me.color;
      this.meName = me.name;
    }
    const shards = me.shards || 0;
    let count = 0;
    this.shardMeshes.forEach((s, i) => {
      const on = !!(shards & (1 << i));
      if (on) count++;
      s.material.color.set(s.userData.color).multiplyScalar(on ? 2.5 : 0.35);
      s.material.opacity = on ? 1 : 0.35;
    });
    this.keyMat.opacity = count === 3 ? 1 : 0.25 + count * 0.15;
    this.keyMat.color.setScalar(count === 3 ? 2.5 : 0.6);
    this.keyLabel.setText(count === 3 ? 'THE FINAL KEY · UNLOCKED' : `THE FINAL KEY · ${count}/3`);
  }

  enter() {
    this.group.visible = true;
    this.pos.set(0, 0, 12);
    this.heading = Math.PI;
    this.yaw = Math.PI;
    this.me.root.position.copy(this.pos);
  }

  exit() {
    this.group.visible = false;
  }

  // Slow orbit for the login screen.
  attract(dt) {
    this.time += dt;
    const cam = this.app.camera;
    const a = this.time * 0.06;
    cam.position.set(Math.sin(a) * 34, 12 + Math.sin(this.time * 0.2) * 2, Math.cos(a) * 34);
    cam.lookAt(0, 4, -4);
    cam.fov = 60;
    cam.updateProjectionMatrix();
    this.animate(dt);
  }

  animate(dt) {
    const t = this.time;
    for (const m of this.portals) m.uniforms.uT.value = t;
    this.keyBody.rotation.y += dt * 0.6;
    this.keyBody.position.y = 3 + Math.sin(t * 1.4) * 0.15;
    this.shardMeshes.forEach((s, i) => {
      const a = t * 0.8 + (i * Math.PI * 2) / 3;
      s.position.set(Math.cos(a) * 1.4, 3 + Math.sin(t * 2 + i) * 0.2, Math.sin(a) * 1.4);
      s.rotation.y += dt * 2;
    });
    this.topRing.rotation.z += dt * 0.1;
    for (const o of this.others.values()) {
      const px = o.av.root.position.x, pz = o.av.root.position.z;
      o.av.root.position.x = damp(px, o.tx, 8, dt);
      o.av.root.position.z = damp(pz, o.tz, 8, dt);
      o.av.root.rotation.y = o.ry;
      o.av.update(dt, { speed: o.m ? 4 : 0, moving: !!o.m });
    }
  }

  update(dt) {
    this.time += dt;
    const app = this.app;
    const input = app.input;
    const cam = app.camera;
    const [mx, my] = input.takeMouse();
    this.yaw -= mx * 0.0024;
    this.pitch = clamp(this.pitch - my * 0.002, -0.75, 0.45);

    // Move relative to the camera.
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const mv = new THREE.Vector3();
    if (input.key('KeyW', 'ArrowUp')) mv.add(fwd);
    if (input.key('KeyS', 'ArrowDown')) mv.sub(fwd);
    if (input.key('KeyD', 'ArrowRight')) mv.add(right);
    if (input.key('KeyA', 'ArrowLeft')) mv.sub(right);
    const moving = mv.lengthSq() > 0 && !app.menuOpen;
    const speed = input.key('ShiftLeft', 'ShiftRight') ? 8 : 4.6;
    if (moving) {
      mv.normalize();
      this.pos.addScaledVector(mv, speed * dt);
      const target = Math.atan2(mv.x, mv.z);
      let d = target - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 12);
    }
    // Stay on the platform and out of solid things.
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > RADIUS - 1.2) this.pos.multiplyScalar((RADIUS - 1.2) / r);
    const solids = [[0, 0, 2.1], [TERMINAL[0], TERMINAL[1], 0.9], ...GATES.map((g) => [g.pos[0], g.pos[1], 4.2])];
    for (const [sx, sz, sr] of solids) {
      const dx = this.pos.x - sx, dz = this.pos.z - sz;
      const d = Math.hypot(dx, dz);
      if (d < sr && d > 0.0001) {
        this.pos.x = sx + (dx / d) * sr;
        this.pos.z = sz + (dz / d) * sr;
      }
    }
    this.me.root.position.copy(this.pos);
    this.me.root.rotation.y = this.heading;
    this.me.update(dt, { speed: moving ? speed : 0, moving });

    // Camera behind.
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const target = this.pos.clone().add(new THREE.Vector3(0, 1.7, 0));
    const want = target.clone().addScaledVector(dir, -5.4);
    want.y = Math.max(0.4, want.y);
    cam.position.lerp(want, 1 - Math.exp(-dt * 14));
    cam.lookAt(target.clone().addScaledVector(dir, 3));
    if (cam.fov !== 70) {
      cam.fov = 70;
      cam.updateProjectionMatrix();
    }

    // What are we standing next to?
    let near = null;
    for (const g of GATES) {
      if (Math.hypot(this.pos.x - g.pos[0], this.pos.z - g.pos[1]) < 7) near = { kind: 'gate', g };
    }
    if (Math.hypot(this.pos.x - TERMINAL[0], this.pos.z - TERMINAL[1]) < 2.6) near = { kind: 'terminal' };
    if (Math.hypot(this.pos.x, this.pos.z) < 3.4) near = { kind: 'key' };
    this.near = near;

    const me = app.me;
    const locked = me && me.lockedUntil > app.net.now();
    this.gate1Sub.setText(locked ? `LOCKED ${fmtLeft(me.lockedUntil - app.net.now())}` : 'THE RACE', locked ? '#ff8fa3' : '#ffffff');
    this.termScreen.setText(`LIVE RACES\n${app.raceCount || 0} RUNNING`);

    if (input.hit('KeyE') && near && !app.menuOpen) app.interact(near);

    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      this.sendTimer = 0.12;
      app.net.send({ t: 'hp', x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2), ry: +this.heading.toFixed(2), m: moving ? 1 : 0 });
    }
    this.animate(dt);
  }
}

export function fmtLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
