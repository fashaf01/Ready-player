/**
 * The one Durable Object that runs THE HUNT: live sockets, the Gate Hall,
 * every race room and the accounts API. All of it lives in ./cloudflare/world.js,
 * shared game code in ./server/core and ./shared.
 *
 * The class keeps the name `Room` because app.manifest.json declares it.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { createWorld } from "./cloudflare/world.js";

export class Room extends DurableObject<Env> {
  private readonly world: { fetch(request: Request): Promise<Response> };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.world = createWorld(ctx, env);
  }

  override async fetch(request: Request): Promise<Response> {
    return this.world.fetch(request);
  }
}
