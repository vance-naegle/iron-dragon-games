'use strict';

const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');
let vw, vh;

// ── Resize ─────────────────────────────────────────────────────────────────
function resize() {
  const dpr = window.devicePixelRatio || 1;
  vw = window.innerWidth;
  vh = window.innerHeight;
  canvas.width  = Math.floor(vw * dpr);
  canvas.height = Math.floor(vh * dpr);
  canvas.style.width  = vw + 'px';
  canvas.style.height = vh + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paddle.w = paddleWidth();
  paddle.y = vh - 60;
  paddle.x = Math.max(0, Math.min(vw - paddle.w, paddle.x));
  if (bricks.length) recalcBrickPositions();
  if (state === 'paused' && ball) snapBallToPaddle();
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
let ball       = null;
let paddle     = { x: 0, y: 0, w: 0 };
let scoreSaved  = false;
let gamePaused  = false;
let deathTimer  = 0;

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

function recalcBrickPositions() {
  const m = brickMargin(), bw = brickW();
  bricks.forEach((b, i) => {
    const r = Math.floor(i / BRICK_COLS);
    const c = i % BRICK_COLS;
    b.x = m + c * (bw + BRICK_GAP);
    b.y = BRICK_TOP + r * (BRICK_H + BRICK_GAP);
    b.w = bw;
  });
}

function initBricks() {
  const m = brickMargin(), bw = brickW();
  bricks = [];
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      bricks.push({
        x: m + c * (bw + BRICK_GAP),
        y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
        w: bw, h: BRICK_H,
        color:  ROW_COLORS[r],
        points: ROW_POINTS[r],
        alive:  true,
      });
    }
  }
}

// ── Ball ───────────────────────────────────────────────────────────────────
function ballSpeed() { return Math.min(300 + (level - 1) * 25, 540); }

function snapBallToPaddle() {
  if (!ball) ball = { vx: 0, vy: 0 };
  ball.x = paddle.x + paddle.w / 2;
  ball.y = paddle.y - BALL_R - 2;
}

function initBall() {
  snapBallToPaddle();
  const sp    = ballSpeed();
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.6;
  ball.vx = sp * Math.cos(angle);
  ball.vy = sp * Math.sin(angle);
}

// ── Game init ──────────────────────────────────────────────────────────────
function startGame() {
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

window.addEventListener('mousemove', e => { mouseX = e.clientX; });
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' ||
      e.code === 'KeyA'      || e.code === 'KeyD') mouseX = null;
  if (e.code === 'Space') handleAction();
  if ((e.code === 'Escape' || e.code === 'KeyP') &&
      (state === 'playing' || state === 'paused')) {
    gamePaused = !gamePaused;
  }
});
window.addEventListener('keyup',     e => { keys[e.code] = false; });
canvas.addEventListener('click',     handleAction);

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  mouseX = e.touches[0].clientX;
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  mouseX = e.touches[0].clientX;
  touchStartPos = null; // moved → was a drag, not a tap
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  if (touchStartPos) {
    const dx = Math.abs(e.changedTouches[0].clientX - touchStartPos.x);
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartPos.y);
    if (dx < 12 && dy < 12) handleAction();
  }
  touchStartPos = null;
}, { passive: false });

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

  if (state === 'paused') { snapBallToPaddle(); return; }

  if (state === 'dying') {
    deathTimer -= dt;
    if (deathTimer <= 0) { initBall(); state = 'paused'; }
    return;
  }

  if (state === 'levelcomplete') return;

  if (state !== 'playing') return;

  // Move ball
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Wall collisions
  if (ball.x - BALL_R < 0)  { ball.x = BALL_R;      ball.vx =  Math.abs(ball.vx); }
  if (ball.x + BALL_R > vw) { ball.x = vw - BALL_R; ball.vx = -Math.abs(ball.vx); }
  if (ball.y - BALL_R < 0)  { ball.y = BALL_R;       ball.vy =  Math.abs(ball.vy); }

  // Paddle collision
  if (ball.vy > 0 &&
      ball.y + BALL_R >= paddle.y &&
      ball.y - BALL_R <= paddle.y + PADDLE_H &&
      ball.x + BALL_R >= paddle.x &&
      ball.x - BALL_R <= paddle.x + paddle.w) {
    ball.y = paddle.y - BALL_R;
    const rel   = (ball.x - paddle.x) / paddle.w;           // 0..1
    const angle = -Math.PI / 2 + (rel * 2 - 1) * (Math.PI * 0.28);
    const sp    = Math.max(Math.hypot(ball.vx, ball.vy), ballSpeed());
    ball.vx = sp * Math.cos(angle);
    ball.vy = sp * Math.sin(angle);
    if (ball.vy > 0) ball.vy = -ball.vy; // safety: always send up
  }

  // Fell off bottom
  if (ball.y - BALL_R > vh) {
    lives--;
    if (lives <= 0) {
      state = 'gameover';
      if (!scoreSaved) { saveScore(score); scoreSaved = true; }
    } else {
      state = 'dying';
      deathTimer = 1.8;
    }
    return;
  }

  // Brick collisions (first hit only reverses velocity)
  let reflected = false;
  for (const b of bricks) {
    if (!b.alive) continue;
    const cx = Math.max(b.x, Math.min(ball.x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(ball.y, b.y + b.h));
    const dx = ball.x - cx, dy = ball.y - cy;
    if (dx * dx + dy * dy < BALL_R * BALL_R) {
      b.alive = false;
      score  += b.points;
      spawnParticles(ball.x, ball.y, b.color, 8);
      if (!reflected) {
        const ox = (BALL_R + b.w * 0.5) - Math.abs(ball.x - (b.x + b.w * 0.5));
        const oy = (BALL_R + b.h * 0.5) - Math.abs(ball.y - (b.y + b.h * 0.5));
        if (ox < oy) ball.vx = -ball.vx;
        else         ball.vy = -ball.vy;
        reflected = true;
      }
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
  for (const b of bricks) {
    if (!b.alive) continue;
    ctx.shadowColor = b.color;
    ctx.shadowBlur  = 5;
    ctx.fillStyle   = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(255,255,255,0.18)';
    ctx.fillRect(b.x, b.y, b.w, 4);
  }
}

function drawBall() {
  if (!ball) return;
  ctx.shadowColor = '#aef';
  ctx.shadowBlur  = 20;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
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
  ctx.textAlign = 'center';
  ctx.fillText('LEVEL  ' + level, vw / 2, 30);
  for (let i = 0; i < lives; i++) {
    ctx.beginPath();
    ctx.shadowColor = '#6ef';
    ctx.shadowBlur  = 8;
    ctx.arc(vw - 16 - i * 20, 22, 6, 0, Math.PI * 2);
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
  ctx.fillText('ESC  ·  P  TO  RESUME', vw / 2, vh / 2 + 32);
  ctx.textAlign = 'left';
}

function draw() {
  ctx.fillStyle = '#061427';
  ctx.fillRect(0, 0, vw, vh);
  drawStars();
  if (state === 'start') return;
  drawBricks();
  drawParticles();
  drawBall();
  drawPaddle();
  drawHUD();
  if (state === 'paused')   drawLaunchHint();
  if (state === 'dying')    drawDying();
  if (state === 'gameover') drawGameOver();
  if (gamePaused)                drawPauseScreen();
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
