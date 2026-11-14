// The reel TV app's shell (docs/tizen.md):
//
// 1. Starts the core service of this package (`<packageId>.Core`) with an AppControl that
//    carries a fresh token, and waits for GET http://127.0.0.1:47391/health.
// 2. Loads the NSH web build in a full-screen iframe from the core itself,
//    http://127.0.0.1:47391/ui/index.html?reelToken=…: NSH's web runtime fetch()es its wasm
//    and chunks, which file:// URLs of a packaged widget do not allow, and the UI's RPC calls
//    become same-origin. Without a web build (shell-config.js sets REEL_WEB = false) it shows
//    a diagnostics screen instead.
// 3. Plays video with AVPlay on behalf of the page (AVPlay exists only in this top-level
//    document, and the page is cross-origin to it): the page posts {reel:"avplay", op, …} to
//    window.top, the shell answers the sender with {reel:"avplay-event", type, …}. Protocol:
//    docs/tizen.md, "Player".
//
// Plain ES2017, no build step: it has to run before anything else is known to work.
(function () {
  'use strict';

  var PORT = 47391; // reel_tizen_core::DEFAULT_PORT, service/ReelCore_App.cs
  var BASE = 'http://127.0.0.1:' + PORT;
  var HEALTH_TIMEOUT_MS = 20000;

  var token = randomToken();
  var frame = null; // the NSH build's iframe, once loaded

  function randomToken() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---- the core ----

  function serviceAppId() {
    return tizen.application.getCurrentApplication().appInfo.packageId + '.Core';
  }

  function launchCore() {
    return new Promise(function (resolve, reject) {
      var control = new tizen.ApplicationControl(
        'http://tizen.org/appcontrol/operation/default', null, null, null,
        [new tizen.ApplicationControlData('command', ['start']), new tizen.ApplicationControlData('token', [token])]
      );
      tizen.application.launchAppControl(control, serviceAppId(), resolve, function (e) { reject(new Error(e.name + ': ' + e.message)); });
    });
  }

  function health() {
    return fetch(BASE + '/health', { headers: { 'X-Reel-Token': token } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // Polls /health until the core answers with this token (a running core gets the new token
  // through the same AppControl, so an old one answers 401 until then).
  function waitForCore() {
    var until = Date.now() + HEALTH_TIMEOUT_MS;
    var last = null;
    function attempt() {
      return health().catch(function (e) {
        last = e;
        if (Date.now() > until) throw new Error('no answer from ' + BASE + ' in ' + HEALTH_TIMEOUT_MS / 1000 + ' s (' + (last && last.message) + ')');
        return sleep(250).then(attempt);
      });
    }
    return attempt();
  }

  function rpc(module, method, args) {
    return fetch(BASE + '/rpc', {
      method: 'POST',
      // text/plain keeps it a simple request: no CORS preflight.
      headers: { 'Content-Type': 'text/plain', 'X-Reel-Token': token },
      body: JSON.stringify({ module: module, method: method, args: args || [] })
    }).then(function (r) { return r.json(); }).then(function (reply) {
      if (!reply.ok) throw new Error(module + '.' + method + ': ' + reply.error);
      return reply.value;
    });
  }

  // ---- AVPlay ----

  var av = {
    listener: function (emit) {
      return {
        onbufferingstart: function () { emit({ type: 'buffering', buffering: true }); },
        onbufferingcomplete: function () { emit({ type: 'buffering', buffering: false }); },
        oncurrentplaytime: function (ms) { emit({ type: 'time', position: ms / 1000 }); },
        onstreamcompleted: function () { emit({ type: 'ended' }); },
        onerror: function (e) { emit({ type: 'error', message: String(e) }); },
        onevent: function (type, data) { emit({ type: 'event', event: type, data: data }); }
      };
    },

    open: function (url, emit) {
      var p = webapis.avplay;
      try { p.stop(); p.close(); } catch (e) { /* nothing was open */ }
      p.open(url);
      p.setDisplayRect(0, 0, 1920, 1080);
      p.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      p.setListener(av.listener(emit));
      p.prepareAsync(function () {
        emit({ type: 'loaded', duration: p.getDuration() / 1000, tracks: av.tracks() });
        p.play();
      }, function (e) { emit({ type: 'error', message: 'prepare: ' + (e && e.name) }); });
    },

    tracks: function () {
      try {
        return webapis.avplay.getTotalTrackInfo().map(function (t) {
          return { index: t.index, type: t.type, extra: t.extra_info };
        });
      } catch (e) { return []; }
    },

    handle: function (msg, emit) {
      var p = webapis.avplay;
      switch (msg.op) {
        case 'open': av.open(msg.url, emit); break;
        case 'play': p.play(); break;
        case 'pause': p.pause(); break;
        case 'seek': p.seekTo(Math.round(msg.position * 1000), function () { emit({ type: 'seeked' }); }, function (e) { emit({ type: 'error', message: 'seek: ' + (e && e.name) }); }); break;
        case 'track': p.setSelectTrack(msg.trackType, msg.index); break;
        case 'stop': try { p.stop(); p.close(); } catch (e) { /* already closed */ } break;
        default: emit({ type: 'error', message: 'unknown op ' + msg.op });
      }
    }
  };

  // The sender is NSH's app realm, a frame inside our iframe, so it is checked by origin.
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!frame || e.origin !== BASE || !msg || msg.reel !== 'avplay') return;
    var sender = e.source;
    var emit = function (event) {
      event.reel = 'avplay-event';
      sender.postMessage(event, BASE);
    };
    try { av.handle(msg, emit); } catch (err) { emit({ type: 'error', message: String(err) }); }
  });

  function registerMediaKeys() {
    try {
      tizen.tvinputdevice.registerKeyBatch(['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward']);
    } catch (e) { /* not on a TV */ }
  }

  // ---- the NSH web build ----

  function loadApp(info) {
    if (!info.ui || !info.ui.index) throw new Error('the core has no web build at ' + (info.ui && info.ui.dir));
    frame = document.createElement('iframe');
    frame.id = 'app';
    frame.src = BASE + '/ui/index.html?reelToken=' + token;
    document.body.appendChild(frame);
    frame.addEventListener('load', function () { frame.focus(); });
  }

  // ---- diagnostics (no web build yet) ----

  var steps = document.getElementById('steps');
  var log = document.getElementById('log');

  function step(text) {
    var li = document.createElement('li');
    li.className = 'wait';
    li.textContent = text;
    steps.appendChild(li);
    return {
      ok: function (detail) { li.className = 'ok'; if (detail) li.textContent += ': ' + detail; },
      fail: function (e) { li.className = 'fail'; li.textContent += ': ' + (e && e.message || e); }
    };
  }

  function say(line) { log.textContent = (line + '\n' + log.textContent).slice(0, 4000); }

  function diagnostics(info) {
    document.getElementById('diag').classList.remove('hidden');
    var s = step('RPC Fmt.position(4360)');
    rpc('Fmt', 'position', [4360]).then(s.ok, s.fail);
    var space = step('Engine.checkSpace');
    rpc('Engine', 'checkSpace', []).then(space.ok, space.fail);
    say('core ' + JSON.stringify(info));
    var ui = step('web build served by the core');
    if (info.ui && info.ui.index) ui.ok(info.ui.dir); else ui.fail('none at ' + (info.ui && info.ui.dir) + ' (expected with --shell-only)');

    var job = 0;
    var playBtn = document.getElementById('play');
    var stopBtn = document.getElementById('stop');
    playBtn.focus();
    playBtn.addEventListener('click', function () {
      var opened = step('Engine.open("sintel") → stream → AVPlay');
      rpc('Engine', 'open', ['sintel']).then(function (id) {
        job = id;
        function poll() {
          return rpc('Engine', 'status', [job]).then(function (raw) {
            var st = JSON.parse(raw);
            say('status ' + raw);
            if (st.phase === 'ready') return st.stream_url;
            if (st.phase === 'failed' || st.phase === 'no_source' || st.phase === 'no_space') throw new Error(raw);
            return sleep(1000).then(poll);
          });
        }
        return poll();
      }).then(function (url) {
        opened.ok(url);
        av.open(url, function (event) { if (event.type !== 'time') say('avplay ' + JSON.stringify(event)); });
      }).catch(opened.fail);
    });
    stopBtn.addEventListener('click', function () {
      av.handle({ op: 'stop' }, say);
      if (job) rpc('Engine', 'close', [job]);
      job = 0;
    });
    document.addEventListener('keydown', function (e) {
      if (e.keyCode === 37 || e.keyCode === 39) (document.activeElement === playBtn ? stopBtn : playBtn).focus();
      if (e.keyCode === 10009) tizen.application.getCurrentApplication().exit(); // Back
    });
  }

  // ---- start ----

  registerMediaKeys();
  var launch = step('start the core service');
  launchCore()
    .then(function () { launch.ok(serviceAppId()); })
    .catch(function (e) { launch.fail(e); }) // still poll: the service may already run
    .then(function () {
      var h = step('GET ' + BASE + '/health');
      return waitForCore().then(function (r) { h.ok(r.info.methods.length + ' methods'); return r.info; }, function (e) { h.fail(e); throw e; });
    })
    .then(function (info) {
      if (window.REEL_WEB) loadApp(info);
      else diagnostics(info);
    })
    .catch(function (e) {
      document.getElementById('diag').classList.remove('hidden');
      say('the core did not start: ' + e.message + '\nOn a rooted TV: data/startup-error.txt and data/core.log of ' + serviceAppId());
    });
})();
