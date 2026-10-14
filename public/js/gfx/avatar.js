// Procedural neon avatars with a running cycle, plus THE CLOCK.

import * as THREE from 'three';
import { neon, metal, nameSprite, damp } from './common.js';

const geoCache = {};
function cap(r, len) {
  const k = `c${r}_${len}`;
  return (geoCache[k] ??= new THREE.CapsuleGeometry(r, len, 4, 10));
}
function box(w, h, d) {
  const k = `b${w}_${h}_${d}`;
  return (geoCache[k] ??= new THREE.BoxGeometry(w, h, d));
}
function sph(r) {
  const k = `s${r}`;
  return (geoCache[k] ??= new THREE.SphereGeometry(r, 16, 12));
}

const suitMat = metal(0x2a3152, { metalness: 0.35, roughness: 0.5, emissive: 0x0c0f22 });
suitMat.userData.shared = true;

export class Avatar {
  constructor({ color = '#00e5ff', name = null, ghost = false, scale = 1 } = {}) {
    this.color = color;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.phase = Math.random() * 6;
    this.speed = 0;
    this.lean = 0;
    this.ghost = ghost;

    const suit = ghost ? neon(color, 1.5, { transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }) : suitMat;
    const glow = neon(color, ghost ? 2.6 : 1.9);
    const visor = neon(color, 2.4);

    const hips = new THREE.Group();
    hips.position.y = 0.92;
    this.body.add(hips);
    this.hips = hips;

    const torso = new THREE.Group();
    hips.add(torso);
    this.torso = torso;
    const chest = new THREE.Mesh(cap(0.19, 0.36), suit);
    chest.position.y = 0.32;
    torso.add(chest);
    for (const sx of [-1, 1]) {
      const stripe = new THREE.Mesh(box(0.035, 0.42, 0.06), glow);
      stripe.position.set(sx * 0.17, 0.33, 0.09);
      torso.add(stripe);
    }
    const belt = new THREE.Mesh(box(0.4, 0.05, 0.3), glow);
    belt.position.y = 0.06;
    torso.add(belt);

    const head = new THREE.Group();
    head.position.y = 0.7;
    torso.add(head);
    const skull = new THREE.Mesh(sph(0.15), suit);
    head.add(skull);
    const vis = new THREE.Mesh(box(0.24, 0.07, 0.1), visor);
    vis.position.set(0, 0.02, 0.11);
    head.add(vis);
    const crest = new THREE.Mesh(box(0.03, 0.06, 0.26), glow);
    crest.position.set(0, 0.15, -0.01);
    head.add(crest);
    this.head = head;

    const limb = (parent, x, y, upLen, loLen, r) => {
      const top = new THREE.Group();
      top.position.set(x, y, 0);
      parent.add(top);
      const upper = new THREE.Mesh(cap(r, upLen), suit);
      upper.position.y = -upLen / 2 - r;
      top.add(upper);
      const joint = new THREE.Group();
      joint.position.y = -upLen - r * 2;
      top.add(joint);
      const pad = new THREE.Mesh(sph(r * 0.9), glow);
      joint.add(pad);
      const lower = new THREE.Mesh(cap(r * 0.9, loLen), suit);
      lower.position.y = -loLen / 2 - r;
      joint.add(lower);
      return { top, joint, end: -loLen - r * 2 };
    };
    this.armL = limb(torso, 0.27, 0.52, 0.2, 0.2, 0.055);
    this.armR = limb(torso, -0.27, 0.52, 0.2, 0.2, 0.055);
    this.legL = limb(hips, 0.11, 0, 0.3, 0.3, 0.075);
    this.legR = limb(hips, -0.11, 0, 0.3, 0.3, 0.075);
    for (const leg of [this.legL, this.legR]) {
      const foot = new THREE.Mesh(box(0.13, 0.08, 0.26), suit);
      foot.position.set(0, leg.end, 0.05);
      leg.joint.add(foot);
      const sole = new THREE.Mesh(box(0.135, 0.02, 0.27), glow);
      sole.position.set(0, leg.end - 0.04, 0.05);
      leg.joint.add(sole);
      leg.foot = foot;
    }

    this.skates = new THREE.Group();
    for (const leg of [this.legL, this.legR]) {
      const s = new THREE.Group();
      const deck = new THREE.Mesh(box(0.16, 0.05, 0.36), neon('#7df9ff', 2.4));
      s.add(deck);
      for (const z of [-0.12, 0.12]) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 16), neon('#ffffff', 3));
        disc.position.set(0, -0.04, z);
        s.add(disc);
      }
      s.position.set(0, leg.end - 0.08, 0.05);
      leg.joint.add(s);
      s.visible = false;
      leg.skate = s;
    }

    if (ghost) {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 48), neon(color, 3));
      halo.position.set(0, 0.04, -0.12);
      head.add(halo);
      for (let i = 0; i < 12; i++) {
        const tick = new THREE.Mesh(box(0.03, 0.09, 0.03), neon(color, 3));
        const a = (i / 12) * Math.PI * 2;
        tick.position.set(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0);
        tick.rotation.z = a;
        halo.add(tick);
      }
      this.halo = halo;
      const hand = new THREE.Mesh(box(0.025, 0.36, 0.025), neon('#ffffff', 3));
      hand.geometry = hand.geometry.clone().translate(0, 0.18, 0);
      halo.add(hand);
      this.clockHand = hand;
    }

    this.root.scale.setScalar(scale);
    if (name) this.setName(name);
  }

  setName(name) {
    if (this.tag) {
      this.root.remove(this.tag);
      this.tag.material.map.dispose();
      this.tag.material.dispose();
    }
    this.tag = nameSprite(name, this.color);
    this.tag.position.y = 2.2;
    this.root.add(this.tag);
  }

  showSkates(on) {
    this.legL.skate.visible = on;
    this.legR.skate.visible = on;
  }

  // s: { speed, air, slide, down, moving }
  update(dt, s) {
    const speed = s.speed ?? 0;
    this.speed = damp(this.speed, speed, 8, dt);
    const run = Math.min(1, this.speed / 7);
    this.phase += dt * (3 + this.speed * 1.05);
    const p = this.phase;
    const sw = Math.sin(p);
    const t = performance.now() / 1000;

    let legAmp = 0.15 + run * 0.85;
    let thighL = -sw * legAmp;
    let thighR = sw * legAmp;
    let kneeL = Math.max(0, -Math.cos(p)) * (0.2 + run * 1.3);
    let kneeR = Math.max(0, Math.cos(p)) * (0.2 + run * 1.3);
    let armL = sw * (0.15 + run * 0.9);
    let armR = -sw * (0.15 + run * 0.9);
    let elbow = -(0.3 + run * 0.9);
    let lean = 0.06 + run * 0.28;
    let bodyY = Math.abs(Math.cos(p)) * 0.06 * run;
    let bodyRX = 0;

    if (s.skating) {
      thighL = -0.35 + Math.sin(p * 0.35) * 0.25;
      thighR = -0.35 - Math.sin(p * 0.35) * 0.25;
      kneeL = kneeR = 0.7;
      armL = Math.sin(p * 0.35) * 0.6;
      armR = -armL;
      lean = 0.45;
      bodyY = -0.12;
    }
    if (!s.moving && speed < 0.3) {
      thighL = thighR = 0;
      kneeL = kneeR = 0.05;
      armL = armR = Math.sin(t * 1.6) * 0.04;
      elbow = -0.2;
      lean = 0.02;
      bodyY = Math.sin(t * 2) * 0.01;
    }
    if (s.air) {
      thighL = -1.0;
      thighR = -0.4;
      kneeL = 1.4;
      kneeR = 1.1;
      armL = -1.2;
      armR = -0.9;
      lean = 0.2;
    }
    if (s.slide) {
      thighL = thighR = -1.4;
      kneeL = kneeR = 0.2;
      armL = armR = -0.6;
      lean = -0.9;
      bodyY = -0.5;
    }
    if (s.down) {
      bodyRX = -1.45;
      bodyY = -0.62;
      thighL = 0.1;
      thighR = -0.2;
      kneeL = kneeR = 0.3;
      armL = -2.4 + Math.sin(t * 30) * 0.1;
      armR = -2.2;
      lean = 0;
    }

    const k = 18;
    const L = this.legL.top.rotation, R = this.legR.top.rotation;
    L.x = damp(L.x, thighL, k, dt);
    R.x = damp(R.x, thighR, k, dt);
    this.legL.joint.rotation.x = damp(this.legL.joint.rotation.x, kneeL, k, dt);
    this.legR.joint.rotation.x = damp(this.legR.joint.rotation.x, kneeR, k, dt);
    this.armL.top.rotation.x = damp(this.armL.top.rotation.x, armL, k, dt);
    this.armR.top.rotation.x = damp(this.armR.top.rotation.x, armR, k, dt);
    this.armL.joint.rotation.x = damp(this.armL.joint.rotation.x, elbow, k, dt);
    this.armR.joint.rotation.x = damp(this.armR.joint.rotation.x, elbow, k, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, lean, 10, dt);
    this.body.position.y = damp(this.body.position.y, bodyY, 14, dt);
    this.body.rotation.x = damp(this.body.rotation.x, bodyRX, 10, dt);

    if (this.halo) {
      this.halo.rotation.z -= dt * 0.8;
      this.clockHand.rotation.z -= dt * 6;
    }
  }

  dispose() {
    if (this.tag) {
      this.tag.material.map.dispose();
      this.tag.material.dispose();
    }
  }
}
