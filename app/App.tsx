// Concept: the home screen, driven by arrow keys like a remote (TV density on a TV, regular on a Mac).
import { computed, keymap, mount, Scroll, setColorScheme, signal, Text, View } from "nsh";
import { t } from "nsh/i18n";
import { Fmt } from "app/native";
import { filmText, runtime, shelves, type Film } from "./data";
import { restoreLanguage } from "./ui/language";
import { Poster } from "./ui/Poster";
import { Player } from "./ui/Player";
import { play, playback, stop } from "./ui/playback";
import { Settings } from "./ui/Settings";
import { checkSpace, restoreSettings } from "./ui/preferences";
import { colors, focusRing, fonts, safe, type, u } from "./ui/theme";

setColorScheme("dark");
restoreLanguage();
restoreSettings().catch((e) => console.warn("could not restore settings", e));

function App() {
  // Focus as (shelf, item); each shelf remembers the item it was left on.
  const row = signal(0);
  const cols = signal(shelves.map(() => 0));
  const focusedFilm = computed<Film>(() => shelves[row()].items[cols()[row()]]);
  const playing = () => playback().phase !== "idle";
  const screen = signal<"home" | "settings">("home");
  /** The remote is on the top bar (Settings) instead of a shelf. */
  const onTop = signal(false);
  /** Free space for the Settings screen, read when it opens. */
  const freeBytes = signal<number | null>(null);
  const home = () => !playing() && screen() === "home";
  const openSettings = () => {
    screen.set("settings");
    checkSpace().then((s) => freeBytes.set(s.free)).catch(() => freeBytes.set(null));
  };

  const moveCol = (d: number) => {
    const r = row();
    const next = Math.min(Math.max(cols()[r] + d, 0), shelves[r].items.length - 1);
    cols.set(cols().map((c, i) => (i === r ? next : c)));
  };
  const moveRow = (d: number) => row.set(Math.min(Math.max(row() + d, 0), shelves.length - 1));

  keymap.bind(
    {
      left: () => home() && !onTop() && moveCol(-1),
      right: () => home() && !onTop() && moveCol(1),
      up: () => home() && (row() === 0 ? onTop.set(true) : moveRow(-1)),
      down: () => home() && (onTop() ? onTop.set(false) : moveRow(1)),
    },
    { repeat: true },
  );
  keymap.bind({
    enter: () => home() && (onTop() ? openSettings() : play(focusedFilm())),
    escape: () => playing() && stop(),
  });

  return (
    <If when={!playing()} else={<Player />}>
    <If when={screen() === "home"} else={<Settings freeBytes={freeBytes} onClose={() => screen.set("home")} />}>
    <Scroll style={{ flex: 1, backgroundColor: colors.hall() }}>
    <View style={{ paddingHorizontal: safe().x, paddingVertical: safe().y, gap: u(40) }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <View
          role="button"
          onPress={openSettings}
          style={{
            borderRadius: 999,
            borderWidth: 2,
            borderColor: colors.line(),
            paddingHorizontal: u(28),
            paddingVertical: u(10),
            ...focusRing(onTop()),
          }}
        >
          <Text style={{ fontFamily: fonts.body, fontSize: u(28), color: colors.screen() }}>{t("settings.title")}</Text>
        </View>
      </View>
      <FilmHeader film={focusedFilm} onWatch={() => play(focusedFilm())} />
      <Each of={shelves} key={(s) => s.id}>
        {(shelf, r) => (
          <View style={{ gap: u(20) }}>
            <Text style={{ ...type.subtitle(), color: row() === r() ? colors.screen() : colors.dim() }}>
              {t(`shelf.${shelf().id}`)}
            </Text>
            {/* Room around the posters for the focus lift and outline. */}
            <Scroll horizontal style={{ marginHorizontal: -u(16) }}>
            <View style={{ flexDirection: "row", gap: u(28), paddingHorizontal: u(16), paddingTop: u(16), paddingBottom: u(8) }}>
              <Each of={shelf().items} key={(f) => f.id}>
                {(film, c) => (
                  <Poster
                    film={film}
                    focused={() => !onTop() && row() === r() && cols()[r()] === c()}
                    rowFocused={() => !onTop() && row() === r()}
                    onPress={() => {
                      if (!onTop() && row() === r() && cols()[r()] === c()) return play(film());
                      onTop.set(false);
                      row.set(r());
                      cols.set(cols().map((x, i) => (i === r() ? c() : x)));
                    }}
                  />
                )}
              </Each>
            </View>
            </Scroll>
          </View>
        )}
      </Each>
    </View>
    </Scroll>
    </If>
    </If>
  );
}

function FilmHeader(props: { film: () => Film; onWatch: () => void }) {
  const f = props.film;
  return (
    <View style={{ gap: u(16), maxWidth: u(1100), minHeight: u(330) }}>
      <Text style={{ ...type.title(), color: colors.screen() }}>{filmText(f(), "title")}</Text>
      <Text style={{ ...type.caption(), color: colors.dim() }}>
        {t("film.meta", {
          year: f().year,
          runtime: runtime(f().minutes),
          director: filmText(f(), "director"),
        })}
      </Text>
      <Text style={{ ...type.body(), color: colors.screen(), maxWidth: u(980) }}>{filmText(f(), "about")}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: u(24), marginTop: u(8) }}>
        <View
          role="button"
          onPress={props.onWatch}
          style={{ backgroundColor: colors.beam(), borderRadius: 10, paddingHorizontal: u(36), paddingVertical: u(16) }}
          activeStyle={{ opacity: 0.85 }}
        >
          <Text style={{ fontFamily: fonts.body, fontWeight: "600", fontSize: u(32), color: colors.hall() }}>
            {f().stoppedAt != null ? t("film.resume") : t("film.watch")}
          </Text>
        </View>
        <If when={f().stoppedAt != null}>
          <Text style={{ ...type.caption(), color: colors.dim() }}>
            {t("film.resume_from", { position: Fmt.position(f().stoppedAt ?? 0) })}
          </Text>
        </If>
      </View>
    </View>
  );
}

mount(App);
