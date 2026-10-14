// Particle bursts: derezz cubes, sparks, shattering glass.

import * as THREE from 'three';

const MAX = 900;

export class Fx {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parts = [];
    this.free = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, new THREE.Color(0, 0, 0));
      this.free.push(i);
    }
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  burst(pos, color, { count = 60, speed = 5, size = 0.12, life = 1.2, gravity = 6, up = 2, spread = 1 } = {}) {
    const col = new THREE.Color(color).multiplyScalar(2.2);
    for (let i = 0; i < count && this.free.length; i++) {
      const id = this.free.pop();
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize();
      this.parts.push({
        id,
        p: new THREE.Vector3(pos.x + (Math.random() - 0.5) * 0.5 * spread, pos.y + Math.random() * 1.8 * spread, pos.z + (Math.random() - 0.5) * 0.5 * spread),
        v: dir.multiplyScalar(speed * (0.3 + Math.random())).add(new THREE.Vector3(0, up, 0)),
        r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        life,
        age: 0,
        size: size * (0.5 + Math.random()),
        g: gravity,
      });
      this.mesh.setColorAt(id, col);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const zero = this._s;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.mesh.setMatrixAt(p.id, this._m.makeScale(0, 0, 0));
        this.free.push(p.id);
        this.parts.splice(i, 1);
        continue;
      }
      p.v.y -= p.g * dt;
      p.p.addScaledVector(p.v, dt);
      const k = 1 - p.age / p.life;
      this._e.set(p.r.x * p.age, p.r.y * p.age, p.r.z * p.age);
      this._q.setFromEuler(this._e);
      zero.setScalar(p.size * k);
      this._m.compose(p.p, this._q, zero);
      this.mesh.setMatrixAt(p.id, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
