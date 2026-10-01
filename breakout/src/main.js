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
  paddle.w = paddleWidth();
  paddle.y = vh - 60;
  paddle.x = Math.max(0, Math.min(vw - paddle.w, paddle.x));
  if (bricks.length) recalcBrickPositions();
  if (state === 'paused' && balls[0]) snapBallToPaddle(balls[0]);
}

function paddleWidth() { return Math.min(Math.max(vw * 0.14, 80), 130); }

// ── Constants ──────────────────────────────────────────────────────────────
const BALL_R     = 8;
const PADDLE_H   = 13;
const BRICK_ROWS = 7;
const BRICK_COLS = 10;
const BRICK_GAP  = 5;
const BRICK_H    = 18;
const BRICK_TOP  = 70;

const ROW_COLORS = ['#ff4455','#ff6622','#ffcc00','#44cc44','#22ccff','#7755ff','#cc44ff'];
const ROW_POINTS = [7, 6, 5, 4, 3, 2, 1];

// ── State ──────────────────────────────────────────────────────────────────
// 'start' | 'paused' | 'playing' | 'dying' | 'levelcomplete' | 'gameover'
let state      = 'start';
let score      = 0;
let lives      = 3;
let level      = 1;
let bricks     = [];
let particles  = [];
let balls      = [];
let paddle     = { x: 0, y: 0, w: 0 };
let scoreSaved  = false;
let gamePaused  = false;
let homeBtnRect = null;
let pauseBtnRect = null;
let deathTimer  = 0;

// Bonus-ball tracking: a random target in [3,5] successful paddle rallies
// (across every ball in play) earns one extra ball, once per serve. Reset
// whenever a fresh ball is served (new level, new life, game start).
const MAX_BALLS      = 10; // safety cap — volley bonus + up to 3 bursts of 3 could otherwise run away
let paddleHitStreak   = 0;
let bonusBallTarget   = 0;
let bonusBallGiven    = false;

function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

function resetVolleyTracking() {
  paddleHitStreak = 0;
  bonusBallTarget = randInt(3, 5);
  bonusBallGiven  = false;
}

// ── High scores ────────────────────────────────────────────────────────────
function getScores() {
  try { return JSON.parse(localStorage.getItem('breakout_scores') || '[]'); }
  catch { return []; }
}

function saveScore(s) {
  const arr = getScores();
  arr.push(s);
  arr.sort((a, b) => b - a);
  arr.splice(10);
  localStorage.setItem('breakout_scores', JSON.stringify(arr));
  saveScore._rank = arr.indexOf(s) + 1;
}
saveScore._rank = 0;

// ── Bricks ─────────────────────────────────────────────────────────────────
function brickMargin() { return Math.min(vw * 0.05, 40); }
function brickW()      {
  const m = brickMargin();
  return (vw - m * 2 - BRICK_GAP * (BRICK_COLS - 1)) / BRICK_COLS;
}

// Each layout is BRICK_ROWS strings of BRICK_COLS chars — '#' places a brick,
// '.' leaves a void. initBricks() just skips '.' cells, so the existing
// circle-vs-brick-rect collision loop needs no changes to support shapes:
// a missing brick is simply open space. Gaps between two LIVE bricks are
// only BRICK_GAP (5px) wide — far narrower than the ball (16px across) — so
// the ball can never slip between adjacent bricks; only a fully-missing
// cell is actually passable. That also guarantees every brick stays
// reachable from some open cell, so a layout can never soft-lock a level.
const LAYOUT_WALL = [
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
];
const LAYOUT_INVERTED_PYRAMID = [
  '##########',
  '.########.',
  '..######..',
  '...####...',
  '....##....',
  '....##....',
  '....##....',
];
const LAYOUT_PYRAMID = [
  '....##....',
  '....##....',
  '....##....',
  '...####...',
  '..######..',
  '.########.',
  '##########',
];
const LAYOUT_DIAMOND = [
  '....##....',
  '..######..',
  '.########.',
  '##########',
  '.########.',
  '..######..',
  '....##....',
];
const LAYOUT_LANES = [
  '##########',
  '.#.#.#.#.#',
  '#.#.#.#.#.',
  '.#.#.#.#.#',
  '#.#.#.#.#.',
  '.#.#.#.#.#',
  '##########',
];
const LAYOUT_FORTRESS = [
  '##########',
  '#........#',
  '#.##..##.#',
  '#.#....#.#',
  '#.######.#',
  '#........#',
  '##########',
];
// Level 1 is always the classic wall; after that, layouts cycle for variety.
const LAYOUT_ORDER = [LAYOUT_WALL, LAYOUT_INVERTED_PYRAMID, LAYOUT_LANES, LAYOUT_DIAMOND, LAYOUT_PYRAMID, LAYOUT_FORTRESS];
function layoutForLevel(lvl) { return LAYOUT_ORDER[(lvl - 1) % LAYOUT_ORDER.length]; }

