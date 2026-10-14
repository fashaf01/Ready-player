// The 400 m hoverway: deck, rails, stands, arches, every obstacle, and the
// giant clock at the finish. build() is called once per race because each
// race has its own course.

import * as THREE from 'three';
import { TRACK } from '/shared/constants.js';
import { OBST, ballState, blockState, gateHeight, trapState, pistonExt, crashState } from '/shared/course.js';
import { neon, metal, canvasTex, textPlane, disposeTree, rand } from './common.js';

const { HALF_W, EDGE_X, LANE_W, LENGTH, PANEL_LEN, RAIL_H, DECK_T } = TRACK;
const PANELS = Math.ceil(LENGTH / PANEL_LEN);

let laneTex = null;
function getLaneTex() {
  if (laneTex) return laneTex;
  laneTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#0b0c1e';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,140,255,0.08)';
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 1);
    g.fillStyle = 'rgba(0,229,255,0.9)';
    g.fillRect(0, 0, 3, h);
    g.fillStyle = 'rgba(255,43,214,0.35)';
    g.fillRect(0, h / 2 - 1, w, 2);
  });
  laneTex.wrapS = laneTex.wrapT = THREE.RepeatWrapping;
  laneTex.userData.shared = true;
  return laneTex;
}

let crackTex = null;
function getCrackTex() {
  if (crackTex) return crackTex;
  crackTex = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#ff3a2a';
    g.lineWidth = 3;
    g.shadowColor = '#ff2200';
    g.shadowBlur = 8;
    for (let k = 0; k < 9; k++) {
      let x = Math.random() * w, y = Math.random() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 7; s++) {
        x += (Math.random() - 0.5) * 70;
        y += (Math.random() - 0.5) * 70;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
  crackTex.userData.shared = true;
  return crackTex;
}

let hazardTex = null;
function getHazardTex() {
  if (hazardTex) return hazardTex;
  hazardTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#111';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffcf33';
    for (let i = -h; i < w; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 16, 0);
      g.lineTo(i + 16 + h, h);
      g.lineTo(i + h, h);
      g.fill();
    }
  });
  hazardTex.wrapS = hazardTex.wrapT = THREE.RepeatWrapping;
  hazardTex.userData.shared = true;
  return hazardTex;
}

// Flat deck piece with world-aligned lane texture.
function deckPiece(x0, x1, z0, z1) {
  const g = new THREE.Group();
  const w = x1 - x0, l = z1 - z0;
  const top = new THREE.PlaneGeometry(w, l);
  top.rotateX(-Math.PI / 2);
  const uv = top.attributes.uv;
  const pos = top.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + (x0 + x1) / 2;
    const wz = pos.getZ(i) + (z0 + z1) / 2;
    uv.setXY(i, (wx + HALF_W) / LANE_W, wz / 8);
  }
  const tex = getLaneTex();
  const topMesh = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.85, metalness: 0.15, roughness: 0.75 }));
  topMesh.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  g.add(topMesh);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, DECK_T, l), metal(0x0a0a18));
  body.position.set((x0 + x1) / 2, -DECK_T / 2 - 0.005, (z0 + z1) / 2);
  g.add(body);
  g.userData.top = topMesh;
  return g;
}

