// The "anime oil painting" look, as a small post-processing chain:
//
//   scene ──► paint (Kuwahara: flattens detail into brush-like patches)
//         ──► ink   (dark outlines from depth + colour edges, fade with distance)
//         ──► bloom (soft neon glow)
//         ──► grade (anime colour grade, cel bands, canvas texture, vignette,
//                    hit flashes, tone mapping) ──► screen
//
// Quality: 'high' = everything, 'medium' = no paint pass, 'low' = no paint
// and a lower resolution. It drops a level by itself if the frame rate sinks.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PAINT_FRAG = `
uniform sampler2D tDiffuse;
uniform sampler2D tCanvas;
uniform vec2 resolution;
uniform float stride;
varying vec2 vUv;

void quad(vec2 base, vec2 dir, inout vec3 bestMean, inout float bestVar) {
  vec3 m = vec3(0.0);
  vec3 s = vec3(0.0);
  for (int j = 0; j <= 2; j++) {
    for (int i = 0; i <= 2; i++) {
      vec3 c = texture2D(tDiffuse, base + vec2(float(i), float(j)) * dir).rgb;
      m += c;
      s += c * c;
    }
  }
  m /= 9.0;
  vec3 v = abs(s / 9.0 - m * m);
  float var = v.r + v.g + v.b;
  if (var < bestVar) { bestVar = var; bestMean = m; }
}

void main() {
  // Wobble the sampling with the canvas texture so patches look brushed.
  vec2 wob = (texture2D(tCanvas, vUv * 3.0).rg - 0.5) * 0.6;
  vec2 px = stride / resolution;
  vec2 uv = vUv + wob * px;
  vec3 best = vec3(0.0);
  float bestVar = 1e9;
  quad(uv, vec2(-px.x, -px.y), best, bestVar);
  quad(uv, vec2( px.x, -px.y), best, bestVar);
  quad(uv, vec2(-px.x,  px.y), best, bestVar);
  quad(uv, vec2( px.x,  px.y), best, bestVar);
  gl_FragColor = vec4(best, 1.0);
}`;

const INK_FRAG = `
#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float lineWidth;
varying vec2 vUv;

