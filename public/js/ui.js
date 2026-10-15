// Everything on top of the 3D view.

import { AVATAR_COLORS, TRACK } from '/shared/constants.js';
import { fmtLeft } from './scenes/hall.js';

const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export class UI {
  constructor(app) {
    this.app = app;
    this.timers = {};
    this.color = AVATAR_COLORS[0];
    this.buildAuth();
    this.lockTimer = null;

    $('r-hall').onclick = () => {
      this.hide('results');
      app.toHall();
    };
    $('r-again').onclick = () => app.raceAgain();
    $('r-watch').onclick = () => {
      this.hide('results');
      app.openRaces();
    };
    $('races-close').onclick = () => app.closeRaces();
    $('m-resume').onclick = () => app.closeMenu();
    $('m-leave').onclick = () => app.leaveFromMenu();
    $('m-logout').onclick = () => app.logout();
  }

  show(id) {
    $(id).classList.add('show');
  }
  hide(id) {
    $(id).classList.remove('show');
  }
  isOpen(id) {
    return $(id).classList.contains('show');
  }

  // ---------------------------------------------------------------- auth

  buildAuth() {
    const sw = $('swatches');
    for (const c of AVATAR_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = c;
      b.style.color = c;
      b.title = c;
      if (c === this.color) b.classList.add('on');
      b.onclick = () => {
        this.color = c;
        sw.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      };
      sw.appendChild(b);
    }
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
        $('form-login').classList.toggle('on', b.dataset.tab === 'login');
        $('form-signup').classList.toggle('on', b.dataset.tab === 'signup');
        $('auth-err').textContent = '';
      };
    });
    $('form-login').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      this.app.login({ username: f.get('username'), password: f.get('password') });
    };
    $('form-signup').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      this.app.signup({ username: f.get('username'), password: f.get('password'), displayName: f.get('displayName'), color: this.color });
    };
  }

  authError(msg) {
    $('auth-err').textContent = msg || '';
  }

  // ---------------------------------------------------------------- hall

  showHallHud(on) {
    $('hud-hall').classList.toggle('show', on);
  }

  setMe(me) {
    if (!me) return;
    $('me-name').textContent = me.name;
    $('me-dot').style.color = me.color;
    const sh = $('me-shards');
    sh.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'shard' + (me.shards & (1 << i) ? ' on' : '');
      d.title = ['Shard of Time', 'Gate II shard', 'Gate III shard'][i];
      sh.appendChild(d);
    }
    $('me-meta').textContent = `Attempts ${me.attempts} · Best ${Math.round(me.best || 0)} m`;
    this.updateLock();
    clearInterval(this.lockTimer);
    this.lockTimer = setInterval(() => this.updateLock(), 1000);
  }

  updateLock() {
    const me = this.app.me;
    if (!me) return;
    const left = me.lockedUntil - this.app.net.now();
    const el = $('lock-status');
    if (left > 0) {
      el.textContent = `RACE LOCKED · ${fmtLeft(left)}`;
      el.classList.add('locked');
    } else {
      el.textContent = 'READY TO RACE';
      el.classList.remove('locked');
    }
    if (this.isOpen('results') && this.resultsMe) {
      const l2 = this.resultsMe.lockedUntil - this.app.net.now();
      $('r-lock').textContent = l2 > 0 ? `LOCKED OUT · NEXT ATTEMPT IN ${fmtLeft(l2)}` : '';
      $('r-again').disabled = l2 > 0;
    }
  }

  setOnline(n, races) {
    $('online').textContent = `${n} online · ${races ?? 0} live ${races === 1 ? 'race' : 'races'}`;
  }

  prompt(html) {
    const el = $('prompt');
    if (!html) {
      el.classList.remove('show');
      return;
    }
    if (el.innerHTML !== html) el.innerHTML = html;
    el.classList.add('show');
  }

  // ---------------------------------------------------------------- race

  showRaceHud(on) {
    $('hud-race').classList.toggle('show', on);
    document.body.classList.toggle('racing', on);
    if (!on) {
      this.center('');
      this.sub('');
      this.signalLost(false);
      this.speedLines(0);
      $('lockhint').classList.remove('show');
    }
  }

  setKeysHint(t) {
    $('race-keys').textContent = t;
  }

  setClock(txt, urgent) {
    const el = $('clock-time');
    if (el.textContent !== txt) el.textContent = txt;
    el.classList.toggle('urgent', !!urgent);
  }

  center(text, tone = '', ms = 0) {
    const el = $('center-msg');
    clearTimeout(this.timers.center);
    el.textContent = text;
    el.className = 'center-msg' + (text ? ' show' : '') + (tone ? ` ${tone}` : '');
    if (ms) this.timers.center = setTimeout(() => el.classList.remove('show'), ms);
  }

  sub(text, ms = 0) {
    const el = $('sub-msg');
    clearTimeout(this.timers.sub);
    if (el.textContent !== text) el.textContent = text;
    if (ms) this.timers.sub = setTimeout(() => (el.textContent = ''), ms);
  }

  hurt() {
    const v = $('vignette');
    v.style.opacity = '1';
    clearTimeout(this.timers.hurt);
    this.timers.hurt = setTimeout(() => (v.style.opacity = '0'), 260);
  }

  flash(color) {
    const v = $('vignette');
    v.style.background = `radial-gradient(ellipse at center, ${color}55 0%, transparent 70%)`;
    v.style.opacity = '1';
    setTimeout(() => {
      v.style.opacity = '0';
      setTimeout(() => (v.style.background = ''), 200);
    }, 220);
  }

  speedLines(k) {
    $('speedlines').style.opacity = String(k);
  }

  signalLost(on) {
    $('signal-lost').classList.toggle('show', on);
  }

  setRunners(rows, clockZ, myZ) {
    const list = $('runner-list');
    let html = '';
    for (const r of rows) {
      const cls = [r.me ? 'me' : '', r.lost ? 'lost' : '', r.out ? 'out' : ''].join(' ');
      html += `<div class="${cls}" style="color:${r.color}"><span>${esc(r.name)}</span><span>${r.status}</span></div>`;
    }
    if (list._html !== html) {
      list.innerHTML = html;
      list._html = html;
    }
    const marks = $('marks');
    let mh = '';
    for (const r of rows) {
      if (r.lost || r.out || r.z < -2) continue;
      const pct = Math.max(0, Math.min(100, (r.z / TRACK.LENGTH) * 100));
      mh += `<i class="${r.clock ? 'clock' : r.me ? 'me' : ''}" style="left:${pct.toFixed(2)}%;color:${r.color}"></i>`;
    }
    marks.innerHTML = mh;
  }

  setDash(dist, speed, stamina, exhausted) {
    const d = $('dash');
    if (dist === null) {
      d.style.display = 'none';
      return;
    }
    d.style.display = '';
    $('dist').textContent = Math.min(TRACK.LENGTH, Math.round(dist));
    $('speed').textContent = Math.max(0, speed).toFixed(1);
    $('stamina').style.width = `${Math.max(0, Math.min(100, stamina))}%`;
    $('stamina').parentElement.classList.toggle('low', exhausted);
  }

  lockHint(on) {
    $('lockhint').classList.toggle('show', on);
  }

  // ------------------------------------------------------------- modals

  results({ title, tone, sub, me, watchMode }) {
    $('r-title').textContent = title;
    $('r-title').className = 'r-title ' + (tone || '');
    $('r-sub').innerHTML = sub;
    this.resultsMe = me;
    $('r-lock').textContent = '';
    $('r-watch').style.display = '';
    $('r-again').textContent = watchMode ? 'RACE NOW (R)' : 'RACE AGAIN (R)';
    this.show('results');
    this.updateLock();
    this.app.releaseMouse();
  }

  showRaces(list) {
    const el = $('race-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty">No races right now. Check back soon.</div>';
      return;
    }
    el.innerHTML = '';
    for (const r of list) {
      const row = document.createElement('div');
      row.className = 'row';
      const phase = { lobby: 'WAITING FOR RUNNERS', countdown: 'STARTING', running: `RUNNING · ${r.t}s`, done: 'FINISHING' }[r.phase] || r.phase;
      row.innerHTML = `<div class="info"><b>RACE #${r.id} · ${phase}</b><div>${r.players.map(esc).join(', ') || 'AI only'} · ${r.watchers} watching</div></div>`;
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = 'WATCH';
      b.disabled = r.phase === 'lobby';
      b.onclick = () => this.app.watch(r.id);
      row.appendChild(b);
      el.appendChild(row);
    }
  }

  menu({ inRace, alive }) {
    const body = $('menu-body');
    body.innerHTML = `<table>
      <tr><td>W / ↑</td><td>Run</td></tr>
      <tr><td>SHIFT</td><td>Sprint (uses stamina)</td></tr>
      <tr><td>A / D</td><td>Move sideways</td></tr>
      <tr><td>SPACE</td><td>Jump</td></tr>
      <tr><td>S / ↓</td><td>Slide</td></tr>
      <tr><td>MOUSE</td><td>Look around (click to capture)</td></tr>
      <tr><td>E</td><td>Interact (Gate Hall)</td></tr>
      <tr><td>M</td><td>Sound on / off</td></tr>
    </table>`;
    $('m-leave').style.display = inRace ? '' : 'none';
    $('m-leave').textContent = alive ? 'LEAVE RACE (COUNTS AS A FAILED ATTEMPT)' : 'LEAVE';
    this.show('menu');
  }

  toast(msg, ms = 2600) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.timers.toast);
    this.timers.toast = setTimeout(() => el.classList.remove('show'), ms);
  }
}
