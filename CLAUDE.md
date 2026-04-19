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
        ├── main.js     # All game logic (~1200 lines)
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
| 1–18 | Canvas setup, `resize()` |
| 20–105 | Input: keyboard + touch joystick |
| 107–112 | `class Starfield` |
| 114–158 | `class Bullet`, `class EnemyBullet` (with trail particles) |
| 160–319 | `class Enemy` |
| 320–373 | `class Explosion` |
| 374–449 | Game state flags, localStorage high score functions |
| 451–569 | `class Player` |
| 571–618 | Constants, arrays, spawn helpers |
| 620–669 | Terrain: `groundHeight`, `laserTop`, `makeMountainPts()`, `makeHillPts()`, `spawnObstacle()` |
| 671–830 | `class Boss` |
| 831–955 | `update(dt)` — main game loop logic |
| 956–1117 | `draw()` — render pass |
| 1118–1187 | `drawTouchControls()` |
| 1188–1189 | rAF loop |

## Gameplay boundaries

- **Top boundary**: `laserTop = 10` — pulsing lime green laser beam, kills player on contact
- **Bottom boundary**: `groundHeight = 80` — asteroid surface strip (visual) with laser beam above it
- **Player y-clamp**: `Math.max(laserTop + radius, Math.min(vh - groundHeight - radius, y))`
- Mountains and hills are **purely visual** — no collision

## Terrain system

Terrain objects (mountains, hills) store points as normalized fractions `[fx, fy]`:
- `fx` = fraction of object width, `fy` = fraction of object height
- Actual draw coordinates computed at render time from current `groundY`
- This makes them resize-safe

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
