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
}

// ── Constants ──────────────────────────────────────────────────────────────
const SHIP_R       = 14;
const ROTATE_SPD   = 2.8;    // rad/s
const THRUST       = 240;    // px/s²
const MAX_SPD      = 380;    // px/s
const DRAG         = 0.38;   // velocity lost per second
const BULLET_SPD   = 520;    // px/s
const BULLET_LIFE  = 1.4;    // s
const FIRE_CD      = 0.2;    // s between shots
const SHIELD_DRAIN = 48;     // energy %/s while active
const SHIELD_REGEN = 14;     // energy %/s while inactive
const INVINCIBLE_T = 2.5;    // s of invincibility after spawn

const SIZES = {
  large:  { r: 50, sMin: 36,  sMax: 72,  pts: 20 },
  medium: { r: 27, sMin: 62,  sMax: 112, pts: 50 },
  small:  { r: 13, sMin: 105, sMax: 170, pts: 100 },
};
const NEXT = { large: 'medium', medium: 'small' };

// ── State ──────────────────────────────────────────────────────────────────
// 'start' | 'playing' | 'dying' | 'levelcomplete' | 'gameover'
let state      = 'start';
let score      = 0, lives = 3, level = 1;
let ship       = null;
let asteroids  = [];
let bullets    = [];
let particles  = [];
let stars      = [];
let gamePaused = false;
let homeBtnRect = null;
let scoreSaved = false;
let deathTimer = 0;
let fireCooldown = 0;
let thrustFlicker = 0;

// ── Stars ──────────────────────────────────────────────────────────────────
function initStars() {
  stars = Array.from({ length: 160 }, () =>
    ({ x: Math.random() * vw, y: Math.random() * vh, r: 0.5 + Math.random() * 1.2, a: 0.2 + Math.random() * 0.6 }));
}

// ── High scores ────────────────────────────────────────────────────────────
function getScores() {
  try { return JSON.parse(localStorage.getItem('avoid_scores') || '[]'); }
  catch { return []; }
}
function saveScore(s) {
  const arr = getScores();
  arr.push(s);
  arr.sort((a, b) => b - a);
  arr.splice(10);
  localStorage.setItem('avoid_scores', JSON.stringify(arr));
  saveScore._rank = arr.indexOf(s) + 1;
}
saveScore._rank = 0;

// ── Asteroid helpers ───────────────────────────────────────────────────────
function makeVerts(n) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = 0.62 + Math.random() * 0.38;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}

function mkAsteroid(size, x, y, vx, vy) {
  const sz = SIZES[size];
  if (vx === undefined) {
    const a = Math.random() * Math.PI * 2;
    const spd = sz.sMin + Math.random() * (sz.sMax - sz.sMin);
    vx = Math.cos(a) * spd; vy = Math.sin(a) * spd;
  }
  return { size, x, y, vx, vy, r: sz.r, angle: 0,
           spin: (Math.random() - 0.5) * 1.4,
           verts: makeVerts(9 + Math.floor(Math.random() * 4)) };
}

function splitAsteroid(a) {
  if (!NEXT[a.size]) return [];
  const ns = NEXT[a.size], sz = SIZES[ns];
  return [0, 1].map(i => {
    const baseAng = Math.atan2(a.vy, a.vx) + (i === 0 ? 0.6 : -0.6) + (Math.random() - 0.5) * 0.4;
    const spd = sz.sMin + Math.random() * (sz.sMax - sz.sMin);
    return mkAsteroid(ns, a.x, a.y, Math.cos(baseAng) * spd, Math.sin(baseAng) * spd);
  });
}

function safeSpawnPos(minDist) {
  const cx = ship ? ship.x : vw / 2;
  const cy = ship ? ship.y : vh / 2;
  for (let t = 0; t < 30; t++) {
    const x = Math.random() * vw, y = Math.random() * vh;
    if ((x - cx) ** 2 + (y - cy) ** 2 > minDist ** 2) return { x, y };
  }
  return { x: -80, y: Math.random() * vh };
}

