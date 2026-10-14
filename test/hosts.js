// Ways to start a game server for the suite.

export function localHost(storeOptions, { teardown } = {}) {
  return {
    async start() {
      const { createServer } = await import('../server/index.js');
      const srv = await createServer(await storeOptions());
      await new Promise((r) => srv.server.listen(0, r));
      return {
        base: `http://127.0.0.1:${srv.server.address().port}`,
        spot: async (roomId) => srv.hub.rooms.get(roomId).spot,
        async stop() {
          await srv.close();
          await teardown?.();
        },
      };
    },
  };
}

// A server that is already running (for example the Cloudflare version under
// `wrangler dev`). It must be in dev mode with DEBUG_SECRET=1 so the suite can
// ask where the hidden spot is.
export function remoteHost(base) {
  return {
    async start() {
      return {
        base,
        async spot(roomId) {
          const spots = await (await fetch(`${base}/api/_debug/spots`)).json();
          return spots[roomId];
        },
        async stop() {},
      };
    },
  };
}
