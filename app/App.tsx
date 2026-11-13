// reel: the screens, driven by arrow keys, OK and Back like a remote (TV
// density on a TV, regular on a Mac, compact on a phone) and by the mouse.
// Only one screen is mounted at a time, so only its keys are bound; the
// screens keep their focus in their own modules, so Back finds it again.
import { effect, mount, setColorScheme, signal, View } from "nsh";
import { Engine } from "app/native";
import { Browse, Search } from "./ui/Browse";
import { HomeScreen } from "./ui/screens/home/HomeScreen";
import { back, route } from "./ui/nav";
import { Player } from "./ui/Player";
import { status } from "./ui/playback";
import { Settings } from "./ui/Settings";
import { Title } from "./ui/Title";
import { loadSettings } from "./ui/preferences";
import { colors } from "./ui/theme";

setColorScheme("dark");
loadSettings().catch((e) => console.warn("could not load settings", e));

function App() {
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
      <If when={!playing()} else={<Player />}>
        <If when={r().name === "home"}>
          <HomeScreen />
        </If>
        <If when={r().name === "movies"}>
          <Browse page="movies" />
        </If>
        <If when={r().name === "shows"}>
          <Browse page="shows" />
        </If>
        <If when={r().name === "search"}>
          <Search />
        </If>
        <If when={r().name === "settings"}>
          <Settings freeBytes={freeBytes} onClose={back} />
        </If>
        <If when={r().name === "title" ? (r() as { id: string }).id : null}>
          {(id) => <Title id={id()} />}
        </If>
      </If>
    </View>
  );
}

mount(App);
