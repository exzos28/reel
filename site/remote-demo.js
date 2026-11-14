// The "Made for the remote" demo: a small reel screen moved with the arrow keys or the
// buttons beside it. Rows of public-domain titles, a white ring on the focused one, the
// row slides under a fixed focus line; OK opens a title, Back closes it.
(function () {
  var root = document.getElementById("remote-demo");
  if (!root) return;
  var ROWS = [
    ["Metropolis", "Nosferatu", "The General", "Sherlock Jr.", "Safety Last!", "The Kid", "Häxan"],
    ["The Cabinet of Dr. Caligari", "Battleship Potemkin", "Sunrise", "The Gold Rush", "Faust", "Wings"],
    ["A Trip to the Moon", "Flash Gordon", "Aelita", "Woman in the Moon", "Things to Come", "Just Imagine"],
  ];
  var HUES = [12, 210, 38, 280, 160, 330, 95];
  var rows = root.querySelectorAll(".rd-row");
  var lanes = root.querySelectorAll(".rd-cards");
  var stack = root.querySelector(".rd-rows");
  var open = root.querySelector(".rd-open");
  var openTitle = root.querySelector(".rd-open-title");
  var at = { row: 0, col: [0, 0, 0] };
  ROWS.forEach(function (titles, r) {
    titles.forEach(function (t, c) {
      var card = document.createElement("div");
      card.className = "rd-card";
      card.style.setProperty("--h", HUES[(r * 3 + c) % HUES.length]);
      card.innerHTML = "<span>" + t + "</span>";
      lanes[r].appendChild(card);
    });
  });
  function paint() {
    rows.forEach(function (row, r) {
      row.classList.toggle("on", r === at.row);
      var cards = lanes[r].children;
      for (var c = 0; c < cards.length; c++) cards[c].classList.toggle("focus", r === at.row && c === at.col[r]);
      // The focused card stays at the left of its row; the row slides.
      lanes[r].style.transform = "translateX(calc(" + -at.col[r] + " * (var(--card) + var(--gap))))";
    });
    stack.style.transform = "translateY(calc(" + -at.row + " * var(--rowh)))";
  }
  function press(k) {
    if (!open.hidden) {
      if (k === "back" || k === "ok") open.hidden = true;
      return;
    }
    if (k === "up") at.row = Math.max(0, at.row - 1);
    if (k === "down") at.row = Math.min(ROWS.length - 1, at.row + 1);
    if (k === "left") at.col[at.row] = Math.max(0, at.col[at.row] - 1);
    if (k === "right") at.col[at.row] = Math.min(ROWS[at.row].length - 1, at.col[at.row] + 1);
    if (k === "ok") {
      openTitle.textContent = ROWS[at.row][at.col[at.row]];
      open.hidden = false;
    }
    paint();
  }
  root.querySelectorAll("[data-k]").forEach(function (b) {
    b.addEventListener("click", function () { press(b.getAttribute("data-k")); });
  });
  var KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "ok", Escape: "back", Backspace: "back" };
  root.addEventListener("keydown", function (e) {
    var k = KEYS[e.key];
    if (!k || (e.target.tagName === "BUTTON" && e.key === "Enter")) return;
    e.preventDefault();
    press(k);
  });
  paint();
})();
