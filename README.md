# IRON FRONT: GLOBAL CONFLICT

An original, browser-based real-time strategy game in the spirit of late-90s / early-2000s classics: build a base, harvest ore, raise an army, and destroy your opponent — against the computer or against friends online, on desktop or mobile.

The battlefield is rendered in **3D with Three.js (WebGL 2)**: lit, shadow-casting procedural models, raised cliffs, animated water, instanced forests and ore crystals, particle effects and bloom. All models, textures and effects are generated in code at runtime, and all sound effects and music are synthesized with WebAudio. The project ships **no third-party art or audio assets** and is not affiliated with any commercial RTS franchise.


---

## Features

| Area | What's implemented |
|---|---|
| **Core loop** | Deploy an MCV into a Command Center → power → refinery + harvesters → barracks / war factory → army → destroy the enemy. |
| **Base building** | 8 structure categories (HQ, power, refinery, barracks, war factory, recon center, tech center, defenses) + faction-specific defenses, costs, build timers, prerequisites, power, grid placement with live preview, build radius, occupancy checks, construction animation, selling, repairing. |
| **Economy** | Ore fields with depletion **and** slow regrowth, harvesters that seek/mine/return/dock/unload, refinery queueing, neutral **Ferrite Extractors** capturable by engineers for passive income. |
| **Units** | Rifleman, Rocket Soldier, Engineer, Scout, Guardian Tank / Ripper Raider, Bastion / Mauler heavy tanks, Longbow Howitzer / Hailstorm rocket artillery, Harvester, Mobile HQ. Every unit has HP, armor class, speed, vision, range, damage, cooldown, cost, build time. |
| **Combat** | Warhead × armor damage table, hitscan and travelling projectiles, artillery with minimum range, scatter and splash, burst fire, chain lightning (Arc Pylon), auto-targeting, retaliation, attack-move, guard leash, destruction effects. |
| **Movement** | A* (octile, no corner cutting, binary heap, generation-stamped buffers) with line-of-sight smoothing, straight-line fast path, per-tick path budget, formation slot assignment, unit separation via spatial hash, stuck detection + repath. |
| **Factions** | **Continental Defense Coalition** (tough self-repairing structures, Bastion self-repair, Sentinel Cannon) and **Eastern Strategic Directorate** (faster vehicles, faster production, Recon Sweep support power, Arc Pylon). |
| **Maps** | 4 original maps: *Twin Rivers* (2p, river + fords), *Ironclad Pass* (2p desert ridge + chokepoints), *Four Corners* (4p, central lake, forest belts), *Frostbite Flats* (2p compact arctic). |
| **Fog of war** | Shroud + fog, remembered enemy structures ("ghosts"), soft-edged rendering. Enforced **server-side**: clients only ever receive what their player can see. |
| **AI** | Easy / Normal / Hard. Builds and rebuilds its base, manages power and harvesters, scouts, adapts unit mix to what it has *seen*, defends, gathers and launches waves, retreats (Normal/Hard), captures extractors and uses Recon Sweep (Hard). Uses exactly the same command API and fog as humans — no cheating. |
| **Multiplayer** | Server-authoritative (Node + Socket.IO): rooms with 5-letter codes and invite links, lobby with faction/color/team/ready, host map selection, add AI slots, match start, fog-filtered 10 Hz snapshots + client interpolation, command validation, rate limiting, room isolation, reconnect-on-reload, 60 s disconnect grace then forfeit, victory/defeat, return to lobby for rematch, file-backed stats. 1v1 tested; supports up to 4 players. |
| **Desktop UI** | Main menu, skirmish setup, multiplayer menu, lobby, settings, field manual, sidebar with minimap/power/build tabs, selection panel, notifications, pause menu, result screen with statistics. |
| **Mobile UI** | Separate touch layout: tap select / tap command, double-tap select-type, long-press box select, drag pan, pinch zoom, command strip, collapsible build drawer, tap-to-position + confirm placement, toggleable minimap. |
| **Audio** | Synthesized weapon, explosion, UI and alert sounds with distance attenuation; procedural looping soundtrack; optional spoken announcer via the browser's speech synthesis; volume settings. |

