// Procedural people (seeded looks: skin, hair, face, kit) with a running
// cycle, plus THE CLOCK.

import * as THREE from 'three';
import { neon, toon, nameSprite, damp } from './common.js';

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
function cyl(rt, rb, h) {
  const k = `y${rt}_${rb}_${h}`;
  return (geoCache[k] ??= new THREE.CylinderGeometry(rt, rb, h, 14));
}
function cone(r, h) {
  const k = `n${r}_${h}`;
  return (geoCache[k] ??= new THREE.ConeGeometry(r, h, 8));
}
function dome(r) {
  const k = `d${r}`;
  return (geoCache[k] ??= new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2));
}
function plane(w, h) {
  const k = `p${w}_${h}`;
  return (geoCache[k] ??= new THREE.PlaneGeometry(w, h));
}
// The front of the head, for the face texture.
function facePatch() {
  return (geoCache.face ??= new THREE.SphereGeometry(0.1313, 20, 16, Math.PI / 2 - 0.8, 1.6, Math.PI / 2 - 0.75, 1.4));
}

// ---------------------------------------------------------------- looks

const SKIN = ['#f7d6bc', '#efc09c', '#dca47c', '#c4895e', '#a26c45', '#7f5134', '#5c3a25'];
const HAIR = ['#14100e', '#14100e', '#261a13', '#3b2a1f', '#5e3b22', '#8a5a2b', '#d8b169', '#c8442f', '#2f5fd0', '#e46aa8', '#f1efe9'];
const CLOTH = ['#ffffff', '#1b1b22', '#2a6df4', '#ff7a1a', '#ffd23f', '#7a4dff', '#22c38e', '#ff4f9a', '#efe6d2', '#9be15d', '#3fc8ff'];
const IRIS = ['#3b2414', '#24160c', '#2e5d8a', '#3c7a4a', '#6b3fa0', '#8a4a1c'];
const HAIRSTYLES = ['crop', 'afro', 'spiky', 'bun', 'buzz', 'bald', 'cap', 'mohawk', 'ponytail', 'crop', 'spiky'];

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rngFrom(seed) {
  let a = hashStr(String(seed)) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

// A stable look for a player, from their name.
export function lookFor(seed, color) {
  const rng = rngFrom(seed);
  let shorts = pick(rng, CLOTH);
  if (shorts === color) shorts = '#1b1b22';
  const hair = pick(rng, HAIR);
  return {
    skin: pick(rng, SKIN),
    hair,
    iris: pick(rng, IRIS),
    style: pick(rng, HAIRSTYLES),
    top: rng() < 0.6 ? 'tank' : 'tee',
    legs: rng() < 0.55 ? 'shorts' : rng() < 0.6 ? 'tights' : 'pants',
    shorts,
    shoes: rng() < 0.55 ? '#ffffff' : pick(rng, CLOTH),
    socks: rng() < 0.7 ? '#ffffff' : '#1b1b22',
    headband: rng() < 0.25,
    wristband: rng() < 0.45,
    beard: rng() < 0.22,
    number: Math.floor(rng() * 99) + 1,
    smile: rng() < 0.5 ? 1 : 0,
    build: 0.94 + rng() * 0.12,
    shoulders: 0.235 + rng() * 0.025,
    capColor: pick(rng, CLOTH),
    backwards: rng() < 0.5,
  };
}

const matCache = new Map();
function mat(color) {
  let m = matCache.get(color);
  if (!m) {
    m = toon({ color });
    m.userData.shared = true;
    matCache.set(color, m);
  }
  return m;
}

// Anime face drawn on a patch that wraps the front of the head.
function faceTexture(look) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const ink = '#1c100c';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (look.beard) {
    g.fillStyle = look.hair;
    g.globalAlpha = 0.9;
    g.beginPath();
    g.moveTo(26, 86);
    g.quadraticCurveTo(64, 140, 102, 86);
    g.lineTo(96, 96);
    g.quadraticCurveTo(64, 104, 32, 96);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
  }
  // Brows.
  g.strokeStyle = look.hair === '#f1efe9' ? '#8a8378' : look.hair;
  g.lineWidth = 5;
  for (const sx of [-1, 1]) {
    const x = 64 + sx * 25;
    g.beginPath();
    g.moveTo(x - sx * 11, 46);
    g.quadraticCurveTo(x, 38, x + sx * 10, 42);
    g.stroke();
  }
  // Eyes.
  for (const sx of [-1, 1]) {
    const x = 64 + sx * 24, y = 60;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(x, y, 10, 8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = look.iris;
    g.beginPath();
    g.ellipse(x + sx * 1.5, y + 1, 6.5, 7.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ink;
    g.beginPath();
    g.ellipse(x + sx * 1.5, y + 1, 2.6, 3.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x + sx * 1.5 - 2, y - 2, 1.8, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 4.2;
    g.beginPath();
    g.ellipse(x, y + 1, 11, 9, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
  }
  // Nose shadow and mouth.
  g.strokeStyle = 'rgba(90,40,25,0.55)';
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(66, 70);
  g.lineTo(62, 82);
  g.lineTo(67, 84);
  g.stroke();
  g.strokeStyle = '#5a2620';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(55, 97);
  g.quadraticCurveTo(64, 98 + look.smile * 6, 73, 97 - look.smile * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function numberTexture(n, color, trim) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '900 44px "Dela Gothic One", Orbitron, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = trim;
  g.strokeText(String(n), 32, 35);
  g.fillStyle = color;
  g.fillText(String(n), 32, 35);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const isLight = (hex) => {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.6;
};

const ghostSuit = new Map();

export class Avatar {
  constructor({ color = '#00e5ff', name = null, ghost = false, scale = 1, seed = null } = {}) {
    this.color = color;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.phase = Math.random() * 6;
    this.speed = 0;
    this.lean = 0;
    this.ghost = ghost;
    this.owned = [];

    if (ghost) this.buildGhost(color);
    else this.buildHuman(lookFor(seed ?? name ?? color, color), color);

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

    this.root.scale.setScalar(scale);
    if (name) this.setName(name);
  }

  // A person: skin, hair, face, jersey, shorts, sneakers.
  buildHuman(look, color) {
    this.look = look;
    this.body.scale.setScalar(look.build);
    const skin = mat(look.skin);
    const jersey = mat(color);
    const trimCol = isLight(color) ? '#1b1b22' : '#ffffff';
    const trim = mat(trimCol);
    const shorts = mat(look.shorts);
    const lower = look.legs === 'tights' ? mat('#15151c') : look.legs === 'pants' ? shorts : skin;

    const hips = new THREE.Group();
    hips.position.y = 0.92;
    this.body.add(hips);
    this.hips = hips;
    const waist = new THREE.Mesh(cyl(0.165, 0.175, 0.2), shorts);
    waist.scale.set(1, 1, 0.68);
    waist.position.y = 0.02;
    hips.add(waist);

    const torso = new THREE.Group();
    hips.add(torso);
    this.torso = torso;
    // V-shaped torso: wide shoulders, narrow waist, rounded top.
    const chest = new THREE.Mesh(cyl(0.215, 0.16, 0.44), jersey);
    chest.scale.set(1, 1, 0.62);
    chest.position.y = 0.34;
    torso.add(chest);
    const yoke = new THREE.Mesh(dome(0.215), jersey);
    yoke.scale.set(1, 0.42, 0.62);
    yoke.position.y = 0.56;
    torso.add(yoke);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.016, 6, 16), trim);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.63;
    torso.add(collar);
    this.owned.push(collar.geometry);
    const num = numberTexture(look.number, trimCol, color);
    const numMat = toon({ map: num, transparent: true, alphaTest: 0.4 });
    this.owned.push(num, numMat);
    for (const back of [0, 1]) {
      const plate = new THREE.Mesh(plane(0.17, 0.17), numMat);
      plate.position.set(0, 0.37, back ? -0.124 : 0.124);
      plate.rotation.set(back ? 0.08 : -0.08, back ? Math.PI : 0, 0);
      torso.add(plate);
    }
    const neck = new THREE.Mesh(cyl(0.05, 0.056, 0.12), skin);
    neck.position.y = 0.66;
    torso.add(neck);

    // Head.
    const head = new THREE.Group();
    head.position.y = 0.7;
    head.scale.setScalar(1.14);
    torso.add(head);
    this.head = head;
    const skull = new THREE.Mesh(sph(0.13), skin);
    skull.scale.set(0.92, 1.08, 0.98);
    skull.position.y = 0.09;
    head.add(skull);
    const faceTex = faceTexture(look);
    const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, alphaTest: 0.35 });
    this.owned.push(faceTex, faceMat);
    const face = new THREE.Mesh(facePatch(), faceMat);
    skull.add(face);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(sph(0.03), skin);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(sx * 0.128, 0.0, -0.005);
      skull.add(ear);
    }
    this.addHair(skull, look);
    if (look.headband) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.133, 0.016, 6, 24), jersey);
      band.rotation.x = Math.PI / 2 - 0.25;
      band.position.y = 0.07;
      skull.add(band);
      this.owned.push(band.geometry);
    }

    // Arms.
    const arm = (sx) => {
      const top = new THREE.Group();
      top.position.set(sx * look.shoulders, 0.53, 0);
      top.rotation.z = sx * 0.1;
      torso.add(top);
      const shoulder = new THREE.Mesh(sph(0.056), look.top === 'tee' ? jersey : skin);
      top.add(shoulder);
      const upper = new THREE.Mesh(cap(0.05, 0.2), skin);
      upper.position.y = -0.15;
      top.add(upper);
      if (look.top === 'tee') {
        const sleeve = new THREE.Mesh(cyl(0.07, 0.066, 0.13), jersey);
        sleeve.position.y = -0.06;
        top.add(sleeve);
      }
      const joint = new THREE.Group();
      joint.position.y = -0.3;
      top.add(joint);
      const elbow = new THREE.Mesh(sph(0.048), skin);
      joint.add(elbow);
      const fore = new THREE.Mesh(cap(0.044, 0.19), skin);
      fore.position.y = -0.13;
      joint.add(fore);
      if (look.wristband) {
        const wb = new THREE.Mesh(cyl(0.052, 0.052, 0.06), jersey);
        wb.position.y = -0.22;
        joint.add(wb);
      }
      const hand = new THREE.Mesh(sph(0.052), skin);
      hand.scale.set(0.8, 1.1, 0.9);
      hand.position.y = -0.29;
      joint.add(hand);
      return { top, joint, end: -0.3 };
    };
    this.armL = arm(1);
    this.armR = arm(-1);

    // Legs.
    const leg = (sx) => {
      const top = new THREE.Group();
      top.position.set(sx * 0.1, 0, 0);
      hips.add(top);
      const thigh = new THREE.Mesh(cap(0.075, 0.3), look.legs === 'pants' ? shorts : skin);
      thigh.position.y = -0.225;
      top.add(thigh);
      if (look.legs !== 'pants') {
        const short = new THREE.Mesh(cyl(0.115, 0.1, 0.36), shorts);
        short.position.y = -0.17;
        top.add(short);
        const hem = new THREE.Mesh(cyl(0.102, 0.102, 0.03), trim);
        hem.position.y = -0.34;
        top.add(hem);
      }
      const joint = new THREE.Group();
      joint.position.y = -0.45;
      top.add(joint);
      const shin = new THREE.Mesh(cap(0.064, 0.3), lower);
      shin.position.y = -0.2;
      joint.add(shin);
      const sock = new THREE.Mesh(cyl(0.068, 0.064, 0.1), mat(look.socks));
      sock.position.y = -0.36;
      joint.add(sock);
      const end = -0.435;
      const shoe = new THREE.Mesh(cap(0.068, 0.15), mat(look.shoes));
      shoe.rotation.x = Math.PI / 2;
      shoe.scale.set(1.05, 1, 0.75);
      shoe.position.set(0, end + 0.02, 0.06);
      joint.add(shoe);
      const sole = new THREE.Mesh(box(0.14, 0.035, 0.3), mat(look.shoes === '#ffffff' ? '#e9e4da' : '#ffffff'));
      sole.position.set(0, end - 0.03, 0.06);
      joint.add(sole);
      return { top, joint, end, foot: shoe };
    };
    this.legL = leg(1);
    this.legR = leg(-1);
  }

  addHair(skull, look) {
    const hairMat = mat(look.hair);
    const add = (geo, m = hairMat) => {
      const mesh = new THREE.Mesh(geo, m);
      skull.add(mesh);
      return mesh;
    };
    const capGeo = (r, len) => {
      const k = `hair${r}_${len}`;
      return (geoCache[k] ??= new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, len));
    };
    const style = look.style;
    if (style === 'bald') return;
    if (style === 'afro') {
      const a = add(sph(0.165));
      a.position.set(0, 0.075, -0.05);
      a.scale.set(1.08, 0.95, 1);
      return;
    }
    if (style === 'cap') {
      const capMat = mat(look.capColor);
      const dome = add(capGeo(0.142, 1.35), capMat);
      dome.rotation.x = -0.25;
      const brim = add(box(0.2, 0.018, 0.14), capMat);
      brim.position.set(0, 0.045, look.backwards ? -0.17 : 0.17);
      brim.rotation.x = look.backwards ? -0.2 : 0.2;
      return;
    }
    const crop = add(capGeo(style === 'buzz' ? 0.135 : 0.142, style === 'buzz' ? 1.15 : 1.3));
    crop.rotation.x = -0.32;
    if (style === 'spiky') {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const spike = add(cone(0.05, 0.13));
        spike.position.set(Math.cos(a) * 0.07, 0.11, Math.sin(a) * 0.06 - 0.02);
        spike.rotation.set(Math.sin(a) * 0.7 - 0.3, 0, -Math.cos(a) * 0.7);
      }
      const top = add(cone(0.06, 0.16));
      top.position.set(0, 0.16, -0.02);
      top.rotation.x = -0.4;
    } else if (style === 'bun') {
      const bun = add(sph(0.06));
      bun.position.set(0, 0.13, -0.08);
    } else if (style === 'ponytail') {
      const tail = add(cap(0.04, 0.18));
      tail.position.set(0, -0.02, -0.15);
      tail.rotation.x = 0.35;
    } else if (style === 'mohawk') {
      crop.scale.set(0.98, 0.9, 0.98);
      const strip = add(box(0.05, 0.08, 0.26));
      strip.position.set(0, 0.13, -0.02);
    } else if (style === 'crop') {
      const fringe = add(box(0.2, 0.05, 0.08));
      fringe.position.set(0, 0.105, 0.075);
      fringe.rotation.x = 0.5;
    }
  }

  // THE CLOCK: a see-through glowing figure with a clock halo.
  buildGhost(color) {
    let suit = ghostSuit.get(color);
    if (!suit) {
      suit = neon(color, 1.5, { unique: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      suit.userData.shared = true;
      ghostSuit.set(color, suit);
    }
    const glow = neon(color, 2.6);
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
    const head = new THREE.Group();
    head.position.y = 0.7;
    torso.add(head);
    head.add(new THREE.Mesh(sph(0.15), suit));
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
      const lowerM = new THREE.Mesh(cap(r * 0.9, loLen), suit);
      lowerM.position.y = -loLen / 2 - r;
      joint.add(lowerM);
      return { top, joint, end: -loLen - r * 2 };
    };
    this.armL = limb(torso, 0.27, 0.52, 0.2, 0.2, 0.055);
    this.armR = limb(torso, -0.27, 0.52, 0.2, 0.2, 0.055);
    this.legL = limb(hips, 0.11, 0, 0.3, 0.3, 0.075);
    this.legR = limb(hips, -0.11, 0, 0.3, 0.3, 0.075);

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
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.36, 0.025).translate(0, 0.18, 0), neon('#ffffff', 3));
    halo.add(hand);
    this.clockHand = hand;
    const belt = new THREE.Mesh(box(0.4, 0.05, 0.3), glow);
    belt.position.y = 0.06;
    torso.add(belt);
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
    for (const o of this.owned) o.dispose();
    this.owned = [];
  }
}