function recalcBrickPositions() {
  const m = brickMargin(), bw = brickW();
  bricks.forEach(b => {
    b.x = m + b.col * (bw + BRICK_GAP);
    b.y = BRICK_TOP + b.row * (BRICK_H + BRICK_GAP);
    b.w = bw;
  });
}

function initBricks() {
  const m = brickMargin(), bw = brickW();
  const layout = layoutForLevel(level);
  bricks = [];
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      if (layout[r][c] !== '#') continue;
      bricks.push({
        x: m + c * (bw + BRICK_GAP),
        y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
        w: bw, h: BRICK_H,
        color:  ROW_COLORS[r],
        points: ROW_POINTS[r],
        row:    r,
        col:    c,
        alive:  true,
        burst:  false,
      });
    }
  }
  assignBurstBricks();
}

// Up to 3 random bricks per level are marked as a "burst" brick — breaking
// one fires 3 new balls from its position (see spawnBallBurst). Picked
// fresh every initBricks() call, so a new level gets a new random set.
function assignBurstBricks() {
  const pool  = bricks.slice();
  const count = Math.min(3, pool.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    pool[idx].burst = true;
    pool.splice(idx, 1);
  }
}

// ── Ball ───────────────────────────────────────────────────────────────────
function ballSpeed() { return Math.min(300 + (level - 1) * 25, 540); }

function snapBallToPaddle(b) {
  b.x = paddle.x + paddle.w / 2;
  b.y = paddle.y - BALL_R - 2;
}

function initBall() {
  const b = { x: 0, y: 0, vx: 0, vy: 0 };
  balls = [b];
  snapBallToPaddle(b);
  const sp    = ballSpeed();
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.6;
  b.vx = sp * Math.cos(angle);
  b.vy = sp * Math.sin(angle);
  resetVolleyTracking();
}

// Adds a ball at (x,y) heading off at `angle` radians (0 = +x axis), unless
// MAX_BALLS is already reached.
function spawnExtraBall(x, y, angle) {
  if (balls.length >= MAX_BALLS) return;
  const sp = ballSpeed();
  balls.push({ x, y, vx: sp * Math.cos(angle), vy: sp * Math.sin(angle) });
}

// Volley-streak reward: one extra ball, split off from the ball that just
// completed the winning rally so it immediately joins play.
function spawnBonusBall(from) {
  const baseAngle = Math.atan2(from.vy, from.vx);
  spawnExtraBall(from.x, from.y, baseAngle + (Math.random() < 0.5 ? -0.5 : 0.5));
  SoundFX.playBonusBall();
}

// Breaking a "burst" brick (see assignBurstBricks) fires 3 new balls,
// fanned out from straight up, from the brick's position.
function spawnBallBurst(x, y) {
  for (const off of [-0.55, 0, 0.55]) spawnExtraBall(x, y, -Math.PI / 2 + off);
  SoundFX.playBonusBall();
}

// ── Game init ──────────────────────────────────────────────────────────────
function startGame() {
  SoundFX.cancelSpeech();
  score = 0; lives = 3; level = 1; scoreSaved = false; gamePaused = false; particles = [];
  paddle.w = paddleWidth();
  paddle.y = vh - 60;
  paddle.x = vw / 2 - paddle.w / 2;
  initBricks();
  initBall();
  state = 'paused';
}

