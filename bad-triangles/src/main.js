const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let vw, vh;
let scenery = null;
const VIRT_W = 900;
let gameScale = 1;
const planetImg = new Image();
planetImg.src = 'assets/planet_02.png';

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
  scenery = null; // rebuild at new viewport size
}
window.addEventListener('resize', resize);
resize();

const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia('(pointer: coarse)').matches;
if (isMobile) {
  document.getElementById('start-controls').textContent = 'Touch left side to move  ·  Touch right side to fire';
}

// Input
const input = { left: false, right: false, up: false, down: false, shoot: false };
window.addEventListener('keydown', (e) => {
  SoundFX.resume();
  SoundFX.startAmbient();
  if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') && gameStarted && !gameOver && !gameWin) {
    paused = !paused;
    return;
  }
  if (paused) {
    if (e.key === 'h' || e.key === 'H') location.href = '../index.html';
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'a') input.left = true;
  if (e.key === 'ArrowRight' || e.key === 'd') input.right = true;
  if (e.key === 'ArrowUp' || e.key === 'w') input.up = true;
  if (e.key === 'ArrowDown' || e.key === 's') input.down = true;
  if (e.key === ' ' || e.key === 'Spacebar') input.shoot = true;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a') input.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd') input.right = false;
  if (e.key === 'ArrowUp' || e.key === 'w') input.up = false;
  if (e.key === 'ArrowDown' || e.key === 's') input.down = false;
  if (e.key === ' ' || e.key === 'Spacebar') input.shoot = false;
});

// Touch input
const touches = {};
const JOYSTICK_THRESHOLD = 22;

function updateTouchInput() {
  input.left = input.right = input.up = input.down = input.shoot = false;
  for (const id in touches) {
    const t = touches[id];
    if (t.side === 'left') {
      const dx = t.curX - t.startX;
      const dy = t.curY - t.startY;
      if (dx < -JOYSTICK_THRESHOLD) input.left  = true;
      if (dx >  JOYSTICK_THRESHOLD) input.right = true;
      if (dy < -JOYSTICK_THRESHOLD) input.up    = true;
      if (dy >  JOYSTICK_THRESHOLD) input.down  = true;
    } else {
      input.shoot = true;
    }
  }
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  SoundFX.resume();
  SoundFX.startAmbient();
  if (gameOver) { location.reload(); return; }
  for (const t of e.changedTouches) {
    touches[t.identifier] = {
      side: t.clientX / gameScale < vw * 0.65 ? 'left' : 'right',
      startX: t.clientX, startY: t.clientY,
      curX: t.clientX,   curY: t.clientY,
    };
  }
  updateTouchInput();
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (touches[t.identifier]) {
      touches[t.identifier].curX = t.clientX;
      touches[t.identifier].curY = t.clientY;
    }
  }
  updateTouchInput();
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const td = touches[t.identifier];
    if (td && paused) {
      const dx = Math.abs(t.clientX - td.startX);
      const dy = Math.abs(t.clientY - td.startY);
      if (dx < 15 && dy < 15) checkHomeBtn(t.clientX, t.clientY);
    }
    delete touches[t.identifier];
  }
  updateTouchInput();
}, { passive: false });

canvas.addEventListener('touchcancel', (e) => {
  for (const t of e.changedTouches) delete touches[t.identifier];
  updateTouchInput();
}, { passive: false });

canvas.addEventListener('click', (e) => {
  checkHomeBtn(e.clientX, e.clientY);
});

