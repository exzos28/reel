// A stand-in for the native engine in headless tests (`open`'s `modules`).

/** Engine calls every test needs: room to play, a port, a job. */
export const ENGINE = {
  "Engine.start": 8000,
  "Engine.add": 1,
  "Engine.close": null,
  "Engine.setBufferMb": null,
  "Engine.checkSpace": JSON.stringify({ ok: true, free: 10 * 1024 ** 3, needed: 306 * 1024 ** 2, buffer: 256 }),
};
