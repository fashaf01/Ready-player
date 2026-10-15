// The world around everything: painted sky and sun, stars, the megacity far
// below, flying traffic, giant holo rings and floating billboards.

import * as THREE from 'three';
import { canvasTex, neon, textPlane, rand, toon } from './common.js';

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
    // A painted anime sunset: violet zenith, hot pink horizon, a striped sun
    // at the far end of the track and cel-shaded clouds lit from below.
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
            vec3 sunDir = normalize(vec3(0.0, 0.06, 1.0));
            float sd = max(dot(d, sunDir), 0.0);

            vec3 zen = vec3(0.03, 0.012, 0.11);
            vec3 mid = vec3(0.17, 0.04, 0.34);
            vec3 hor = vec3(1.05, 0.26, 0.46);
            vec3 low = vec3(0.06, 0.012, 0.14);
            vec3 c = h > 0.0 ? mix(mid, zen, smoothstep(0.0, 0.55, h)) : mix(mid, low, smoothstep(0.0, 0.22, -h));
            c = mix(c, hor, exp(-abs(h) * 8.0) * (0.35 + 0.65 * pow(sd, 3.0)));
            c += vec3(1.0, 0.42, 0.22) * pow(sd, 30.0) * 0.45 + vec3(0.9, 0.25, 0.5) * pow(sd, 6.0) * 0.22;

            // Sun disc: warm top, pink bottom, the lower half sliced by bands.
            float R = 0.15;
            float disc = smoothstep(cos(R) - 0.0006, cos(R), sd);
            float yy = (h - sunDir.y) / R;
            vec3 sunCol = mix(vec3(1.25, 0.18, 0.55), vec3(1.55, 1.05, 0.4), smoothstep(-0.9, 0.8, yy));
            float bands = yy < 0.15 ? step(0.38 + (0.15 - yy) * 0.25, fract(yy * 6.0 - uT * 0.12)) : 1.0;
            c = mix(c, sunCol, disc * bands);

            // Painted clouds on a layer above the city, flattened into 3 cel tones.
            if (h > -0.03) {
              vec2 uv = d.xz / (h + 0.12) * 0.9 + vec2(uT * 0.004, 0.0);
              float n = fbm(uv);
              float cover = smoothstep(0.5, 0.62, n) * smoothstep(-0.03, 0.05, h) * (1.0 - smoothstep(0.25, 0.7, h));
              float lit = fbm(uv - normalize(sunDir.xz + vec2(0.0001)) * 0.12) - n;
              float tone = floor(clamp(0.5 - lit * 7.0, 0.0, 1.0) * 3.0) / 2.0;
              float nearSun = pow(sd, 4.0);
              vec3 shade = vec3(0.16, 0.05, 0.3);
              vec3 midC = vec3(0.6, 0.15, 0.5);
              vec3 rim = mix(vec3(1.1, 0.42, 0.62), vec3(1.9, 0.95, 0.55), nearSun);
              vec3 cc = tone < 0.25 ? shade : tone < 0.75 ? midC : rim;
              // Thin bright edge where the cloud meets the sky.
              cc = mix(cc, rim * 1.1, smoothstep(0.5, 0.53, n) * (1.0 - smoothstep(0.53, 0.56, n)) * 0.8);
              c = mix(c, cc, cover * 0.92);
            }

            // Long painted streaks across the horizon.
            float streak = smoothstep(0.55, 0.9, noise(vec2(atan(d.x, d.z) * 3.0, h * 90.0))) * exp(-abs(h - 0.1) * 18.0);
            c += vec3(1.0, 0.45, 0.6) * streak * 0.18;
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    sky.renderOrder = -10;
    this.sky = sky;
    this.group.add(sky);

    // Stars (big enough to survive the paint filter).
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(rand(0.3, 1));
      const r = 2800;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffe6ff, size: 2.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
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
    const mat = toon({ color: 0x1c1440, emissive: 0xffffff, emissiveMap: windows, emissiveIntensity: 1.4 });
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
    this.sky.material.uniforms.uT.value = t;
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
