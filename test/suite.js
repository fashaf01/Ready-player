// End-to-end checks of the race rules, using real logins and real sockets.
// One race is run with several scripted players at once:
//   - an honest runner at top speed           -> THE CLOCK must win
//   - a runner who finds the hidden spot       -> must be able to win
//   - a runner who goes over the side elsewhere -> out + locked
//   - a speed cheater                          -> must not win
//   - a watcher                                -> must never see the hidden runner

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

process.env.LOBBY_WAIT = '2';
process.env.LOCKOUT_MINUTES = '60';

const { createServer } = await import('../server/index.js');

const { TRACK, SPEED, CLOCK } = await import('../shared/constants.js');

// Runs the whole suite against one storage backend.
// store: { setup(): Promise<storeOptions>, teardown?(): Promise<void> }
export function raceSuite(label, store) {
  let srv;
  let base;

  before(async () => {
    srv = await createServer(await store.setup());
    await new Promise((r) => srv.server.listen(0, r));
    base = `http://127.0.0.1:${srv.server.address().port}`;
  });

  after(async () => {
    await srv.close();
    await store.teardown?.();
  });

  async function signup(username) {
    const res = await fetch(`${base}/api/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'secret123', displayName: username, color: '#00e5ff' }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    return res.headers.get('set-cookie').split(';')[0];
  }

  async function connect(username) {
    const cookie = await signup(username);
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie } });
    const inbox = [];
    const waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      inbox.push(m);
      for (const w of [...waiters]) {
        if (w.pred(m)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
    await new Promise((r) => ws.on('open', r));
    const c = {
      ws,
      inbox,
      send: (m) => ws.send(JSON.stringify(m)),
      waitFor(pred, ms = 60000) {
        const found = inbox.find(pred);
        if (found) return Promise.resolve(found);
        return new Promise((resolve, reject) => {
          const w = { pred, resolve };
          waiters.push(w);
          setTimeout(() => reject(new Error(`${username}: timed out waiting`)), ms).unref();
        });
      },
    };
    await c.waitFor((m) => m.t === 'welcome');
    return c;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Drives a scripted runner: plan(t, state) returns the z/x to report.
  async function drive(c, room, plan) {
    const s = { z: -1, x: 0, done: false };
    while (!s.done) {
      const t = (Date.now() - room.startAt) / 1000;
      if (t >= 0) {
        const res = plan(t, s);
        if (res === 'stop') break;
        c.send({ t: 'st', z: s.z, x: s.x, y: 0, f: 0 });
      }
      if (c.inbox.some((m) => m.t === 'result')) break;
      await sleep(50);
    }
  }

  test(`[${label}] one race: running loses, the hidden way wins, the rules hold`, { timeout: 120000 }, async () => {
    const honest = await connect('honest_runner');
    const finder = await connect('finder');
    const faller = await connect('faller');
    const cheater = await connect('cheater');
    const watcher = await connect('watcher');

    for (const c of [honest, finder, faller, cheater]) c.send({ t: 'join' });
    const rooms = await Promise.all([honest, finder, faller, cheater].map((c) => c.waitFor((m) => m.t === 'room' && m.phase === 'countdown')));
    const room = rooms[0];
    assert.ok(rooms.every((r) => r.id === room.id), 'all four share one race');
    assert.equal(room.runners.filter(Boolean).length, 10, 'AI fills the empty lanes');

    watcher.send({ t: 'watch', id: room.id });
    await watcher.waitFor((m) => m.t === 'room');

    const serverRoom = srv.hub.rooms.get(room.id);
    const spot = serverRoom.spot;
    const lanes = Object.fromEntries([honest, finder, faller, cheater].map((c, i) => [i, rooms[i].you]));

    // Wrong place to go over the side: the other side of the track.
    const wrongSide = -spot.side;

    await Promise.all([
      // Perfect, never-hit runner at full sprint the whole way (impossible in
      // the real game because stamina runs out, so this is generous).
      drive(honest, room, (t, s) => {
        s.z = Math.min(TRACK.LENGTH, -1 + SPEED.SPRINT * t);
        s.x = 0;
      }),

      // Runs to the hidden spot, goes over the side, picks up, finishes.
      (async () => {
        const s = { z: -1, x: 0, phase: 'run', ledge: null };
        let lastT = 0;
        while (true) {
          const t = (Date.now() - room.startAt) / 1000;
          const dt = Math.max(0, t - lastT);
          lastT = t;
          if (t >= 0) {
            if (s.phase === 'run') {
              s.z += SPEED.SPRINT * dt;
              if (s.z >= spot.z0 + 1) {
                s.phase = 'edge';
                s.x = spot.side * 8.6;
                finder.send({ t: 'edge', z: s.z, x: s.x });
                const res = await finder.waitFor((m) => m.t === 'edge');
                assert.equal(res.ok, true, 'hidden spot accepted');
                s.ledge = res.g;
                s.phase = 'ledge';
                s.x = spot.side * 9;
              }
            } else if (s.phase === 'ledge') {
              s.z += SPEED.RUN * dt;
              if (s.z >= s.ledge.skateZ) {
                finder.send({ t: 'pick' });
                s.phase = 'skate';
              }
            } else if (s.phase === 'skate') {
              s.z = Math.min(TRACK.LENGTH + 1, s.z + SPEED.SKATE * dt);
              if (s.z >= s.ledge.launchZ) s.x = spot.side * 5;
              if (s.z >= TRACK.LENGTH) {
                finder.send({ t: 'st', z: s.z, x: s.x, y: 0, f: 0 });
                finder.send({ t: 'fin' });
                break;
              }
            }
            finder.send({ t: 'st', z: s.z, x: s.x, y: s.phase === 'run' ? 0 : -4, f: 0 });
          }
          await sleep(50);
        }
      })(),

      // Goes over the side in the wrong place.
      (async () => {
        await drive(faller, room, (t, s) => {
          s.z = -1 + SPEED.RUN * t;
          if (s.z > 30) {
            faller.send({ t: 'edge', z: s.z, x: wrongSide * 8.6 });
            return 'stop';
          }
        });
      })(),

      // Claims to be much faster than possible, then claims the finish.
      (async () => {
        await drive(cheater, room, (t, s) => {
          s.z = Math.min(TRACK.LENGTH, -1 + 30 * t);
          if (s.z >= TRACK.LENGTH) cheater.send({ t: 'fin' });
        });
      })(),
    ]);

    const finderRes = await finder.waitFor((m) => m.t === 'result');
    assert.equal(finderRes.outcome, 'win', 'the hidden way beats THE CLOCK');
    assert.ok(finderRes.time < CLOCK.TIME, `won in ${finderRes.time}s`);
    assert.equal(finderRes.me.shards & 1, 1, 'shard awarded');

    const fallerRes = await faller.waitFor((m) => m.t === 'result');
    assert.equal(fallerRes.outcome, 'dead');
    assert.equal(fallerRes.cause, 'void');
    assert.ok(fallerRes.me.lockedUntil > Date.now() + 59 * 60000, 'locked for an hour');

    const honestRes = await honest.waitFor((m) => m.t === 'result', 70000);
    assert.equal(honestRes.outcome, 'lose', 'a perfect runner still loses to THE CLOCK');
    assert.ok(honestRes.me.lockedUntil > Date.now() + 59 * 60000);

    const cheaterRes = await cheater.waitFor((m) => m.t === 'result', 70000);
    assert.notEqual(cheaterRes.outcome, 'win', 'speed hack does not win');

    // The watcher never saw the finder's position after they went over the side.
    const end = await watcher.waitFor((m) => m.t === 'end', 70000);
    assert.deepEqual(end.winners.map((w) => w.n), ['finder']);
    const finderLane = lanes[1];
    const states = watcher.inbox.filter((m) => m.t === 'rs');
    assert.ok(states.length > 50);
    const afterEdge = states.filter((m) => m.lost.includes(finderLane));
    assert.ok(afterEdge.length > 10, 'finder shows as SIGNAL LOST');
    for (const m of afterEdge) assert.ok(!m.r.some((r) => r[0] === finderLane), 'no position leaked');
    for (const m of states) for (const r of m.r) assert.ok(Math.abs(r[2]) <= TRACK.EDGE_X + 1, 'no visible runner below the track');

    // Locked players cannot race again.
    faller.send({ t: 'hall' });
    faller.send({ t: 'join' });
    const err = await faller.waitFor((m) => m.t === 'error');
    assert.equal(err.code, 'locked');

    // Scoreboard lists the clear.
    const board = await (await fetch(`${base}/api/board`)).json();
    assert.equal(board.clears[0].n, 'finder');
    assert.ok(board.stats.attempts >= 4);

    for (const c of [honest, finder, faller, cheater, watcher]) c.ws.close();
  });

  test(`[${label}] login, wrong password, logout`, async () => {
    const cookie = await signup('someone');
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
    assert.equal(me.me.name, 'someone');
    const bad = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'someone', password: 'nope' }),
    });
    assert.equal(bad.status, 401);
    const dup = await fetch(`${base}/api/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'SOMEONE', password: 'secret123', displayName: 'x2', color: '#00e5ff' }),
    });
    assert.equal(dup.status, 409, 'usernames are case-insensitive');
    await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie } });
    const after = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
    assert.equal(after.me, null);
  });
}