// ── Ship init ──────────────────────────────────────────────────────────────
function initShip() {
  ship = { x: vw / 2, y: vh / 2, angle: -Math.PI / 2,
           vx: 0, vy: 0, shieldEnergy: 100,
           shieldActive: false, invincible: true, invTimer: INVINCIBLE_T };
}

// ── Level init ─────────────────────────────────────────────────────────────
function initLevel() {
  asteroids = []; bullets = [];
  const count = 3 + level;
  for (let i = 0; i < count; i++) {
    const p = safeSpawnPos(200);
    asteroids.push(mkAsteroid('large', p.x, p.y));
  }
}

function startGame() {
  score = 0; lives = 3; level = 1; scoreSaved = false;
  gamePaused = false; particles = []; fireCooldown = 0;
  initShip(); initLevel(); state = 'playing';
}

function startLevel() {
  gamePaused = false; particles = []; fireCooldown = 0;
  initShip(); initLevel(); state = 'playing';
}

function showWaveComplete() {
  document.getElementById('lc-title').textContent = 'Wave ' + level + ' Clear!';
  document.getElementById('lc-sub').textContent   = 'Ready for wave ' + (level + 1) + '?';
  document.getElementById('level-complete').classList.remove('hidden');
}
function hideWaveComplete() {
  document.getElementById('level-complete').classList.add('hidden');
}

// ── Wrap ───────────────────────────────────────────────────────────────────
function wrap(obj) {
  const p = (obj.r || 8) + 4;
  if (obj.x < -p)     obj.x += vw + p * 2;
  if (obj.x > vw + p) obj.x -= vw + p * 2;
  if (obj.y < -p)     obj.y += vh + p * 2;
  if (obj.y > vh + p) obj.y -= vh + p * 2;
}

// ── Particles ──────────────────────────────────────────────────────────────
function spawnParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 190;
    const life = 0.35 + Math.random() * 0.55;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                     color, life, maxLife: life, r: 1.5 + Math.random() * 2.5 });
  }
}

// ── Input ──────────────────────────────────────────────────────────────────
const keys  = {};
const touch = { rotL: false, rotR: false, thrust: false, fire: false, shield: false };
let hasTouched = false;

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if ((e.code === 'Escape' || e.code === 'KeyP') && (state === 'playing' || state === 'dying'))
    gamePaused = !gamePaused;
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function touchBtnLayout() {
  const R = 34, by = vh - 58;
  return {
    rotL:   { x: 54,       y: by      },
    rotR:   { x: 126,      y: by      },
    thrust: { x: vw - 54,  y: by      },
    fire:   { x: vw - 126, y: by      },
    shield: { x: vw - 54,  y: by - 82 },
    R,
  };
}

function hitTestTouch(touchList) {
  for (const k of Object.keys(touch)) touch[k] = false;
  const b = touchBtnLayout();
  for (let i = 0; i < touchList.length; i++) {
    const tx = touchList[i].clientX / gameScale, ty = touchList[i].clientY / gameScale;
    for (const k of Object.keys(touch)) {
      const btn = b[k];
      if ((tx - btn.x) ** 2 + (ty - btn.y) ** 2 < b.R ** 2) touch[k] = true;
    }
  }
}

let tapStart = null;
canvas.addEventListener('touchstart', e => {
  e.preventDefault(); hasTouched = true;
  hitTestTouch(e.touches);
  if (e.touches.length === 1) tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (state === 'gameover') { startGame(); }
}, { passive: false });
canvas.addEventListener('touchmove',   e => { e.preventDefault(); hitTestTouch(e.touches); tapStart = null; }, { passive: false });
canvas.addEventListener('touchend', e => {
  e.preventDefault(); hitTestTouch(e.touches);
  if (tapStart && e.changedTouches.length === 1) {
    const t = e.changedTouches[0];
    if (Math.abs(t.clientX - tapStart.x) < 15 && Math.abs(t.clientY - tapStart.y) < 15)
      checkHomeBtn(t.clientX, t.clientY);
  }
  tapStart = null;
}, { passive: false });
canvas.addEventListener('touchcancel', e => { e.preventDefault(); hitTestTouch(e.touches); tapStart = null; }, { passive: false });
canvas.addEventListener('click', e => {
  if (checkHomeBtn(e.clientX, e.clientY)) return;
  if (state === 'gameover') startGame();
});

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
  return false;
}

