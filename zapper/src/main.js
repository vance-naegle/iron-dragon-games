'use strict';

const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');
let vw, vh;
const VIRT_W = 900;
let gameScale = 1;

// ── Resize ─────────────────────────────────────────────────────────────────
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const sw  = canvas.parentElement.clientWidth;
  const sh  = canvas.parentElement.clientHeight;
  gameScale = sw / VIRT_W;
  vw = VIRT_W;
  vh = Math.round(sh / gameScale);
  canvas.width  = Math.floor(sw * dpr);
  canvas.height = Math.floor(sh * dpr);
  canvas.style.width  = sw + 'px';
  canvas.style.height = sh + 'px';
  ctx.setTransform(dpr * gameScale, 0, 0, dpr * gameScale, 0, 0);
  player.y = vh - 60;
  player.x = Math.max(PLAYER_R + 4, Math.min(vw - PLAYER_R - 4, player.x));
}

// ── Constants ──────────────────────────────────────────────────────────────
const ALIEN_ROWS = 5;
const ALIEN_COLS = 8;
const ALIEN_GAP  = 14;
const ALIEN_H    = 26;
const FORMATION_TOP      = 50;
const ALIEN_DROP_STEP    = 22;
const FORMATION_WALL_PAD = 10;

const ROW_COLORS = ['#ff4455', '#ff6622', '#ffcc00', '#44cc44', '#22ccff'];
const ROW_POINTS = [50, 40, 30, 20, 10];

const PLAYER_R        = 14;
const PLAYER_SPEED    = 420;
const MISSILE_SPEED   = 520;
const MISSILE_COOLDOWN = 0.16;
const ALIEN_MISSILE_SPEED = 220;
const INVINCIBLE_T    = 2.0;

const DIVE_DURATION = 2.0;   // seconds, used to compute lateral drift toward the player
const DIVE_SPEED    = 180;   // px/s downward
const DIVE_WOBBLE    = 46;   // px, sideways swoop amplitude
const DIVE_RETURN_Y  = () => vh - 70;

// ── State ──────────────────────────────────────────────────────────────────
// 'start' | 'playing' | 'levelcomplete' | 'gameover'
let state      = 'start';
let score      = 0;
let lives      = 3;
let level      = 1;
let scoreSaved = false;
let gamePaused = false;
let homeBtnRect  = null;
let pauseBtnRect = null;
let gameOverReason = '';

let aliens         = [];
let formation      = { x: 0, y: 0, vx: 60 };
let playerMissiles = [];
let alienMissiles  = [];
let particles      = [];
let player         = { x: 0, y: 0, invincible: false, invTimer: 0 };

let fireTimer       = 0;
let alienFireTimer  = 0;
let diveTimer       = 0;

// ── High scores ────────────────────────────────────────────────────────────
function getScores() {
  try { return JSON.parse(localStorage.getItem('zapper_scores') || '[]'); }
  catch { return []; }
}

function saveScore(s) {
  const arr = getScores();
  arr.push(s);
  arr.sort((a, b) => b - a);
  arr.splice(10);
  localStorage.setItem('zapper_scores', JSON.stringify(arr));
  saveScore._rank = arr.indexOf(s) + 1;
}
saveScore._rank = 0;

// ── Alien formation geometry ──────────────────────────────────────────────
// Aliens don't cache x/y — their position is always derived fresh from
// row/col + the formation's current offset (or, while diving, from their own
// x/y fields). That avoids the resize/stale-position bug class entirely
// (see Breakout's brick-layout fix in CLAUDE.md for why caching is risky).
function alienMargin() { return Math.min(vw * 0.05, 40); }
function alienCellW()  {
  const m = alienMargin();
  return (vw - m * 2 - ALIEN_GAP * (ALIEN_COLS - 1)) / ALIEN_COLS;
}
function alienBaseX(col) { return alienMargin() + col * (alienCellW() + ALIEN_GAP) + alienCellW() / 2; }
function alienBaseY(row) { return FORMATION_TOP + row * (ALIEN_H + ALIEN_GAP) + ALIEN_H / 2; }

