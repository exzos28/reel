// reel: the screens, driven by arrow keys, OK and Back like a remote (TV
// density on a TV, regular on a Mac, compact on a phone) and by the mouse.
// Only one screen is mounted at a time, so only its keys are bound; the
// screens keep their focus in their own modules, so Back finds it again.
// The nav's destinations are the roots (screens/TopLevel.tsx); Back goes
// through one handler (ui/nav.ts `handleBack`), whatever key or button.
import { fpsEnabled, keymap, mount, platform, setColorScheme, setFpsEnabled, View } from "nsh";
import { currentWindow, titleBar } from "nsh/desktop";
import { remote } from "./ui/native";
import { mapRemoteBack } from "./ui/tvKeys";
import { AboutScreen } from "./ui/screens/about/AboutScreen";
import { TitleScreen } from "./ui/screens/title/TitleScreen";
import { TopLevel } from "./ui/screens/TopLevel";
import { handleBack, isRoot, route, useTabStacks } from "./ui/nav";
import { isTouch } from "./ui/layout/chrome";
import { ExitDialog } from "./ui/layout/ExitDialog";
import { Player } from "./ui/Player";
import { status } from "./ui/playback";
import { loadSettings } from "./ui/preferences";
import { backInTitleBar, TITLE_BAR_HEIGHT, TitleBarBack } from "./ui/layout/TopBar";
import { colors } from "./ui/theme";
import { videoUnderUi } from "./ui/VideoSurface";

setColorScheme("dark");
// The web build runs on a Samsung TV: its remote's Back becomes Escape.
if (remote) mapRemoteBack();
// A phone and a tablet keep a stack per tab (design/navigation.md, "History model").
useTabStacks(isTouch);
loadSettings().catch((e) => console.warn("could not load settings", e));

function App() {
  // ⌘⇧F (Ctrl+Shift+F elsewhere): NSH's performance monitor, to see where frames drop.
  keymap.bind("mod+shift+f", () => setFpsEnabled(!fpsEnabled()));
  // On the Mac the window has no grey title bar: the app's own background (the
  // hero's still) runs up to the top edge, under the traffic lights.
  if (platform.os === "macos") currentWindow().set({ titleBar: { style: "hidden", height: TITLE_BAR_HEIGHT } });
  // Back: Escape (a TV remote's Back arrives as Escape), through what is open first.
  keymap.bind({ escape: handleBack });
  const playing = () => status().phase !== "idle";
  const r = route;

  return (
    // While a film plays under the UI (AVPlay on a TV), the app paints no background over it.
    <View style={{ flex: 1, backgroundColor: playing() && videoUnderUi() ? "transparent" : colors.ink() }}>
      {/* Where the title bar was: dragging there moves the window, a double click zooms it. */}
      <View
        desktop={{ windowDrag: true }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: titleBar().height, zIndex: 10 }}
      />
      {/* On a Mac, Back sits in the title bar beside the traffic lights. */}
      <If when={backInTitleBar && !playing() && !isRoot(r().name)}>
        <TitleBarBack onPress={handleBack} />
      </If>
      <If when={!playing()} else={<Player />}>
        <If when={isRoot(r().name)}>
          <TopLevel />
        </If>
        <If when={r().name === "about"}>
          <AboutScreen />
        </If>
        {/* Keyed by the id: a title opened from another one (More like this) is a new screen. */}
        <Each of={r().name === "title" ? [(r() as { id: string }).id] : []} key={(id) => id}>
          {(id) => <TitleScreen id={id()} />}
        </Each>
      </If>
      <ExitDialog />
    </View>
  );
}

mount(App);