function checkHomeBtn(clientX, clientY) {
  if (!homeBtnRect || !paused) return false;
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

class Starfield {
  constructor(count) { this.stars = []; for (let i = 0; i < count; i++) this.stars.push(this._makeStar()); }
  _makeStar() { return { x: Math.random() * vw, y: Math.random() * vh, z: Math.random() * 1 + 0.2 }; }
  update(dt, speed) { for (let s of this.stars) { s.x -= speed * s.z * dt; if (s.x < 0) { s.x = vw; s.y = Math.random() * vh; } } }
  draw(ctx) { ctx.fillStyle = '#ffffff'; for (let s of this.stars) { ctx.globalAlpha = 0.6 * s.z; ctx.fillRect(s.x, s.y, 2 * s.z, 2 * s.z); } ctx.globalAlpha = 1; }
}

class Bullet {
  constructor(x, y, vx) { this.x = x; this.y = y; this.vx = vx; this.radius = 3; this.dead = false; this.trailTime = 0; }
  update(dt) {
    this.x += this.vx * dt;
    if (this.x > vw + 50 || this.x < -50) this.dead = true;
    if (!this.dead) {
      this.trailTime += dt;
      const interval = 0.012;
      while (this.trailTime >= interval) {
        this.trailTime -= interval;
        bulletTrails.push({ x: this.x, y: this.y, life: 1.0, decay: 2.4, size: this.radius });
      }
    }
  }
  draw(ctx) { ctx.fillStyle = '#ff6'; ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill(); }
}

class EnemyBullet {
  constructor(x, y, vx, vy) { this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.radius = 3; this.dead = false; this.trailTime = 0; }
  update(dt) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.x < -60 || this.x > vw + 60 || this.y < -60 || this.y > vh + 60) this.dead = true;
    if (!this.dead) {
      this.trailTime += dt;
      const interval = 0.014;
      while (this.trailTime >= interval) {
        this.trailTime -= interval;
        enemyBulletTrails.push({ x: this.x, y: this.y, life: 1.0, decay: 1.6, size: this.radius });
      }
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.fillStyle = '#f55';
    // elongate in direction of travel
    const ang = Math.atan2(this.vy, this.vx);
    ctx.translate(this.x, this.y); ctx.rotate(ang);
    ctx.beginPath(); ctx.ellipse(0, 0, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    // glow
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#f88';
    ctx.beginPath(); ctx.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

class Comet {
  constructor() {
    this.dead = false; this.radius = 10; this.trailTime = 0;
    const side = Math.random();
    const spd = 260 + Math.random() * 80;
    if (side < 0.45) {
      // from left, moving right with slight angle
      this.x = -20; this.y = laserTop + 30 + Math.random() * (vh - groundHeight - laserTop - 60);
      const ang = (Math.random() - 0.5) * 0.7;
      this.vx = spd * Math.cos(ang); this.vy = spd * Math.sin(ang);
    } else if (side < 0.55) {
      // from top, moving diagonally down
      this.x = vw * 0.15 + Math.random() * vw * 0.7; this.y = laserTop - 20;
      const ang = Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      this.vx = spd * Math.cos(ang); this.vy = Math.abs(spd * Math.sin(ang));
    } else {
      // from right, moving left
      this.x = vw + 20; this.y = laserTop + 30 + Math.random() * (vh - groundHeight - laserTop - 60);
      const ang = Math.PI + (Math.random() - 0.5) * 0.7;
      this.vx = spd * Math.cos(ang); this.vy = spd * Math.sin(ang);
    }
  }
  update(dt) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    // ground impact — explode
    if (this.y + this.radius >= vh - groundHeight) {
      triggerCometImpact(this.x, vh - groundHeight);
      this.dead = true; return;
    }
    // exit off left, right, or top — just disappear
    if (this.x < -150 || this.x > vw + 150 || this.y < -150) this.dead = true;
    if (!this.dead) {
      this.trailTime += dt;
      const spd = Math.hypot(this.vx, this.vy);
      const nx = -this.vy / spd; const ny = this.vx / spd;
      while (this.trailTime >= 0.007) {
        this.trailTime -= 0.007;
        const spread = (Math.random() - 0.5) * 5;
        cometTrails.push({ x: this.x + nx * spread, y: this.y + ny * spread, life: 1.0, decay: 0.28, size: 4 + Math.random() * 6 });
      }
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#6ef';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.45; ctx.fillStyle = '#aef';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85; ctx.fillStyle = '#dff';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

class Enemy {
  constructor(x, y, vx, vy) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.radius = 16; this.dead = false;
    this.type = Math.random() < 0.5 ? 'mantis' : 'crab';
    this.thrustTime = 0;

    // flight behaviour
    this.waveAmp    = 30  + Math.random() * 70;   // vertical weave amplitude
    this.waveFreq   = 0.6 + Math.random() * 1.4;  // weave cycles per second
    this.wavePhase  = Math.random() * Math.PI * 2;
    this.waveTime   = 0;

    // dive/climb manoeuvre
    this.manTimer   = 1.5 + Math.random() * 3.5;  // time until next manoeuvre
    this.manVy      = 0;                           // extra vertical impulse
    this.manDecay   = 3.5;

    // shooting
    // base shoot timer; increase for easier (level 1)
    this.shootTimer = (level === 1 ? 1.8 : 1.2) + Math.random() * (level === 1 ? 3.0 : 2.0);
  }
  update(dt) {
    const groundY = vh - groundHeight;
    const clearance = 14;

    // --- Non-linear flight ---
    this.waveTime += dt;

    // Continuous sine weave
    const waveForce = Math.sin(this.waveTime * this.waveFreq * Math.PI * 2 + this.wavePhase)
                      * this.waveAmp * dt * 3.5;
    this.vy += waveForce;

    // Periodic sharp manoeuvres (dive, climb, juke)
    this.manTimer -= dt;
    if (this.manTimer <= 0) {
      this.manTimer = 1.2 + Math.random() * 3.2;
      this.manVy = (Math.random() > 0.5 ? 1 : -1) * (80 + Math.random() * 160);
      // occasionally also change horizontal speed slightly for a juke
      if (Math.random() < 0.4) this.vx += (Math.random() - 0.5) * 60;
    }
    this.vy += this.manVy * dt;
    this.manVy *= 1 - this.manDecay * dt;

    // Ground avoidance
    const distToGround = (groundY - this.radius) - this.y;
    if (distToGround < clearance) {
      this.vy -= (1 - Math.max(0, distToGround) / clearance) * 8 * dt;
    }

    // Damping and clamps
    this.vy *= 1 - 1.8 * dt;
    this.vy = Math.max(-200, Math.min(200, this.vy));
    if (this.y < 30)           this.vy = Math.max(0, this.vy);
    if (this.y > vh - groundHeight - this.radius) this.vy = Math.min(0, this.vy);

    // --- Shooting ---
    this.shootTimer -= dt;
    if (this.shootTimer <= 0) {
      // reset timer (larger on low difficulty / early levels)
      this.shootTimer = (level === 1 ? 1.6 : 1.0) + Math.random() * (level === 1 ? 3.0 : 2.2);
      // never shoot if the enemy is behind the player's ship (player's back)
      const isBehind = player.facing >= 0 ? (this.x < player.x) : (this.x > player.x);
      if (isBehind) return;
      // aim roughly toward player with some spread; reduce aggression on level 1
      const dx = player.x - this.x, dy = player.y - this.y;
      const spread = level === 1 ? 0.28 : 0.18;
      const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * spread;
      const spd = (level === 1 ? 240 : 320) + Math.random() * 80;
      enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(angle) * spd, Math.sin(angle) * spd));
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.x < -100) this.dead = true;

    // thrust trail — rate and particle life scale with speed
    const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const interval = Math.max(0.012, 0.055 - spd * 0.00018); // faster = more frequent
    this.thrustTime += dt;
    const color = this.type === 'mantis' ? [0, 220, 180] : [255, 110, 20];
    while (this.thrustTime >= interval) {
      this.thrustTime -= interval;
      // emit from the rear (opposite to velocity direction)
      const nx = this.vx / (spd || 1), ny = this.vy / (spd || 1);
      const tailX = this.x - nx * 18 + (Math.random() - 0.5) * 4;
      const tailY = this.y - ny * 18 + (Math.random() - 0.5) * 4;
      const spread = 0.45;
      const baseAngle = Math.atan2(-this.vy, -this.vx);
      const angle = baseAngle + (Math.random() - 0.5) * spread;
      const pspd = 40 + Math.random() * (50 + spd * 0.18);
      enemyThrust.push({
        x: tailX, y: tailY,
        vx: Math.cos(angle) * pspd,
        vy: Math.sin(angle) * pspd,
        life: 1.0,
        decay: 1.6 + Math.random() * 1.2 - spd * 0.0008, // faster enemy = longer-lived trail
        size: 1.5 + Math.random() * 2.8 + spd * 0.004,
        r: color[0], g: color[1], b: color[2],
      });
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.type === 'mantis') {
      // engine glow
      const eg = ctx.createRadialGradient(-20, 0, 2, -20, 0, 14);
      eg.addColorStop(0, 'rgba(0,220,180,0.7)'); eg.addColorStop(1, 'rgba(0,220,180,0)');
      ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(-20, 0, 14, 0, Math.PI * 2); ctx.fill();
      // wings
      ctx.fillStyle = '#2a7a5a';
      ctx.beginPath(); ctx.moveTo(0,-3); ctx.lineTo(-14,-20); ctx.lineTo(-26,-7); ctx.lineTo(-16,4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#5fffc0'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,3); ctx.lineTo(-14,20); ctx.lineTo(-26,7); ctx.lineTo(-16,-4); ctx.closePath(); ctx.fill(); ctx.stroke();
      // body
      const bg = ctx.createLinearGradient(-18, 0, 20, 0);
      bg.addColorStop(0, '#1a5a40'); bg.addColorStop(1, '#5fffc0');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.moveTo(20,0); ctx.lineTo(8,-6); ctx.lineTo(-18,-4); ctx.lineTo(-18,4); ctx.lineTo(8,6); ctx.closePath(); ctx.fill();
      // fangs
      ctx.fillStyle = '#5fffc0';
      ctx.beginPath(); ctx.moveTo(20,0); ctx.lineTo(14,-4); ctx.lineTo(26,-6); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(20,0); ctx.lineTo(14,4); ctx.lineTo(26,6); ctx.closePath(); ctx.fill();
      // cockpit
      const cg = ctx.createRadialGradient(5,-1,1,5,-1,5);
      cg.addColorStop(0,'#aff'); cg.addColorStop(1,'#0a6a50');
      ctx.fillStyle = cg; ctx.beginPath(); ctx.ellipse(5,0,5,3,0,0,Math.PI*2); ctx.fill();
    } else {
      // crab
      // thruster glow
      const tg = ctx.createRadialGradient(-20, 0, 2, -20, 0, 12);
      tg.addColorStop(0, 'rgba(255,100,20,0.8)'); tg.addColorStop(1, 'rgba(255,100,20,0)');
      ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(-20, 0, 12, 0, Math.PI * 2); ctx.fill();
      // claws
      ctx.strokeStyle = '#c87a30'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(10,-6); ctx.lineTo(22,-16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(22,-16); ctx.lineTo(28,-11); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(22,-16); ctx.lineTo(25,-21); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10,6); ctx.lineTo(22,16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(22,16); ctx.lineTo(28,11); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(22,16); ctx.lineTo(25,21); ctx.stroke();
      // hull
      ctx.fillStyle = '#7a4a18';
      ctx.beginPath(); ctx.moveTo(17,0); ctx.lineTo(10,-9); ctx.lineTo(-6,-10); ctx.lineTo(-20,-6); ctx.lineTo(-20,6); ctx.lineTo(-6,10); ctx.lineTo(10,9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#e09040'; ctx.lineWidth = 1; ctx.stroke();
      // plate lines
      ctx.strokeStyle = '#e09040'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(-4,-10); ctx.lineTo(-2,0); ctx.lineTo(-4,10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6,-9); ctx.lineTo(4,0); ctx.lineTo(6,9); ctx.stroke();
      // eye
      const eyeg = ctx.createRadialGradient(8,0,1,8,0,5);
      eyeg.addColorStop(0,'#ff4'); eyeg.addColorStop(0.5,'#f80'); eyeg.addColorStop(1,'#600');
      ctx.fillStyle = eyeg; ctx.beginPath(); ctx.arc(8,0,5,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
}

class Explosion {
  constructor(x, y, colors, count) {
    this.dead = false;
    this.particles = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.9;
      const speed = 55 + Math.random() * 155;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: 0.75 + Math.random() * 0.75,
        size: 2.5 + Math.random() * 4.5,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 13,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }
  update(dt) {
    let alive = 0;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      alive++;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 2.2 * dt;
      p.vy *= 1 - 2.2 * dt;
      p.rot += p.spin * dt;
      p.life -= p.decay * dt;
    }
    this.dead = alive === 0;
  }
  draw(ctx) {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      const s = p.size;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.75, s * 0.75);
      ctx.lineTo(-s * 0.75, s * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

let gameStarted = false;
let gameOver = false;
let paused = false;
let homeBtnRect = null;
let scoreSaved = false;

// ── Local high scores (localStorage) ──────────────────────────
const HS_KEY = 'badTriangles_scores';
const HS_MAX = 10;

function getHighScores() {
  try { return JSON.parse(localStorage.getItem(HS_KEY)) || []; }
  catch { return []; }
}

function saveHighScore(s, lvl) {
  const scores = getHighScores();
  const now = new Date();
  const date = (now.getMonth() + 1) + '/' + now.getDate() + '/' + String(now.getFullYear()).slice(2);
  scores.push({ score: s, level: lvl, date });
  scores.sort((a, b) => b.score - a.score);
  scores.splice(HS_MAX);
  localStorage.setItem(HS_KEY, JSON.stringify(scores));
  return scores.findIndex(e => e.score === s && e.date === date && e.level === lvl);
}

function drawHighScores(titleText, titleColor) {
  if (!scoreSaved) {
    const rank = saveHighScore(score, level);
    scoreSaved = true;
    drawHighScores._rank = rank;
  }
  const myRank = drawHighScores._rank ?? -1;
  const scores = getHighScores();

  // dark overlay
  ctx.fillStyle = 'rgba(6,20,39,0.82)';
  ctx.fillRect(0, 0, vw, vh);

  const cx = vw / 2;
  const fs = Math.max(11, Math.min(18, vw / 40));

  // title
  ctx.fillStyle = titleColor;
  ctx.font = `bold ${Math.min(48, vw / 14)}px system-ui,Arial`;
  ctx.textAlign = 'center';
  ctx.fillText(titleText, cx, vh * 0.13);

  // score this run
  ctx.font = `${fs + 2}px system-ui,Arial`;
  ctx.fillStyle = '#aef';
  ctx.fillText(`Score: ${score.toLocaleString()}   Level: ${level}`, cx, vh * 0.22);

  // high scores header
  const tableTop = vh * 0.30;
  const rowH = Math.min(32, (vh * 0.55) / Math.max(scores.length, 1));
  ctx.font = `bold ${fs}px system-ui,Arial`;
  ctx.fillStyle = '#6ab';
  ctx.fillText('── HIGH SCORES ──', cx, tableTop);

  scores.forEach((e, i) => {
    const y = tableTop + (i + 1) * rowH + 6;
    const isMe = i === myRank;
    ctx.font = `${isMe ? 'bold ' : ''}${fs}px system-ui,Arial`;
    ctx.fillStyle = isMe ? '#6ef' : (i < 3 ? '#ffd' : '#8ab');
    const rank = `${i + 1}.`.padEnd(3);
    ctx.fillText(
      `${rank}  ${e.score.toLocaleString().padStart(7)}   Lvl ${e.level}   ${e.date}`,
      cx, y
    );
  });

  // replay prompt
  ctx.font = `${fs}px system-ui,Arial`;
  ctx.fillStyle = '#6ab';
  ctx.fillText(isMobile ? 'Tap to play again' : 'Reload to play again', cx, vh * 0.92);
}

class Player {
  constructor() {
    this.x = 120; this.y = vh / 2; this.vx = 0; this.vy = 0;
    this.speed = 260; this.radius = 14; this.cooldown = 0;
    this.lives = 3; this.dead = false; this.invulnerable = 0;
    this.facing = 1;       // 1 = right, -1 = left
    this.thrustTime = 0;   // accumulator for spawning thrust particles
  }
  update(dt) {
    if (gameOver) return;
    const acc = this.speed; this.vx = 0; this.vy = 0;
    if (input.left)  { this.vx = -acc; this.facing = -1; }
    if (input.right) { this.vx =  acc; this.facing =  1; }
    if (input.up)    this.vy = -acc;
    if (input.down)  this.vy =  acc;
    if (!this.dead) { this.x += this.vx * dt; this.y += this.vy * dt; }
    this.y = Math.max(laserTop + this.radius, Math.min(vh - groundHeight - this.radius, this.y));
    this.x = Math.max(20, Math.min(vw - 20, this.x));
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.invulnerable > 0) this.invulnerable -= dt;

    // spawn thrust particles while moving horizontally
    if (!this.dead && (input.left || input.right)) {
      this.thrustTime += dt;
      const interval = 0.022;
      while (this.thrustTime >= interval) {
        this.thrustTime -= interval;
        // tail is behind the nose: offset in the opposite facing direction
        const tailX = this.x - this.facing * 13;
        const tailY = this.y;
        const spread = 0.55;
        const baseAngle = this.facing > 0 ? Math.PI : 0; // shoot backwards
        const angle = baseAngle + (Math.random() - 0.5) * spread;
        const speed = 55 + Math.random() * 90;
        thrustParticles.push({
          x: tailX + (Math.random() - 0.5) * 4,
          y: tailY + (Math.random() - 0.5) * 5,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1.0,
          decay: 2.8 + Math.random() * 2.0,
          size: 1.8 + Math.random() * 3.2,
        });
      }
    } else {
      this.thrustTime = 0;
    }
  }
  canShoot() { return !this.dead && this.cooldown <= 0 && !gameOver; }
  shoot(bullets) {
    if (!this.canShoot()) return;
    const speed = 600 * this.facing;
    const noseX = this.x + this.facing * 14;
    bullets.push(new Bullet(noseX, this.y, speed));
    this.cooldown = 0.18;
    SoundFX.playShoot();
  }
  destroy() {
    if (this.dead || this.invulnerable > 0 || gameOver) return;
    this.dead = true;
    SoundFX.playExplosion();
    explosions.push(new Explosion(this.x, this.y, PLAYER_COLORS, 14));
    this.lives -= 1;
    if (this.lives <= 0) { gameOver = true; return; }
    setTimeout(() => {
      this.dead = false;
      this.invulnerable = 1.6;
      this.x = 120;
      this.y = Math.max(60, vh / 2 - 60);
    }, 700);
  }
  draw(ctx) {
    if (this.dead) return;
    ctx.save();
    if (this.invulnerable > 0) ctx.globalAlpha = 0.5 + 0.5 * Math.sin(Date.now() / 80);
    ctx.translate(this.x, this.y);
    ctx.scale(this.facing, 1);
    ctx.scale(0.42, 0.42); // scale Viper down to game size

    // engine glow
    const eg = ctx.createRadialGradient(-30, 0, 2, -30, 0, 18);
    eg.addColorStop(0, 'rgba(0,180,255,0.8)'); eg.addColorStop(1, 'rgba(0,180,255,0)');
    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(-30, 0, 18, 0, Math.PI*2); ctx.fill();

    // upper delta wing
    ctx.fillStyle = '#1a3a6a';
    ctx.beginPath(); ctx.moveTo(10,-2); ctx.lineTo(-18,-26); ctx.lineTo(-32,-8); ctx.lineTo(-14,-2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#4af'; ctx.lineWidth = 0.9; ctx.stroke();
    // lower delta wing
    ctx.beginPath(); ctx.moveTo(10,2); ctx.lineTo(-18,26); ctx.lineTo(-32,8); ctx.lineTo(-14,2); ctx.closePath(); ctx.fill(); ctx.stroke();

    // engine nacelles
    ctx.fillStyle = '#0a2a50';
    ctx.beginPath(); ctx.roundRect(-36,-10,12,6,2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-36,4,12,6,2); ctx.fill();
    ctx.fillStyle = '#0af';
    ctx.fillRect(-36,-7,3,3); ctx.fillRect(-36,7,3,3);

    // fuselage
    const hg = ctx.createLinearGradient(-28,0,36,0);
    hg.addColorStop(0,'#0a2a50'); hg.addColorStop(0.5,'#1a4a8a'); hg.addColorStop(1,'#4af');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.moveTo(36,0); ctx.lineTo(22,-6); ctx.lineTo(-24,-7); ctx.lineTo(-28,0); ctx.lineTo(-24,7); ctx.lineTo(22,6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#4af'; ctx.lineWidth = 0.8; ctx.stroke();

    // dorsal ridge
    ctx.strokeStyle = 'rgba(100,200,255,0.4)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(30,0); ctx.lineTo(-20,0); ctx.stroke();

    // cockpit
    const cg = ctx.createRadialGradient(14,-1,1,14,-1,9);
    cg.addColorStop(0,'#dff'); cg.addColorStop(0.4,'#4af'); cg.addColorStop(1,'#0a3a6a');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.ellipse(14,0,9,5,-0.15,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#8df'; ctx.lineWidth = 0.8; ctx.stroke();

    ctx.restore();
  }
}

const ENEMY_COLORS  = ['#f55', '#f77', '#fa4', '#ff8'];
const PLAYER_COLORS = ['#6ef', '#4df', '#aff', '#fff'];

const starfield = new Starfield(160);

// ── Deep background scenery (nebula + planet) ──────────────────
function createScenery() {
  const gy = vh - groundHeight; // horizon line
  return {
    // nebula blobs centred on the horizon — only top half visible above terrain
    blobs: [
      { x: vw * 0.50, y: gy, vx: -1.2, rx: 520, ry: 340, rgb: [85, 18, 155] },
      { x: vw * 0.18, y: gy, vx: -0.8, rx: 400, ry: 260, rgb: [18, 55, 180] },
      { x: vw * 0.85, y: gy, vx: -1.6, rx: 360, ry: 240, rgb: [145, 28, 105] },
    ],
    // planet centred on horizon — only top dome + rings visible above terrain
    planet: { x: vw * 0.72, y: gy, vx: -10, r: 190 },
  };
}
function updateScenery(dt) {
  if (!scenery) scenery = createScenery();
  for (const b of scenery.blobs) { b.x += b.vx * dt; if (b.x + b.rx < 0) b.x = vw + b.rx + Math.random() * 300; }
  const p = scenery.planet; p.x += p.vx * dt; if (p.x + p.r * 3 < 0) p.x = vw + p.r * 3;
}
function drawNebula(ctx) {
  if (!scenery) scenery = createScenery();
  for (const b of scenery.blobs) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(1, b.ry / b.rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, b.rx);
    g.addColorStop(0,    `rgba(${b.rgb},0.24)`);
    g.addColorStop(0.38, `rgba(${b.rgb},0.13)`);
    g.addColorStop(0.70, `rgba(${b.rgb},0.05)`);
    g.addColorStop(1,    `rgba(${b.rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, b.rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

}
function drawPlanet(ctx) {
  if (!scenery || !planetImg.complete || !planetImg.naturalWidth) return;
  const p = scenery.planet;
  // Scale image so its height spans the desired diameter; width preserves aspect ratio
  const drawH = p.r * 2.4;
  const drawW = drawH * (planetImg.naturalWidth / planetImg.naturalHeight);
  // Centre image on the horizon line — top half visible above terrain, bottom covered by ground strip
  const ix = p.x - drawW / 2;
  const iy = p.y - drawH / 2;
  ctx.save();
  ctx.filter = 'hue-rotate(185deg) saturate(0.75) brightness(0.8)';
  ctx.drawImage(planetImg, ix, iy, drawW, drawH);
  ctx.restore();
}
// ── Asteroid field — background decoration, no collision ───────
const asteroidField = [];
const ASTEROID_COLORS = ['#2a1a10','#1a1520','#2e1c12','#1e1828','#231510','#1c1a2a','#321e14','#16141e'];

function makeAsteroidPts(r) {
  const segs = 7 + Math.floor(Math.random() * 5);
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const d = r * (0.55 + Math.random() * 0.5);
    pts.push([Math.cos(a) * d, Math.sin(a) * d]);
  }
  return pts;
}
function initAsteroids() {
  for (let i = 0; i < 60; i++) {
    const r = 4 + Math.pow(Math.random(), 1.8) * 80; // bias toward small, occasional huge
    const speedScale = 1 - (r / 90);                  // big = slow, small = fast
    asteroidField.push({
      x: Math.random() * vw,
      y: 20 + Math.random() * (vh - groundHeight - 40),
      vx: -(12 + speedScale * 130),
      vy: (Math.random() - 0.5) * (20 + speedScale * 60),
      spin: (Math.random() - 0.5) * (0.4 + speedScale * 2.5),
      angle: Math.random() * Math.PI * 2,
      r, pts: makeAsteroidPts(r),
      color: ASTEROID_COLORS[Math.floor(Math.random() * ASTEROID_COLORS.length)],
      alpha: 1.0,
    });
  }
}
function updateAsteroids(dt) {
  if (asteroidField.length === 0) initAsteroids();
  const skyBottom = vh - groundHeight - 20;
  for (const a of asteroidField) {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.angle += a.spin * dt;
    if (a.x + a.r < 0) { const sc = 1 - (a.r / 90); a.x = vw + a.r + Math.random() * 200; a.y = 20 + Math.random() * (skyBottom - 20); a.vx = -(12 + sc * 130); a.vy = (Math.random() - 0.5) * (20 + sc * 60); }
    if (a.y - a.r < 20) { a.vy = Math.abs(a.vy); }
    if (a.y + a.r > skyBottom) { a.vy = -Math.abs(a.vy); }
  }
}
function drawAsteroids(ctx) {
  for (const a of asteroidField) {
    ctx.save();
    ctx.globalAlpha = a.alpha;
    ctx.translate(a.x, a.y);
    ctx.rotate(a.angle);
    ctx.beginPath();
    ctx.moveTo(a.pts[0][0], a.pts[0][1]);
    for (let i = 1; i < a.pts.length; i++) ctx.lineTo(a.pts[i][0], a.pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = a.color;
    ctx.fill();
    ctx.restore();
  }
}

const player = new Player();
const bullets = [];
const bulletTrails = [];
const enemies = [];
const explosions = [];
const thrustParticles = [];
const enemyThrust = [];
const enemyBullets = [];
const enemyBulletTrails = [];
const comets = [];
const cometTrails = [];
const shockwaves = [];
let cometTimer = 6 + Math.random() * 4;
let score = 0;
let enemyTimer = 0;
let boss = null;
let bossTimer = 18 + Math.random() * 14; // first boss in 18–32 s
let level = 1;
const MAX_LEVELS = 10;
let gameWin = false;
const powerups = [];
let powerupTimer = 12 + Math.random() * 14;
let levelComplete = false;

// Level complete modal elements
const lcModal = document.getElementById('level-complete');
const lcTitle = document.getElementById('lc-title');
const lcSub = document.getElementById('lc-sub');
const lcContinue = document.getElementById('lc-continue');
if (lcContinue) lcContinue.addEventListener('click', () => {
  levelComplete = false;
  if (lcModal) lcModal.classList.add('hidden');
  // clear active hazards so the player resumes safely
  enemies.length = 0; enemyBullets.length = 0; powerups.length = 0;
  enemyTimer = 2.0;
  bossTimer = 6 + Math.random() * 4;
  player.invulnerable = 1.6;
});

function spawnExtraLife() {
  const y = 40 + Math.random() * (vh - 120);
  const x = vw + 60;
  const vx = -100 - Math.random() * 60;
  powerups.push({ x, y, vx, radius: 12, dead: false });
}

function spawnEnemy() { const y = 30 + Math.random() * (vh - 60); const x = vw + 40; const vx = -120 - Math.random() * 160; const vy = (Math.random() - 0.5) * 80; enemies.push(new Enemy(x, y, vx, vy)); }

// ground and obstacles
const groundHeight = 80;
const laserTop = 10;           // y position of top boundary laser
const mountains  = [];   // layer 1 — farthest, slowest
const mountains2 = [];   // layer 2 — mid-back
const buildings2 = [];   // layer 3 — mid-front
const buildings  = [];   // layer 4 — closest, fastest
let obstacleTimer = 0;

function makeMountainPts() {
  const segs = 8 + Math.floor(Math.random() * 5); // 8–12 ridge segments
  const pts = [[0, 0]];
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const env = Math.sin(t * Math.PI);
    const crag = (Math.random() - 0.42) * 0.65; // bias downward for crags
    const fy = Math.max(0, env + env * crag);
    // occasional x-shift creates overhangs / undercuts
    const xShift = Math.random() < 0.22 ? (Math.random() - 0.5) * 0.11 : (Math.random() - 0.5) * 0.025;
    pts.push([t + xShift, fy]);
  }
  pts.push([1, 0]);
  return pts;
}

function makeHillPts() {
  const segs = 5 + Math.floor(Math.random() * 4); // 5–8 facets
  const pts = [[0, 0]];
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const env = Math.sin(t * Math.PI);
    const facet = (Math.random() - 0.5) * 0.9;
    const fy = Math.max(0, env * (0.55 + facet * 0.45));
    pts.push([t, fy]);
  }
  pts.push([1, 0]);
  return pts;
}

function initTerrain() {
  for (let x = -220; x < vw + 200; x += 130 + Math.random() * 90) {
    mountains.push({  x,                        w: 85  + Math.random() * 125, h: 28 + Math.random() * 62, vx: -52  - Math.random() * 10, pts: makeMountainPts() });
    mountains2.push({ x: x + Math.random() * 80, w: 80  + Math.random() * 115, h: 24 + Math.random() * 55, vx: -68  - Math.random() * 10, pts: makeMountainPts() });
    buildings2.push({ x: x + Math.random() * 60, w: 75  + Math.random() * 110, h: 18 + Math.random() * 40, vx: -86  - Math.random() * 10, pts: makeHillPts() });
    buildings.push({  x: x + Math.random() * 50, w: 70  + Math.random() * 100, h: 14 + Math.random() * 30, vx: -104 - Math.random() * 10, pts: makeHillPts() });
  }
}

function spawnObstacle() {
  const x = vw + 40;
  const r = Math.random();
  if (r < 0.25) {
    mountains.push({  x, w: 85 + Math.random() * 125, h: 28 + Math.random() * 62, vx: -52 - Math.random() * 10, pts: makeMountainPts() });
  } else if (r < 0.52) {
    mountains2.push({ x, w: 80 + Math.random() * 115, h: 24 + Math.random() * 55, vx: -68 - Math.random() * 10, pts: makeMountainPts() });
  } else if (r < 0.76) {
    buildings2.push({ x, w: 75 + Math.random() * 110, h: 18 + Math.random() * 40, vx: -86 - Math.random() * 10, pts: makeHillPts() });
  } else {
    buildings.push({  x, w: 70 + Math.random() * 100, h: 14 + Math.random() * 30, vx: -104 - Math.random() * 10, pts: makeHillPts() });
  }
}

class Boss {
  constructor() {
    this.x      = vw + 80;
    this.y      = 80 + Math.random() * (vh * 0.5);
    this.radius = 48;
    // make early boss easier on level 1
    this.hp     = level === 1 ? 3 : 5;
    this.dead   = false;

    // passes: each pass = fly to left edge, then reverse back right, repeat
    this.passes    = 0;
    this.maxPasses = 3 + Math.floor(Math.random() * 3); // 3–5 passes before leaving
    this.vx        = -(160 + Math.random() * 60);
    this.vy        = 0;
    this.targetY   = this.y;
    this.yTimer    = 0;

    // shooting — fires a 3-bullet spread
    this.shootTimer = level === 1 ? 2.4 : 1.4;
    this.warning    = true;  // show "BOSS!" banner briefly on entry
    this.warnTimer  = 2.5;

    // hit flash
    this.flashTimer = 0;

    // light rotation on the saucer
    this.lightAngle = 0;
  }

  update(dt) {
    this.lightAngle += dt * 1.8;
    if (this.flashTimer > 0) this.flashTimer -= dt;

    // warning countdown
    if (this.warning) { this.warnTimer -= dt; if (this.warnTimer <= 0) this.warning = false; }

    // drift toward a slowly-changing target Y for gentle vertical movement
    this.yTimer -= dt;
    if (this.yTimer <= 0) {
      this.yTimer   = 1.2 + Math.random() * 1.6;
      this.targetY  = 80 + Math.random() * (vh * 0.52);
    }
    this.vy += (this.targetY - this.y) * 1.8 * dt;
    this.vy *= 1 - 3.0 * dt;
    this.y  += this.vy * dt;
    this.y   = Math.max(this.radius + 10, Math.min(vh * 0.7, this.y));

    // horizontal pass logic
    this.x += this.vx * dt;

    // reached left edge — reverse
    if (this.vx < 0 && this.x < -this.radius) {
      this.passes++;
      if (this.passes >= this.maxPasses) {
        // done — exit off right
        this.vx = 200;
      } else {
        this.vx = -this.vx * (0.9 + Math.random() * 0.2);
        this.x  = -this.radius;
      }
    }
    // reached right edge after reversal — reverse again for another pass
    if (this.vx > 0 && this.x > vw + this.radius * 2 && this.passes < this.maxPasses) {
      this.vx = -this.vx;
    }
    // truly gone — mark dead (departed, not destroyed)
    if (this.vx > 0 && this.x > vw + 200) { this.dead = true; return; }

    // shoot 3-bullet spread toward player
    this.shootTimer -= dt;
    if (this.shootTimer <= 0) {
      this.shootTimer = 1.0 + Math.random() * 1.2;
      const dx = player.x - this.x, dy = player.y - this.y;
      const base = Math.atan2(dy, dx);
      const spd  = 280 + Math.random() * 60;
      for (let i = -1; i <= 1; i++) {
        const a = base + i * 0.22;
        enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(a) * spd, Math.sin(a) * spd));
      }
    }
  }

  hit() {
    this.hp--;
    this.flashTimer = 0.14;
    SoundFX.playExplosion();
    if (this.hp <= 0) {
      this.dead = true;
      // big multi-burst explosion
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          explosions.push(new Explosion(
            this.x + (Math.random() - 0.5) * 60,
            this.y + (Math.random() - 0.5) * 40,
            ['#f55','#f77','#fa4','#ff8','#fff','#c080ff'], 18
          ));
          SoundFX.playExplosion();
        }, i * 160);
      }
      score += 1000;
    }
  }

  draw(ctx) {
    const cx = this.x, cy = this.y;
    ctx.save();
    if (this.flashTimer > 0) ctx.globalAlpha = 0.4 + 0.6 * (this.flashTimer / 0.14);

    // underbelly glow
    const g = ctx.createRadialGradient(cx, cy + 10, 6, cx, cy + 10, 50);
    g.addColorStop(0, 'rgba(160,60,255,0.6)'); g.addColorStop(1, 'rgba(160,60,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, cy + 10, 50, 26, 0, 0, Math.PI * 2); ctx.fill();

    // disc body
    ctx.fillStyle = this.flashTimer > 0 ? '#fff' : '#7a6aaa';
    ctx.beginPath(); ctx.ellipse(cx, cy + 10, 44, 16, 0, 0, Math.PI * 2); ctx.fill();

    // rim highlight
    ctx.strokeStyle = '#c8a0ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, cy + 10, 44, 16, 0, Math.PI, Math.PI * 2); ctx.stroke();

    // dome
    const dg = ctx.createRadialGradient(cx - 10, cy - 6, 3, cx, cy, 26);
    dg.addColorStop(0, '#eef'); dg.addColorStop(1, '#5040a0');
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.ellipse(cx, cy, 26, 20, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c8a0ff'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(cx, cy, 26, 20, 0, Math.PI, Math.PI * 2); ctx.stroke();

    // rotating port lights
    const numLights = 7;
    for (let i = 0; i < numLights; i++) {
      const a = (Math.PI * 2 / numLights) * i + this.lightAngle;
      const lx = cx + Math.cos(a) * 38, ly = (cy + 10) + Math.sin(a) * 11;
      ctx.fillStyle = i % 2 === 0 ? '#f80' : '#0ef';
      ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();

    // health bar — drawn above the saucer, always full alpha
    const barW = 80, barH = 8;
    const barX = cx - barW / 2, barY = cy - 52;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.roundRect(barX - 1, barY - 1, barW + 2, barH + 2, 3); ctx.fill();
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 2); ctx.fill();
    const pct = Math.max(0, this.hp / 5);
    const barColor = pct > 0.6 ? '#4f4' : pct > 0.3 ? '#fa0' : '#f44';
    ctx.fillStyle = barColor;
    ctx.beginPath(); ctx.roundRect(barX, barY, barW * pct, barH, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 0.8;
    ctx.strokeRect(barX, barY, barW, barH);

    // BOSS label above bar
    ctx.fillStyle = '#c8a0ff'; ctx.font = 'bold 11px system-ui,Arial'; ctx.textAlign = 'center';
    ctx.fillText('BOSS', cx, barY - 4);
  }
}

function triggerCometImpact(x, y) {
  const blastRadius = 150;
  SoundFX.playExplosion();
  // big multi-layer explosion
  explosions.push(new Explosion(x, y, ['#fff', '#aef', '#6ef', '#aff', '#ff8'], 40));
  explosions.push(new Explosion(x, y, ['#fff', '#6ef', '#aef'], 20));
  // expanding shockwave ring
  shockwaves.push({ x, y, maxR: blastRadius, life: 1.0 });
  // blast damage
  if (!player.dead && Math.hypot(player.x - x, player.y - y) <= blastRadius + player.radius) player.destroy();
  for (let e of enemies) {
    if (e.dead) continue;
    if (Math.hypot(e.x - x, e.y - y) <= blastRadius + e.radius) {
      e.dead = true; score += 100;
      SoundFX.playExplosion();
      explosions.push(new Explosion(e.x, e.y, ENEMY_COLORS, 10));
    }
  }
  if (boss && !boss.dead && Math.hypot(boss.x - x, boss.y - y) <= blastRadius + boss.radius) {
    boss.hit(); boss.hit();
  }
}

function rectCircleCollide(cx, cy, r, ox, oy, or) { const dx = cx - ox, dy = cy - oy; return dx * dx + dy * dy <= (r + or) * (r + or); }

function update(dt) {
  starfield.update(dt, 80);
  updateScenery(dt);
  updateAsteroids(dt);
  if (!gameStarted) return;
  if (paused) return;
  if (levelComplete) return;
  player.update(dt);
  if (input.shoot && player.canShoot()) player.shoot(bullets);

  for (let b of bullets) b.update(dt);
  for (let b of enemyBullets) b.update(dt);
  for (let e of enemies) e.update(dt);
  if (boss) boss.update(dt);
  for (let m of mountains)  m.x += m.vx * dt;
  for (let m of mountains2) m.x += m.vx * dt;
  for (let b of buildings2) b.x += b.vx * dt;
  for (let b of buildings)  b.x += b.vx * dt;
  for (let c of comets) c.update(dt);

  for (let e of enemies) {
    if (e.dead) continue;
    if (rectCircleCollide(e.x, e.y, e.radius, player.x, player.y, player.radius)) {
      e.dead = true; explosions.push(new Explosion(e.x, e.y, ENEMY_COLORS, 10)); player.destroy();
    }
    for (let b of bullets) {
      if (b.dead) continue;
      if (rectCircleCollide(e.x, e.y, e.radius, b.x, b.y, b.radius)) {
        e.dead = true; b.dead = true; score += 100;
        SoundFX.playExplosion(); explosions.push(new Explosion(e.x, e.y, ENEMY_COLORS, 10));
      }
    }
  }

  // boss hit by player bullets
  if (boss && !boss.dead) {
    for (let b of bullets) {
      if (b.dead) continue;
      if (rectCircleCollide(b.x, b.y, b.radius, boss.x, boss.y, boss.radius)) {
        b.dead = true; boss.hit();
      }
    }
    // boss rams player
    if (rectCircleCollide(boss.x, boss.y, boss.radius, player.x, player.y, player.radius)) {
      player.destroy();
    }
  }
  if (boss && boss.dead) {
    // Player defeated the boss — award extra life if player survived and advance level
    if (!player.dead && !gameOver && !gameWin) {
      player.lives = Math.min(99, player.lives + 1); // reward: extra life for boss kill
      score += 500;
      level++;
      if (level > MAX_LEVELS) {
        gameWin = true;
      } else {
        // show level complete modal (previous level completed)
        levelComplete = true;
        if (lcTitle) lcTitle.textContent = `Level ${level - 1} Complete`;
        if (lcSub) lcSub.textContent = `Continue to level ${level}?`;
        if (lcModal) lcModal.classList.remove('hidden');
      }
    }
    boss = null;
    bossTimer = 22 + Math.random() * 16;
  }

  // enemy bullet hits player
  for (let b of enemyBullets) {
    if (b.dead) continue;
    if (rectCircleCollide(b.x, b.y, b.radius, player.x, player.y, player.radius)) {
      b.dead = true; player.destroy();
    }
  }

  // comet hits player or enemies
  for (let c of comets) {
    if (c.dead) continue;
    if (rectCircleCollide(c.x, c.y, c.radius, player.x, player.y, player.radius)) player.destroy();
    for (let e of enemies) {
      if (e.dead) continue;
      if (rectCircleCollide(c.x, c.y, c.radius, e.x, e.y, e.radius)) {
        e.dead = true; score += 100;
        SoundFX.playExplosion(); explosions.push(new Explosion(e.x, e.y, ENEMY_COLORS, 10));
      }
    }
    if (boss && !boss.dead && rectCircleCollide(c.x, c.y, c.radius, boss.x, boss.y, boss.radius)) {
      boss.hit();
    }
  }

  // powerups update and pickup
  for (let p of powerups) {
    if (p.dead) continue;
    p.x += p.vx * dt;
    if (p.x < -80) p.dead = true;
    if (rectCircleCollide(p.x, p.y, p.radius, player.x, player.y, player.radius)) {
      p.dead = true;
      player.lives = Math.min(99, player.lives + 1);
      score += 250;
      SoundFX.playPickup();
      explosions.push(new Explosion(player.x, player.y, ['#6ef','#aff','#fff'], 10));
    }
  }

  // laser boundary collisions
  if (player.y - player.radius <= laserTop) player.destroy();
  if (player.y + player.radius >= vh - groundHeight) player.destroy();

  for (let ex of explosions) ex.update(dt);
  for (const p of thrustParticles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 3.5 * dt; p.vy *= 1 - 3.5 * dt; p.life -= p.decay * dt; }
  for (const p of enemyThrust)    { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 3.0 * dt; p.vy *= 1 - 3.0 * dt; p.life -= p.decay * dt; }
  for (let i = bullets.length - 1; i >= 0; i--) if (bullets[i].dead) bullets.splice(i, 1);
  for (let i = enemyBullets.length - 1; i >= 0; i--) if (enemyBullets[i].dead) enemyBullets.splice(i, 1);
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
  for (let i = explosions.length - 1; i >= 0; i--) if (explosions[i].dead) explosions.splice(i, 1);
  for (let i = thrustParticles.length - 1; i >= 0; i--) if (thrustParticles[i].life <= 0) thrustParticles.splice(i, 1);
  for (let i = enemyThrust.length - 1; i >= 0; i--) if (enemyThrust[i].life <= 0) enemyThrust.splice(i, 1);
  for (const p of bulletTrails) p.life -= p.decay * dt;
  for (const p of enemyBulletTrails) p.life -= p.decay * dt;
  for (let i = bulletTrails.length - 1; i >= 0; i--) if (bulletTrails[i].life <= 0) bulletTrails.splice(i, 1);
  for (let i = enemyBulletTrails.length - 1; i >= 0; i--) if (enemyBulletTrails[i].life <= 0) enemyBulletTrails.splice(i, 1);
  for (const p of cometTrails) p.life -= p.decay * dt;
  for (let i = cometTrails.length - 1; i >= 0; i--) if (cometTrails[i].life <= 0) cometTrails.splice(i, 1);
  for (let i = comets.length - 1; i >= 0; i--) if (comets[i].dead) comets.splice(i, 1);
  for (let i = shockwaves.length - 1; i >= 0; i--) { shockwaves[i].life -= 1.4 * dt; if (shockwaves[i].life <= 0) shockwaves.splice(i, 1); }
  for (let m of mountains)  { if (m.x + m.w < -100) { m.x = vw + 60 + Math.random() * 300; m.w = 85 + Math.random() * 125; m.h = 28 + Math.random() * 62; m.pts = makeMountainPts(); } }
  for (let m of mountains2) { if (m.x + m.w < -100) { m.x = vw + 60 + Math.random() * 280; m.w = 80 + Math.random() * 115; m.h = 24 + Math.random() * 55; m.pts = makeMountainPts(); } }
  for (let b of buildings2) { if (b.x + b.w < -100) { b.x = vw + 60 + Math.random() * 260; b.w = 75 + Math.random() * 110; b.h = 18 + Math.random() * 40; b.pts = makeHillPts(); } }
  for (let b of buildings)  { if (b.x + b.w < -100) { b.x = vw + 60 + Math.random() * 240; b.w = 70 + Math.random() * 100; b.h = 14 + Math.random() * 30; b.pts = makeHillPts(); } }

  enemyTimer -= dt;
  if (!gameWin && enemyTimer <= 0) {
    spawnEnemy();
    enemyTimer = (level === 1) ? 1.2 + Math.random() * 1.8 : 0.6 + Math.random() * 1.2;
  }
  obstacleTimer -= dt;
  if (obstacleTimer <= 0) { spawnObstacle(); obstacleTimer = 0.5 + Math.random() * 1.2; }
  if (!boss && !gameWin) { bossTimer -= dt; if (bossTimer <= 0) boss = new Boss(); }

  // comet spawning
  cometTimer -= dt;
  if (!gameWin && cometTimer <= 0) { comets.push(new Comet()); cometTimer = 18 + Math.random() * 18; }

  // powerup spawning and cleanup
  powerupTimer -= dt;
  if (powerupTimer <= 0) { spawnExtraLife(); powerupTimer = 18 + Math.random() * 28; }
  for (let i = powerups.length - 1; i >= 0; i--) if (powerups[i].dead) powerups.splice(i, 1);
}

function draw() {
  ctx.fillStyle = '#061427';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawNebula(ctx);
  starfield.draw(ctx);
  drawPlanet(ctx);
  drawAsteroids(ctx);
  if (!gameStarted) return;

  // ground
  const groundY = vh - groundHeight;
  const ggrad = ctx.createLinearGradient(0, groundY, 0, vh);
  ggrad.addColorStop(0, '#2e3e4a');
  ggrad.addColorStop(1, '#1a2530');
  ctx.fillStyle = ggrad;
  ctx.fillRect(0, groundY, vw, groundHeight);

  // ground title — static, centered in the strip
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.min(52, groundHeight * 0.62)}px system-ui,Arial`;
  ctx.fillStyle = 'rgba(120,160,190,0.18)';
  ctx.fillText('BAD TRIANGLES', vw / 2, groundY + groundHeight / 2);
  ctx.restore();

  // terrain layers — back to front, colours step gradually closer in value
  const terrainLayers = [
    { arr: mountains,  top: '#162234', bot: '#061427' },
    { arr: mountains2, top: '#1e2d3e', bot: '#0c1824' },
    { arr: buildings2, top: '#263748', bot: '#13202e' },
    { arr: buildings,  top: '#2f4054', bot: '#1c2c3c' },
  ];
  for (const layer of terrainLayers) {
    for (const obj of layer.arr) {
      if (!obj.pts) continue;
      const peakY = groundY - obj.h;
      const g = ctx.createLinearGradient(0, peakY, 0, groundY);
      g.addColorStop(0, layer.top);
      g.addColorStop(1, layer.bot);
      ctx.beginPath();
      for (let i = 0; i < obj.pts.length; i++) {
        const px = obj.x + obj.pts[i][0] * obj.w, py = groundY - obj.pts[i][1] * obj.h;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  // laser boundary beams
  const pulse = 0.65 + 0.35 * Math.sin(Date.now() / 110);
  ctx.save();
  ctx.strokeStyle = '#00ff55';
  // bottom laser
  for (const [lw, alpha] of [[14, 0.10], [6, 0.30], [2, 0.80], [1, 1.0]]) {
    ctx.lineWidth = lw; ctx.globalAlpha = alpha * pulse;
    ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(vw, groundY); ctx.stroke();
  }
  // top laser
  for (const [lw, alpha] of [[14, 0.10], [6, 0.30], [2, 0.80], [1, 1.0]]) {
    ctx.lineWidth = lw; ctx.globalAlpha = alpha * pulse;
    ctx.beginPath(); ctx.moveTo(0, laserTop); ctx.lineTo(vw, laserTop); ctx.stroke();
  }
  ctx.restore();

  // comet impact shockwaves
  for (const sw of shockwaves) {
    const r = sw.maxR * (1 - sw.life);
    ctx.save();
    ctx.strokeStyle = '#aef';
    ctx.lineWidth = 4 * sw.life;
    ctx.globalAlpha = sw.life * 0.8;
    ctx.beginPath(); ctx.arc(sw.x, sw.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 12 * sw.life;
    ctx.globalAlpha = sw.life * 0.25;
    ctx.beginPath(); ctx.arc(sw.x, sw.y, r * 0.75, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // comet trails — white-hot at head, fading to ice blue
  for (const p of cometTrails) {
    const t = Math.max(0, p.life);
    ctx.save();
    ctx.globalAlpha = t * 0.88;
    ctx.fillStyle = `rgb(${Math.floor(80 + t * 175)},${Math.floor(180 + t * 75)},255)`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  for (const p of bulletTrails) {
    const t = Math.max(0, p.life);
    ctx.save(); ctx.globalAlpha = t * 0.85;
    ctx.fillStyle = '#ff6';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (let b of bullets) b.draw(ctx);

  for (const p of enemyBulletTrails) {
    const t = Math.max(0, p.life);
    ctx.save(); ctx.globalAlpha = t * 0.85;
    ctx.fillStyle = '#f55';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (let b of enemyBullets) b.draw(ctx);
  // enemy thrust trails drawn before ships so they sit behind them
  for (const p of enemyThrust) {
    const t = Math.max(0, p.life);
    ctx.save();
    ctx.globalAlpha = t * 0.75;
    ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (let e of enemies) e.draw(ctx);
  for (let c of comets) c.draw(ctx);
  if (boss) boss.draw(ctx);
  // draw powerups
  for (let p of powerups) {
    ctx.save();
    ctx.translate(p.x, p.y);
    // simple life icon: green circle with plus
    ctx.fillStyle = '#6ef'; ctx.beginPath(); ctx.arc(0, 0, p.radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(-6, -2, 12, 4); ctx.fillRect(-2, -6, 4, 12);
    ctx.restore();
  }
  // thrust particles drawn before ship so they appear behind it
  for (const p of thrustParticles) {
    const t = Math.max(0, p.life);
    ctx.save();
    ctx.globalAlpha = t * 0.85;
    // colour shifts cyan → white → transparent as it fades
    const r = Math.floor(80  + (1 - t) * 175);
    const g = Math.floor(220 + (1 - t) * 35);
    const b2 = 255;
    ctx.fillStyle = `rgb(${r},${g},${b2})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  player.draw(ctx);
  for (let ex of explosions) ex.draw(ctx);

  ctx.fillStyle = '#bfe8ff'; ctx.font = '18px system-ui,Segoe UI,Arial'; ctx.textAlign = 'left';
  ctx.fillText('Score: ' + score, 16, 28);
  ctx.fillText('Lives: ' + player.lives, 16, 52);
  ctx.fillText('Level: ' + level, 16, 76);
  if (!isMobile) { ctx.textAlign = 'right'; ctx.fillText('Controls: Arrows/WASD, Space to shoot', vw - 16, 28); }

  // boss warning banner
  if (boss && boss.warning) {
    const alpha = Math.min(1, boss.warnTimer / 1.0) * (0.6 + 0.4 * Math.sin(Date.now() / 120));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#c080ff'; ctx.font = 'bold 38px system-ui,Arial'; ctx.textAlign = 'center';
    ctx.fillText('⚠ BOSS INCOMING ⚠', vw / 2, vh / 2 - 20);
    ctx.font = '16px system-ui,Arial'; ctx.fillStyle = '#e0c0ff';
    ctx.fillText('Destroy the saucer!', vw / 2, vh / 2 + 16);
    ctx.restore();
  }

  if (gameOver) drawHighScores('GAME OVER', '#ffd');
  if (gameWin)  drawHighScores('YOU WIN!',  '#c8f7c8');

  if (paused) {
    ctx.save();
    ctx.fillStyle = 'rgba(6,20,39,0.65)';
    ctx.fillRect(0, 0, vw, vh);
    ctx.fillStyle = '#6ef';
    ctx.font = 'bold 52px system-ui,Arial';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', vw / 2, vh / 2 - 14);
    ctx.font = '18px system-ui,Arial';
    ctx.fillStyle = '#6ab';
    ctx.fillText('Press P or Esc to resume', vw / 2, vh / 2 + 22);
    const bW = 220, bH = 44, bX = vw / 2 - 110, bY = vh / 2 + 52;
    homeBtnRect = { x: bX, y: bY, w: bW, h: bH };
    ctx.fillStyle = 'rgba(74,122,153,0.18)';
    ctx.fillRect(bX, bY, bW, bH);
    ctx.strokeStyle = '#6ab';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(bX, bY, bW, bH); ctx.stroke();
    ctx.fillStyle = '#6ab';
    ctx.font = '16px system-ui,Arial';
    ctx.fillText('⌂  Main Menu    [H]', vw / 2, bY + 28);
    ctx.restore();
  }

  drawTouchControls();
}

function drawTouchControls() {
  if (!isMobile || !gameStarted || gameOver) return;

  const joyGuideX = 76, joyGuideY = vh - 88, joyR = 46;
  const fireX = vw - 76, fireY = vh - 88, fireR = 42;

  let leftTouch = null, rightTouch = null;
  for (const id in touches) {
    if (touches[id].side === 'left'  && !leftTouch)  leftTouch  = touches[id];
    if (touches[id].side === 'right' && !rightTouch) rightTouch = touches[id];
  }

  ctx.save();

  // ── Joystick ─────────────────────────────────────────────
  if (!leftTouch) {
    // idle guide ring
    ctx.strokeStyle = 'rgba(100,190,255,0.22)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(joyGuideX, joyGuideY, joyR, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(100,190,255,0.18)';
    ctx.font = '13px system-ui,Arial'; ctx.textAlign = 'center';
    ctx.fillText('MOVE', joyGuideX, joyGuideY + 5);
  } else {
    const cx = leftTouch.startX, cy = leftTouch.startY;
    const dx = leftTouch.curX - cx, dy = leftTouch.curY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clamp = Math.min(dist, joyR);
    const nx = dist > 0 ? dx / dist : 0, ny = dist > 0 ? dy / dist : 0;
    const dotX = cx + nx * clamp, dotY = cy + ny * clamp;
    // outer ring
    ctx.strokeStyle = 'rgba(100,190,255,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, joyR, 0, Math.PI * 2); ctx.stroke();
    // thumb dot
    ctx.fillStyle = 'rgba(100,190,255,0.62)';
    ctx.beginPath(); ctx.arc(dotX, dotY, 20, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(200,235,255,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // ── Fire button ──────────────────────────────────────────
  const fireActive = !!rightTouch;
  ctx.strokeStyle = fireActive ? 'rgba(255,210,60,0.92)' : 'rgba(255,210,60,0.28)';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(fireX, fireY, fireR, 0, Math.PI * 2); ctx.stroke();
  if (fireActive) {
    const fg = ctx.createRadialGradient(fireX, fireY, 0, fireX, fireY, fireR);
    fg.addColorStop(0, 'rgba(255,210,60,0.28)');
    fg.addColorStop(1, 'rgba(255,210,60,0.04)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(fireX, fireY, fireR, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = fireActive ? 'rgba(255,210,60,0.95)' : 'rgba(255,210,60,0.32)';
  ctx.font = `bold 13px system-ui,Arial`; ctx.textAlign = 'center';
  ctx.fillText('FIRE', fireX, fireY + 5);

  ctx.restore();
}

document.getElementById('start-btn').addEventListener('click', () => {
  initTerrain();
  gameStarted = true;
  SoundFX.resume();
  SoundFX.startAmbient();
  const screen = document.getElementById('start-screen');
  screen.classList.add('hidden');
  screen.addEventListener('transitionend', () => screen.remove(), { once: true });
});

let last = performance.now();
function loop(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(loop); }
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
