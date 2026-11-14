// The desktop's navigation shortcuts (design/navigation.md, "Desktop"): Back
// (⌘[ and ⌘← on a Mac; Alt+← and Backspace outside text fields on Windows
// and Linux; Escape everywhere, bound by the app), the destinations
// (⌘/Ctrl+1–4, ⌘/Ctrl+F Search, ⌘/Ctrl+, Settings).
import { keymap } from "nsh";
import { Menu } from "nsh/desktop";
import { t } from "nsh/i18n";
import { family } from ".";
import type { InputActions, PlatformInput } from "./remote";

/** macOS: the menu bar carries the shortcuts (a menu item gets a keystroke before the
 * window does: ⌘F reached nothing as a plain binding), under Go, as Mac apps do. */
function setMacMenu({ back: handleBack, go }: InputActions) {
  Menu.setApplicationMenu([
    {
      label: "reel",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: t("menu.settings"), shortcut: "mod+,", onSelect: () => go("settings") },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "showAll" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: t("menu.edit"),
      submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    },
    {
      label: t("menu.go"),
      submenu: [
        { label: t("menu.back"), shortcut: "mod+[", onSelect: handleBack },
        { type: "separator" },
        { label: t("nav.home"), shortcut: "mod+1", onSelect: () => go("home") },
        { label: t("nav.movies"), shortcut: "mod+2", onSelect: () => go("movies") },
        { label: t("nav.shows"), shortcut: "mod+3", onSelect: () => go("shows") },
        { label: t("nav.anime"), shortcut: "mod+4", onSelect: () => go("anime") },
        { type: "separator" },
        { label: t("nav.search"), shortcut: "mod+f", onSelect: () => go("search") },
      ],
    },
    { label: t("menu.window"), submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "toggleFullScreen" }] },
  ]);
}

function bindDesktopKeys(actions: InputActions) {
  const { back: handleBack, go } = actions;
  if (family === "mac") {
    setMacMenu(actions);
    // ⌘← stays a binding: the menu shows ⌘[ for Back.
    keymap.bind({ "mod+left": handleBack });
    return;
  }
  keymap.bind({ "alt+left": handleBack });
  keymap.bind({ backspace: handleBack }, { when: "notEditing" });
  keymap.bind({
    "mod+1": () => go("home"),
    "mod+2": () => go("movies"),
    "mod+3": () => go("shows"),
    "mod+4": () => go("anime"),
    "mod+f": () => go("search"),
    "mod+,": () => go("settings"),
  });
}

/** macOS, Windows, Linux (and a desktop browser). */
export const desktopInput: PlatformInput = { bind: bindDesktopKeys };
