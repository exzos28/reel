// Install: one device at a time. The visitor's own device is picked first; the tabs pick
// another. Without this script every device's row shows.
(function () {
  var tabs = document.querySelectorAll(".get-tabs [data-p]");
  var panels = document.querySelectorAll(".get-panel[data-p]");
  if (!tabs.length) return;
  document.documentElement.classList.add("js");
  function pick(p, focus) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-p") === p;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    panels.forEach(function (x) { x.classList.toggle("on", x.getAttribute("data-p") === p); });
  }
  function guess() {
    var ua = navigator.userAgent || "";
    if (/Tizen|SMART-TV/i.test(ua)) return "tizen";
    if (/Android/i.test(ua)) return "android";
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
    if (/Windows/i.test(ua)) return "windows";
    if (/Linux|X11/i.test(ua)) return "linux";
    return "mac";
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { pick(t.getAttribute("data-p")); });
    t.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      pick(tabs[(i + d + tabs.length) % tabs.length].getAttribute("data-p"), true);
    });
  });
  pick(guess());
})();