// Returns the alien's current CENTER point.
function alienPos(a) {
  if (a.diving) return { x: a.x, y: a.y };
  return { x: alienBaseX(a.col) + formation.x, y: alienBaseY(a.row) + formation.y };
}

function formationSpeed(lvl)  { return Math.min(50 + (lvl - 1) * 8, 170); }
function alienFireDelay(lvl)  { const base = Math.max(0.35, 1.6 - (lvl - 1) * 0.12); return base * 0.5 + Math.random() * base; }
function diveDelay(lvl)       { const base = Math.max(2.5, 7 - (lvl - 1) * 0.3); return base * 0.6 + Math.random() * base * 0.8; }

function startWave() {
  aliens = [];
  for (let r = 0; r < ALIEN_ROWS; r++) {
    for (let c = 0; c < ALIEN_COLS; c++) {
      aliens.push({
        row: r, col: c, alive: true, diving: false,
        color: ROW_COLORS[r], points: ROW_POINTS[r],
      });
    }
  }
  formation = { x: 0, y: 0, vx: formationSpeed(level) };
  playerMissiles = [];
  alienMissiles  = [];
  alienFireTimer = alienFireDelay(level);
  diveTimer      = diveDelay(level);
}

// ── Game init ──────────────────────────────────────────────────────────────
function startGame() {
  SoundFX.cancelSpeech();
  score = 0; lives = 3; level = 1; scoreSaved = false; gamePaused = false; particles = [];
  player.x = vw / 2; player.y = vh - 60;
  player.invincible = true; player.invTimer = 1.0; // brief grace period at game start
  fireTimer = 0;
  startWave();
  state = 'playing';
}

function showLevelComplete() {
  document.getElementById('lc-title').textContent = 'Wave ' + level + ' Cleared!';
  document.getElementById('lc-sub').textContent   = 'Ready for wave ' + (level + 1) + '?';
  document.getElementById('level-complete').classList.remove('hidden');
}

function hideLevelComplete() {
  document.getElementById('level-complete').classList.add('hidden');
}

function hitPlayer() {
  lives--;
  SoundFX.playerHit();
  if (lives <= 0) {
    triggerGameOver('OUT OF SHIPS');
  } else {
    player.x = vw / 2;
    player.invincible = true;
    player.invTimer = INVINCIBLE_T;
  }
}

function triggerGameOver(reason) {
  state = 'gameover';
  gameOverReason = reason;
  if (!scoreSaved) { saveScore(score); scoreSaved = true; }
  SoundFX.sayGameOver();
}

// ── Input ──────────────────────────────────────────────────────────────────
let mouseX        = null;
let touchStartPos = null;
const keys        = {};

const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || matchMedia('(pointer:coarse)').matches;
if (isMobile) {
  document.getElementById('start-controls').textContent = 'Drag to move  ·  Auto-fire engaged';
}

window.addEventListener('mousemove', e => { mouseX = e.clientX / gameScale; });
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' ||
      e.code === 'KeyA'      || e.code === 'KeyD') mouseX = null;
  if (e.code === 'Space') handleAction();
  if ((e.code === 'Escape' || e.code === 'KeyP') && state === 'playing') {
    gamePaused = !gamePaused;
  }
  if (e.code === 'KeyH' && gamePaused) location.href = '../index.html';
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('click', e => {
  if (checkHomeBtn(e.clientX, e.clientY)) return;
  handleAction();
});

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  SoundFX.resume();
  SoundFX.startMusic();
  touchStartPos = { x: e.touches[0].clientX / gameScale, y: e.touches[0].clientY / gameScale };
  mouseX = e.touches[0].clientX / gameScale;
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  mouseX = e.touches[0].clientX / gameScale;
  touchStartPos = null; // moved → was a drag, not a tap
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  if (touchStartPos) {
    const ex = e.changedTouches[0].clientX / gameScale;
    const ey = e.changedTouches[0].clientY / gameScale;
    const dx = Math.abs(ex - touchStartPos.x);
    const dy = Math.abs(ey - touchStartPos.y);
    if (dx < 12 && dy < 12) {
      const raw = e.changedTouches[0];
      if (!checkHomeBtn(raw.clientX, raw.clientY) && !checkPauseBtn(raw.clientX, raw.clientY)) {
        if (gamePaused) gamePaused = false;
        else handleAction();
      }
    }
  }
  touchStartPos = null;
}, { passive: false });