function startLevel() {
  particles = [];
  gamePaused = false;
  initBricks();
  initBall();
  state = 'paused';
}

function showLevelComplete() {
  document.getElementById('lc-title').textContent = 'Level ' + level + ' Clear!';
  document.getElementById('lc-sub').textContent   = 'Ready for level ' + (level + 1) + '?';
  document.getElementById('level-complete').classList.remove('hidden');
}

function hideLevelComplete() {
  document.getElementById('level-complete').classList.add('hidden');
}

// ── Input ──────────────────────────────────────────────────────────────────
let mouseX        = null;
let touchStartPos = null;
const keys        = {};

window.addEventListener('mousemove', e => { mouseX = e.clientX / gameScale; });
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' ||
      e.code === 'KeyA'      || e.code === 'KeyD') mouseX = null;
  if (e.code === 'Space') handleAction();
  if ((e.code === 'Escape' || e.code === 'KeyP') &&
      (state === 'playing' || state === 'paused')) {
    gamePaused = !gamePaused;
  }
  if (e.code === 'KeyH' && gamePaused) location.href = '../index.html';
});
window.addEventListener('keyup',     e => { keys[e.code] = false; });
canvas.addEventListener('click', e => {
  if (checkHomeBtn(e.clientX, e.clientY)) return;
  handleAction();
});

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  SoundFX.resume();
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
    if (state === 'playing' || state === 'paused') gamePaused = !gamePaused;
    return true;
  }
  return false;
}

