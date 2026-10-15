import * as THREE from 'three';
import { PaintPipeline } from './paint.js';

export function createRenderer(container) {
  // No MSAA: the paint pipeline renders into its own targets and the ink
  // pass draws the edges anyway.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  // Tone mapping and colour space happen in the paint pipeline's grade pass.
  renderer.toneMapping = THREE.NoToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7cc8ff);
  scene.fog = new THREE.FogExp2(0x9fd6ff, 0.0016);

  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 4000);
  const paint = new PaintPipeline(renderer, scene, camera);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    paint.setSize(innerWidth, innerHeight);
  });

  // Sunny anime lighting: a sky-blue fill (so shadows go cool blue) and one
  // warm high sun that the toon materials split into hard light/shadow bands.
  const hemi = new THREE.HemisphereLight(0x8fc8ff, 0xd9b48a, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.9);
  sun.position.set(-50, 90, -40);
  scene.add(sun);

  return { renderer, scene, camera, paint };
}

// Three hard light bands for cel shading.
const TOON_RAMP = (() => {
  const t = new THREE.DataTexture(new Uint8Array([70, 150, 230, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

// Shared rim light: a hard anime edge highlight on curved surfaces.
const RIM = { color: { value: new THREE.Color(1.0, 0.95, 0.85) }, strength: { value: 0.3 } };

function addRim(shader) {
  shader.uniforms.rimColor = RIM.color;
  shader.uniforms.rimStrength = RIM.strength;
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform vec3 rimColor;\nuniform float rimStrength;\nvoid main() {')
    .replace(
      '#include <opaque_fragment>',
      `float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      outgoingLight += rimColor * smoothstep(0.62, 0.7, rimF) * rimStrength * diffuseColor.rgb * 2.5;
      #include <opaque_fragment>`,
    );
}

// Cel-shaded material. Accepts (and ignores) PBR-only options so old call
// sites keep working.
export function toon(opts = {}) {
  const { metalness, roughness, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ gradientMap: TOON_RAMP, ...rest });
  m.onBeforeCompile = addRim;
  m.customProgramCacheKey = () => 'toon-rim';
  return m;
}

const neonCache = new Map();
// Bright unlit material that blooms.
export function neon(color, boost = 1.6, opts = {}) {
  const { unique, ...rest } = opts;
  const key = `${color}|${boost}|${JSON.stringify(rest)}`;
  if (!unique && neonCache.has(key)) return neonCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost), ...rest });
  if (!unique) {
    m.userData.shared = true;
    neonCache.set(key, m);
  }
  return m;
}

export function metal(color = 0x12142a, opts = {}) {
  return toon({ color, ...opts });
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A flat sign with text. Call .setText() to change it.
export function textPlane(text, { w = 4, h = 1, px = 256, color = '#00e5ff', font = '900 {S}px Orbitron, sans-serif', glow = 18, bg = null, align = 'center', boost = 1.5, lines = null } = {}) {
  const cw = Math.round(px * (w / h));
  const ch = px;
  const c = document.createElement('canvas');
  c.width = Math.min(4096, cw);
  c.height = ch;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  mat.color.setScalar(boost);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  let current = null;
  mesh.setText = (t, col = color) => {
    const key = `${t}|${col}`;
    if (key === current) return;
    current = key;
    g.clearRect(0, 0, c.width, c.height);
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, c.width, c.height);
    }
    const rows = lines ? String(t).split('\n') : [String(t)];
    const size = Math.floor((c.height * 0.72) / rows.length);
    g.font = font.replace('{S}', size);
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillStyle = col;
    g.shadowColor = col;
    g.shadowBlur = glow;
    const x = align === 'center' ? c.width / 2 : align === 'left' ? c.height * 0.1 : c.width - c.height * 0.1;
    rows.forEach((row, i) => g.fillText(row, x, (c.height / rows.length) * (i + 0.5)));
    tex.needsUpdate = true;
  };
  mesh.setText(text);
  mesh.canvas = c;
  mesh.ctx = g;
  mesh.tex = tex;
  return mesh;
}

// Name tag that always faces the camera.
export function nameSprite(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.font = '700 54px Rajdhani, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = Math.min(496, g.measureText(text).width + 40);
  g.fillStyle = '#16161d';
  g.fillRect((512 - w) / 2 - 3, 11, w + 6, 74);
  g.fillStyle = '#fffaf0';
  g.fillRect((512 - w) / 2, 14, w, 68);
  g.fillStyle = color;
  g.fillRect((512 - w) / 2, 72, w, 10);
  g.fillStyle = '#16161d';
  g.fillText(text, 256, 46);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, toneMapped: false }));
  s.scale.set(2.4, 0.45, 1);
  s.renderOrder = 10;
  return s;
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.userData.shared) continue;
        if (m.map && !m.map.userData?.shared) m.map.dispose();
        m.dispose();
      }
    }
  });
}

