// Animated starfield background — same effect as the landing page (index.html).
(function () {
  const bg = document.getElementById('bg');
  if (!bg) return;
  const ctx = bg.getContext('2d');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, last = 0;
  const stars = [];

  function init() {
    const dpr = window.devicePixelRatio || 1;
    w = window.innerWidth; h = window.innerHeight;
    bg.width = Math.floor(w * dpr); bg.height = Math.floor(h * dpr);
    bg.style.width = w + 'px'; bg.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!stars.length)
      for (let i = 0; i < 400; i++)
        stars.push({ x: Math.random() * w, y: Math.random() * h, z: 0.15 + Math.random() * 0.85 });
    if (reduce) draw(0);
  }

  function draw(dt) {
    ctx.fillStyle = '#061427';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      s.x -= 30 * s.z * dt;
      if (s.x < 0) { s.x = w; s.y = Math.random() * h; }
      ctx.globalAlpha = 0.2 + 0.5 * s.z;
      ctx.fillRect(s.x, s.y, 1.5 * s.z, 1.5 * s.z);
    }
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    draw(dt);
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', init);
  window.addEventListener('load', function () {
    init();
    if (!reduce) requestAnimationFrame(loop);
  });
})();
