import path from 'node:path';
import { CONFIG } from '../config.js';

// Postgres when DATABASE_URL is set, otherwise a local SQLite file.
export async function openStore({ databaseUrl = CONFIG.DATABASE_URL, sqliteFile } = {}) {
  if (databaseUrl) {
    const { openPostgres } = await import('./postgres.js');
    return openPostgres(databaseUrl, { max: CONFIG.DB_POOL_MAX });
  }
  const { openSqlite } = await import('./sqlite.js');
  return openSqlite(sqliteFile ?? path.join(CONFIG.DATA_DIR, 'hunt.db'));
}

export function publicProfile(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.display_name,
    color: u.color,
    shards: u.shards,
    attempts: u.attempts,
    best: u.best_distance,
    lockedUntil: u.locked_until,
  };
}