function checkHomeBtn(clientX, clientY) {
  if (!homeBtnRect || !gamePaused) return false;
  const r = canvas.getBoundingClientRect();
  const x = (clientX - r.left) / gameScale;
  const y = (clientY - r.top)  / gameScale;
  if (x >= homeBtnRect.x && x <= homeBtnRect.x + homeBtnRect.w &&
      y >= homeBtnRect.y && y <= homeBtnRect.y + homeBtnRect.h) {
    location.href = '../index.html';
    return true;
  }
}

function checkPauseBtn(clientX, clientY) {
  if (!pauseBtnRect) return false;
  const r = canvas.getBoundingClientRect();
  const x = (clientX - r.left) / gameScale;
  const y = (clientY - r.top)  / gameScale;
  if (x >= pauseBtnRect.x && x <= pauseBtnRect.x + pauseBtnRect.w &&
      y >= pauseBtnRect.y && y <= pauseBtnRect.y + pauseBtnRect.h) {
    if (state === 'playing') gamePaused = !gamePaused;
    return true;
  }
  return false;
}

function handleAction() {
  if (state === 'gameover') startGame();
}

// ── Particles ──────────────────────────────────────────────────────────────
function spawnParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a    = Math.random() * Math.PI * 2;
    const sp   = 60 + Math.random() * 200;
    const life = 0.35 + Math.random() * 0.35;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                     color, life, maxLife: life, r: 1.5 + Math.random() * 2.5 });
  }
}

