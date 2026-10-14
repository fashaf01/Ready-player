// Same suite against real Postgres (PGlite, served over the Postgres wire
// protocol), so the production storage code is exercised too.
process.env.DB_POOL_MAX = '1';

const { PGlite } = await import('@electric-sql/pglite');
const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
const { raceSuite } = await import('./suite.js');

let pgServer;
let pgDb;

raceSuite('postgres', {
  async setup() {
    pgDb = await PGlite.create();
    pgServer = new PGLiteSocketServer({ db: pgDb, port: 0, host: '127.0.0.1' });
    await pgServer.start();
    return { databaseUrl: `postgres://postgres:postgres@${pgServer.getServerConn()}/postgres?sslmode=disable` };
  },
  async teardown() {
    await pgServer?.stop();
    await pgDb?.close();
  },
});
