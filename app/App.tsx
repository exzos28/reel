// reel: the screens, driven by arrow keys, OK and Back like a remote (TV
// density on a TV, regular on a Mac, compact on a phone) and by the mouse.
// Only one screen is mounted at a time, so only its keys are bound; the
// screens keep their focus in their own modules, so Back finds it again.
// Home, Movies, Shows and Anime share one nav (screens/TopLevel.tsx).
import { effect, mount, platform, setColorScheme, signal, View } from "nsh";
import { currentWindow, titleBar } from "nsh/desktop";
import { Engine } from "app/native";
import { AboutScreen } from "./ui/screens/about/AboutScreen";
import { SearchScreen } from "./ui/screens/search/SearchScreen";
import { SettingsScreen } from "./ui/screens/settings/SettingsScreen";
import { TitleScreen } from "./ui/screens/title/TitleScreen";
import { isTopLevel, TopLevel } from "./ui/screens/TopLevel";
import { back, route } from "./ui/nav";
import { Player } from "./ui/Player";
import { status } from "./ui/playback";
import { loadSettings } from "./ui/preferences";
import { colors } from "./ui/theme";

setColorScheme("dark");
loadSettings().catch((e) => console.warn("could not load settings", e));

function App() {
  // On the Mac the window has no grey title bar: the app's own background (the
  // hero's still) runs up to the top edge, under the traffic lights.
  if (platform.os === "macos") currentWindow().set({ titleBar: { style: "hidden" } });
  const playing = () => status().phase !== "idle";
  /** Free space for the Settings screen, read when it opens. */
  const freeBytes = signal<number | null>(null);
  effect(() => {
    if (route().name !== "settings") return;
    freeBytes.set(null);
    Promise.resolve(Engine.checkSpace())
      .then((s) => freeBytes.set(JSON.parse(s).free))
      .catch(() => freeBytes.set(null));
  });
  const r = route;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink() }}>
      {/* Where the title bar was: dragging there moves the window, a double click zooms it. */}
      <View
        desktop={{ windowDrag: true }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: titleBar().height, zIndex: 10 }}
      />
      <If when={!playing()} else={<Player />}>
        <If when={isTopLevel(r().name)}>
          <TopLevel />
        </If>
        <If when={r().name === "search"}>
          <SearchScreen />
        </If>
        <If when={r().name === "settings"}>
          <SettingsScreen freeBytes={freeBytes} onClose={back} />
        </If>
        <If when={r().name === "about"}>
          <AboutScreen onClose={back} />
        </If>
        {/* Keyed by the id: a title opened from another one (More like this) is a new screen. */}
        <Each of={r().name === "title" ? [(r() as { id: string }).id] : []} key={(id) => id}>
          {(id) => <TitleScreen id={id()} />}
        </Each>
      </If>
    </View>
  );
}

mount(App);