// ── Update ─────────────────────────────────────────────────────────────────
function update(dt) {
  if (gamePaused) return;

  if (state === 'dying') {
    deathTimer -= dt;
    for (const a of asteroids) { a.x += a.vx * dt; a.y += a.vy * dt; a.angle += a.spin * dt; wrap(a); }
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    if (deathTimer <= 0) {
      if (lives <= 0) {
        state = 'gameover';
        if (!scoreSaved) { saveScore(score); scoreSaved = true; }
      } else { initShip(); state = 'playing'; }
    }
    return;
  }

  if (state !== 'playing') return;

  // ── Ship movement ──
  const rotL   = keys['ArrowLeft']  || keys['KeyA']     || touch.rotL;
  const rotR   = keys['ArrowRight'] || keys['KeyD']     || touch.rotR;
  const thrust = keys['ArrowUp']    || keys['KeyW']     || touch.thrust;
  const firing = keys['Space']      || keys['ControlLeft'] || touch.fire;
  const shield = keys['ShiftLeft']  || keys['ShiftRight']  || touch.shield;

  if (rotL) ship.angle -= ROTATE_SPD * dt;
  if (rotR) ship.angle += ROTATE_SPD * dt;

  thrustFlicker = thrust ? Math.random() : 0;

  if (thrust) {
    ship.vx += Math.cos(ship.angle) * THRUST * dt;
    ship.vy += Math.sin(ship.angle) * THRUST * dt;
    const spd = Math.hypot(ship.vx, ship.vy);
    if (spd > MAX_SPD) { ship.vx *= MAX_SPD / spd; ship.vy *= MAX_SPD / spd; }
  }

  const drag = 1 - DRAG * dt;
  ship.vx *= drag; ship.vy *= drag;
  ship.x  += ship.vx * dt; ship.y += ship.vy * dt;
  wrap(ship);

  ship.shieldActive = shield && ship.shieldEnergy > 0;
  ship.shieldEnergy = ship.shieldActive
    ? Math.max(0,   ship.shieldEnergy - SHIELD_DRAIN * dt)
    : Math.min(100, ship.shieldEnergy + SHIELD_REGEN * dt);

  if (ship.invincible) { ship.invTimer -= dt; if (ship.invTimer <= 0) ship.invincible = false; }

  // ── Fire ──
  fireCooldown -= dt;
  if (firing && fireCooldown <= 0) {
    const nx = Math.cos(ship.angle), ny = Math.sin(ship.angle);
    bullets.push({ x: ship.x + nx * (SHIP_R + 5), y: ship.y + ny * (SHIP_R + 5),
                   vx: ship.vx + nx * BULLET_SPD, vy: ship.vy + ny * BULLET_SPD,
                   life: BULLET_LIFE });
    fireCooldown = FIRE_CD;
  }

  // ── Bullets ──
  for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; wrap(b); }
  bullets = bullets.filter(b => b.life > 0);

  // ── Asteroids ──
  for (const a of asteroids) { a.x += a.vx * dt; a.y += a.vy * dt; a.angle += a.spin * dt; wrap(a); }

  // ── Bullet–asteroid collisions ──
  const newAsteroids = [];
  const usedBullets  = new Set();
  for (let ai = 0; ai < asteroids.length; ai++) {
    const a = asteroids[ai];
    let hit = false;
    for (let bi = 0; bi < bullets.length; bi++) {
      if (usedBullets.has(bi)) continue;
      const b = bullets[bi];
      if ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 < a.r ** 2) {
        hit = true;
        usedBullets.add(bi);
        score += SIZES[a.size].pts;
        spawnParticles(a.x, a.y, '#22ccff', 10);
        newAsteroids.push(...splitAsteroid(a));
        break;
      }
    }
    if (!hit) newAsteroids.push(a);
  }
  asteroids = newAsteroids;
  bullets   = bullets.filter((_, i) => !usedBullets.has(i));

  // ── Ship–asteroid collisions ──
  if (!ship.invincible) {
    for (let i = 0; i < asteroids.length; i++) {
      const a = asteroids[i];
      const dx = ship.x - a.x, dy = ship.y - a.y;
      if (dx ** 2 + dy ** 2 < (SHIP_R + a.r * 0.78) ** 2) {
        if (ship.shieldActive) {
          const dist = Math.hypot(dx, dy) || 1;
          const nx = dx / dist, ny = dy / dist;
          const spd = Math.hypot(a.vx, a.vy);
          a.vx = nx * spd * (0.9 + Math.random() * 0.3);
          a.vy = ny * spd * (0.9 + Math.random() * 0.3);
          spawnParticles(ship.x, ship.y, '#6ef', 7);
          ship.invTimer = 0.3; ship.invincible = true; // brief invincibility after deflect
        } else {
          spawnParticles(ship.x, ship.y, '#ff4455', 18);
          ship = null; lives--;
          state = 'dying'; deathTimer = 1.8;
          break;
        }
      }
    }
  }

  // ── Level complete ──
  if (state === 'playing' && asteroids.length === 0) {
    state = 'levelcomplete';
    showWaveComplete();
  }

  // ── Particles ──
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
}

