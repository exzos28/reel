// A stand-in QR code for the mockups: finder squares and a fixed pseudo-random fill.
for (const qr of document.querySelectorAll(".qr")) {
  const n = 29;
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const finder = (r, c) => [[0, 0], [0, n - 7], [n - 7, 0]].some(([fr, fc]) => {
    const y = r - fr, x = c - fc;
    if (y < 0 || x < 0 || y > 6 || x > 6) return false;
    return y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4);
  });
  const inFinderZone = (r, c) => [[0, 0], [0, n - 8], [n - 8, 0]].some(([fr, fc]) => r >= fr && r < fr + 8 && c >= fc && c < fc + 8);
  qr.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const on = inFinderZone(r, c) ? finder(r, c) : rnd() > 0.52;
    const i = document.createElement("i");
    if (on) i.className = "on";
    qr.appendChild(i);
  }
}