function handleAction() {
  if (state === 'paused') { state = 'playing'; return; }
  if (state === 'gameover') {
    score = 0; lives = 3; level = 1; scoreSaved = false; particles = [];
    startGame();
  }
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
  // Paddle
  const PSPEED = 650;
  if (mouseX !== null) {
    paddle.x = mouseX - paddle.w / 2;
  } else {
    if (keys['ArrowLeft']  || keys['KeyA']) paddle.x -= PSPEED * dt;
    if (keys['ArrowRight'] || keys['KeyD']) paddle.x += PSPEED * dt;
  }
  paddle.x = Math.max(0, Math.min(vw - paddle.w, paddle.x));

  if (state === 'paused') { if (balls[0]) snapBallToPaddle(balls[0]); return; }

  if (state === 'dying') {
    deathTimer -= dt;
    if (deathTimer <= 0) { initBall(); state = 'paused'; }
    return;
  }

  if (state === 'levelcomplete') return;

  if (state !== 'playing') return;

  // Snapshot so a ball spawned mid-frame (bonus/burst) is drawn immediately
  // but only starts moving/colliding from next frame, not mid-iteration.
  for (const b of balls.slice()) {
    // Move
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Wall collisions
    if (b.x - BALL_R < 0)  { b.x = BALL_R;      b.vx =  Math.abs(b.vx); }
    if (b.x + BALL_R > vw) { b.x = vw - BALL_R; b.vx = -Math.abs(b.vx); }
    if (b.y - BALL_R < 0)  { b.y = BALL_R;      b.vy =  Math.abs(b.vy); }

    // Paddle collision
    if (b.vy > 0 &&
        b.y + BALL_R >= paddle.y &&
        b.y - BALL_R <= paddle.y + PADDLE_H &&
        b.x + BALL_R >= paddle.x &&
        b.x - BALL_R <= paddle.x + paddle.w) {
      b.y = paddle.y - BALL_R;
      const rel   = (b.x - paddle.x) / paddle.w;           // 0..1
      const angle = -Math.PI / 2 + (rel * 2 - 1) * (Math.PI * 0.28);
      const sp    = Math.max(Math.hypot(b.vx, b.vy), ballSpeed());
      b.vx = sp * Math.cos(angle);
      b.vy = sp * Math.sin(angle);
      if (b.vy > 0) b.vy = -b.vy; // safety: always send up
      SoundFX.playPaddleHit();

      // Bonus ball after a random 3–5 successful rallies this serve
      // (counts a paddle hit from any ball currently in play).
      paddleHitStreak++;
      if (!bonusBallGiven && paddleHitStreak >= bonusBallTarget) {
        bonusBallGiven = true;
        spawnBonusBall(b);
      }
    }

    // Fell off bottom — losing one of several balls isn't a miss; only
    // losing the last one costs a life (checked after this loop).
    if (b.y - BALL_R > vh) { b.dead = true; continue; }

    // Brick collisions (first hit only reverses this ball's velocity)
    let reflected = false;
    for (const brick of bricks) {
      if (!brick.alive) continue;
      const cx = Math.max(brick.x, Math.min(b.x, brick.x + brick.w));
      const cy = Math.max(brick.y, Math.min(b.y, brick.y + brick.h));
      const dx = b.x - cx, dy = b.y - cy;
      if (dx * dx + dy * dy < BALL_R * BALL_R) {
        brick.alive = false;
        score += brick.points;
        spawnParticles(b.x, b.y, brick.color, brick.burst ? 16 : 8);
        SoundFX.playBrickHit(brick.row);
        if (brick.burst) spawnBallBurst(brick.x + brick.w / 2, brick.y + brick.h / 2);
        if (!reflected) {
          const ox = (BALL_R + brick.w * 0.5) - Math.abs(b.x - (brick.x + brick.w * 0.5));
          const oy = (BALL_R + brick.h * 0.5) - Math.abs(b.y - (brick.y + brick.h * 0.5));
          if (ox < oy) b.vx = -b.vx;
          else         b.vy = -b.vy;
          reflected = true;
        }
      }
    }
  }

  // Remove balls lost off the bottom; only lose a life once none remain.
  if (balls.some(b => b.dead)) {
    balls = balls.filter(b => !b.dead);
    if (balls.length === 0) {
      lives--;
      if (lives <= 0) {
        state = 'gameover';
        if (!scoreSaved) { saveScore(score); scoreSaved = true; }
        SoundFX.sayGameOver();
      } else {
        SoundFX.playMiss();
        state = 'dying';
        deathTimer = 1.8;
      }
      return;
    }
  }

  if (bricks.every(b => !b.alive)) { state = 'levelcomplete'; showLevelComplete(); }

  // Particles
  for (const p of particles) {
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;
    p.vy += 220 * dt;
    p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);
}

// ── Starfield ──────────────────────────────────────────────────────────────
const stars = Array.from({ length: 180 }, () =>
  ({ x: Math.random(), y: Math.random(), z: 0.15 + Math.random() * 0.85 }));

