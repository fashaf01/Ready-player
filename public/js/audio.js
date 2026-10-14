// All sound is synthesized with WebAudio, so there are no audio files to load.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = localStorageGet('hunt_muted') === '1';
    this.music = null;
    this.mode = null;
    this.noiseBuf = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.mode) this.setMusic(this.mode, true);
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorageSet('hunt_muted', this.muted ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  tone({ f = 440, f2 = null, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, attack = 0.005 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.3, freq = 1200, q = 0.8, type = 'lowpass', delay = 0, f2 = null }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  play(name) {
    switch (name) {
      case 'beep': return this.tone({ f: 660, type: 'square', dur: 0.18, vol: 0.18 });
      case 'go':
        this.tone({ f: 990, type: 'square', dur: 0.5, vol: 0.2 });
        return this.tone({ f: 1320, type: 'sawtooth', dur: 0.5, vol: 0.08 });
      case 'step': return this.noise({ dur: 0.05, vol: 0.06, freq: 2400, type: 'bandpass', q: 2 });
      case 'jump': return this.tone({ f: 300, f2: 620, type: 'triangle', dur: 0.16, vol: 0.12 });
      case 'land': return this.noise({ dur: 0.09, vol: 0.14, freq: 500 });
      case 'slide': return this.noise({ dur: 0.45, vol: 0.12, freq: 3000, f2: 600, type: 'bandpass', q: 1 });
      case 'hit':
        this.noise({ dur: 0.35, vol: 0.5, freq: 900, f2: 120 });
        return this.tone({ f: 120, f2: 40, type: 'sine', dur: 0.4, vol: 0.5 });
      case 'zap':
        this.tone({ f: 1800, f2: 200, type: 'sawtooth', dur: 0.3, vol: 0.18 });
        return this.noise({ dur: 0.3, vol: 0.25, freq: 5000, type: 'highpass' });
      case 'crash':
        this.noise({ dur: 1.4, vol: 0.45, freq: 400, f2: 60 });
        return this.tone({ f: 70, f2: 30, type: 'sawtooth', dur: 1.2, vol: 0.25 });
      case 'crack': return this.noise({ dur: 0.25, vol: 0.25, freq: 2500, f2: 800, type: 'bandpass', q: 3 });
      case 'whoosh': return this.noise({ dur: 0.4, vol: 0.12, freq: 300, f2: 1800, type: 'bandpass', q: 1.5 });
      case 'thud':
        this.noise({ dur: 0.5, vol: 0.35, freq: 300, f2: 50 });
        return this.tone({ f: 60, f2: 30, dur: 0.5, vol: 0.4 });
      case 'piston': return this.noise({ dur: 0.18, vol: 0.2, freq: 1500, f2: 300, type: 'bandpass', q: 2 });
      case 'derezz':
        for (let i = 0; i < 8; i++) this.tone({ f: 1200 - i * 130, type: 'square', dur: 0.08, vol: 0.12, delay: i * 0.06 });
        return this.noise({ dur: 0.9, vol: 0.3, freq: 3000, f2: 200, type: 'bandpass', q: 4 });
      case 'power':
        this.tone({ f: 200, f2: 1600, type: 'sawtooth', dur: 0.6, vol: 0.14 });
        return this.tone({ f: 400, f2: 3200, type: 'sine', dur: 0.7, vol: 0.12, delay: 0.05 });
      case 'win':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone({ f, type: 'square', dur: 0.4, vol: 0.12, delay: i * 0.11 }));
        return this.noise({ dur: 1.5, vol: 0.25, freq: 6000, f2: 1500, type: 'highpass', delay: 0.1 });
      case 'shatter':
        for (let i = 0; i < 10; i++) this.tone({ f: 2000 + Math.random() * 3000, type: 'sine', dur: 0.3, vol: 0.06, delay: Math.random() * 0.4 });
        return this.noise({ dur: 0.8, vol: 0.4, freq: 7000, type: 'highpass' });
      case 'lose':
        [392, 311, 233, 175].forEach((f, i) => this.tone({ f, type: 'sawtooth', dur: 0.5, vol: 0.12, delay: i * 0.22 }));
        return;
      case 'ui': return this.tone({ f: 880, type: 'triangle', dur: 0.06, vol: 0.08 });
      case 'deny': return this.tone({ f: 180, type: 'square', dur: 0.2, vol: 0.12 });
    }
  }

  // Simple synth music. 'hall' is a slow pad, 'race' adds a driving pulse.
  setMusic(mode, force = false) {
    if (this.mode === mode && !force) return;
    this.mode = mode;
    if (!this.ctx) return;
    if (this.music) {
      const old = this.music;
      old.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      setTimeout(() => {
        old.nodes.forEach((n) => n.stop?.());
        clearInterval(old.timer);
      }, 1500);
      this.music = null;
    }
    if (!mode) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(mode === 'race' ? 0.16 : 0.12, ctx.currentTime, 0.8);
    gain.connect(this.master);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = mode === 'race' ? 900 : 600;
    filter.Q.value = 4;
    filter.connect(gain);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    const nodes = [lfo];
    const chord = mode === 'race' ? [55, 82.4, 110, 130.8] : [49, 73.4, 98, 116.5, 146.8];
    for (const f of chord) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = 0.12;
        o.connect(g).connect(filter);
        o.start();
        nodes.push(o);
      }
    }
    let timer = null;
    if (mode === 'race') {
      let step = 0;
      const bass = [55, 55, 82.4, 55, 73.4, 55, 82.4, 98];
      timer = setInterval(() => {
        if (!this.music || this.music.gain !== gain) return;
        const t = ctx.currentTime;
        // kick
        const k = ctx.createOscillator();
        const kg = ctx.createGain();
        k.frequency.setValueAtTime(140, t);
        k.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        kg.gain.setValueAtTime(step % 2 === 0 ? 0.5 : 0, t);
        kg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        k.connect(kg).connect(gain);
        k.start(t);
        k.stop(t + 0.2);
        // bass pluck
        const b = ctx.createOscillator();
        const bg = ctx.createGain();
        b.type = 'square';
        b.frequency.value = bass[step % bass.length];
        bg.gain.setValueAtTime(0.25, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        b.connect(bg).connect(filter);
        b.start(t);
        b.stop(t + 0.22);
        step++;
      }, 250);
    }
    this.music = { gain, nodes, timer };
  }
}

function localStorageGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}
