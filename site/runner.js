// The footer's funny part: reel's own little dinosaur runs along at an even pace and hops
// over the cacti by itself. Nothing to play, no score. With reduced motion it stands still.
(function () {
  var cv = document.getElementById("runner");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");
  var css = getComputedStyle(document.documentElement);
  var SNOW = css.getPropertyValue("--snow").trim() || "#F5F5F5";
  var ASH = css.getPropertyValue("--ash").trim() || "#8C8C8C";
  var LINE = css.getPropertyValue("--line").trim() || "#262626";
  var INK = css.getPropertyValue("--ink").trim() || "#0F0F0F";
  var RED = css.getPropertyValue("--red").trim() || "#E5383B";
  var H = 120, GROUND = 100, SPEED = 0.22, GRAV = 0.0024, JUMP = -0.66, DINO_X = 90;
  var w = 0, y = 0, vy = 0, step = 0, cacti = [], clouds = [], last = 0;
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function size() {
    var dpr = window.devicePixelRatio || 1;
    w = cv.clientWidth;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!cacti.length) for (var x = 380; x < w + 400; x += 260 + Math.random() * 260) cacti.push(cactus(x));
    if (!clouds.length) for (var c = 60; c < w; c += 220 + Math.random() * 200) clouds.push({ x: c, y: 14 + Math.random() * 26 });
    draw();
  }
  function cactus(x) { return { x: x, h: 18 + Math.random() * 16, arms: Math.random() < 0.6 }; }
  function dino(x, top, legs) {
    ctx.fillStyle = SNOW;
    // tail, body, neck and head: soft round shapes
    ctx.beginPath(); ctx.moveTo(x - 26, top + 22); ctx.quadraticCurveTo(x - 14, top + 12, x - 4, top + 14); ctx.lineTo(x - 4, top + 26); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 4, top + 22, 15, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x + 10, top + 2, 9, 18, 4); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x + 8, top - 6, 22, 14, 6); ctx.fill();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x + 22, top - 1, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(x + 25, top + 4, 1.4, 0, Math.PI * 2); ctx.fill();
    // legs: a two-step run, together in the air
    ctx.fillStyle = SNOW;
    var a = legs === 0 ? 0 : legs === 1 ? 4 : -4;
    ctx.beginPath(); ctx.roundRect(x - 4 + a, top + 30, 5, 10, 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x + 7 - a, top + 30, 5, 10, 2); ctx.fill();
  }
  function drawCactus(c) {
    ctx.fillStyle = ASH;
    ctx.beginPath(); ctx.roundRect(c.x, GROUND - c.h, 8, c.h, 4); ctx.fill();
    if (c.arms) {
      ctx.beginPath(); ctx.roundRect(c.x - 6, GROUND - c.h * 0.7, 5, c.h * 0.35, 2.5); ctx.fill();
      ctx.beginPath(); ctx.roundRect(c.x + 9, GROUND - c.h * 0.85, 5, c.h * 0.4, 2.5); ctx.fill();
    }
  }
  function draw() {
    ctx.clearRect(0, 0, w, H);
    ctx.fillStyle = LINE; ctx.fillRect(0, GROUND, w, 1);
    ctx.strokeStyle = LINE; ctx.lineWidth = 2;
    clouds.forEach(function (c) { ctx.beginPath(); ctx.roundRect(c.x, c.y, 34, 9, 4.5); ctx.stroke(); });
    cacti.forEach(drawCactus);
    var legs = y < 0 ? 0 : Math.floor(step / 90) % 2 + 1;
    dino(DINO_X, GROUND - 40 + y, legs);
  }
  function loop(now) {
    var dt = Math.min(40, now - (last || now)); last = now;
    var move = SPEED * dt;
    step += dt;
    cacti.forEach(function (c) { c.x -= move; });
    clouds.forEach(function (c) { c.x -= move * 0.25; });
    // Hop when a cactus comes near: an even arc that clears it.
    var near = cacti.some(function (c) { return c.x > DINO_X + 8 && c.x < DINO_X + 58; });
    if (near && y === 0) vy = JUMP;
    vy += GRAV * dt; y = Math.min(0, y + vy * dt); if (y === 0) vy = 0;
    if (cacti.length && cacti[0].x < -20) { cacti.shift(); }
    var far = cacti.length ? cacti[cacti.length - 1].x : w;
    if (far < w + 100) cacti.push(cactus(far + 260 + Math.random() * 300));
    if (clouds.length && clouds[0].x < -40) { clouds.shift(); clouds.push({ x: w + 20, y: 14 + Math.random() * 26 }); }
    draw();
    requestAnimationFrame(loop);
  }
  window.addEventListener("resize", size);
  size();
  if (!still) requestAnimationFrame(loop);
})();
