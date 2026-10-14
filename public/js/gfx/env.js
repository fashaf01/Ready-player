// The world around everything: sky, synth sun, stars, the megacity far
// below, flying traffic, giant holo rings and floating billboards.

import * as THREE from 'three';
import { canvasTex, neon, textPlane, rand } from './common.js';

export class Environment {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.buildSky();
    this.buildCity();
    this.buildTraffic();
    this.buildHolos();
  }

  buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {},
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP;
          void main(){
            float h = vP.y;
            vec3 top = vec3(0.012,0.004,0.05);
            vec3 mid = vec3(0.09,0.02,0.22);
            vec3 hor = vec3(0.55,0.06,0.42);
            vec3 low = vec3(0.04,0.01,0.10);
            vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0,0.6,h)) : mix(mid, low, smoothstep(0.0,0.3,-h));
            c = mix(c, hor, exp(-abs(h)*14.0)*0.9);
            gl_FragColor = vec4(c,1.0);
          }`,
      }),
    );
    sky.renderOrder = -10;
    this.group.add(sky);

    // Synth sun at the far end of the track.
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(420, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: { uT: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform float uT;
          void main(){
            float y = vUv.y;
            vec3 c = mix(vec3(0.75,0.05,0.42), vec3(0.95,0.6,0.12), smoothstep(0.1,0.9,y));
            float band = step(0.45, fract(y*16.0 - uT*0.3));
            float cut = y < 0.72 ? mix(band, 1.0, smoothstep(0.3, 0.72, y)) : 1.0;
            gl_FragColor = vec4(c, cut * 0.95);
          }`,
      }),
    );
    sun.position.set(0, 150, 2600);
    sun.rotation.y = Math.PI;
    this.sun = sun;
    this.group.add(sun);

    // Stars
    const n = 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(rand(0.05, 1));
      const r = 2800;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    this.group.add(stars);
  }

  buildCity() {
    const windows = canvasTex(64, 128, (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      const cols = ['#00e5ff', '#ff2bd6', '#ffcf33', '#8a5cff', '#ffffff'];
      for (let y = 4; y < h; y += 8) {
        for (let x = 3; x < w; x += 7) {
          if (Math.random() < 0.38) {
            g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
            g.globalAlpha = rand(0.35, 1);
            g.fillRect(x, y, 4, 4);
          }
        }
      }
      g.globalAlpha = 1;
    });
    windows.wrapS = windows.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({ color: 0x090a18, metalness: 0.6, roughness: 0.5, emissive: 0xffffff, emissiveMap: windows, emissiveIntensity: 1.4 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const count = 1100;
    const city = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let i = 0;
    while (i < count) {
      const x = rand(-1100, 1100);
      const z = rand(-900, 1900);
      const nearTrack = Math.abs(x) < 70 && z > -120 && z < 520;
      const nearHall = Math.hypot(x, z - 0) < 90;
      if (nearHall && Math.random() < 0.9) continue;
      const tall = !nearTrack && Math.abs(x) < 400 && Math.random() < 0.18;
      const base = -320;
      const top = tall ? rand(-40, 90) : nearTrack ? rand(-170, -90) : rand(-260, -80);
      const w = rand(14, tall ? 34 : 46);
      const d = rand(14, tall ? 34 : 46);
      m.compose(new THREE.Vector3(x, base, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() < 0.3 ? rand(0, 1) : 0), new THREE.Vector3(w, top - base, d));
      city.setMatrixAt(i++, m);
    }
    city.frustumCulled = false;
    this.group.add(city);

    // Streets glowing far below.
    const grid = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#040010';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ff2bd6';
      g.globalAlpha = 0.9;
      g.lineWidth = 3;
      for (let k = 0; k <= w; k += 64) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k, h);
        g.stroke();
        g.beginPath();
        g.moveTo(0, k);
        g.lineTo(w, k);
        g.stroke();
      }
    });
    grid.wrapS = grid.wrapT = THREE.RepeatWrapping;
    grid.repeat.set(40, 40);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshBasicMaterial({ map: grid, color: new THREE.Color(0.9, 0.9, 1) }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -320, 500);
    this.group.add(floor);
  }

  buildTraffic() {
    const n = 90;
    const geo = new THREE.BoxGeometry(0.9, 0.5, 4.2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.traffic = new THREE.InstancedMesh(geo, mat, n);
    this.traffic.frustumCulled = false;
    this.cars = [];
    const cols = [new THREE.Color(2, 0.2, 0.3), new THREE.Color(2, 2, 2.2), new THREE.Color(0.2, 1.6, 2), new THREE.Color(2, 0.4, 1.8)];
    for (let i = 0; i < n; i++) {
      const alongZ = Math.random() < 0.5;
      const lane = rand(-1, 1) > 0 ? 1 : -1;
      this.cars.push({
        alongZ,
        dir: lane,
        speed: rand(30, 80),
        off: rand(0, 3000),
        a: alongZ ? (Math.random() < 0.5 ? -1 : 1) * rand(90, 600) : rand(-600, 1400),
        y: rand(-140, 70),
      });
      this.traffic.setColorAt(i, cols[i % cols.length]);
    }
    this.group.add(this.traffic);
  }

  buildHolos() {
    this.rings = [];
    const ringSpecs = [
      { p: [-260, 120, 300], r: 90, c: '#00e5ff' },
      { p: [320, 90, 700], r: 120, c: '#ff2bd6' },
      { p: [0, 260, 1300], r: 200, c: '#8a5cff' },
      { p: [180, 60, -260], r: 70, c: '#ffcf33' },
    ];
    for (const s of ringSpecs) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(s.r, 1.4, 8, 96), neon(s.c, 1.4, { transparent: true, opacity: 0.8 }));
      ring.position.set(...s.p);
      ring.rotation.set(rand(0, 1), rand(0, 3), 0);
      this.group.add(ring);
      this.rings.push(ring);
    }
    const ads = [
      ['THE HUNT', '#00e5ff', [-70, 34, 140], 0.5],
      ['NEON COLA', '#ff2bd6', [72, 28, 230], -0.5],
      ['SYNTH FM 88.8', '#ffcf33', [-80, 40, 330], 0.6],
      ['THREE GATES · ONE KEY', '#8a5cff', [76, 44, 420], -0.6],
      ['NO ONE HAS BEATEN TIME', '#ff3355', [-60, 30, 40], 0.4],
      ['GATE I IS OPEN', '#00ffa3', [-95, 52, 470], 0.7],
      ['HOVERWAY 9 · CLOSED', '#ff6a00', [90, 22, 60], -0.8],
    ];
    for (const [txt, col, p, ry] of ads) {
      const w = Math.max(24, txt.length * 2.4);
      const sign = textPlane(txt, { w, h: 7, px: 160, color: col, bg: 'rgba(8,2,24,0.55)', boost: 1.4 });
      sign.position.set(...p);
      sign.rotation.y = Math.PI + ry;
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(w + 1, 8), neon(col, 1.2, { transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
      frame.position.z = 0.05;
      sign.add(frame);
      this.group.add(sign);
    }
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.sun.material.uniforms.uT.value = t;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const d = (((c.off + t * c.speed * c.dir) % 3000) + 3000) % 3000 - 1500;
      if (c.alongZ) {
        p.set(c.a, c.y, d + 400);
        q.identity();
      } else {
        p.set(d, c.y, c.a);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      }
      m.compose(p, q, s);
      this.traffic.setMatrixAt(i, m);
    }
    this.traffic.instanceMatrix.needsUpdate = true;
    for (const [i, r] of this.rings.entries()) r.rotation.z += dt * (0.05 + i * 0.02);
  }
}
