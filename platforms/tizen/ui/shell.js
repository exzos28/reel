// The reel TV app's shell (docs/tizen.md):
//
// 1. Starts the core service of this package (the other app in it) with an AppControl that
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
// 4. Leaves the app when the page asks ({reel:"exit"}: the viewer confirmed "Exit reel?").
//
// Plain ES2017, no build step: it has to run before anything else is known to work.
(function () {
  'use strict';

  var PORT = 47391; // reel_tizen_core::DEFAULT_PORT, service/ReelCore_App.cs
  var BASE = 'http://127.0.0.1:' + PORT;
  var HEALTH_TIMEOUT_MS = 20000;
  // Sintel (Blender Foundation, CC BY 3.0), the open test torrent the core's tests stream too
  // (app/engine/src/engine.rs SINTEL).
  var SINTEL = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel'
    + '&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969'
    + '&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent';

  var token = randomToken();
  var frame = null; // the NSH build's iframe, once loaded

  function randomToken() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---- the core ----

  // The core service's app id: the other app of this package. The .NET packaging names it after
  // the project (ReelTizen1.ReelCore), whatever tizen-manifest.xml says, so it is looked up.
  var coreId = null;
  function serviceAppId() { return coreId || '(not found yet)'; }

  function findCore() {
    return new Promise(function (resolve, reject) {
      var me = tizen.application.getCurrentApplication().appInfo;
      tizen.application.getAppsInfo(function (apps) {
        var mine = apps.filter(function (a) { return a.packageId === me.packageId && a.id !== me.id; });
        if (!mine.length) return reject(new Error('no other app in package ' + me.packageId));
        coreId = mine[0].id;
        resolve(coreId);
      }, function (e) { reject(new Error(e.name + ': ' + e.message)); });
    });
  }

  function launchCore() {
    return findCore().then(function (id) {
      return new Promise(function (resolve, reject) {
        var control = new tizen.ApplicationControl(
          'http://tizen.org/appcontrol/operation/default', null, null, null,
          [new tizen.ApplicationControlData('command', ['start']), new tizen.ApplicationControlData('token', [token])]
        );
        tizen.application.launchAppControl(control, id, function () { resolve(id); }, function (e) { reject(new Error(e.name + ': ' + e.message)); });
      });
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
        onbufferingstart: function () { note('avplay buffering'); emit({ type: 'buffering', buffering: true }); },
        onbufferingcomplete: function () { note('avplay buffered'); emit({ type: 'buffering', buffering: false }); },
        oncurrentplaytime: function (ms) { emit({ type: 'time', position: ms / 1000 }); },
        onstreamcompleted: function () { emit({ type: 'ended' }); },
        onerror: function (e) { note('avplay error ' + e); emit({ type: 'error', message: String(e) }); },
        onevent: function (type, data) { note('avplay event ' + type + ' ' + data); emit({ type: 'event', event: type, data: data }); }
      };
    },

    // `hold`: prepared, AVPlay waits for the page's `play` (it picks the audio track first).
    // The stream AVPlay has open (null: none): a late `stop` or a callback of an older one
    // must not touch the next.
    current: null,

    open: function (url, emit, hold) {
      if (typeof webapis === 'undefined' || !webapis.avplay) throw new Error('webapis.avplay is not available');
      var p = webapis.avplay;
      try { p.stop(); p.close(); } catch (e) { /* nothing was open */ }
      av.resetSeek();
      av.current = url;
      // What AVPlay says about this stream, only while it is still the one open.
      var mine = function (event) { if (av.current === url) emit(event); };
      emit({ type: 'step', step: 'open ' + url });
      p.open(url);
      p.setDisplayRect(0, 0, 1920, 1080);
      p.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      p.setListener(av.listener(mine));
      emit({ type: 'step', step: 'prepareAsync, state ' + p.getState() });
      p.prepareAsync(function () {
        if (av.current !== url) return;
        mine({ type: 'loaded', duration: p.getDuration() / 1000, tracks: av.tracks() });
        if (hold) return;
        p.play();
        mine({ type: 'step', step: 'play, state ' + p.getState() });
      }, function (e) {
        if (av.current !== url) return note('avplay prepare of an older stream: ' + (e && (e.name || e)));
        mine({ type: 'error', message: 'prepare: ' + (e && (e.name + ' ' + e.message)) });
      });
    },

    tracks: function () {
      try {
        return webapis.avplay.getTotalTrackInfo().map(function (t) {
          return { index: t.index, type: t.type, extra: t.extra_info };
        });
      } catch (e) { return []; }
    },

    // AVPlay takes one seekTo at a time: another while one runs fails or is lost, and the
    // player can hang. Remote presses come faster than that, so a seek waits for the one
    // running, and only the latest target waits (the ones in between are skipped).
    seeking: false,
    pendingSeek: null,
    seekTimer: null,
    resetSeek: function () {
      av.seeking = false;
      av.pendingSeek = null;
      if (av.seekTimer) clearTimeout(av.seekTimer);
      av.seekTimer = null;
    },
    seek: function (ms, emit) {
      var p = webapis.avplay;
      if (av.seeking) { av.pendingSeek = ms; return; }
      av.seeking = true;
      var t0 = Date.now();
      var state = p.getState();
      var finished = false;
      var done = function (ok, e) {
        if (finished) return;
        finished = true;
        if (av.seekTimer) clearTimeout(av.seekTimer);
        av.seekTimer = null;
        av.seeking = false;
        note('avplay seek ' + ms + ' ms from ' + state + ': ' + (ok ? 'done' : 'failed ' + (e && (e.name || e))) + ' in ' + (Date.now() - t0) + ' ms');
        if (av.pendingSeek != null) {
          var next = av.pendingSeek;
          av.pendingSeek = null;
          av.seek(next, emit);
        } else if (ok) emit({ type: 'seeked' });
        else emit({ type: 'error', message: 'seek: ' + (e && (e.name || e)) });
      };
      // Some firmware never calls back: after 10 s the next seek may go anyway.
      av.seekTimer = setTimeout(function () { done(false, 'no answer in 10 s'); }, 10000);
      // seekTo holds this page's thread (and the app's, in the same renderer) until AVPlay has
      // data at the target, seconds on a stream still downloading: two frames first, so the
      // app's loader, asked for with the seek, is on screen while it waits.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try {
            p.seekTo(ms, function () { done(true); }, function (e) { done(false, e); });
          } catch (e) { done(false, e); }
        });
      });
    },

    // Each op only in the states AVPlay takes it in (an op in another state throws
    // InvalidStateError): one that comes too early or too late — a pause before the prepared
    // stream plays, a play after it was closed — is skipped and logged, never an error.
    allowed: {
      play: ['READY', 'PAUSED'],
      pause: ['PLAYING'],
      seek: ['READY', 'PLAYING', 'PAUSED'],
      track: ['READY', 'PLAYING', 'PAUSED']
    },

    handle: function (msg, emit) {
      var p = webapis.avplay;
      if (msg.op === 'open') return av.open(msg.url, emit, !!msg.hold);
      if (msg.op === 'stop') {
        // A stop of the stream that was open before this one (a view that left after the next
        // one opened) leaves the next alone.
        if (msg.url && msg.url !== av.current) return note('avplay stop of an older stream, skipped');
        av.resetSeek();
        av.current = null;
        try { p.stop(); p.close(); } catch (e) { /* already closed */ }
        return;
      }
      var states = av.allowed[msg.op];
      if (!states) return emit({ type: 'error', message: 'unknown op ' + msg.op });
      var state = p.getState();
      if (states.indexOf(state) < 0) return note('avplay ' + msg.op + ' skipped in ' + state);
      try {
        switch (msg.op) {
          case 'play': p.play(); break;
          case 'pause': p.pause(); break;
          case 'seek': av.seek(Math.round(msg.position * 1000), emit); break;
          case 'track': p.setSelectTrack(msg.trackType, msg.index); break;
        }
      } catch (e) {
        // AVPlay moved on between the check and the call: logged, the stream plays on.
        note('avplay ' + msg.op + ' failed in ' + state + ': ' + (e && (e.name || e)));
      }
    }
  };

  // The app has drawn its first frame: the splash goes.
  window.addEventListener('message', function (e) {
    if (e.origin === BASE && e.data && e.data.reel === 'ready') hideSplash();
  });

  // The sender is NSH's app realm, a frame inside our iframe, so it is checked by origin.
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!frame || e.origin !== BASE || !msg) return;
    if (msg.reel === 'exit') {
      try { tizen.application.getCurrentApplication().exit(); } catch (err) { /* not on a TV */ }
      return;
    }
    if (msg.reel !== 'avplay') return;
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
    frame.src = BASE + '/ui/index.html?reelToken=' + token + (window.REEL_PERF ? '&reelPerf=1' : '');
    document.body.appendChild(frame);
    frame.addEventListener('load', function () { frame.focus(); });
    // The splash stays until the app says it has drawn (the page is white until the web
    // runtime has started it); at most 20 s, should that never come.
    setTimeout(hideSplash, 20000);
  }

  /** The splash goes (it fades), and the page turns transparent for the video plane. */
  function hideSplash() {
    var splash = document.getElementById('splash');
    if (!splash || splash.className === 'gone') return;
    document.documentElement.className = 'ready';
    splash.className = 'gone';
    setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 500);
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
      ok: function (detail) { li.className = 'ok'; if (detail) li.textContent += ': ' + detail; note('OK ' + li.textContent); },
      fail: function (e) { li.className = 'fail'; li.textContent += ': ' + (e && e.message || e); note('FAIL ' + li.textContent); }
    };
  }

  function say(line) {
    log.textContent = (line + '\n' + log.textContent).slice(0, 4000);
    note(line);
  }

  // ---- the shell's own log, kept by the core for GET http://<TV>:47392/logs ----

  var LOGS = 'http://127.0.0.1:47392';
  var journal = [];
  var pending = null;
  // Sends the whole journal (the core keeps the last copy), batched; while the core is not up
  // it tries again every 3 s.
  function flush(delay) {
    if (pending) return;
    pending = setTimeout(function () {
      pending = null;
      fetch(LOGS + '/shell-log', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: journal.join('\n') })
        .catch(function () { flush(3000); });
    }, delay);
  }
  function note(line) {
    journal.push(new Date().toISOString() + ' ' + line);
    if (journal.length > 500) journal.shift();
    flush(500);
  }
  window.addEventListener('error', function (e) { note('js error: ' + e.message + ' at ' + e.filename + ':' + e.lineno); });
  window.addEventListener('unhandledrejection', function (e) { note('unhandled rejection: ' + (e.reason && e.reason.message || e.reason)); });

  function diagnostics(info) {
    hideSplash();
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
      var opened = step('Engine.openRelease(Sintel) → stream → AVPlay');
      rpc('Engine', 'openRelease', [SINTEL, 0, 0]).then(function (id) {
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
        // The core's side while it plays: speed, people, how much of the start is in.
        var watch = setInterval(function () {
          if (!job) return clearInterval(watch);
          rpc('Engine', 'status', [job]).then(function (raw) { say('status ' + raw); }, function (e) { say('status: ' + e.message); });
        }, 2000);
        var lastTime = 0;
        av.open(url, function (event) {
          if (event.type === 'time') {
            if (event.position - lastTime < 5) return;
            lastTime = event.position;
          }
          say('avplay ' + JSON.stringify(event));
        });
      }).catch(function (e) { say('FAIL ' + (e && e.message || e)); opened.fail(e); });
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
  // Shown at once: the page is transparent over the video plane, so nothing on it is a black screen.
  if (!window.REEL_WEB) {
    hideSplash();
    document.getElementById('diag').classList.remove('hidden');
  }
  note('shell ' + navigator.userAgent);
  var launch = step('start the core service');
  launchCore()
    .then(function (id) { launch.ok(id); })
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
      hideSplash();
      document.getElementById('diag').classList.remove('hidden');
      say('the core did not start: ' + e.message + '\nOn a rooted TV: data/startup-error.txt and data/core.log of ' + serviceAppId());
    });
})();