// ── Update ─────────────────────────────────────────────────────────────────
function update(dt) {
  if (gamePaused) return;
  if (state !== 'playing') return;

  // Player movement
  if (mouseX !== null) {
    player.x = mouseX;
  } else {
    if (keys['ArrowLeft']  || keys['KeyA']) player.x -= PLAYER_SPEED * dt;
    if (keys['ArrowRight'] || keys['KeyD']) player.x += PLAYER_SPEED * dt;
  }
  player.x = Math.max(PLAYER_R + 4, Math.min(vw - PLAYER_R - 4, player.x));

  if (player.invincible) {
    player.invTimer -= dt;
    if (player.invTimer <= 0) player.invincible = false;
  }

  // Auto-fire
  fireTimer -= dt;
  if (fireTimer <= 0) {
    playerMissiles.push({ x: player.x, y: player.y - 18, vy: -MISSILE_SPEED });
    SoundFX.playerShoot();
    fireTimer = MISSILE_COOLDOWN;
  }

  // Move missiles
  for (const m of playerMissiles) m.y += m.vy * dt;
  playerMissiles = playerMissiles.filter(m => m.y > -20);

  for (const m of alienMissiles) {
    m.y += m.vy * dt;
    if (m.vx) m.x += m.vx * dt;
  }
  alienMissiles = alienMissiles.filter(m => m.y < vh + 20);

  // Formation march: bounce off the walls, step down and reverse on contact
  const aw = alienCellW();
  formation.x += formation.vx * dt;
  const aliveStanding = aliens.filter(a => a.alive && !a.diving);
  if (aliveStanding.length) {
    const cols = aliveStanding.map(a => a.col);
    const minCol = Math.min(...cols), maxCol = Math.max(...cols);
    const leftEdge  = alienBaseX(minCol) + formation.x - aw / 2;
    const rightEdge = alienBaseX(maxCol) + formation.x + aw / 2;
    if (leftEdge <= FORMATION_WALL_PAD) {
      formation.x += (FORMATION_WALL_PAD - leftEdge);
      formation.vx = Math.abs(formation.vx);
      formation.y += ALIEN_DROP_STEP;
    } else if (rightEdge >= vw - FORMATION_WALL_PAD) {
      formation.x -= (rightEdge - (vw - FORMATION_WALL_PAD));
      formation.vx = -Math.abs(formation.vx);
      formation.y += ALIEN_DROP_STEP;
    }
  }

  // Swarm reached the defender's line — immediate game over
  if (aliveStanding.some(a => alienBaseY(a.row) + formation.y + ALIEN_H / 2 >= player.y - PLAYER_R - 6)) {
    triggerGameOver('THE SWARM BROKE THROUGH');
    return;
  }

  // Random alien fire — only the front-most (highest row) alive, non-diving
  // alien in a column can fire, so shots always come from the visible front.
  alienFireTimer -= dt;
  if (alienFireTimer <= 0) {
    const front = {};
    for (const a of aliens) {
      if (!a.alive || a.diving) continue;
      if (!(a.col in front) || a.row > front[a.col].row) front[a.col] = a;
    }
    const shooters = Object.values(front);
    if (shooters.length) {
      const shooter = shooters[Math.floor(Math.random() * shooters.length)];
      const p = alienPos(shooter);
      alienMissiles.push({ x: p.x, y: p.y + ALIEN_H / 2, vy: ALIEN_MISSILE_SPEED });
      SoundFX.alienShoot();
    }
    alienFireTimer = alienFireDelay(level);
  }

  // Dive trigger — a random alien breaks formation and swoops at the player
  diveTimer -= dt;
  if (diveTimer <= 0) {
    const candidates = aliens.filter(a => a.alive && !a.diving);
    if (candidates.length) {
      const a = candidates[Math.floor(Math.random() * candidates.length)];
      const p = alienPos(a);
      a.diving      = true;
      a.x = p.x; a.y = p.y;
      a.diveElapsed = 0;
      a.diveFired   = false;
      a.diveStartX  = p.x;
      a.diveVX      = (player.x - p.x) / DIVE_DURATION; // net drift toward the player's position at dive-start
      SoundFX.diveAlert();
    }
    diveTimer = diveDelay(level);
  }

  // Dive flight
  for (const a of aliens) {
    if (!a.alive || !a.diving) continue;
    a.diveElapsed += dt;
    a.x = a.diveStartX + a.diveVX * a.diveElapsed + Math.sin(a.diveElapsed * 5) * DIVE_WOBBLE;
    a.x = Math.max(10, Math.min(vw - 10, a.x));
    a.y += DIVE_SPEED * dt;
    if (!a.diveFired && a.diveElapsed > DIVE_DURATION * 0.4) {
      a.diveFired = true;
      const dx = player.x - a.x, dy = player.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      alienMissiles.push({
        x: a.x, y: a.y,
        vx: dx / len * ALIEN_MISSILE_SPEED * 1.3,
        vy: dy / len * ALIEN_MISSILE_SPEED * 1.3,
      });
      SoundFX.alienShoot();
    }
    // Past the defender's altitude without being hit — fold back into formation.
    if (a.y > DIVE_RETURN_Y()) a.diving = false;
  }

  // Player missiles vs aliens
  for (const m of playerMissiles) {
    if (m.dead) continue;
    for (const a of aliens) {
      if (!a.alive) continue;
      const p = alienPos(a);
      const halfW = aw * 0.4, halfH = ALIEN_H * 0.4;
      if (Math.abs(m.x - p.x) < halfW && Math.abs(m.y - p.y) < halfH) {
        a.alive = false;
        m.dead  = true;
        score  += a.points + (a.diving ? 25 : 0); // bonus for picking off a diver
        spawnParticles(p.x, p.y, a.color, 10);
        SoundFX.explosion(a.row);
        break;
      }
    }
  }
  playerMissiles = playerMissiles.filter(m => !m.dead);

  // Alien missiles vs player
  if (!player.invincible) {
    for (const m of alienMissiles) {
      const dx = m.x - player.x, dy = m.y - player.y;
      if (dx * dx + dy * dy < (PLAYER_R + 4) * (PLAYER_R + 4)) {
        m.dead = true;
        hitPlayer();
        break;
      }
    }
    alienMissiles = alienMissiles.filter(m => !m.dead);
    if (state !== 'playing') return; // hitPlayer() may have ended the game
  }

  // Diving alien rams the player (kamikaze) — destroys both
  if (!player.invincible) {
    for (const a of aliens) {
      if (!a.alive || !a.diving) continue;
      const dx = a.x - player.x, dy = a.y - player.y;
      if (dx * dx + dy * dy < (PLAYER_R + 14) * (PLAYER_R + 14)) {
        a.alive = false;
        spawnParticles(a.x, a.y, a.color, 10);
        hitPlayer();
        break;
      }
    }
    if (state !== 'playing') return;
  }

  // Particles
  for (const p of particles) {
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;
    p.vy += 220 * dt;
    p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);

  if (aliens.every(a => !a.alive)) { state = 'levelcomplete'; showLevelComplete(); }
}

