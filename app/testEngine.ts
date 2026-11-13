// A stand-in for the native engine in headless tests (`open`'s `modules`).

/** Engine calls every test needs: a film opens as job 1 and there is room. */
export const ENGINE = {
  "Engine.open": 1,
  "Engine.close": null,
  "Engine.checkSpace": JSON.stringify({ ok: true, free: 10 * 1024 ** 3, needed: 306 * 1024 ** 2, buffer: 256 }),
  "Engine.timeline": JSON.stringify({ ranges: [], ahead: 0 }),
};
