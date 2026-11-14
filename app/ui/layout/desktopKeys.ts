// The desktop's navigation shortcuts (design/navigation.md, "Desktop"): Back
// (⌘[ and ⌘← on a Mac; Alt+← and Backspace outside text fields on Windows
// and Linux; Escape everywhere, bound by the app), the destinations
// (⌘/Ctrl+1–4, ⌘/Ctrl+F Search, ⌘/Ctrl+, Settings).
import { keymap } from "nsh";
import { go, handleBack } from "../nav";
import { chrome } from "./chrome";

export function bindDesktopKeys() {
  if (chrome === "mac") keymap.bind({ "mod+[": handleBack, "mod+left": handleBack });
  else {
    keymap.bind({ "alt+left": handleBack });
    keymap.bind({ backspace: handleBack }, { when: "notEditing" });
  }
  keymap.bind({
    "mod+1": () => go("home"),
    "mod+2": () => go("movies"),
    "mod+3": () => go("shows"),
    "mod+4": () => go("anime"),
    "mod+f": () => go("search"),
    "mod+,": () => go("settings"),
  });
}