// ── Starfield — simplified, scrolls downward (toward the defender) ──────────
const stars = Array.from({ length: 140 }, () =>
  ({ x: Math.random(), y: Math.random(), z: 0.15 + Math.random() * 0.85 }));

function updateStars(dt) {
  for (const s of stars) {
    s.y += 0.09 * s.z * dt;
    if (s.y > 1) { s.y = 0; s.x = Math.random(); }
  }
}

function drawStars() {
  ctx.fillStyle = '#fff';
  for (const s of stars) {
    ctx.globalAlpha = 0.15 + 0.5 * s.z;
    ctx.fillRect(s.x * vw, s.y * vh, 1.3 * s.z, 1.3 * s.z);
  }
  ctx.globalAlpha = 1;
}

// ── Draw helpers ───────────────────────────────────────────────────────────
function drawAlienShape(cx, cy, w, h, color) {
  const bw = w * 0.8, bh = h * 0.8;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(-bw * 0.5, 0);
  ctx.lineTo(-bw * 0.3, -bh * 0.5);
  ctx.lineTo(bw * 0.3, -bh * 0.5);
  ctx.lineTo(bw * 0.5, 0);
  ctx.lineTo(bw * 0.3, bh * 0.5);
  ctx.lineTo(-bw * 0.3, bh * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#061427';
  ctx.beginPath(); ctx.arc(-bw * 0.15, 0, bw * 0.07, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(bw * 0.15, 0, bw * 0.07, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawAliens() {
  const aw = alienCellW();
  for (const a of aliens) {
    if (!a.alive) continue;
    const p = alienPos(a);
    drawAlienShape(p.x, p.y, aw, ALIEN_H, a.color);
  }
}

function drawPlayer() {
  if (player.invincible && Math.floor(performance.now() / 100) % 2 === 0) return;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(-22, 10);
  ctx.lineTo(-10, 10);
  ctx.lineTo(-10, 16);
  ctx.lineTo(10, 16);
  ctx.lineTo(10, 10);
  ctx.lineTo(22, 10);
  ctx.closePath();
  ctx.fillStyle = '#6ef';
  ctx.shadowColor = '#6ef';
  ctx.shadowBlur = 14;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(0, -2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMissiles() {
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#6ef';
  ctx.shadowBlur = 10;
  for (const m of playerMissiles) {
    ctx.beginPath();
    ctx.roundRect(m.x - 2, m.y - 7, 4, 14, 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#ff5566';
  ctx.shadowColor = '#ff4455';
  ctx.shadowBlur = 8;
  for (const m of alienMissiles) {
    ctx.beginPath();
    ctx.arc(m.x, m.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawParticles() {
  ctx.shadowBlur = 3;
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.shadowColor = p.color;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;
}

// ── HUD icons ──────────────────────────────────────────────────────────────
function drawStarIcon(cx, cy, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a  = -Math.PI / 2 + i * (Math.PI * 2 / 5);
    const a2 = a + Math.PI / 5;
    ctx.lineTo(cx + Math.cos(a) * r,  cy + Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(a2) * r * 0.42, cy + Math.sin(a2) * r * 0.42);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawBoltIcon(x, y, s, color) {
  ctx.beginPath();
  ctx.moveTo(x + s * 0.15, y - s);
  ctx.lineTo(x - s * 0.35, y + s * 0.15);
  ctx.lineTo(x - s * 0.05, y + s * 0.15);
  ctx.lineTo(x - s * 0.2,  y + s);
  ctx.lineTo(x + s * 0.4,  y - s * 0.1);
  ctx.lineTo(x + s * 0.1,  y - s * 0.1);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawShipIcon(x, y, s, color) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x - s * 0.8, y + s * 0.7);
  ctx.lineTo(x, y + s * 0.3);
  ctx.lineTo(x + s * 0.8, y + s * 0.7);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawHUD() {
  ctx.textAlign = 'left';
  ctx.font = '700 15px "Segoe UI",sans-serif';
  ctx.fillStyle = '#6ef';

  drawStarIcon(22, 22, 8, '#ffcc00');
  ctx.fillText('' + score, 36, 28);

  ctx.textAlign = 'center';
  drawBoltIcon(vw / 2 - 26, 22, 9, '#6ef');
  ctx.fillText('WAVE  ' + level, vw / 2 + 10, 28);

  const coarse = matchMedia('(pointer:coarse)').matches;
  const rightStart = vw - (coarse ? 64 : 16);
  for (let i = 0; i < lives; i++) {
    drawShipIcon(rightStart - i * 20, 20, 8, '#6ef');
  }
  ctx.textAlign = 'left';
}

function drawOverlay(alpha) {
  ctx.fillStyle = `rgba(6,20,39,${alpha})`;
  ctx.fillRect(0, 0, vw, vh);
}

function drawGameOver() {
  drawOverlay(0.88);
  ctx.textAlign = 'center';

  ctx.shadowColor = '#ff4455';
  ctx.shadowBlur  = 36;
  ctx.fillStyle   = '#ff4455';
  ctx.font = '900 60px "Segoe UI",sans-serif';
  ctx.fillText('GAME  OVER', vw / 2, vh * 0.26);

  ctx.shadowBlur = 0;
  ctx.fillStyle  = '#4a7a99';
  ctx.font = '700 13px "Segoe UI",sans-serif';
  ctx.fillText(gameOverReason, vw / 2, vh * 0.26 + 30);

  ctx.fillStyle  = '#6ef';
  ctx.font = '700 26px "Segoe UI",sans-serif';
  ctx.fillText('SCORE:  ' + score, vw / 2, vh * 0.26 + 72);

  const arr = getScores();
  ctx.fillStyle = '#4a7a99';
  ctx.font = '700 12px "Segoe UI",sans-serif';
  ctx.fillText('—  HIGH  SCORES  —', vw / 2, vh * 0.26 + 126);
  ctx.font = '600 15px "Segoe UI",sans-serif';
  for (let i = 0; i < Math.min(5, arr.length); i++) {
    ctx.fillStyle = (i + 1 === saveScore._rank) ? '#6ef' : '#3a5f7a';
    ctx.fillText((i + 1) + '.  ' + arr[i], vw / 2, vh * 0.26 + 156 + i * 28);
  }

  ctx.fillStyle = '#3a5f7a';
  ctx.font = '600 13px "Segoe UI",sans-serif';
  ctx.fillText('CLICK  ·  SPACE  ·  TAP  TO  PLAY  AGAIN', vw / 2, vh * 0.26 + 304);
  ctx.textAlign = 'left';
}

function drawPauseScreen() {
  drawOverlay(0.7);
  ctx.textAlign   = 'center';
  ctx.shadowColor = '#6ef';
  ctx.shadowBlur  = 30;
  ctx.fillStyle   = '#6ef';
  ctx.font = '900 64px "Segoe UI",sans-serif';
  ctx.fillText('PAUSED', vw / 2, vh / 2 - 16);
  ctx.shadowBlur = 0;
  ctx.fillStyle  = '#4a7a99';
  ctx.font = '600 14px "Segoe UI",sans-serif';
  ctx.fillText(matchMedia('(pointer:coarse)').matches ? 'TAP  TO  RESUME  ·  ESC  ·  P' : 'ESC  ·  P  TO  RESUME', vw / 2, vh / 2 + 32);
  const bW = 220, bH = 44, bX = vw / 2 - 110, bY = vh / 2 + 54;
  homeBtnRect = { x: bX, y: bY, w: bW, h: bH };
  ctx.fillStyle = 'rgba(74,122,153,0.18)';
  ctx.fillRect(bX, bY, bW, bH);
  ctx.strokeStyle = '#6ab';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.rect(bX, bY, bW, bH); ctx.stroke();
  ctx.fillStyle = '#6ab';
  ctx.font = '600 15px "Segoe UI",sans-serif';
  ctx.fillText('Main Menu    [H]', vw / 2, bY + 28);
  ctx.textAlign = 'left';
}

function drawMobilePauseBtn() {
  if (!matchMedia('(pointer:coarse)').matches || state === 'start' || state === 'gameover') {
    pauseBtnRect = null; return;
  }
  const pbW = 44, pbH = 28, pbX = vw - pbW - 8, pbY = 6;
  pauseBtnRect = { x: pbX, y: pbY, w: pbW, h: pbH };
  ctx.fillStyle = gamePaused ? 'rgba(102,238,255,0.22)' : 'rgba(102,238,255,0.1)';
  ctx.fillRect(pbX, pbY, pbW, pbH);
  ctx.strokeStyle = '#6ef';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.rect(pbX, pbY, pbW, pbH); ctx.stroke();
  ctx.fillStyle = '#6ef';
  ctx.font = 'bold 13px "Segoe UI",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gamePaused ? '▶' : 'II', pbX + pbW / 2, pbY + 19);
  ctx.textAlign = 'left';
}

function draw() {
  ctx.fillStyle = '#061427';
  ctx.fillRect(0, 0, vw, vh);
  drawStars();
  if (state === 'start') return;
  drawAliens();
  drawParticles();
  drawMissiles();
  drawPlayer();
  drawHUD();
  if (state === 'gameover') drawGameOver();
  if (gamePaused)           drawPauseScreen();
  drawMobilePauseBtn();
}

// ── Main loop ──────────────────────────────────────────────────────────────
let last = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateStars(dt);
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', () => {
  document.getElementById('start-screen').style.display = 'none';
  SoundFX.resume();
  SoundFX.startMusic();
  startGame();
});

document.getElementById('lc-continue').addEventListener('click', () => {
  hideLevelComplete();
  level++;
  startWave();
  state = 'playing';
});

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(loop);

// ── Fullscreen ─────────────────────────────────────────────────────────────
(function () {
  const btn = document.getElementById('fs-btn');
  const rfs = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
  const efs = document.exitFullscreen || document.webkitExitFullscreen;
  if (!rfs) { btn.style.display = 'none'; return; }
  btn.addEventListener('click', () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement)
      rfs.call(document.documentElement);
    else
      efs.call(document);
  });
  const sync = () => { btn.textContent = (document.fullscreenElement || document.webkitFullscreenElement) ? '✕' : '⛶'; };
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
})();
