// Diagnostics switch of a `--perf` TV build (tvKeys.perfProbe turns it on): code on hot
// paths checks `perf.on` and logs "[perf]" lines through the forwarded console.
export const perf = { on: false };
