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
  scene.background = new THREE.Color(0x0a0320);
  scene.fog = new THREE.FogExp2(0x2a0c46, 0.0036);

  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 4000);
  const paint = new PaintPipeline(renderer, scene, camera);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    paint.setSize(innerWidth, innerHeight);
  });

  // Anime lighting: a cool violet fill, and one warm key light from the
  // sunset that the toon materials split into hard light/shadow bands.
  const hemi = new THREE.HemisphereLight(0x7a5cff, 0x2a0838, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb59a, 1.7);
  sun.position.set(-60, 70, -50);
  scene.add(sun);

  return { renderer, scene, camera, paint };
}

// Three hard light bands for cel shading.
const TOON_RAMP = (() => {
  const t = new THREE.DataTexture(new Uint8Array([46, 120, 205, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

// Shared rim light: a hard anime edge highlight on curved surfaces.
const RIM = { color: { value: new THREE.Color(1.0, 0.42, 0.85) }, strength: { value: 0.55 } };

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
  const w = Math.min(500, g.measureText(text).width + 40);
  g.fillStyle = 'rgba(5,2,20,0.55)';
  g.fillRect((512 - w) / 2, 14, w, 68);
  g.fillStyle = color;
  g.fillRect((512 - w) / 2, 78, w, 4);
  g.fillStyle = '#ffffff';
  g.fillText(text, 256, 49);
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