---

## Tech stack

- **TypeScript** everywhere (npm workspaces monorepo)
- **shared/** — the whole game simulation: pure TS, no DOM, deterministic seeded RNG, data-driven definitions
- **client/** — React 19 + Vite 7 for menus and HUD; **Three.js 0.186 (WebGL 2)** renderer for the battlefield, with an automatic Canvas 2D fallback renderer for browsers without WebGL 2
- **server/** — Node.js + Socket.IO 4, runs the *same* shared simulation authoritatively
- **Tests** — Vitest (unit + socket integration) and Playwright (browser end-to-end, desktop + mobile emulation + two-browser multiplayer)

Single-player runs the simulation inside the browser through the same snapshot pipeline the server uses, so fog filtering, rendering and input are a single code path for both modes.

## Folder structure

```
shared/src/
  constants.ts, rng.ts
  data/          defs.ts (units & buildings), weapons.ts (weapons + armor table), factions.ts
  maps/          maps.ts (procedural map builder + 4 maps)
  sim/           game.ts (world, commands, victory), movement.ts, pathfinding.ts, grid.ts (grid + spatial hash),
                 combat.ts, economy.ts, production.ts, fog.ts, snapshot.ts (per-player views), commands.ts (validation)
  ai/ai.ts       computer opponent
  net/protocol.ts socket event & lobby types
shared/test/     simulation and AI tests
client/src/
  game/          controller.ts (input, selection, commands, HUD state), connection.ts (local/remote), world.ts
                 (client model + interpolation), camera.ts, audio.ts, settings.ts, store.ts
  game/render3d/ renderer3d.ts (scene, lights, camera, shadows, bloom), models.ts (procedural 3D units/buildings),
                 terrain3d.ts (heightfield, water, trees, rocks, ore), entities3d.ts (instancing), effects3d.ts,
                 materials.ts (PBR materials + fog-of-war shader), overlay.ts (health bars etc.), icons3d.ts
  game/render/   2D fallback renderer, ground texture painter, effects simulation, minimap
  ui/            App.tsx, GameScreen.tsx, hud/Hud.tsx, screens/*, common.tsx
  net/socket.ts  multiplayer client
server/src/      index.ts (entry/env), server.ts (HTTP + sockets), rooms.ts, match.ts, stats.ts
server/test/     socket integration tests
tests/e2e/       Playwright specs
scripts/         dev.mjs (run server + client), bench.ts (headless AI-vs-AI benchmark), dbg.ts
```

## Getting started

Requirements: **Node.js 20+** (developed on Node 22) and npm.

```bash
npm install          # installs all workspaces
npm run dev          # starts the multiplayer server (:3001) and the Vite client (:5173)
```

Open <http://localhost:5173>. The Vite dev server proxies `/socket.io` to the game server, so multiplayer works out of the box. Other devices on your LAN can join via `http://<your-ip>:5173`.

Individual processes:

```bash
npm run dev:server   # server only (tsx watch)
npm run dev:client   # client only (single-player works without the server)
```

Spectate an AI-vs-AI match: <http://localhost:5173/?demo=1> (optionally `&map=ironclad-pass`).

## Tests

```bash
npm test             # Vitest: simulation, AI, server/socket integration (41 tests)
npm run test:e2e     # Playwright: builds, starts the production server, runs desktop, mobile and 2-browser multiplayer flows
npm run typecheck    # tsc for shared, server and client
npm run sim:bench    # headless AI vs AI benchmark: npx tsx scripts/bench.ts [map] [diffA] [diffB] [minutes]
```

Playwright uses its own browser; in environments with a pre-installed Chromium at `/opt/pw-browsers` it uses that automatically.

## How to play

### Creating / joining an online match
1. **Multiplayer → Create Room.** You become the host and get a room code like `XKRJY` and an invite link (`…/?room=XKRJY`).
2. Your friend opens the invite link (or enters the code under **Join a match**).
3. Everyone chooses faction, color and team; non-host players press **Ready**. The host can pick the map and add AI slots.
4. The host presses **Start Match**. After the match, **Back to lobby** lets you ready up for a rematch.

If you reload or lose connection you rejoin automatically (the session token lives in that browser tab). A player who stays disconnected for 60 s forfeits.

### Desktop controls
| Input | Action |
|---|---|
| Left click / drag | Select / box-select (Shift adds) |
| Double-click unit | Select all of that type on screen |
| Right click | Contextual: move, attack, harvest ore, enter refinery/building, set rally point |
| A + left click | Attack-move |
| S / D | Stop / Deploy MCV |
| Ctrl+1–9, 1–9 | Assign / recall control group (double-tap to jump) |
| Arrow keys, screen edge, middle-drag | Scroll |
| Mouse wheel | Zoom |
| Z X C V · Q W E R T Y | Build tab · build item |
| Right-click build button | Cancel (refund) |
| H / Space | Center on selection or base |
| Delete | Sell selected structure |
| Esc / P | Cancel mode · Pause menu |
| Minimap click / right-click | Move camera / command selected units |

### Mobile controls
| Gesture | Action |
|---|---|
| Tap | Select; with units selected, tap ground/enemy/ore to command |
| Double-tap unit | Select all of that type on screen |
| Long-press then drag (or ▢ button) | Box select |
| One-finger drag | Pan camera |
| Pinch | Zoom |
| ⚑ / ✕ / ⚔ / ■ / ⤓ / ◎ | Select army / deselect / attack-move / stop / deploy / center |
| ▲ Build | Open the production drawer; when **READY**, tap it, tap/drag to position, then ✔ Place |

Best played in landscape.

## Production build & deployment

```bash
npm run build        # client → client/dist, server → server/dist/index.js (shared sim bundled in)
npm start            # node server/dist/index.js — serves the built client AND the multiplayer endpoint
```

### Option A — single host (simplest)
Deploy the repo to any Node host (Render, Railway, Fly.io, a VPS, Docker…), run `npm install && npm run build`, start with `npm start`. Everything — static client and WebSocket server — is served from one origin and port. The host must support **WebSockets** (Socket.IO falls back to long-polling if not).

### Option B — static client + separate game server
- Build the client with the server URL baked in: `VITE_SERVER_URL=https://game.example.com npm run build -w client`, then upload `client/dist` to any static host (Netlify, Vercel, GitHub Pages, S3…). Single-player works fully offline from the static site.
- Run the server elsewhere (`npm run build -w server && node server/dist/index.js`) with `CORS_ORIGIN=https://your-static-site.example`.

Internet play requires the server to be reachable over HTTPS/WSS (put it behind a TLS-terminating proxy or use a platform that provides TLS). Match state is held in memory: one server process hosts many rooms, but rooms are not shared across multiple processes, so scale vertically or pin rooms to instances with sticky sessions.

### Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `PORT` | server | `3001` | HTTP/WebSocket port |
| `HOST` | server | `0.0.0.0` | Bind address |
| `CORS_ORIGIN` | server | `*` | Comma-separated allowed origins for Socket.IO |
| `STATIC_DIR` | server | `client/dist` | Built client to serve (if present) |
| `DATA_DIR` | server | `server/data` | Where `stats.json` is written |
| `DISCONNECT_GRACE_MS` | server | `60000` | Time before a disconnected player forfeits |
| `VITE_SERVER_URL` | client build | same origin | Multiplayer server URL when hosted separately |
| `SERVER_PORT` | Vite dev | `3001` | Port the dev proxy forwards to |

No secrets are required; nothing secret is shipped to the client.

## Graphics

- Tilted orthographic RTS camera (48° pitch); screen↔ground mapping stays linear so input, minimap and fog use simple math.
- Directional sun with soft shadow maps that follow the view, sky/ground hemisphere light, image-based reflections (PMREM room environment), ACES tone mapping.
- Terrain: 512 px chunk meshes over a heightfield (cliffs raised, riverbeds sunk) textured by the procedural ground painter plus a world-space detail texture; animated normal-mapped water; instanced trees, boulders and ore crystals that shrink as fields are mined.
- Units and buildings: procedural PBR models (extruded armour profiles, lathe-turned towers, rounded hulls) drawn with one InstancedMesh per model part and team-coloured per instance; animated turrets, recoiling barrels, walking infantry, rotating radar dishes, pumping derricks, rising construction.
- Effects: soft additive particles for fire/flashes/sparks, smoke columns, tracers, lightning, shockwave rings, scorch decals, dynamic explosion lights and bloom (bloom and AA on *High* quality).
- Fog of war is a blurred visibility texture applied in every material's shader.
- Build-menu icons are rendered from the same 3D models.

## Architecture notes

- **Server-authoritative simulation** at 20 ticks/s. Clients send *commands* only; the server validates structure (`sanitizeCommand`) and rules (`Game.issue`: ownership, visibility of targets, prerequisites, funds, placement, cooldowns). Resource balances, production, movement, combat, visibility and victory are computed only on the server.
- **Snapshots** are built per player (`SnapshotBuilder`) at 10 Hz: compact numeric entity arrays containing only own/allied units and enemies on currently visible tiles, remembered structure ghosts, a visibility bitset when fog changes, ore changes on visible tiles and only the events that player could perceive. Clients interpolate between snapshots.
- **Security & robustness**: per-socket token-bucket rate limit (abusive sockets are disconnected), 32 KB max message, prototype-safe type lookups, rooms isolated (each room owns its own `Game`), session tokens are random 144-bit values, version handshake.
- **Performance**: spatial hash for proximity queries, A* budget per tick, fog recomputed every 4 ticks with cached circle stamps, terrain rendered into lazily cached 512 px chunks, fog drawn as a 1-px-per-tile mask upscaled with bilinear filtering, sprites pre-rendered per type/color, particle caps per quality level, HUD state throttled to ~7 Hz.

## Measured performance

Headless (Node 22, single core of the dev container): a full Hard-vs-Normal AI match on Twin Rivers averages **~0.3 ms per simulation tick** (budget: 50 ms) — see `npm run sim:bench`. A stress test with 400 simultaneous combat units is reported by `npx tsx scripts/stress.ts`. In headless Chromium with software rendering the client runs at 40–60 fps during AI battles; real GPUs are faster. Mobile performance has been verified only via Chromium device emulation, not on physical phones.

## Status

### Complete
Everything in the feature table above, verified by automated tests (Vitest + Playwright) and manual browser sessions: skirmish vs AI on all maps, both factions, three AI difficulties, base building, economy, production, combat, fog, victory/defeat, online 1v1 between two separate browsers (create, join by link, play, reload-rejoin, surrender, rematch lobby), touch controls in mobile emulation.

### Known limitations / not yet done
- No aircraft or naval units (optional roster items) — ground combat only.
- Matches with more than two humans are supported by the code and lobby but have only been tested with 2 humans (+ AI slots in unit tests).
- No accounts/authentication — players are identified per browser tab; stats are kept by display name.
- Mobile tested in Chromium device emulation; not yet on physical iOS/Android hardware. iOS requires a tap before audio can play (handled by unlocking audio on first interaction).
- Models and sounds are procedural. Every unit/building model is a function in `client/src/game/render3d/models.ts` keyed by type id, so authored glTF models could replace them per type without engine changes.
- Online matches cannot be paused; single-player can.