function updateStars(dt) {
  for (const s of stars) { s.x -= 0.008 * s.z * dt; if (s.x < 0) s.x = 1; }
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
function drawBricks() {
  const t = performance.now() / 1000;
  for (const b of bricks) {
    if (!b.alive) continue;
    ctx.shadowColor = b.color;
    ctx.shadowBlur  = 5;
    ctx.fillStyle   = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(255,255,255,0.18)';
    ctx.fillRect(b.x, b.y, b.w, 4);
    // Burst bricks get a pulsing white outline so they stand out as special.
    if (b.burst) {
      const pulse = 0.5 + 0.4 * Math.sin(t * 5 + b.x * 0.05);
      ctx.shadowColor = '#fff';
      ctx.shadowBlur  = 8;
      ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
      ctx.lineWidth   = 2;
      ctx.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
      ctx.shadowBlur  = 0;
    }
  }
}

function drawBalls() {
  ctx.shadowColor = '#aef';
  ctx.shadowBlur  = 20;
  for (const b of balls) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawPaddle() {
  ctx.shadowColor = '#6ef';
  ctx.shadowBlur  = 16;
  ctx.fillStyle   = '#6ef';
  ctx.beginPath();
  ctx.roundRect(paddle.x, paddle.y, paddle.w, PADDLE_H, PADDLE_H / 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.roundRect(paddle.x + 5, paddle.y + 2, paddle.w - 10, 4, 2);
  ctx.fill();
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

function drawHUD() {
  ctx.font      = '700 15px "Segoe UI",sans-serif';
  ctx.fillStyle = '#6ef';
  ctx.textAlign = 'left';
  ctx.fillText('SCORE  ' + score, 16, 30);
  if (balls.length > 1) {
    ctx.font = '700 12px "Segoe UI",sans-serif';
    ctx.fillText('×' + balls.length + '  BALLS', 16, 48);
    ctx.font = '700 15px "Segoe UI",sans-serif';
  }
  ctx.textAlign = 'center';
  ctx.fillText('LEVEL  ' + level, vw / 2, 30);
  for (let i = 0; i < lives; i++) {
    ctx.beginPath();
    ctx.shadowColor = '#6ef';
    ctx.shadowBlur  = 8;
    ctx.arc(vw - (matchMedia('(pointer:coarse)').matches ? 64 : 16) - i * 20, 22, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#6ef';
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.textAlign  = 'left';
}

function drawLaunchHint() {
  ctx.fillStyle = 'rgba(102,238,255,0.6)';
  ctx.font      = '600 13px "Segoe UI",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CLICK  ·  SPACE  ·  TAP  TO  LAUNCH', vw / 2, paddle.y - 30);
  ctx.textAlign = 'left';
}

function drawOverlay(alpha) {
  ctx.fillStyle = `rgba(6,20,39,${alpha})`;
  ctx.fillRect(0, 0, vw, vh);
}

function drawDying() {
  drawOverlay(0.65);
  ctx.textAlign   = 'center';
  ctx.shadowColor = '#ff4455';
  ctx.shadowBlur  = 28;
  ctx.fillStyle   = '#ff4455';
  ctx.font = '900 50px "Segoe UI",sans-serif';
  ctx.fillText(lives + (lives === 1 ? '  LIFE  LEFT' : '  LIVES  LEFT'), vw / 2, vh / 2);
  ctx.shadowBlur = 0;
  ctx.textAlign  = 'left';
}


function drawGameOver() {
  drawOverlay(0.88);
  ctx.textAlign = 'center';

  ctx.shadowColor = '#ff4455';
  ctx.shadowBlur  = 36;
  ctx.fillStyle   = '#ff4455';
  ctx.font = '900 60px "Segoe UI",sans-serif';
  ctx.fillText('GAME  OVER', vw / 2, vh * 0.28);

  ctx.shadowBlur = 0;
  ctx.fillStyle  = '#6ef';
  ctx.font = '700 26px "Segoe UI",sans-serif';
  ctx.fillText('SCORE:  ' + score, vw / 2, vh * 0.28 + 58);

  const arr = getScores();
  ctx.fillStyle = '#4a7a99';
  ctx.font = '700 12px "Segoe UI",sans-serif';
  ctx.fillText('—  HIGH  SCORES  —', vw / 2, vh * 0.28 + 112);
  ctx.font = '600 15px "Segoe UI",sans-serif';
  for (let i = 0; i < Math.min(5, arr.length); i++) {
    ctx.fillStyle = (i + 1 === saveScore._rank) ? '#6ef' : '#3a5f7a';
    ctx.fillText((i + 1) + '.  ' + arr[i], vw / 2, vh * 0.28 + 142 + i * 28);
  }

  ctx.fillStyle = '#3a5f7a';
  ctx.font = '600 13px "Segoe UI",sans-serif';
  ctx.fillText('CLICK  ·  SPACE  ·  TAP  TO  PLAY  AGAIN', vw / 2, vh * 0.28 + 290);
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
  ctx.fillText('⌂  Main Menu    [H]', vw / 2, bY + 28);
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
  drawBricks();
  drawParticles();
  drawBalls();
  drawPaddle();
  drawHUD();
  if (state === 'paused')   drawLaunchHint();
  if (state === 'dying')    drawDying();
  if (state === 'gameover') drawGameOver();
  if (gamePaused)                drawPauseScreen();
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
  startLevel();
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
