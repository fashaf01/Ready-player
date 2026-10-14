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

export { publicProfile } from '../core/profile.js';
