// What NSH says this runtime is, read once. The platform layer's other files decide from
// it (index.ts); nothing outside `ui/platform/` reads `nsh`'s `platform`. Kept apart from
// index.ts because `native.ts` needs `web` before the core's modules exist, and index.ts
// asks the core (`Settings.device`).
import { platform } from "nsh";

export const runtime = {
  os: platform.os,
  idiom: platform.idiom,
  /** NSH's desktop behaviour (desktop OSes, and a browser in the desktop idiom: a TV's web build). */
  desktop: platform.desktop,
  /** The web build (a Samsung TV's browser): the core is reached over HTTP. */
  web: platform.os === "web",
};