// ── Draw ───────────────────────────────────────────────────────────────────
function drawStars() {
  for (const s of stars) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#fff';
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
}

function drawAsteroids() {
  ctx.strokeStyle = '#22ccff';
  ctx.lineWidth   = 1.5;
  ctx.shadowColor = '#22ccff';
  ctx.shadowBlur  = 6;
  for (const a of asteroids) {
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.angle);
    ctx.beginPath();
    ctx.moveTo(a.verts[0].x * a.r, a.verts[0].y * a.r);
    for (let i = 1; i < a.verts.length; i++) ctx.lineTo(a.verts[i].x * a.r, a.verts[i].y * a.r);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  ctx.shadowBlur = 0;
}

function drawShip() {
  if (!ship) return;
  // Flicker while invincible
  if (ship.invincible && Math.floor(Date.now() / 120) % 2 === 0) return;

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  // Thrust flame
  if (thrustFlicker > 0) {
    ctx.beginPath();
    ctx.moveTo(-8, -4);
    ctx.lineTo(-8 - 10 - thrustFlicker * 14, 0);
    ctx.lineTo(-8, 4);
    ctx.strokeStyle = Math.random() > 0.4 ? '#f84' : '#ff6';
    ctx.lineWidth   = 2;
    ctx.shadowColor = '#f84';
    ctx.shadowBlur  = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Ship triangle
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-10, -11);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-10, 11);
  ctx.closePath();
  ctx.strokeStyle = '#6ef';
  ctx.lineWidth   = 2;
  ctx.shadowColor = '#6ef';
  ctx.shadowBlur  = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  // Shield ring
  if (ship.shieldActive) {
    const flicker = 0.25 + Math.random() * 0.35;
    ctx.beginPath();
    ctx.arc(ship.x, ship.y, SHIP_R + 10, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(102,238,255,${flicker})`;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#6ef';
    ctx.shadowBlur  = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function drawBullets() {
  ctx.fillStyle   = '#fff';
  ctx.shadowColor = '#6ef';
  ctx.shadowBlur  = 8;
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawParticles() {
  ctx.shadowBlur = 4;
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
  ctx.font = '700 15px "Segoe UI",sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6ef';
  ctx.fillText('SCORE  ' + score, 16, 28);
  ctx.textAlign = 'center';
  ctx.fillText('WAVE  ' + level, vw / 2, 28);

  // Lives as tiny ships
  for (let i = 0; i < lives; i++) {
    ctx.save();
    ctx.translate(vw - 16 - i * 22, 22);
    ctx.rotate(-Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-5, -5); ctx.lineTo(-3, 0); ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.strokeStyle = '#6ef'; ctx.lineWidth = 1.5;
    ctx.shadowColor = '#6ef'; ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // Shield bar
  if (ship) {
    const bx = 16, by = 38, bw = 72, bh = 6;
    ctx.fillStyle = '#0a1f35';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = ship.shieldActive ? '#6ef' : '#1e5a80';
    ctx.shadowColor = ship.shieldActive ? '#6ef' : 'transparent';
    ctx.shadowBlur  = ship.shieldActive ? 8 : 0;
    ctx.fillRect(bx, by, bw * ship.shieldEnergy / 100, bh);
    ctx.shadowBlur = 0;
    ctx.fillStyle  = '#2a5070';
    ctx.font = '600 9px "Segoe UI",sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SHIELD', bx, by + bh + 11);
  }
  ctx.textAlign = 'left';
}

function drawTouchControls() {
  const b = touchBtnLayout();
  const btnDefs = [
    { k: 'rotL',   label: '◄', btn: b.rotL   },
    { k: 'rotR',   label: '►', btn: b.rotR   },
    { k: 'thrust', label: '▲', btn: b.thrust },
    { k: 'fire',   label: '●', btn: b.fire   },
    { k: 'shield', label: '⬡', btn: b.shield },
  ];
  for (const { k, label, btn } of btnDefs) {
    const active = touch[k];
    ctx.beginPath();
    ctx.arc(btn.x, btn.y, b.R, 0, Math.PI * 2);
    ctx.fillStyle   = active ? 'rgba(102,238,255,0.22)' : 'rgba(6,20,39,0.55)';
    ctx.strokeStyle = active ? '#6ef' : 'rgba(102,238,255,0.35)';
    ctx.lineWidth   = 1.5;
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = active ? '#6ef' : 'rgba(102,238,255,0.55)';
    ctx.font = '16px "Segoe UI",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, btn.x, btn.y);
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign    = 'left';
}

function drawOverlay(alpha) {
  ctx.fillStyle = `rgba(6,20,39,${alpha})`;
  ctx.fillRect(0, 0, vw, vh);
}

function drawPauseScreen() {
  drawOverlay(0.72);
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
  const bW = 160, bH = 36, bX = vw / 2 - 80, bY = vh / 2 + 58;
  homeBtnRect = { x: bX, y: bY, w: bW, h: bH };
  ctx.strokeStyle = '#4a7a99';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.rect(bX, bY, bW, bH); ctx.stroke();
  ctx.fillStyle = '#4a7a99';
  ctx.font = '600 13px "Segoe UI",sans-serif';
  ctx.fillText('⌂  Main Menu', vw / 2, bY + 23);
  ctx.textAlign  = 'left';
}

function drawGameOver() {
  drawOverlay(0.88);
  ctx.textAlign = 'center';
  ctx.shadowColor = '#ff4455'; ctx.shadowBlur = 36;
  ctx.fillStyle = '#ff4455';
  ctx.font = '900 60px "Segoe UI",sans-serif';
  ctx.fillText('GAME  OVER', vw / 2, vh * 0.28);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#6ef';
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
  ctx.fillText('CLICK  ·  TAP  TO  PLAY  AGAIN', vw / 2, vh * 0.28 + 290);
  ctx.textAlign = 'left';
}

function drawDying() {
  if (lives > 0) {
    drawOverlay(0.55);
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff4455'; ctx.shadowBlur = 28;
    ctx.fillStyle = '#ff4455';
    ctx.font = '900 50px "Segoe UI",sans-serif';
    ctx.fillText(lives + (lives === 1 ? '  LIFE  LEFT' : '  LIVES  LEFT'), vw / 2, vh / 2);
    ctx.shadowBlur = 0; ctx.textAlign = 'left';
  }
}

function draw() {
  ctx.fillStyle = '#061427';
  ctx.fillRect(0, 0, vw, vh);
  drawStars();
  if (state === 'start') return;
  drawAsteroids();
  drawBullets();
  drawParticles();
  drawShip();
  drawHUD();
  if ((hasTouched || matchMedia('(pointer:coarse)').matches) && state !== 'gameover') drawTouchControls();
  if (state === 'dying')    drawDying();
  if (state === 'gameover') drawGameOver();
  if (gamePaused)           drawPauseScreen();
}

// ── Main loop ──────────────────────────────────────────────────────────────
let last = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
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
  hideWaveComplete(); level++; startLevel();
});

window.addEventListener('resize', () => { resize(); initStars(); });
resize();
initStars();
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