export class TrackView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.static = new THREE.Group();
    this.group.add(this.static);
    this.dyn = null;
    this.ledge = null;
    this.time = 0;
    this.buildStatic();
  }

  // ------------------------------------------------------------- static set

  buildStatic() {
    const S = this.static;

    // Start plaza.
    const plazaTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#0a0a1c';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,229,255,0.35)';
      g.lineWidth = 2;
      const r = 22;
      for (let y = 0; y < h + r; y += r * 1.5) {
        for (let x = 0; x < w + r; x += r * Math.sqrt(3)) {
          const ox = (Math.round(y / (r * 1.5)) % 2) * (r * Math.sqrt(3)) / 2;
          g.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k + Math.PI / 6;
            g.lineTo(x + ox + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
          }
          g.closePath();
          g.stroke();
        }
      }
    });
    plazaTex.wrapS = plazaTex.wrapT = THREE.RepeatWrapping;
    plazaTex.repeat.set(4, 6);
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(24, DECK_T, 35), new THREE.MeshStandardMaterial({ map: plazaTex, emissive: 0xffffff, emissiveMap: plazaTex, emissiveIntensity: 0.7, metalness: 0.5, roughness: 0.4 }));
    plaza.position.set(0, -DECK_T / 2, TRACK.PLAZA_START + 17.5);
    S.add(plaza);
    for (const sx of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 35), neon('#ff2bd6', 2));
      edge.position.set(sx * 12, 0.02, TRACK.PLAZA_START + 17.5);
      S.add(edge);
    }

    // Start line + arch.
    const line = new THREE.Mesh(new THREE.BoxGeometry(EDGE_X * 2, 0.03, 0.25), neon('#ffffff', 2.5));
    line.position.set(0, 0.02, 0);
    S.add(line);
    S.add(this.arch(0, '#00e5ff', 'GATE I · THE RACE'));

    // Finish line + arch + giant clock.
    const checker = canvasTex(256, 32, (g, w, h) => {
      for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 16) {
        g.fillStyle = ((x + y) / 16) % 2 ? '#ffffff' : '#111';
        g.fillRect(x, y, 16, 16);
      }
    });
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(EDGE_X * 2, 1.2), new THREE.MeshBasicMaterial({ map: checker, color: new THREE.Color(1.6, 1.6, 1.6) }));
    fin.rotation.x = -Math.PI / 2;
    fin.position.set(0, 0.02, LENGTH);
    S.add(fin);
    S.add(this.arch(LENGTH, '#ffcf33', 'FINISH'));

    const clock = new THREE.Group();
    clock.position.set(0, 17, LENGTH + 2);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.35, 12, 96), neon('#ffcf33', 2.2));
    clock.add(ring);
    const face = new THREE.Mesh(new THREE.CircleGeometry(6.7, 64), new THREE.MeshBasicMaterial({ color: 0x1a0f00, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    clock.add(face);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(i % 5 ? 0.08 : 0.18, i % 5 ? 0.4 : 0.9, 0.05), neon('#ffcf33', 2));
      tick.position.set(Math.cos(a) * 6.1, Math.sin(a) * 6.1, -0.05);
      tick.rotation.z = a + Math.PI / 2;
      clock.add(tick);
    }
    const digits = textPlane('00:38.00', { w: 9, h: 2.4, px: 200, color: '#ffcf33', glow: 24, boost: 1.8 });
    digits.position.set(0, -2.4, 0.1);
    clock.add(digits);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.6, 0.1), neon('#ffffff', 2.5));
    hand.geometry.translate(0, 2.8, 0);
    hand.position.z = 0.15;
    clock.add(hand);
    this.finishClock = { group: clock, digits, hand, broken: false };
    clock.rotation.y = Math.PI;
    S.add(clock);

    // Run-out end wall.
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(EDGE_X * 2, 8), neon('#ff2bd6', 0.6, { transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
    wall.position.set(0, 4, TRACK.RUNOUT_END);
    S.add(wall);

    // Distance markers.
    for (let d = 50; d < LENGTH; d += 50) {
      for (const sx of [-1, 1]) {
        const m = textPlane(`${d}`, { w: 3, h: 1.6, px: 160, color: '#ff2bd6', boost: 1.6 });
        m.position.set(sx * 10.5, 3.2, d);
        m.rotation.y = Math.PI;
        S.add(m);
      }
    }

    // Edge strips, rail posts and the glass part of the rails (all static).
    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, TRACK.RUNOUT_END + 1), neon('#ff2bd6', 2.2));
      strip.position.set(sx * EDGE_X, -0.12, TRACK.RUNOUT_END / 2 - 0.5);
      S.add(strip);
      const under = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, TRACK.RUNOUT_END + 1), neon('#8a5cff', 1.6));
      under.position.set(sx * (EDGE_X - 0.2), -DECK_T - 0.05, TRACK.RUNOUT_END / 2 - 0.5);
      S.add(under);
    }
    const postGeo = new THREE.BoxGeometry(0.14, RAIL_H + 0.05, 0.14);
    const posts = new THREE.InstancedMesh(postGeo, metal(0x2a2e4a), (PANELS + 11) * 2);
    const glassGeo = new THREE.BoxGeometry(PANEL_LEN - 0.12, RAIL_H - 0.08, 0.04);
    const glass = new THREE.InstancedMesh(glassGeo, new THREE.MeshBasicMaterial({ color: 0x2bd9ff, transparent: true, opacity: 0.1, depthWrite: false }), (PANELS + 10) * 2);
    const m = new THREE.Matrix4();
    let pi = 0, gi = 0;
    for (const sx of [-1, 1]) {
      for (let i = 0; i <= PANELS + 10; i++) {
        m.makeTranslation(sx * 8.15, (RAIL_H + 0.05) / 2, i * PANEL_LEN);
        posts.setMatrixAt(pi++, m);
        if (i < PANELS + 10) {
          m.makeTranslation(sx * 8.15, (RAIL_H - 0.08) / 2 + 0.02, i * PANEL_LEN + PANEL_LEN / 2);
          glass.setMatrixAt(gi++, m);
        }
      }
    }
    S.add(posts, glass);

    // Under-deck ribs and hover emitters (seen when looking over the side).
    const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(EDGE_X * 2 - 0.4, 0.25, 0.25), neon('#3a1a7a', 1.2), 56);
    for (let i = 0; i < 56; i++) {
      m.makeTranslation(0, -DECK_T - 0.15, i * 8 + 2);
      ribs.setMatrixAt(i, m);
    }
    S.add(ribs);
    for (let z = 25; z < TRACK.RUNOUT_END; z += 50) {
      const em = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.18, 8, 40), neon('#00e5ff', 2));
      em.rotation.x = Math.PI / 2;
      em.position.set(0, -DECK_T - 0.6, z);
      S.add(em);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.2, 30, 20, 1, true), neon('#00e5ff', 0.5, { transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      beam.position.set(0, -DECK_T - 15.6, z);
      S.add(beam);
    }

    this.buildStands();
  }

  arch(z, color, label) {
    const g = new THREE.Group();
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9, 0.7), metal(0x161a33));
      p.position.set(sx * 9.6, 4.5, z);
      g.add(p);
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 9, 0.75), neon(color, 2.2));
      s.position.set(sx * 9.6 - sx * 0.36, 4.5, z);
      g.add(s);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(20, 1.4, 0.8), metal(0x161a33));
    top.position.set(0, 9.2, z);
    g.add(top);
    const sign = textPlane(label, { w: 16, h: 1.2, px: 120, color, boost: 1.8 });
    sign.position.set(0, 9.2, z - 0.42);
    sign.rotation.y = Math.PI;
    g.add(sign);
    return g;
  }

  buildStands() {
    const crowdGeo = new THREE.CapsuleGeometry(0.22, 0.5, 3, 6);
    crowdGeo.translate(0, 0.47, 0);
    const per = 1400;
    this.crowd = [];
    const palette = ['#00e5ff', '#ff2bd6', '#ffcf33', '#8a5cff', '#39ff14', '#ff6a00', '#ffffff'];
    for (const sx of [-1, 1]) {
      const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), per);
      const base = [];
      const m = new THREE.Matrix4();
      const c = new THREE.Color();
      let n = 0;
      for (let z0 = -30; z0 < 430; z0 += 46) {
        const seg = new THREE.Group();
        for (let row = 0; row < 4; row++) {
          const step = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 40), metal(0x0e1024));
          step.position.set(sx * (16 + row * 3), row * 0.9, z0 + 20);
          seg.add(step);
          const lip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 40), neon(row % 2 ? '#ff2bd6' : '#00e5ff', 2));
          lip.position.set(sx * (16 + row * 3 - 1.5), row * 0.9 + 0.3, z0 + 20);
          seg.add(lip);
          for (let k = 0; k < 34 && n < per; k++) {
            const x = sx * (16 + row * 3 + rand(-1, 1));
            const y = row * 0.9 + 0.3;
            const z = z0 + 1 + k * (38 / 34) + rand(-0.3, 0.3);
            m.makeTranslation(x, y, z);
            crowd.setMatrixAt(n, m);
            c.set(palette[Math.floor(Math.random() * palette.length)]).multiplyScalar(rand(0.25, 0.75));
            crowd.setColorAt(n, c);
            base.push([x, y, z, Math.random() * 10, Math.random() < 0.25]);
            n++;
          }
        }
        const glowUnder = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 40), neon('#8a5cff', 0.9));
        glowUnder.position.set(sx * 20.5, -0.4, z0 + 20);
        seg.add(glowUnder);
        this.static.add(seg);
      }
      crowd.count = n;
      crowd.frustumCulled = false;
      this.static.add(crowd);
      this.crowd.push({ mesh: crowd, base });
    }
  }

  // ------------------------------------------------------- per-race build

  build(course, panels) {
    if (this.dyn) {
      this.group.remove(this.dyn);
      disposeTree(this.dyn);
    }
    this.removeLedge();
    this.course = course;
    const D = (this.dyn = new THREE.Group());
    this.group.add(D);
    this.resetFinishClock();

    // Deck pieces around the road-crash zones.
    const zs = new Set([-1, TRACK.RUNOUT_END]);
    for (const c of course.crashes) {
      zs.add(c.z0);
      zs.add(c.z1);
    }
    const breaks = [...zs].sort((a, b) => a - b);
    for (let i = 0; i < breaks.length - 1; i++) {
      const za = breaks[i], zb = breaks[i + 1];
      let xs = [[-EDGE_X, EDGE_X]];
      for (const c of course.crashes) {
        if (c.z0 <= za && c.z1 >= zb) {
          const next = [];
          for (const [a, b] of xs) {
            if (c.x1 <= a || c.x0 >= b) next.push([a, b]);
            else {
              if (c.x0 > a) next.push([a, c.x0]);
              if (c.x1 < b) next.push([c.x1, b]);
            }
          }
          xs = next;
        }
      }
      for (const [a, b] of xs) if (b - a > 0.01) D.add(deckPiece(a, b, za, zb));
    }

    this.crashViews = course.crashes.map((c) => {
      const g = deckPiece(c.x0, c.x1, c.z0, c.z1);
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(c.x1 - c.x0, c.z1 - c.z0), new THREE.MeshBasicMaterial({ map: getCrackTex(), transparent: true, opacity: 0, depthWrite: false, color: new THREE.Color(2.5, 1, 1) }));
      crack.rotation.x = -Math.PI / 2;
      crack.position.set((c.x0 + c.x1) / 2, 0.015, (c.z0 + c.z1) / 2);
      g.add(crack);
      const pivot = new THREE.Group();
      pivot.position.set((c.x0 + c.x1) / 2, 0, (c.z0 + c.z1) / 2);
      g.position.set(-pivot.position.x, 0, -pivot.position.z);
      pivot.add(g);
      D.add(pivot);
      return { c, pivot, crack, top: g.userData.top, spin: new THREE.Vector3(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)), played: { warn: false, fall: false } };
    });

    // Rail glow strips (each panel its own colour from the server).
    const stripGeo = new THREE.BoxGeometry(PANEL_LEN - 0.1, 0.07, 0.1);
    this.rails = [];
    for (const [key, sx] of [['L', 1], ['R', -1]]) {
      const mesh = new THREE.InstancedMesh(stripGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), PANELS + 10);
      const m = new THREE.Matrix4();
      const list = panels?.[key] ?? [];
      const data = [];
      for (let i = 0; i < PANELS + 10; i++) {
        m.makeTranslation(sx * 8.15, RAIL_H, i * PANEL_LEN + PANEL_LEN / 2);
        mesh.setMatrixAt(i, m);
        const p = list[i] ?? [0x00d8ff, 0.03, 0.8];
        data.push({ color: new THREE.Color(p[0]), amp: p[1], rate: p[2], ph: Math.random() * Math.PI * 2 });
        mesh.setColorAt(i, data[i].color);
      }
      mesh.frustumCulled = false;
      D.add(mesh);
      this.rails.push({ mesh, data });
    }

    // Laser gates.
    this.gateViews = course.gates.map((g) => {
      const grp = new THREE.Group();
      grp.position.z = g.z;
      const col = g.type === 'sweep' ? '#ff2bd6' : '#ff3355';
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), metal(0x1d2040));
        post.position.set(sx * 8.7, 1.3, 0);
        grp.add(post);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.34), neon(col, 2.5));
        lamp.position.set(sx * 8.7, 2.66, 0);
        grp.add(lamp);
      }
      const beam = new THREE.Group();
      const core = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.05, 0.05), neon('#ffffff', 3));
      const halo = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.18, 0.18), neon(col, 2.4, { transparent: true, opacity: 0.55, depthWrite: false }));
      beam.add(core, halo);
      grp.add(beam);
      D.add(grp);
      return { g, beam };
    });

    // Trap floors.
    this.trapViews = course.traps.map((tr) => {
      const w = tr.x1 - tr.x0, l = tr.z1 - tr.z0;
      const grp = new THREE.Group();
      grp.position.set((tr.x0 + tr.x1) / 2, 0, (tr.z0 + tr.z1) / 2);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, l - 0.1), new THREE.MeshBasicMaterial({ color: 0x222233, transparent: true, opacity: 0.9 }));
      plate.rotation.x = -Math.PI / 2;
      plate.position.y = 0.012;
      grp.add(plate);
      const hz = getHazardTex();
      const border = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshBasicMaterial({ map: hz, transparent: true, opacity: 0.55, depthWrite: false }));
      border.rotation.x = -Math.PI / 2;
      border.position.y = 0.008;
      grp.add(border);
      let spikes = null;
      if (tr.kind === 'spike') {
        const cols = Math.max(2, Math.round(w / 0.8)), rows = Math.round(l / 0.8);
        spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 0.7, 6).translate(0, 0.35, 0), metal(0xb8c0ff, { emissive: 0xff2244, emissiveIntensity: 0.4 }), cols * rows);
        const m = new THREE.Matrix4();
        let k = 0;
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
          m.makeTranslation(-w / 2 + (i + 0.5) * (w / cols), 0, -l / 2 + (j + 0.5) * (l / rows));
          spikes.setMatrixAt(k++, m);
        }
        grp.add(spikes);
      }
      D.add(grp);
      return { tr, grp, plate, spikes, last: 'off' };
    });

    // Pistons.
    this.pistonViews = course.pistons.map((p) => {
      const grp = new THREE.Group();
      grp.position.set(0, 0, p.z);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 2.2), metal(0x23264a));
      housing.position.set(p.side * 9.0, 1.1, 0);
      grp.add(housing);
      const warn = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.2, 2.25), neon('#ff3355', 2, { unique: true }));
      warn.position.set(p.side * 9.0, 2.25, 0);
      grp.add(warn);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1, 0.35, 0.35), metal(0x8890b8));
      grp.add(arm);
      const headMat = new THREE.MeshStandardMaterial({ map: getHazardTex(), emissive: 0xffffff, emissiveMap: getHazardTex(), emissiveIntensity: 0.6 });
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, OBST.PISTON_DEPTH), headMat);
      head.position.y = 0.95;
      grp.add(head);
      D.add(grp);
      return { p, arm, head, warn, lastExt: 0 };
    });

    // Pools for balls, blocks and their shadows.
    const ballTex = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#1a0010';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      for (let x = 0; x <= w; x += 32) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      for (let y = 16; y < h; y += 32) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
    });
    const ballCols = ['#ff2bd6', '#ff6a00', '#ff3355', '#ffcf33'];
    const ballMats = ballCols.map((c) => new THREE.MeshBasicMaterial({ map: ballTex, color: new THREE.Color(c).multiplyScalar(1.8) }));
    const ballGeo = new THREE.SphereGeometry(1, 24, 16);
    const shadowGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
    this.ballPool = [];
    for (let i = 0; i < 64; i++) {
      const mesh = new THREE.Mesh(ballGeo, ballMats[i % ballMats.length]);
      const core = new THREE.Mesh(ballGeo, neon(ballCols[i % ballCols.length], 1.2, { transparent: true, opacity: 0.25, depthWrite: false }));
      core.scale.setScalar(1.12);
      mesh.add(core);
      const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0xff2266, transparent: true, opacity: 0.3, depthWrite: false }));
      mesh.visible = shadow.visible = false;
      D.add(mesh, shadow);
      this.ballPool.push({ mesh, shadow, id: -1 });
    }
    const blockGeo = new THREE.BoxGeometry(OBST.BLOCK_SIZE, OBST.BLOCK_SIZE, OBST.BLOCK_SIZE);
    const edgeGeo = new THREE.EdgesGeometry(blockGeo);
    this.blockPool = [];
    for (let i = 0; i < 20; i++) {
      const mesh = new THREE.Mesh(blockGeo, metal(0x1b1f3a, { transparent: true, opacity: 1 }));
      const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(2.5, 0.3, 0.5) }));
      mesh.add(edges);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(OBST.BLOCK_SIZE, OBST.BLOCK_SIZE).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.4, depthWrite: false }));
      mesh.visible = shadow.visible = false;
      D.add(mesh, shadow);
      this.blockPool.push({ mesh, shadow, id: -1 });
    }
    this.soundEvents = [];
  }

  resetFinishClock() {
    const fc = this.finishClock;
    fc.broken = false;
    fc.group.visible = true;
    fc.group.scale.setScalar(1);
  }

  breakFinishClock(fx) {
    const fc = this.finishClock;
    if (fc.broken) return;
    fc.broken = true;
    const p = fc.group.getWorldPosition(new THREE.Vector3());
    fx.burst(p, '#ffcf33', { count: 260, speed: 14, size: 0.5, life: 2.6, gravity: 9, up: 3, spread: 6 });
    fx.burst(p, '#ffffff', { count: 120, speed: 10, size: 0.3, life: 2, gravity: 9, up: 2, spread: 5 });
    fc.group.visible = false;
  }

  setClockText(txt, frac) {
    const fc = this.finishClock;
    if (fc.broken) return;
    fc.digits.setText(txt);
    fc.hand.rotation.z = -frac * Math.PI * 2;
  }

  // ------------------------------------------------------- hidden area

  addLedge(L) {
    this.removeLedge();
    const g = new THREE.Group();
    const s = L.side;
    const w = L.xout - L.xin;
    const len = L.z1 - L.z0;
    const cx = s * (L.xin + w / 2);
    const cz = (L.z0 + L.z1) / 2;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, len), metal(0x15182c));
    floor.position.set(cx, L.y - 0.2, cz);
    g.add(floor);
    const grate = canvasTex(64, 64, (c, W, H) => {
      c.fillStyle = '#0c0e1c';
      c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(255,170,40,0.55)';
      c.lineWidth = 2;
      for (let i = 0; i < W; i += 8) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i, H);
        c.stroke();
      }
    });
    grate.wrapS = grate.wrapT = THREE.RepeatWrapping;
    grate.repeat.set(w / 2, len / 2);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(w, len), new THREE.MeshStandardMaterial({ map: grate, emissive: 0xffffff, emissiveMap: grate, emissiveIntensity: 0.6 }));
    top.rotation.x = -Math.PI / 2;
    top.position.set(cx, L.y + 0.01, cz);
    g.add(top);
    for (const edgeX of [L.xin, L.xout]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len), neon('#ffaa22', 2.2));
      e.position.set(s * edgeX, L.y + 0.05, cz);
      g.add(e);
    }
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, len), metal(0x262a48));
    lip.position.set(s * L.xout, L.y + 0.3, cz);
    g.add(lip);
    for (let z = L.z0 + 2; z < L.z1; z += 6) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.6), neon('#ffaa22', 2.5));
      lamp.position.set(s * 7, -DECK_T - 0.1, z);
      g.add(lamp);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), metal(0x30355a));
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(s * (6.3 + (z % 2)), -1.6, z + 3);
      g.add(pipe);
    }

    // The thing on the pedestal.
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.5, 20), metal(0x23274a));
    ped.position.set(s * 9.2, L.y + 0.25, L.skateZ);
    g.add(ped);
    const pedGlow = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.04, 8, 32), neon('#7df9ff', 3));
    pedGlow.rotation.x = Math.PI / 2;
    pedGlow.position.set(s * 9.2, L.y + 0.5, L.skateZ);
    g.add(pedGlow);
    const item = new THREE.Group();
    for (const ox of [-0.16, 0.16]) {
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.4), metal(0x1a1d36));
      boot.position.set(ox, 0.12, 0);
      item.add(boot);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.44), neon('#7df9ff', 2.6));
      deck.position.set(ox, 0.01, 0);
      item.add(deck);
      for (const oz of [-0.14, 0.14]) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 16), neon('#ffffff', 3));
        disc.position.set(ox, -0.03, oz);
        item.add(disc);
      }
    }
    item.position.set(s * 9.2, L.y + 0.85, L.skateZ);
    g.add(item);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 3.2, 20, 1, true), neon('#7df9ff', 1, { transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.set(s * 9.2, L.y + 1.9, L.skateZ);
    g.add(beam);

    // Launch pad.
    for (let k = 0; k < 4; k++) {
      const chev = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.04, 0.25), neon('#00ffa3', 2.6));
      chev.position.set(cx, L.y + 0.04, L.launchZ - 3 + k * 0.9);
      g.add(chev);
    }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 6, 24, 1, true), neon('#00ffa3', 1, { transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }));
    col.position.set(cx, L.y + 3, L.launchZ);
    g.add(col);

    this.group.add(g);
    this.ledge = { g, item, beam, pedGlow, L };
  }

  takeLedgeItem(fx) {
    if (!this.ledge || !this.ledge.item.visible) return;
    fx.burst(this.ledge.item.getWorldPosition(new THREE.Vector3()), '#7df9ff', { count: 50, speed: 4, size: 0.08, life: 0.8, gravity: 0, up: 1 });
    this.ledge.item.visible = false;
    this.ledge.beam.visible = false;
  }

  removeLedge() {
    if (!this.ledge) return;
    this.group.remove(this.ledge.g);
    disposeTree(this.ledge.g);
    this.ledge = null;
  }

  // ------------------------------------------------------- per frame

  update(dt, t, camZ, listenerZ = camZ) {
    this.time += dt;
    const time = this.time;
    if (!this.course) return;
    const course = this.course;
    const ev = (this.soundEvents = []);
    const near = (z, r = 30) => Math.abs(z - listenerZ) < r;

    // Rail panels near the camera.
    for (const rail of this.rails) {
      const lo = Math.max(0, Math.floor((camZ - 80) / PANEL_LEN));
      const hi = Math.min(rail.data.length - 1, Math.ceil((camZ + 220) / PANEL_LEN));
      const c = new THREE.Color();
      for (let i = lo; i <= hi; i++) {
        const d = rail.data[i];
        const k = 1.9 * (1 - d.amp * (0.5 + 0.5 * Math.sin(time * d.rate * Math.PI * 2 + d.ph)));
        c.copy(d.color).multiplyScalar(k);
        rail.mesh.setColorAt(i, c);
      }
      rail.mesh.instanceColor.needsUpdate = true;
    }

    // Crashes.
    for (const v of this.crashViews) {
      const s = crashState(v.c, t);
      if (s.phase === 'intact') {
        v.pivot.visible = true;
        v.pivot.position.y = 0;
        v.pivot.rotation.set(0, 0, 0);
        v.crack.material.opacity = 0;
      } else if (s.phase === 'warn') {
        v.pivot.visible = true;
        v.crack.material.opacity = Math.min(1, s.p * 1.4) * (0.6 + 0.4 * Math.sin(time * 40));
        v.pivot.position.y = Math.sin(time * 60) * 0.02 * s.p;
        if (!v.played.warn && near(v.c.z0, 40)) {
          v.played.warn = true;
          ev.push('crack');
        }
      } else if (s.phase === 'fall') {
        const tt = s.p * OBST.CRASH_FALL;
        v.pivot.visible = true;
        v.pivot.position.y = -0.5 * 21 * tt * tt;
        v.pivot.rotation.set(v.spin.x * tt * 0.8, v.spin.y * tt * 0.5, v.spin.z * tt * 0.8);
        v.crack.material.opacity = 1;
        if (!v.played.fall && near(v.c.z0, 60)) {
          v.played.fall = true;
          ev.push('crash');
        }
      } else {
        v.pivot.visible = false;
      }
    }

    // Lasers.
    for (const v of this.gateViews) {
      v.beam.position.y = gateHeight(v.g, t);
      v.beam.children[1].material.opacity = 0.4 + 0.25 * Math.sin(time * 25 + v.g.z);
    }

    // Traps.
    for (const v of this.trapViews) {
      const s = trapState(v.tr, t);
      const pm = v.plate.material;
      if (s === 'on') {
        if (v.tr.kind === 'shock') pm.color.setRGB(0.6 + Math.random() * 1.8, 1.4 + Math.random(), 2.5);
        else pm.color.setRGB(2.2, 0.15, 0.25);
      } else if (s === 'warn') {
        const f = 0.5 + 0.5 * Math.sin(time * 30);
        pm.color.setRGB(1.6 * f + 0.2, 1.2 * f + 0.1, 0.05);
      } else pm.color.setRGB(0.07, 0.07, 0.12);
      if (v.spikes) {
        const target = s === 'on' ? 1 : s === 'warn' ? 0.15 : 0.02;
        v.spikes.scale.y += (target - v.spikes.scale.y) * Math.min(1, dt * 30);
      }
      if (s === 'on' && v.last !== 'on' && near(v.tr.z0, 14)) ev.push(v.tr.kind === 'shock' ? 'zap' : 'piston');
      v.last = s;
    }

    // Pistons.
    for (const v of this.pistonViews) {
      const { ext, windup } = pistonExt(v.p, t);
      const s = v.p.side;
      const front = HALF_W - ext;
      v.head.position.x = s * (front + 0.25);
      const armLen = Math.max(0.05, 8.6 - front);
      v.arm.scale.x = armLen;
      v.arm.position.set(s * (front + armLen / 2), 0.95, 0);
      v.warn.material.color.setRGB(windup || ext > 0.1 ? 3 : 0.4, windup || ext > 0.1 ? 0.3 : 0.05, 0.3);
      if (ext > 0.5 && v.lastExt <= 0.5 && near(v.p.z, 18)) ev.push('piston');
      v.lastExt = ext;
    }

    // Balls.
    let bi = 0;
    for (const b of course.balls) {
      if (b.ts - OBST.BALL_DROP > t) break;
      if (t > b.end + 0.8) continue;
      if (Math.abs(b.z0 - camZ) > 200 && Math.abs(b.z0 - b.v * (t - b.ts) - camZ) > 200) continue;
      const s = ballState(b, t);
      if (!s || bi >= this.ballPool.length) continue;
      const v = this.ballPool[bi++];
      v.mesh.visible = true;
      v.mesh.position.set(s.x, s.y, s.z);
      v.mesh.scale.setScalar(b.r * (s.phase === 'fade' ? Math.max(0.01, 1 - s.k) : 1));
      v.mesh.rotation.set(-s.roll, 0, 0);
      v.shadow.visible = s.phase === 'drop' || s.phase === 'roll';
      v.shadow.position.set(s.x, 0.02, s.z);
      v.shadow.scale.setScalar(b.r * (s.phase === 'drop' ? 0.6 + 0.6 * (1 - s.k) : 1.05));
      v.shadow.material.opacity = s.phase === 'drop' ? 0.25 + 0.4 * (1 - s.k) : 0.18;
      if (v.id !== b.id) {
        v.id = b.id;
        if (s.phase === 'drop' && near(b.z0, 30)) ev.push('whoosh');
      }
    }
    for (; bi < this.ballPool.length; bi++) {
      this.ballPool[bi].mesh.visible = false;
      this.ballPool[bi].shadow.visible = false;
      this.ballPool[bi].id = -1;
    }

    // Blocks.
    let ki = 0;
    for (const b of course.blocks) {
      const s = blockState(b, t);
      if (!s || ki >= this.blockPool.length) continue;
      const v = this.blockPool[ki++];
      v.mesh.visible = true;
      v.mesh.position.set(b.x, s.y, b.z);
      v.mesh.scale.setScalar(Math.max(0.01, s.scale));
      v.mesh.material.opacity = s.phase === 'fade' ? Math.max(0, 1 - s.k) : 1;
      v.shadow.visible = s.phase === 'drop';
      v.shadow.position.set(b.x, 0.025, b.z);
      v.shadow.material.opacity = s.phase === 'drop' ? 0.25 + 0.55 * (1 - s.k) * (0.7 + 0.3 * Math.sin(time * 40)) : 0;
      if (v.id !== b.id) v.id = b.id;
      if (s.phase === 'down' && !b._thud && near(b.z, 40)) {
        b._thud = true;
        ev.push('thud');
      }
    }
    for (; ki < this.blockPool.length; ki++) {
      this.blockPool[ki].mesh.visible = false;
      this.blockPool[ki].shadow.visible = false;
    }

    // Crowd bounce.
    for (const side of this.crowd) {
      const m = new THREE.Matrix4();
      const n = side.base.length;
      for (let k = 0; k < 60; k++) {
        const i = Math.floor(Math.random() * n);
        const [x, y, z, ph, jumper] = side.base[i];
        const hop = jumper ? Math.max(0, Math.sin(time * 7 + ph)) * 0.45 : 0;
        m.makeTranslation(x, y + hop, z);
        side.mesh.setMatrixAt(i, m);
      }
      side.mesh.instanceMatrix.needsUpdate = true;
    }

    if (this.ledge) {
      this.ledge.item.rotation.y += dt * 1.5;
      this.ledge.item.position.y = this.ledge.L.y + 0.85 + Math.sin(time * 2.5) * 0.08;
    }
  }
}
