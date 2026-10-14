# THE HUNT

**Three Gates. One Key.** A futuristic 3D browser game inspired by *Ready Player One*.

Players create an avatar, walk the **Gate Hall** in third person and try to clear three Gates. Each Gate gives a key shard. All three shards unlock the **Final Key**. Version 1 has Gate I playable; Gates II and III are sealed.

## Gate I: The Race

- A 400 m neon hoverway floating above a megacity, 10 runners (real players, with AI runners filling empty lanes).
- Third person at the start line; the camera drops into **first person automatically** when the countdown runs out.
- **THE CLOCK** runs the 400 m in 38 seconds. If it crosses the line first, everyone loses: *TIME WINS*.
- Obstacles: rolling energy balls, falling blocks, laser gates, shock and spike floors, pistons and road that cracks and falls away.
- Fail a race (knocked out, beaten by THE CLOCK, or leaving) and your account is **locked out of racing for one hour**. You can still watch live races.
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
| M | Sound on / off |
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
| `DATA_DIR` | `./data` | Where the SQLite database (accounts, scoreboard) is stored. Point this at a persistent disk when hosting. |
| `LOCKOUT_MINUTES` | `60` | How long a failed runner waits before racing again |
| `LOBBY_WAIT` | `20` | Seconds a race waits for more players before AI fills the lanes |
| `DEBUG_SECRET` | off | `1` prints game-master info to the server log. Testing only. |

### Tests

```bash
npm test
```

Runs a full race on a real server with scripted players and checks the core rules: a perfect runner still loses to THE CLOCK, speed hacks don't win, the lockout holds, logins work and watchers never see what they shouldn't.

## How it's built

- `server/` – Express + WebSocket server. Accounts (scrypt-hashed passwords, HTTP-only session cookies), SQLite storage (`node:sqlite`), race rooms, AI runners, THE CLOCK, the lockout, the scoreboard and all win checks. The server decides who wins; the browser only reports where it is.
- `shared/` – Code used by both sides: the seeded course generator, obstacle timing, and runner physics, so the browser and the server agree on every obstacle.
- `public/` – The game client: Three.js scenes (Gate Hall, race, spectating), procedural neon models, HUD and synthesized sound. No build step.

## Hosting

Any Node host that supports WebSockets and a persistent disk works. The repo is set up for Railway (`railway.json`: start command, `/healthz` health check, restart policy). Attach a volume and set `DATA_DIR` to its mount path (for example `/data`) so accounts and the scoreboard survive redeploys. Run a single instance: races live in the server's memory.

**Keep this repository private.** The server code contains how Gate I is won.
