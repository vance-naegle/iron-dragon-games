# Iron Dragon Games — Project Guide

## Repo layout

```
iron-dragon-games/
├── index.html          # Landing page (game gallery)
├── styles.css          # Landing page styles
└── bad-triangles/
    ├── index.html      # Game shell: canvas, ad slots, start screen, level-complete modal
    ├── styles.css      # Game styles: layout, ad slots, start screen, rotate overlay
    ├── preview.mp4     # Gameplay recording used as card thumbnail on landing page
    ├── privacy.html    # Privacy policy page
    └── src/
        ├── main.js     # All game logic (~1450 lines)
        └── audio.js    # Procedural Web Audio engine (SoundFX global)
```

## Dev setup

- **Local server**: VS Code Live Server, port 5500
- **Landing page**: http://localhost:5500
- **Game**: http://localhost:5500/bad-triangles/index.html
- No build step — plain HTML/CSS/JS, no bundler

## Canvas coordinate system — critical

The canvas uses DPR scaling. Always use logical pixel variables, never `canvas.width`/`canvas.height` for game logic:

```js
// resize() sets these — use them everywhere in game code:
let vw, vh;   // logical viewport size in CSS pixels

// canvas.width / canvas.height = vw * dpr (physical pixels)
// ctx has setTransform(dpr,0,0,dpr,0,0) applied — all draw calls use logical coords
```

**Known bug pattern**: using `canvas.width` instead of `vw` for off-screen culling causes objects to survive past the right edge on any scaled display (Windows 125%/150% DPI). This already bit us on player bullets and the starfield. Always use `vw`/`vh`.

## main.js structure

| Line range | Content |
|---|---|
| 1–4 | Canvas setup, `let vw, vh`, `let scenery = null` |
| 5–18 | `resize()` — resets `scenery = null` on resize |
| 20–105 | Input: keyboard + touch joystick |
| 107–112 | `class Starfield` |
| 114–205 | `class Bullet`, `class EnemyBullet`, `class Comet` |
| 206–365 | `class Enemy` |
| 366–420 | `class Explosion` |
| 421–500 | Game state flags, localStorage high score functions |
| 501–630 | `class Player` |
| 631–700 | Deep background scenery: `createScenery()`, `updateScenery()`, `drawNebula()`, `drawPlanet()` |
| 700–760 | Constants, arrays, spawn helpers |
| 760–810 | Terrain: `initTerrain()`, `spawnObstacle()`, `makeMountainPts()`, `makeHillPts()` |
| 810–970 | `class Boss` |
| 970–1130 | `update(dt)` — main game loop logic |
| 1130–1310 | `draw()` — render pass |
| 1310–1390 | `drawTouchControls()` |
| 1390+ | start-btn listener, rAF loop |

## Gameplay boundaries

- **Top boundary**: `laserTop = 10` — pulsing lime green laser beam, kills player on contact
- **Bottom boundary**: `groundHeight = 80` — asteroid surface strip with laser beam above it
- **Player y-clamp**: `Math.max(laserTop + radius, Math.min(vh - groundHeight - radius, y))`
- All terrain layers are **purely visual** — no collision

## Terrain system

Four parallax layers, back to front. All use normalized point arrays `[fx, fy]`:
- `fx` = fraction of object width, `fy` = fraction of object height — resize-safe

| Array | Speed (px/s) | Peak colour | Role |
|---|---|---|---|
| `mountains` | -52 to -62 | `#162234` | farthest back |
| `mountains2` | -68 to -78 | `#1e2d3e` | mid-back |
| `buildings2` | -86 to -96 | `#263748` | mid-front |
| `buildings` | -104 to -114 | `#2f4054` | closest |

- `initTerrain()` pre-populates all layers on game start so the screen is never empty
- `spawnObstacle()` continuously adds new elements as old ones scroll off left
- Respawn: when `x + w < -100`, reset to `vw + 60 + random offset`

## Deep background scenery

`let scenery = null` declared at top of file (line 4). Reset to `null` in `resize()` so it rebuilds at new viewport size.

Draw order (back to front):
1. `drawNebula(ctx)` — elliptical radial gradient blobs centred on horizon
2. `starfield.draw(ctx)` — stars appear over nebula but behind planet
3. `drawPlanet(ctx)` — dark orange dome + ring arc, only top half visible above terrain

Planet: `r = 190`, `vx = -10 px/s` (much slower than mountains). Centre y = `vh - groundHeight` so only the top hemisphere shows above the ground strip. Ring clipped to y < 0 (planet space) so only the sky arc is visible.

## Comet system

Comets streak across the playfield as hazards:
- Spawns every 18–36 s after the first (first appears at 6–10 s)
- Enters from left, top, or right at 260–340 px/s
- Kills player and enemies on contact; chips boss (double hit)
- Exits harmlessly off left, right, or top
- **Ground impact**: calls `triggerCometImpact(x, y)` — 60-particle explosion, expanding shockwave ring, 150 px blast radius damages everything nearby
- Trail particles in `cometTrails[]`, shockwave rings in `shockwaves[]`

## Audio (audio.js)

Global `SoundFX` object with:
- `SoundFX.resume()` — must call on first user interaction to unlock AudioContext
- `SoundFX.playShoot()` — sawtooth laser zap
- `SoundFX.playExplosion()` — 4-layer glass shatter
- `SoundFX.startAmbient()` — procedural music sequencer (Am/F/C/Em, 138 BPM), starts once
- `SoundFX.playPickup()` — ascending 4-note arpeggio for extra life

All audio is procedurally synthesised — no audio asset files.

## Mobile layout

- **Portrait**: shows top/bottom ad bars, rotate overlay covers screen prompting landscape
- **Landscape**: shows left/right ad bars (120px), safe-area padding for notched phones
- Detection: `@media (pointer: coarse) and (orientation: portrait/landscape)`
- Rotate overlay: `#rotate-overlay`, hidden by default, shown via CSS media query only

## Ad slots

Fictional in-universe ads (Weyland-Yutani, Umbrella Corp, Cyberdyne Systems). Shuffled randomly each load. Slots: `#ad-left`, `#ad-right`, `#ad-top`, `#ad-bottom`, `#lc-ad` (level complete modal).

## High scores

- Stored in `localStorage` under key `badTriangles_scores`
- Max 10 entries, sorted descending
- `scoreSaved` flag ensures save happens once per game session
- `drawHighScores._rank` static property tracks current run's rank for highlight
