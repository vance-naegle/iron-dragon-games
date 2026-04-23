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
    ├── assets/
    │   └── planet_02.png   # Alpha PNG planet, tinted blue via canvas filter at draw time
    └── src/
        ├── main.js     # All game logic (~1550 lines)
        └── audio.js    # Procedural Web Audio engine (SoundFX global)
```

## New game checklist

Every new game added to the site **must** include all four of the following before it is considered complete. These are non-negotiable defaults; the user may add to this list in the future.

### 1 — Responsive design (PC + mobile)
- Canvas fills the full viewport via `position:fixed; inset:0` and DPR-aware `resize()` (see Canvas coordinate system section below).
- Touch input must work alongside mouse/keyboard. Use `touchstart` / `touchmove` / `touchend` on the canvas with `{ passive: false }` and `e.preventDefault()`.
- Ad layout mirrors bad-triangles: left/right bars in landscape, top/bottom bars in portrait (see Ad slots below). Include a `#rotate-overlay` for games that require landscape.
- Test at 100%, 125%, and 150% DPI scaling — never use `canvas.width`/`canvas.height` for logic.
- **Virtual resolution**: declare `const VIRT_W = 900; let gameScale = 1;`. In `resize()`, set `gameScale = parentWidth / VIRT_W`, `vw = VIRT_W`, `vh = Math.round(parentHeight / gameScale)`, and apply `ctx.setTransform(dpr * gameScale, 0, 0, dpr * gameScale, 0, 0)`. This keeps all game elements occupying the same fraction of the screen on every device. Divide all mouse/touch clientX/clientY by `gameScale` before using them as game coordinates.
- **Fullscreen button**: add `<button id="fs-btn" title="Fullscreen">⛶</button>` inside `#game-wrapper`. Use the `requestFullscreen` / `webkitRequestFullscreen` API; hide the button if the API is unavailable. Toggle icon between ⛶ (enter) and ✕ (exit). Add `<meta name="apple-mobile-web-app-capable" content="yes">` and `<meta name="apple-mobile-web-app-status-bar-style" content="black-fullscreen">` to `<head>` for iOS home-screen standalone mode.
- **Ad-slot canvas sizing**: use `canvas.parentElement.clientWidth/clientHeight` (not `window.innerWidth/innerHeight`) so the canvas correctly excludes ad-slot widths.

### 2 — Placeholder ad slots
- Copy the ad-slot HTML structure from `bad-triangles/index.html` exactly: `#ad-top`, `#ad-bottom`, `#ad-left`, `#ad-right`, plus `#lc-ad` inside any level-complete or interstitial modal.
- Copy the ad-slot CSS from `bad-triangles/styles.css` (layout, sizing, media queries).
- Copy the inline ad-shuffle script from `bad-triangles/index.html` — it randomly assigns the three fictional in-universe brands (Weyland-Yutani, Umbrella Corp, Cyberdyne Systems) to each slot on every load.

### 3 — Pause screen
- A `gamePaused` boolean flag overlays any active game state.
- **Esc** and **P** toggle pause. Only respond when the game is in an active state (e.g. `'playing'` or ball-on-paddle equivalent) — ignore keystrokes on start, game-over, and death screens.
- When paused: `update()` returns immediately (everything freezes including the paddle), `draw()` renders the normal game scene underneath then draws the pause overlay on top.
- Pause overlay: semi-transparent dark fill, large glowing "PAUSED" title, and a one-line hint showing the resume keys.
- Reset `gamePaused = false` in `startGame()` and `startLevel()` so a restarted game is never stuck paused.

### 5 — Privacy page
- Every game folder gets its own `privacy.html` using the same structure as `bad-triangles/privacy.html` (inline styles, `.wrap` max-width container, `.back` link, same section headings).
- Update the game title, the "Last updated" date, and the back-link href for each new game.
- Link to it from two places: the start screen credit line (`#start-credit`) and the portal `index.html` footer.
- Contact email is always `vance.naegle@gmail.com`.

### 4 — Local high score screen
- Store scores in `localStorage` under a key unique to the game (e.g. `breakout_scores`).
- Keep the top 10 scores, sorted descending. Save once per session using a `scoreSaved` flag.
- Display on the game-over screen: title, current score, ranked list of top 5, with the current run's entry highlighted in the brand cyan (`#6ef`). Track rank via a static property on the save function (e.g. `saveScore._rank`).
- Pattern to follow: `getScores()` / `saveScore(s)` functions in `breakout/src/main.js`.

---

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
3. `drawPlanet(ctx)` — bitmap planet image, tinted blue via `ctx.filter`
4. `drawAsteroids(ctx)` — tumbling polygon rocks, purely decorative

Planet: `r = 190`, `vx = -10 px/s`. Centre y = `vh - groundHeight` so only the top hemisphere shows. Uses `assets/planet_02.png` (alpha PNG). Tint applied with `ctx.filter = 'hue-rotate(185deg) saturate(0.75) brightness(0.8)'`. Preloaded as `const planetImg = new Image()` at line 5.

**Planet image swap**: change `planetImg.src` and adjust `p.r * 2.4` draw scale if needed. If using a black-background PNG (no alpha), add `ctx.globalCompositeOperation = 'screen'` — black drops out cleanly.

## Asteroid field

60 tumbling rocks, purely decorative — no collision. Lazy-initialised in `initAsteroids()` on first `updateAsteroids()` call.

- Size: `r = 4–84px` biased toward small (`Math.pow(random, 1.8) * 80`)
- Speed: inverse of size — small rocks are fast, large rocks are slow
- `vx`: -12 to -142 px/s, `vy`: chaotic, `spin`: up to ±1.5 rad/s for small rocks
- Colors: dark brown/blue palette (`#2a1a10`, `#1c1a2a`, etc.), fully opaque, no outline
- Wrap at left edge with fresh random speed on re-entry
- Visible on start screen (updated/drawn before `gameStarted` gate)
- **Pending**: user plans to replace procedural polygons with PNG sprite sheet — ask for filename and grid layout when provided

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
