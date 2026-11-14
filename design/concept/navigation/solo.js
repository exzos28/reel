// `file.html#frame-id` shows that frame alone, at its real size (render.sh).
(function () {
  var id = location.hash.slice(1);
  var f = id && document.getElementById(id);
  if (!f) return;
  document.body.classList.add("solo");
  f.classList.add("on");
})();
