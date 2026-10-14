// Postgres storage (Neon, Supabase, Render Postgres, ...). Used when
// DATABASE_URL is set. Tables are created on start-up and prefixed with
// hunt_ so they can live next to other apps' tables.

import pg from 'pg';

// BIGINT columns (ids, timestamps, counts) come back as numbers.
pg.types.setTypeParser(20, (v) => Number(v));

function poolConfig(url, max) {
  const u = new URL(url);
  const sslmode = u.searchParams.get('sslmode');
  // libpq-only options that node-postgres does not understand.
  for (const k of ['sslmode', 'channel_binding', 'sslrootcert']) u.searchParams.delete(k);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  const ssl = sslmode === 'disable' || (local && !sslmode) ? false : { rejectUnauthorized: true };
  return { connectionString: u.toString(), ssl, max, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 };
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS hunt_users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    display_name TEXT NOT NULL,
    color TEXT NOT NULL,
    shards INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    best_distance DOUBLE PRECISION NOT NULL DEFAULT 0,
    locked_until BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hunt_sessions (
    token TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES hunt_users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS hunt_sessions_user ON hunt_sessions (user_id);
  CREATE TABLE IF NOT EXISTS hunt_clears (
    id BIGSERIAL PRIMARY KEY,
    gate INTEGER NOT NULL,
    user_id BIGINT NOT NULL REFERENCES hunt_users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    race_time DOUBLE PRECISION NOT NULL,
    cleared_at BIGINT NOT NULL,
    UNIQUE (gate, user_id)
  );
  CREATE TABLE IF NOT EXISTS hunt_stats (
    key TEXT PRIMARY KEY,
    value BIGINT NOT NULL
  );
`;

export async function openPostgres(url, { max = 5 } = {}) {
  const pool = new pg.Pool(poolConfig(url, max));
  pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  await pool.query(SCHEMA);
  const one = async (sql, args) => (await pool.query(sql, args)).rows[0] ?? null;

  return {
    kind: 'postgres',
    async createUser({ username, passHash, salt, displayName, color }) {
      try {
        return await one(
          `INSERT INTO hunt_users (username, username_key, pass_hash, salt, display_name, color, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [username, username.toLowerCase(), passHash, salt, displayName, color, Date.now()],
        );
      } catch (e) {
        if (e.code === '23505') throw Object.assign(new Error('taken'), { code: 'TAKEN' });
        throw e;
      }
    },
    userByName: (name) => one(`SELECT * FROM hunt_users WHERE username_key = $1`, [String(name).toLowerCase()]),
    userById: (id) => one(`SELECT * FROM hunt_users WHERE id = $1`, [id]),
    async createSession(token, userId, expiresAt) {
      await pool.query(`DELETE FROM hunt_sessions WHERE expires_at <= $1`, [Date.now()]);
      await pool.query(`INSERT INTO hunt_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`, [token, userId, expiresAt]);
    },
    sessionUser: (token) =>
      one(`SELECT u.* FROM hunt_sessions s JOIN hunt_users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > $2`, [token, Date.now()]),
    async deleteSession(token) {
      await pool.query(`DELETE FROM hunt_sessions WHERE token = $1`, [token]);
    },
    async setLockedUntil(id, ts) {
      await pool.query(`UPDATE hunt_users SET locked_until = $1 WHERE id = $2`, [ts, id]);
    },
    async addAttempt(id) {
      await pool.query(`UPDATE hunt_users SET attempts = attempts + 1 WHERE id = $1`, [id]);
      await pool.query(
        `INSERT INTO hunt_stats (key, value) VALUES ('attempts', 1)
         ON CONFLICT (key) DO UPDATE SET value = hunt_stats.value + 1`,
      );
    },
    async setBestDistance(id, d) {
      await pool.query(`UPDATE hunt_users SET best_distance = GREATEST(best_distance, $1) WHERE id = $2`, [d, id]);
    },
    async recordClear(gate, user, raceTime) {
      await pool.query(`UPDATE hunt_users SET shards = shards | $1 WHERE id = $2`, [1 << (gate - 1), user.id]);
      const r = await pool.query(
        `INSERT INTO hunt_clears (gate, user_id, display_name, race_time, cleared_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (gate, user_id) DO NOTHING`,
        [gate, user.id, user.display_name, raceTime, Date.now()],
      );
      return r.rowCount > 0;
    },
    async board(gate, limit = 20) {
      const [clears, attempts, cleared, players] = await Promise.all([
        pool.query(`SELECT display_name, race_time, cleared_at FROM hunt_clears WHERE gate = $1 ORDER BY cleared_at, id LIMIT $2`, [gate, limit]),
        one(`SELECT value FROM hunt_stats WHERE key = 'attempts'`),
        one(`SELECT COUNT(*) AS n FROM hunt_clears WHERE gate = $1`, [gate]),
        one(`SELECT COUNT(*) AS n FROM hunt_users`),
      ]);
      return {
        clears: clears.rows.map((c) => ({ n: c.display_name, time: c.race_time, at: c.cleared_at })),
        stats: { attempts: attempts?.value ?? 0, clears: cleared.n, players: players.n },
      };
    },
    async close() {
      await pool.end();
    },
  };
}
