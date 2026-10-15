// The world around everything: a sunny anime sky with big painted clouds, a
// pastel beach city far below with palm trees and the sea, flying traffic,
// seagulls and billboards.

import * as THREE from 'three';
import { canvasTex, textPlane, rand, toon, palms } from './common.js';

const GROUND_Y = -140;
const SHORE_X = 380;

export class Environment {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.buildSky();
    this.buildCity();
    this.buildTraffic();
    this.buildBirds();
    this.buildBillboards();
  }

  buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uT: { value: 0 } },
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; uniform float uT;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p){
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          float fbm(vec2 p){
            float s = 0.0, a = 0.5;
            for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
            return s;
          }
          void main(){
            vec3 d = normalize(vP);
            float h = d.y;
            vec3 sunDir = normalize(vec3(-0.45, 0.55, 0.7));
            float sd = max(dot(d, sunDir), 0.0);

            vec3 zen = vec3(0.03, 0.17, 0.72);
            vec3 mid = vec3(0.09, 0.38, 0.95);
            vec3 hor = vec3(0.5, 0.78, 1.0);
            vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h));
            c = mix(c, zen, smoothstep(0.2, 0.8, h));
            if (h < 0.0) c = mix(hor, vec3(0.55, 0.76, 0.95), smoothstep(0.0, 0.25, -h));
            c += vec3(1.0, 0.92, 0.75) * (pow(sd, 10.0) * 0.2 + pow(sd, 220.0) * 0.8);
            c = mix(c, vec3(1.7, 1.6, 1.35), smoothstep(cos(0.045), cos(0.04), sd));

            vec3 cw = vec3(1.03, 1.02, 1.0);
            vec3 cm = vec3(0.80, 0.87, 0.99);
            vec3 cs = vec3(0.58, 0.69, 0.92);

            // A bank of towering cumulus on the horizon.
            float u = atan(d.x, d.z);
            float top = 0.04 + 0.22 * fbm(vec2(u * 2.2 + 3.0, 1.3)) * smoothstep(0.25, 0.65, fbm(vec2(u * 0.8, 7.0)));
            float bank = smoothstep(top, top - 0.004, h) * smoothstep(-0.06, -0.01, h);
            float puff = fbm(vec2(u * 10.0, h * 34.0) + 4.0);
            float inside = clamp((top - h) / max(top, 0.01), 0.0, 1.0);
            float lb = 1.0 - inside * 1.5 + (puff - 0.5) * 1.1 + pow(sd, 3.0) * 0.5;
            vec3 bankCol = lb > 0.55 ? cw : lb > 0.15 ? cm : cs;
            c = mix(c, bankCol, bank);

            // Big puffy clouds drifting overhead.
            if (h > 0.0) {
              vec2 uv = d.xz / (h + 0.15) * 0.55 + vec2(uT * 0.004, 0.0);
              float n = fbm(uv);
              float cover = smoothstep(0.53, 0.555, n) * smoothstep(0.03, 0.12, h) * (1.0 - smoothstep(0.55, 0.85, h));
              float lit = n - fbm(uv + normalize(sunDir.xz) * 0.09);
              vec3 cc = lit > 0.015 ? cw : lit > -0.035 ? cm : cs;
              cc = mix(cc, cw * 1.06, smoothstep(0.53, 0.54, n) * (1.0 - smoothstep(0.54, 0.555, n)) * 0.6);
              c = mix(c, cc, cover);
            }
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    sky.renderOrder = -10;
    this.sky = sky;
    this.group.add(sky);
  }

  buildCity() {
    // Pastel towers with blue glass windows.
    const windows = canvasTex(64, 256, (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      for (let y = 4; y < h; y += 16) {
        g.fillStyle = 'rgba(70,110,170,0.9)';
        for (let x = 4; x < w - 4; x += 12) g.fillRect(x, y, 8, 9);
        g.fillStyle = 'rgba(255,255,255,0.55)';
        for (let x = 4; x < w - 4; x += 12) g.fillRect(x, y, 3, 9);
      }
    });
    windows.wrapS = windows.wrapT = THREE.RepeatWrapping;
    windows.repeat.set(2, 3);
    const mat = toon({ color: 0xffffff, map: windows });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const count = 900;
    const city = new THREE.InstancedMesh(geo, mat, count);
    const roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), toon({ color: 0xffffff }), count);
    const pastel = ['#fff6ea', '#ffd9c2', '#cfe8ff', '#ffe7a3', '#d7f0dd', '#f8cfe0', '#e6dcff', '#ffffff', '#ffe0b8', '#c9f1f0'];
    const roofCols = ['#ff8a5c', '#3fa0ff', '#ffffff', '#7a4dff', '#ffd23f', '#2bbf8a'];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    let i = 0;
    while (i < count) {
      const x = rand(-1100, SHORE_X - 40);
      const z = rand(-900, 1900);
      const nearTrack = Math.abs(x) < 70 && z > -120 && z < 520;
      const nearHall = Math.hypot(x, z) < 90;
      if (nearHall && Math.random() < 0.9) continue;
      const tall = !nearTrack && Math.abs(x) < 450 && Math.random() < 0.2;
      const top = tall ? rand(-20, 110) : nearTrack ? rand(-120, -70) : rand(-120, -30);
      const w = rand(14, tall ? 30 : 42);
      const d = rand(14, tall ? 30 : 42);
      const rot = q.setFromAxisAngle(up, Math.random() < 0.3 ? rand(0, 1) : 0);
      m.compose(new THREE.Vector3(x, GROUND_Y, z), rot, new THREE.Vector3(w, top - GROUND_Y, d));
      city.setMatrixAt(i, m);
      city.setColorAt(i, c.set(pastel[Math.floor(Math.random() * pastel.length)]));
      m.compose(new THREE.Vector3(x, top, z), rot, new THREE.Vector3(w + 1.2, 1.4, d + 1.2));
      roofs.setMatrixAt(i, m);
      roofs.setColorAt(i, c.set(roofCols[Math.floor(Math.random() * roofCols.length)]));
      i++;
    }
    city.frustumCulled = roofs.frustumCulled = false;
    this.group.add(city, roofs);

    // Streets, the beach and the sea.
    const streets = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#efe3c8';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#9aa3ad';
      g.fillRect(0, 0, w, 22);
      g.fillRect(0, 0, 22, h);
      g.fillStyle = '#ffffff';
      for (let k = 30; k < w; k += 24) g.fillRect(k, 10, 12, 2);
      g.fillStyle = '#7fcf7a';
      g.fillRect(60, 60, 60, 60);
    });
    streets.wrapS = streets.wrapT = THREE.RepeatWrapping;
    streets.repeat.set(24, 30);
    const land = new THREE.Mesh(new THREE.PlaneGeometry(1600, 3200), toon({ map: streets }));
    land.rotation.x = -Math.PI / 2;
    land.position.set(SHORE_X - 800, GROUND_Y, 500);
    this.group.add(land);
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(60, 3200), toon({ color: 0xf6e2b0 }));
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(SHORE_X + 30, GROUND_Y + 0.2, 500);
    this.group.add(beach);
    const waves = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#2a9be6';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 3;
      for (let k = 0; k < 40; k++) {
        const x = Math.random() * w, y = Math.random() * h;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + 10, y - 4, x + 22, y);
        g.stroke();
      }
    });
    waves.wrapS = waves.wrapT = THREE.RepeatWrapping;
    waves.repeat.set(30, 60);
    this.waves = waves;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3200), toon({ map: waves }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(SHORE_X + 60 + 1500, GROUND_Y - 0.5, 500);
    this.group.add(sea);
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(6, 3200), toon({ color: 0xffffff }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(SHORE_X + 61, GROUND_Y - 0.3, 500);
    this.group.add(foam);

    // Palms along the beach and dotted through the city.
    const spots = [];
    for (let z = -900; z < 1900; z += rand(14, 30)) spots.push({ x: SHORE_X + rand(5, 50), y: GROUND_Y, z, s: rand(1.6, 2.4) });
    for (let k = 0; k < 160; k++) spots.push({ x: rand(-900, SHORE_X - 20), y: GROUND_Y, z: rand(-700, 1700), s: rand(1.6, 2.4) });
    this.group.add(palms(spots));
  }

  buildTraffic() {
    const n = 70;
    const geo = new THREE.CapsuleGeometry(0.9, 2.6, 4, 8).rotateX(Math.PI / 2);
    const mat = toon({ color: 0xffffff });
    this.traffic = new THREE.InstancedMesh(geo, mat, n);
    this.traffic.frustumCulled = false;
    this.cars = [];
    const cols = ['#ff4f5e', '#ffd23f', '#3fa0ff', '#ffffff', '#ff8a2a', '#2bbf8a', '#7a4dff'];
    for (let i = 0; i < n; i++) {
      const alongZ = Math.random() < 0.5;
      this.cars.push({
        alongZ,
        dir: Math.random() < 0.5 ? -1 : 1,
        speed: rand(25, 60),
        off: rand(0, 3000),
        a: alongZ ? (Math.random() < 0.5 ? -1 : 1) * rand(90, 360) : rand(-600, 1400),
        y: rand(-110, 40),
      });
      this.traffic.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    }
    this.group.add(this.traffic);
  }

  buildBirds() {
    // Seagulls: little white V shapes circling in the sky.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.9, 0.25, -0.2, -0.3, 0.05, 0.1, 0, 0, 0, 0.3, 0.05, 0.1, 0.9, 0.25, -0.2], 3));
    g.computeVertexNormals();
    this.birds = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), 26);
    this.birds.frustumCulled = false;
    this.flock = [];
    for (let i = 0; i < 26; i++) {
      this.flock.push({ cx: rand(-80, 80), cz: rand(-40, 420), r: rand(15, 60), y: rand(18, 55), w: rand(0.15, 0.35) * (Math.random() < 0.5 ? -1 : 1), ph: rand(0, 6.28), s: rand(1.2, 2) });
    }
    this.group.add(this.birds);
  }

  buildBillboards() {
    const ads = [
      ['THE HUNT', '#ff7a1a', [-70, 34, 140], 0.5],
      ['SUN COLA', '#ff4f9a', [72, 28, 230], -0.5],
      ['BEACH FM 88.8', '#2a6df4', [-80, 40, 330], 0.6],
      ['THREE GATES · ONE KEY', '#7a4dff', [76, 44, 420], -0.6],
      ['NO ONE HAS BEATEN TIME', '#e8343f', [-60, 30, 40], 0.4],
      ['GATE I IS OPEN', '#14a37f', [-95, 52, 470], 0.7],
      ['HOVERWAY 9 · CLOSED', '#ff7a1a', [90, 22, 60], -0.8],
    ];
    for (const [txt, col, p, ry] of ads) {
      const w = Math.max(24, txt.length * 2.4);
      const sign = textPlane(txt, { w, h: 7, px: 160, color: col, bg: '#fffaf0', boost: 1, glow: 0, font: '400 {S}px "Dela Gothic One", Orbitron, sans-serif' });
      sign.material.transparent = false;
      sign.material.depthWrite = true;
      sign.position.set(...p);
      sign.rotation.y = Math.PI + ry;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 1.4, 8.4, 0.6), toon({ color: 0x1b1b22 }));
      frame.position.z = -0.35;
      sign.add(frame);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 60, 0.8), toon({ color: 0xe9e4da }));
      leg.position.set(0, -34, -0.4);
      sign.add(leg);
      this.group.add(sign);
    }
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.sky.material.uniforms.uT.value = t;
    this.waves.offset.x = (t * 0.01) % 1;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const d = (((c.off + t * c.speed * c.dir) % 3000) + 3000) % 3000 - 1500;
      if (c.alongZ) {
        p.set(c.a, c.y, d + 400);
        q.identity();
      } else {
        p.set(d, c.y, c.a);
        q.setFromAxisAngle(up, Math.PI / 2);
      }
      m.compose(p, q, s);
      this.traffic.setMatrixAt(i, m);
    }
    this.traffic.instanceMatrix.needsUpdate = true;
    const bs = new THREE.Vector3();
    for (let i = 0; i < this.flock.length; i++) {
      const b = this.flock[i];
      const a = b.ph + t * b.w;
      p.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(t * 0.7 + b.ph) * 2, b.cz + Math.sin(a) * b.r);
      q.setFromAxisAngle(up, -a + (b.w > 0 ? 0 : Math.PI));
      const flap = 0.6 + 0.4 * Math.sin(t * 9 + b.ph * 3);
      bs.set(b.s, b.s * flap, b.s);
      m.compose(p, q, bs);
      this.birds.setMatrixAt(i, m);
    }
    this.birds.instanceMatrix.needsUpdate = true;
  }
}
