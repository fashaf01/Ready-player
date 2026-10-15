# THE HUNT

**Three Gates. One Key.** A futuristic 3D browser game inspired by *Ready Player One*, drawn like a cyberpunk anime oil painting: cel-shaded models, a painted sunset sky, ink outlines and brush-stroke post-processing.

Players create an avatar, walk the **Gate Hall** in third person and try to clear three Gates. Each Gate gives a key shard. All three shards unlock the **Final Key**. Version 1 has Gate I playable; Gates II and III are sealed.

## Gate I: The Race

- A 400 m neon hoverway floating above a megacity, 10 runners (real players, with AI runners filling empty lanes).
- Third person at the start line; the camera drops into **first person automatically** when the countdown runs out.
- In the lobby, press **Enter** when ready. When every player in the lobby is ready, the race starts in 3 seconds instead of waiting out the timer.
- **THE CLOCK** runs the 400 m in 38 seconds. If it crosses the line first, everyone loses: *TIME WINS*.
- Obstacles: rolling energy balls, falling blocks, laser gates, shock and spike floors, pistons and road that cracks and falls away.
- Fail a race (knocked out, beaten by THE CLOCK, or leaving) and your account is **locked out of racing for one hour**. You can still watch live races. (The lockout is a setting, `LOCKOUT_MINUTES`; with it off, press **R** to go straight into the next race.)
- The first players to beat THE CLOCK go on the Scoreboard in the Gate Hall.

There are no hints in the game.

### Controls

| Key | Action |
| --- | --- |
| W / ↑ | Run |
| Shift | Sprint (uses stamina) |
| A / D | Move sideways |
| Space | Jump |
| S / ↓ | Slide |
| Mouse | Look around (click the game to capture the mouse) |
| E | Interact (Gate Hall) |
| Enter | Ready up (race lobby) |
| R | Race again (results screen, or after being knocked out when the lockout is off) |
| M | Sound on / off |
| P | Paint quality: high → medium → low (the game also lowers it by itself on slow machines) |
| Esc | Menu |

Desktop browsers only (keyboard, mouse and WebGL).

## Running it

Needs Node.js 22.13 or newer.

```bash
npm install
npm start            # http://localhost:3000
```

For testing on your own machine:

```bash
npm run dev          # 0-minute lockout, and the server log prints game-master info for each race
```

Never run with `DEBUG_SECRET=1` where players can see the server log.

### Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Web server port |
| `DATABASE_URL` | empty | Postgres connection string (Neon, Supabase, …). When empty, a local SQLite file is used instead. |
| `DATA_DIR` | `./data` | Folder for the local SQLite file (only used without `DATABASE_URL`) |
| `LOCKOUT_MINUTES` | `60` | How long a failed runner waits before racing again |
| `LOBBY_WAIT` | `20` | Seconds a race waits for more players before AI fills the lanes |
| `DEBUG_SECRET` | off | `1` prints game-master info to the server log. Testing only. |

### Tests

```bash
npm test
```

Runs a full race on a real server with scripted players and checks the core rules: a perfect runner still loses to THE CLOCK, speed hacks don't win, the lockout holds, logins work and watchers never see what they shouldn't. The suite runs twice: on SQLite and on real Postgres (PGlite).

## How it's built

- `server/core/` – The game server, with no platform code: race rooms, AI runners, THE CLOCK, the lockout, the scoreboard, all win checks, and the accounts API (PBKDF2 password hashes, HTTP-only session cookies). The server decides who wins; the browser only reports where it is.
- `server/` – The Node host: Express + `ws`, storage in Postgres or SQLite (`server/store/`).
- `cloudflare/` – The Cloudflare host used on Higgsfield: one Durable Object runs the whole game and keeps accounts in its SQLite storage. `scripts/build-higgsfield.sh <app-dir>` assembles it into a Higgsfield game app.
- `shared/` – Code used by both sides: the seeded course generator, obstacle timing, and runner physics, so the browser and the server agree on every obstacle.
- `public/` – The game client: Three.js scenes (Gate Hall, race, spectating), procedural neon models, HUD and synthesized sound. No build step.

## Hosting

**Live:** the game runs on Higgsfield (Cloudflare Workers + a Durable Object), built with `scripts/build-higgsfield.sh`. The test suite can run against it under `wrangler dev`: `HUNT_URL=http://127.0.0.1:8787 npm test`.

### Other hosts

The game needs an always-on Node server (WebSockets and races run in memory), plus a Postgres database for accounts.

**Free setup: Render + Neon** (`render.yaml` is included)

1. Create a free database at [neon.tech](https://neon.tech) (region: Singapore) and copy its connection string.
2. On [render.com](https://render.com): **New → Blueprint**, pick this repository, paste the connection string as `DATABASE_URL`, and deploy.

Render's free plan sleeps after 15 minutes with no players; the next visitor waits about a minute while it wakes up. Accounts and the Scoreboard are safe in Neon.

**Paid alternative: Railway** (`railway.json` is included). Set `DATABASE_URL`, or attach a volume and set `DATA_DIR` to its mount path.

Run a single instance either way: races live in the server's memory.

**Keep this repository private.** The server code contains how Gate I is won.
