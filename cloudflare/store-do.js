// Accounts and the Scoreboard in the Durable Object's own SQLite storage.
// Same tables and behaviour as server/store/sqlite.js.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    display_name TEXT NOT NULL,
    color TEXT NOT NULL,
    shards INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    best_distance REAL NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS clears (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gate INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    display_name TEXT NOT NULL,
    race_time REAL NOT NULL,
    cleared_at INTEGER NOT NULL,
    UNIQUE (gate, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stats (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  )`,
];

export function openDoStore(sql) {
  for (const stmt of SCHEMA) sql.exec(stmt);
  const rows = (q, ...args) => sql.exec(q, ...args).toArray();
  const one = (q, ...args) => {
    const r = rows(q, ...args)[0];
    return r ? { ...r } : null;
  };

  return {
    kind: 'durable-object',
    async createUser({ username, passHash, salt, displayName, color }) {
      try {
        return one(
          `INSERT INTO users (username, pass_hash, salt, display_name, color, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
          username, passHash, salt, displayName, color, Date.now(),
        );
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) throw Object.assign(new Error('taken'), { code: 'TAKEN' });
        throw e;
      }
    },
    async userByName(name) {
      return one(`SELECT * FROM users WHERE username = ?`, name);
    },
    async userById(id) {
      return one(`SELECT * FROM users WHERE id = ?`, id);
    },
    async createSession(token, userId, expiresAt) {
      sql.exec(`DELETE FROM sessions WHERE expires_at <= ?`, Date.now());
      sql.exec(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`, token, userId, expiresAt);
    },
    async sessionUser(token) {
      return one(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`, token, Date.now());
    },
    async deleteSession(token) {
      sql.exec(`DELETE FROM sessions WHERE token = ?`, token);
    },
    async setLockedUntil(id, ts) {
      sql.exec(`UPDATE users SET locked_until = ? WHERE id = ?`, ts, id);
    },
    async addAttempt(id) {
      sql.exec(`UPDATE users SET attempts = attempts + 1 WHERE id = ?`, id);
      sql.exec(`INSERT INTO stats (key, value) VALUES ('attempts', 1) ON CONFLICT(key) DO UPDATE SET value = value + 1`);
    },
    async setBestDistance(id, d) {
      sql.exec(`UPDATE users SET best_distance = MAX(best_distance, ?) WHERE id = ?`, d, id);
    },
    async recordClear(gate, user, raceTime) {
      sql.exec(`UPDATE users SET shards = shards | ? WHERE id = ?`, 1 << (gate - 1), user.id);
      if (one(`SELECT id FROM clears WHERE gate = ? AND user_id = ?`, gate, user.id)) return false;
      sql.exec(
        `INSERT INTO clears (gate, user_id, display_name, race_time, cleared_at) VALUES (?, ?, ?, ?, ?)`,
        gate, user.id, user.display_name, raceTime, Date.now(),
      );
      return true;
    },
    async board(gate, limit = 20) {
      return {
        clears: rows(`SELECT display_name, race_time, cleared_at FROM clears WHERE gate = ? ORDER BY cleared_at ASC, id ASC LIMIT ?`, gate, limit).map(
          (c) => ({ n: c.display_name, time: c.race_time, at: c.cleared_at }),
        ),
        stats: {
          attempts: one(`SELECT value FROM stats WHERE key = 'attempts'`)?.value ?? 0,
          clears: one(`SELECT COUNT(*) AS n FROM clears WHERE gate = ?`, gate).n,
          players: one(`SELECT COUNT(*) AS n FROM users`).n,
        },
      };
    },
    async close() {},
  };
}
