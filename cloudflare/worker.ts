/**
 * Worker entry. Static files (the game client) are served before this runs.
 * Live play (/ws) and the accounts API (/api/*) all go to ONE Durable Object,
 * so every player shares the same Gate Hall, races and Scoreboard.
 *
 * The `Room` re-export is required: a Durable Object class must be exported
 * from the Worker's entry module or it does not ship.
 */

import type { Env } from "./env";
import { Room } from "./room";

export { Room };

const WORLD = "world";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") return Response.json({ ok: true });

    if (url.pathname === "/ws" || url.pathname.startsWith("/api/")) {
      return env.ROOMS.get(env.ROOMS.idFromName(WORLD)).fetch(request);
    }

    // Not a static file: give page requests the app shell, everything else 404.
    if (request.method === "GET" && request.headers.get("Accept")?.includes("text/html")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
