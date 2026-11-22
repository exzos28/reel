// Android's system back (remote.ts): on a phone or a tablet the system's rule (the app's
// `systemBack` says whether it took it); on Android TV the remote's Back is the system
// back, not an Escape key, and always goes through the app's Back.
// The remote's other keys come as keys the keymap knows (app/android RemoteKeys.java): OK and a
// gamepad's A as "enter"; the media keys as "f7" (rewind), "f8" (play/pause), "f9" (fast
// forward), "f10" (play) and "f12" (pause).
import { BackHandler } from "nsh/mobile";
import { caps } from ".";
import type { PlatformInput } from "./remote";

export const androidInput: PlatformInput = {
  bind(a) {
    if (caps.touch) BackHandler.on("press", a.systemBack);
    if (caps.remote) BackHandler.on("press", () => (a.back(), true));
  },
};
