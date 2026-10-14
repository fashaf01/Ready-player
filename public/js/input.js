// Keyboard and mouse state.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.mdx = 0;
    this.mdy = 0;
    this.locked = false;
    this.enabled = true;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mdx += e.movementX;
      this.mdy += e.movementY;
    });
    canvas.addEventListener('click', () => this.lock());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if (!this.enabled || this.locked) return;
    const p = this.canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  key(...codes) {
    return codes.some((c) => this.down.has(c));
  }

  hit(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  takeMouse() {
    const d = [this.mdx, this.mdy];
    this.mdx = 0;
    this.mdy = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
  }
}
