// Local storage in a single SQLite file. Used when no DATABASE_URL is set
// (your own machine, tests).

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openSqlite(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
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
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clears (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gate INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      race_time REAL NOT NULL,
      cleared_at INTEGER NOT NULL,
      UNIQUE (gate, user_id)
    );
    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `);

  const q = {
    insertUser: db.prepare(`INSERT INTO users (username, pass_hash, salt, display_name, color, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
    userByName: db.prepare(`SELECT * FROM users WHERE username = ?`),
    userById: db.prepare(`SELECT * FROM users WHERE id = ?`),
    insertSession: db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`),
    sessionUser: db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`),
    deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
    purgeSessions: db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`),
    setLock: db.prepare(`UPDATE users SET locked_until = ? WHERE id = ?`),
    addAttempt: db.prepare(`UPDATE users SET attempts = attempts + 1 WHERE id = ?`),
    setBest: db.prepare(`UPDATE users SET best_distance = MAX(best_distance, ?) WHERE id = ?`),
    addShard: db.prepare(`UPDATE users SET shards = shards | ? WHERE id = ?`),
    insertClear: db.prepare(`INSERT OR IGNORE INTO clears (gate, user_id, display_name, race_time, cleared_at) VALUES (?, ?, ?, ?, ?)`),
    clears: db.prepare(`SELECT display_name, race_time, cleared_at FROM clears WHERE gate = ? ORDER BY cleared_at ASC, id ASC LIMIT ?`),
    clearCount: db.prepare(`SELECT COUNT(*) AS n FROM clears WHERE gate = ?`),
    userCount: db.prepare(`SELECT COUNT(*) AS n FROM users`),
    bumpStat: db.prepare(`INSERT INTO stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value`),
    getStat: db.prepare(`SELECT value FROM stats WHERE key = ?`),
  };
  const plain = (row) => (row ? { ...row } : null);

  return {
    kind: 'sqlite',
    async createUser({ username, passHash, salt, displayName, color }) {
      try {
        const r = q.insertUser.run(username, passHash, salt, displayName, color, Date.now());
        return plain(q.userById.get(Number(r.lastInsertRowid)));
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) throw Object.assign(new Error('taken'), { code: 'TAKEN' });
        throw e;
      }
    },
    async userByName(name) {
      return plain(q.userByName.get(name));
    },
    async userById(id) {
      return plain(q.userById.get(id));
    },
    async createSession(token, userId, expiresAt) {
      q.purgeSessions.run(Date.now());
      q.insertSession.run(token, userId, expiresAt);
    },
    async sessionUser(token) {
      return plain(q.sessionUser.get(token, Date.now()));
    },
    async deleteSession(token) {
      q.deleteSession.run(token);
    },
    async setLockedUntil(id, ts) {
      q.setLock.run(ts, id);
    },
    async addAttempt(id) {
      q.addAttempt.run(id);
      q.bumpStat.run('attempts', 1);
    },
    async setBestDistance(id, d) {
      q.setBest.run(d, id);
    },
    async recordClear(gate, user, raceTime) {
      q.addShard.run(1 << (gate - 1), user.id);
      return q.insertClear.run(gate, user.id, user.display_name, raceTime, Date.now()).changes > 0;
    },
    async board(gate, limit = 20) {
      return {
        clears: q.clears.all(gate, limit).map((c) => ({ n: c.display_name, time: c.race_time, at: c.cleared_at })),
        stats: {
          attempts: q.getStat.get('attempts')?.value ?? 0,
          clears: q.clearCount.get(gate).n,
          players: q.userCount.get().n,
        },
      };
    },
    async close() {
      db.close();
    },
  };
}