float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 px = lineWidth / resolution;
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  float z = viewZ(vUv);
  // Depth edges, relative to distance so far objects aren't all outline.
  float zl = viewZ(vUv - vec2(px.x, 0.0));
  float zr = viewZ(vUv + vec2(px.x, 0.0));
  float zd = viewZ(vUv - vec2(0.0, px.y));
  float zu = viewZ(vUv + vec2(0.0, px.y));
  float dEdge = (abs(zl + zr - 2.0 * z) + abs(zu + zd - 2.0 * z)) / max(z, 0.5);
  // Colour edges.
  float ll = luma(texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb);
  float lr = luma(texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb);
  float ld = luma(texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb);
  float lu = luma(texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb);
  float cEdge = length(vec2(lr - ll, lu - ld));
  float ink = max(smoothstep(0.06, 0.16, dEdge), smoothstep(0.22, 0.45, cEdge) * 0.55);
  // Lines fade into the distance like an atmospheric painting.
  ink *= 1.0 - smoothstep(60.0, 420.0, z);
  // Bright neon keeps its glow instead of being inked over.
  ink *= 1.0 - smoothstep(1.2, 2.4, luma(col));
  vec3 inkColor = vec3(0.045, 0.02, 0.09);
  gl_FragColor = vec4(mix(col, inkColor, ink * 0.85), 1.0);
}`;

const GRADE_FRAG = `
uniform sampler2D tDiffuse;
uniform sampler2D tCanvas;
uniform vec2 resolution;
uniform float exposure;
uniform float time;
uniform float flash;
uniform float bands;
varying vec2 vUv;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb * exposure;
  c = aces(c);
  // Anime grade: richer colour, cool violet shadows, warm peach highlights.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.22);
  c = mix(c, c * vec3(0.78, 0.82, 1.18) + vec3(0.03, 0.0, 0.06), (1.0 - smoothstep(0.0, 0.45, l)) * 0.6);
  c = mix(c, c * vec3(1.08, 0.98, 0.86), smoothstep(0.55, 1.0, l) * 0.5);
  // Soft cel bands.
  c = mix(c, floor(c * bands + 0.5) / bands, 0.28);
  // Canvas weave and brush grain.
  vec2 cuv = vUv * vec2(resolution.x / resolution.y, 1.0) * 2.2;
  vec3 canvas = texture2D(tCanvas, cuv).rgb;
  c *= 0.95 + 0.1 * canvas.b;
  c += (canvas.r - 0.5) * 0.035;
  // Vignette.
  vec2 v = vUv - 0.5;
  c *= 1.0 - dot(v, v) * 0.75;
  // Hit flash: a brief anime "impact frame".
  c = mix(c, vec3(1.0) - c * vec3(0.4, 0.9, 1.0), flash);
  gl_FragColor = vec4(toSRGB(clamp(c, 0.0, 1.0)), 1.0);
}`;

// Canvas texture: R = grain, G = brush direction wobble, B = weave.
function makeCanvasTexture() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const weave = 0.5 + 0.5 * Math.sin(x * 0.9) * Math.sin(y * 0.9);
      img.data[i] = 128 + (Math.random() - 0.5) * 120;
      img.data[i + 1] = 128;
      img.data[i + 2] = Math.max(0, Math.min(255, weave * 255));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Long diagonal brush strokes into the G channel.
  g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 900; k++) {
    const x = Math.random() * S, y = Math.random() * S;
    const len = 20 + Math.random() * 60;
    const a = -0.6 + (Math.random() - 0.5) * 0.5;
    g.strokeStyle = `rgba(0,${Math.floor(40 + Math.random() * 90)},0,0.35)`;
    g.lineWidth = 2 + Math.random() * 5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function target(w, h, depth = false) {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
  if (depth) rt.depthTexture = new THREE.DepthTexture(w, h);
  return rt;
}

export class PaintPipeline {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = 'high';
    this.flash = 0;
    this.time = 0;
    this.canvasTex = makeCanvasTexture();
    this.sceneRT = target(2, 2, true);
    this.rtA = target(2, 2);
    this.rtB = target(2, 2);

    this.paint = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, tCanvas: { value: this.canvasTex }, resolution: { value: new THREE.Vector2() }, stride: { value: 1.4 } },
        vertexShader: VERT,
        fragmentShader: PAINT_FRAG,
      }),
    );
    this.ink = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          tDepth: { value: null },
          resolution: { value: new THREE.Vector2() },
          cameraNear: { value: camera.near },
          cameraFar: { value: camera.far },
          lineWidth: { value: 1 },
        },
        vertexShader: VERT,
        fragmentShader: INK_FRAG,
      }),
    );
    this.grade = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          tCanvas: { value: this.canvasTex },
          resolution: { value: new THREE.Vector2() },
          exposure: { value: 1.05 },
          time: { value: 0 },
          flash: { value: 0 },
          bands: { value: 7 },
        },
        vertexShader: VERT,
        fragmentShader: GRADE_FRAG,
      }),
    );
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 0.9);

    this.fps = { frames: 0, time: 0, checks: 0 };
    this.setSize(innerWidth, innerHeight);
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio() * (this.quality === 'low' ? 0.7 : 1);
    const W = Math.max(2, Math.floor(w * pr));
    const H = Math.max(2, Math.floor(h * pr));
    this.sceneRT.setSize(W, H);
    this.sceneRT.depthTexture.image.width = W;
    this.sceneRT.depthTexture.image.height = H;
    this.rtA.setSize(W, H);
    this.rtB.setSize(W, H);
    this.bloom.setSize(Math.floor(W / 2), Math.floor(H / 2));
    for (const q of [this.paint, this.ink, this.grade]) q.material.uniforms.resolution.value.set(W, H);
    this.ink.material.uniforms.lineWidth.value = Math.max(1, H / 900);
    this.paint.material.uniforms.stride.value = Math.max(1, H / 760);
    this.size = [w, h];
  }

  setQuality(q) {
    this.quality = q;
    this.setSize(...this.size);
  }

  cycleQuality() {
    const order = ['high', 'medium', 'low'];
    this.setQuality(order[(order.indexOf(this.quality) + 1) % order.length]);
    this.fps.checks = 99; // the player chose; stop auto-adjusting
    return this.quality;
  }

  impact(strength = 0.55) {
    this.flash = Math.max(this.flash, strength);
  }

  // Drop quality if the machine can't keep up (checked a few times early on).
  watchFps(dt) {
    const f = this.fps;
    if (f.checks >= 3) return;
    f.frames++;
    f.time += dt;
    if (f.time < 2.5) return;
    const fps = f.frames / f.time;
    f.frames = 0;
    f.time = 0;
    f.checks++;
    if (fps < 38 && this.quality === 'high') this.setQuality('medium');
    else if (fps < 28 && this.quality === 'medium') this.setQuality('low');
  }

  render(dt) {
    const r = this.renderer;
    this.time += dt;
    this.watchFps(dt);
    this.flash = Math.max(0, this.flash - dt * 4);

    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(this.scene, this.camera);

    let src = this.sceneRT;
    if (this.quality === 'high') {
      this.paint.material.uniforms.tDiffuse.value = src.texture;
      r.setRenderTarget(this.rtA);
      this.paint.render(r);
      src = this.rtA;
    }

    const inkU = this.ink.material.uniforms;
    inkU.tDiffuse.value = src.texture;
    inkU.tDepth.value = this.sceneRT.depthTexture;
    inkU.cameraNear.value = this.camera.near;
    inkU.cameraFar.value = this.camera.far;
    const inkOut = src === this.rtA ? this.rtB : this.rtA;
    r.setRenderTarget(inkOut);
    this.ink.render(r);

    this.bloom.render(r, null, inkOut, dt, false);

    const gU = this.grade.material.uniforms;
    gU.tDiffuse.value = inkOut.texture;
    gU.time.value = this.time;
    gU.flash.value = this.flash;
    r.setRenderTarget(null);
    this.grade.render(r);
  }
}