export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

// Joins geometries into one (non-indexed position/normal/uv only).
export function mergeGeometries(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of parts) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

// A palm tree about 9 m tall: a curved ringed trunk and drooping fronds.
let palmGeos = null;
function getPalmGeos() {
  if (palmGeos) return palmGeos;
  const trunk = [];
  const curve = (y) => 0.035 * y * y;
  const H = 8.4, SEG = 7;
  for (let i = 0; i < SEG; i++) {
    const y0 = (i / SEG) * H, y1 = ((i + 1) / SEG) * H;
    const r0 = 0.26 - i * 0.015;
    const seg = new THREE.CylinderGeometry(r0 - 0.03, r0, y1 - y0 + 0.05, 9);
    const lean = Math.atan2(curve(y1) - curve(y0), y1 - y0);
    seg.rotateZ(-lean);
    seg.translate((curve(y0) + curve(y1)) / 2, (y0 + y1) / 2, 0);
    trunk.push(seg);
  }
  const topX = curve(H);
  const fronds = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const leaf = new THREE.PlaneGeometry(1.1, 4.4, 1, 10);
    const pos = leaf.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const t = (pos.getY(k) + 2.2) / 4.4; // 0 at the crown, 1 at the tip
      const w = Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.35);
      pos.setX(k, pos.getX(k) * w);
      // Lay it outward along +z and let it droop.
      pos.setZ(k, t * 4.2);
      pos.setY(k, 0.9 * t - 2.1 * t * t + Math.abs(pos.getX(k)) * 0.25);
    }
    leaf.computeVertexNormals();
    leaf.rotateY((i / N) * Math.PI * 2 + (i % 2) * 0.2);
    leaf.translate(topX, H, 0);
    fronds.push(leaf);
  }
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.SphereGeometry(0.17, 8, 6);
    const a = (i / 3) * Math.PI * 2;
    nut.translate(topX + Math.cos(a) * 0.22, H - 0.25, Math.sin(a) * 0.22);
    trunk.push(nut);
  }
  palmGeos = { trunk: mergeGeometries(trunk), fronds: mergeGeometries(fronds) };
  return palmGeos;
}

// Instanced palms. spots: [{ x, y, z, s = 1, ry = random }]
export function palms(spots) {
  const { trunk, fronds } = getPalmGeos();
  const g = new THREE.Group();
  const tm = new THREE.InstancedMesh(trunk, toon({ color: 0xa8784c }), spots.length);
  const fm = new THREE.InstancedMesh(fronds, toon({ color: 0xffffff, side: THREE.DoubleSide }), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  spots.forEach((p, i) => {
    const s = p.s ?? 1;
    q.setFromAxisAngle(up, p.ry ?? Math.random() * Math.PI * 2);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(s, s, s));
    tm.setMatrixAt(i, m);
    fm.setMatrixAt(i, m);
    fm.setColorAt(i, col.setHSL(0.3 + Math.random() * 0.05, 0.62, 0.42 + Math.random() * 0.1));
  });
  tm.frustumCulled = fm.frustumCulled = false;
  g.add(tm, fm);
  return g;
}
