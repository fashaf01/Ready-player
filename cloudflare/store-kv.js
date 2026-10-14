// Fallback storage on the Durable Object's key-value API, for objects that
// are not SQLite-backed. Same interface as store-do.js.
//
// A Durable Object runs one event at a time and storage calls don't let
// other events in, so each read-modify-write below is effectively atomic.
//
// Keys:
//   u:<id>          user row            un:<lowercase name>  user id
//   seq:user        last user id        s:<token hash>       { userId, expiresAt }
//   c:<gate>        list of clears      stat:<name>          number

export function openKvStore(storage) {
  const get = (k) => storage.get(k);
  const put = (k, v) => storage.put(k, v);

  return {
    kind: 'durable-object-kv',
    async createUser({ username, passHash, salt, displayName, color }) {
      const key = `un:${username.toLowerCase()}`;
      if ((await get(key)) !== undefined) throw Object.assign(new Error('taken'), { code: 'TAKEN' });
      const id = ((await get('seq:user')) ?? 0) + 1;
      const user = {
        id,
        username,
        pass_hash: passHash,
        salt,
        display_name: displayName,
        color,
        shards: 0,
        attempts: 0,
        best_distance: 0,
        locked_until: 0,
        created_at: Date.now(),
      };
      await storage.put({ 'seq:user': id, [key]: id, [`u:${id}`]: user });
      return { ...user };
    },
    async userByName(name) {
      const id = await get(`un:${String(name).toLowerCase()}`);
      return id === undefined ? null : this.userById(id);
    },
    async userById(id) {
      const u = await get(`u:${id}`);
      return u ? { ...u } : null;
    },
    async createSession(token, userId, expiresAt) {
      await put(`s:${token}`, { userId, expiresAt });
    },
    async sessionUser(token) {
      const s = await get(`s:${token}`);
      if (!s) return null;
      if (s.expiresAt <= Date.now()) {
        await storage.delete(`s:${token}`);
        return null;
      }
      return this.userById(s.userId);
    },
    async deleteSession(token) {
      await storage.delete(`s:${token}`);
    },
    async setLockedUntil(id, ts) {
      await update(storage, id, (u) => (u.locked_until = ts));
    },
    async addAttempt(id) {
      await update(storage, id, (u) => u.attempts++);
      await put('stat:attempts', ((await get('stat:attempts')) ?? 0) + 1);
    },
    async setBestDistance(id, d) {
      await update(storage, id, (u) => (u.best_distance = Math.max(u.best_distance, d)));
    },
    async recordClear(gate, user, raceTime) {
      await update(storage, user.id, (u) => (u.shards |= 1 << (gate - 1)));
      const list = (await get(`c:${gate}`)) ?? [];
      if (list.some((c) => c.user_id === user.id)) return false;
      list.push({ user_id: user.id, display_name: user.display_name, race_time: raceTime, cleared_at: Date.now() });
      await put(`c:${gate}`, list);
      return true;
    },
    async board(gate, limit = 20) {
      const list = (await get(`c:${gate}`)) ?? [];
      return {
        clears: list.slice(0, limit).map((c) => ({ n: c.display_name, time: c.race_time, at: c.cleared_at })),
        stats: {
          attempts: (await get('stat:attempts')) ?? 0,
          clears: list.length,
          players: (await get('seq:user')) ?? 0,
        },
      };
    },
    async close() {},
  };
}

async function update(storage, id, fn) {
  const u = await storage.get(`u:${id}`);
  if (!u) return;
  fn(u);
  await storage.put(`u:${id}`, u);
}
