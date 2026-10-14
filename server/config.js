import path from 'node:path';

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const CONFIG = {
  PORT: num(process.env.PORT, 3000),
  DATA_DIR: process.env.DATA_DIR || path.resolve('data'),
  // How long a failed runner has to wait before racing again.
  LOCKOUT_MINUTES: num(process.env.LOCKOUT_MINUTES, 60),
  // Seconds a race room waits for more players before filling with AI.
  LOBBY_WAIT: num(process.env.LOBBY_WAIT, 20),
  // Prints where the secret is for each race to the server log. Testing only.
  DEBUG_SECRET: process.env.DEBUG_SECRET === '1',
  SESSION_DAYS: 30,
  // Postgres connection string (Neon, Supabase, ...). Empty = local SQLite file.
  DATABASE_URL: process.env.DATABASE_URL || '',
  DB_POOL_MAX: num(process.env.DB_POOL_MAX, 5),
};
