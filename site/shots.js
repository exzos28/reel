// The drawing of the home screen: one device at a time. The visitor's own device is picked
// first (data-shot, set in <head> before the first paint); the tabs under it pick another.
(function () {
  var tabs = document.querySelectorAll(".shot-tabs [data-s]");
  if (!tabs.length) return;
  function pick(s, focus) {
    document.documentElement.setAttribute("data-shot", s);
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-s") === s;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { pick(t.getAttribute("data-s")); });
    t.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      pick(tabs[(i + d + tabs.length) % tabs.length].getAttribute("data-s"), true);
    });
  });
  pick(document.documentElement.getAttribute("data-shot") || "tv");
})();
