// Settings, a nav destination: Language (of titles and descriptions),
// Playback (buffer size), Search source (the user's Jackett) and About reel.
// Up/down move the focus through the languages, the buffer sizes and on to
// About (Up from the first language: the nav); OK chooses (or opens About).
// Back takes the focus to the nav, then Home. A click chooses too; the source
// fields take text (on a TV, entering it from a phone comes later).
import { keymap, signal, Text, View, type ViewRef, type ViewStyle } from "nsh";
import { Engine } from "../../native";
import { t } from "nsh/i18n";
import { clamp } from "../../focus/memory";
import { useRootBack } from "../../focus/rootBack";
import { isTouch } from "../../layout/chrome";
import { NAV_BOTTOM } from "../../layout/NavBar";
import { NAV } from "../../layout/navItems";
import { showNav } from "../../layout/navState";
import { rowStyle } from "../../kit/Row";
import { labelText, pageTitle } from "../../kit/text";
import { Screen } from "../../layout/Screen";
import { scroller } from "../../layout/Scroller";
import { go, onBack, openAbout } from "../../nav";
import {
  bufferChoices, chooseBuffer, chooseContentLanguage, contentLanguage, contentLanguages, toggleStreamDetails,
} from "../../preferences";
import { colors, safe, u } from "../../theme";
import { BufferSection, bufferChoiceList } from "./BufferSection";
import { DetailsSection } from "./DetailsSection";
import { languageChoices, LanguageSection } from "./LanguageSection";
import { ChoicePanel } from "../../layout/ChoicePanel";
import { SourceSection } from "./SourceSection";

const aboutRow = (focused: boolean): ViewStyle => ({
  ...rowStyle(false, focused),
  height: u(68),
  paddingHorizontal: u(28),
  maxWidth: u(720),
});

/** The row that opens About reel (its data sources and their notices). */
function AboutRow(props: { focused: () => boolean; viewRef: (r: ViewRef) => void; onPress: () => void }) {
  return (
    <View
      ref={props.viewRef}
      role="button"
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={aboutRow(props.focused())}
    >
      <Text style={labelText()}>{t("settings.about.open")}</Text>
    </View>
  );
}

/** The title where a destination's page starts (170 on a TV). */
const pageStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, paddingTop: u(NAV_BOTTOM + 58), gap: u(32) });
const SETTINGS_AT = NAV.findIndex((n) => n.id === "settings");

/** Back from About finds the focus on its row. */
let backFromAbout = false;

/** Free space on this device (bytes) as Settings opens; null until the core answers. */
function readFreeSpace() {
  const free = signal<number | null>(null);
  Promise.resolve(Engine.checkSpace())
    .then((s) => free.set(JSON.parse(s).free))
    .catch(() => free.set(null));
  return free;
}

export function SettingsScreen() {
  const freeBytes = readFreeSpace();
  /** The focus goes through the language row, the buffer row, stream details, then About. */
  const LANGUAGE_AT = 0;
  const BUFFER_AT = 1;
  const detailsAt = () => 2;
  const aboutAt = () => 3;
  const focus = signal(backFromAbout ? aboutAt() : 0);
  /** The drawer of choices open (the language's or the buffer's), its focus on `pickAt`. */
  const picker = signal<"language" | "buffer" | null>(null);
  const pickAt = signal(0);
  const choices = () => (picker() === "buffer" ? bufferChoiceList() : languageChoices());
  const open = (which: "language" | "buffer") => {
    focus.set(which === "language" ? LANGUAGE_AT : BUFFER_AT);
    onNav.set(false);
    picker.set(which);
    pickAt.set(Math.max(0, choices().findIndex((c) => c.selected)));
  };
  const pick = (i: number) => {
    const which = picker();
    if (which === "language") {
      const l = contentLanguages()[i];
      if (l) chooseContentLanguage(l.tag);
    } else if (which === "buffer") {
      const c = bufferChoices()[i];
      if (c) chooseBuffer(c.mb);
    }
    picker.set(null);
  };
  // Back closes the drawer first.
  onBack(() => (picker() ? (picker.set(null), true) : false));
  backFromAbout = false;
  const about = () => {
    focus.set(aboutAt());
    backFromAbout = true;
    openAbout();
  };
  const move = (d: number) => focus.set(clamp(focus() + d, aboutAt()));
  /** The focus is in the nav, on `navAt`. */
  const onNav = signal(false);
  const navAt = signal(SETTINGS_AT);
  const toNav = () => {
    navAt.set(SETTINGS_AT);
    onNav.set(true);
  };
  /** The row the focus is on, -1 while it is in the nav. */
  const at = () => (onNav() ? -1 : focus());

  keymap.bind(
    {
      up: () =>
        picker() ? pickAt.set(Math.max(pickAt() - 1, 0)) : onNav() ? undefined : focus() === 0 ? toNav() : move(-1),
      down: () =>
        picker() ? pickAt.set(Math.min(pickAt() + 1, choices().length - 1)) : onNav() ? onNav.set(false) : move(1),
      left: () => onNav() && navAt.set(clamp(navAt() - 1, NAV.length - 1)),
      right: () => onNav() && navAt.set(clamp(navAt() + 1, NAV.length - 1)),
    },
    { repeat: true },
  );
  keymap.bind({
    enter: () => {
      if (picker()) return pick(pickAt());
      if (onNav()) return go(NAV[navAt()].id);
      const f = focus();
      if (f === aboutAt()) about();
      else if (f === detailsAt()) toggleStreamDetails();
      else if (f === LANGUAGE_AT) open("language");
      else if (f === BUFFER_AT) open("buffer");
    },
  });

  /** The page shows the focused row whole. */
  const page = scroller({ anchor: (viewport) => viewport / 3, memory: "settings" });
  showNav(() => (onNav() ? navAt() : null));
  useRootBack({ ctl: page, onNav, toNav });
  return (
    // On touch Settings is pushed on the current tab, under the system header (its title).
    <View style={{ flex: 1 }}>
    <Screen ctl={page} nav={!isTouch}>
      <View style={pageStyle()}>
        <If when={!isTouch}>
          <Text style={pageTitle()}>{t("settings.title")}</Text>
        </If>
        <LanguageSection focused={() => at() === LANGUAGE_AT && !picker()} onOpen={() => open("language")} />
        <BufferSection freeBytes={freeBytes} focused={() => at() === BUFFER_AT && !picker()} onOpen={() => open("buffer")} />
        <DetailsSection focused={() => at() === detailsAt()} onFocus={() => focus.set(detailsAt())} />
        <SourceSection />
        <AboutRow focused={() => at() === aboutAt()} viewRef={page.follow(() => at() === aboutAt(), "nearest")} onPress={about} />
      </View>
    </Screen>
      <If when={picker()}>
        <ChoicePanel
          title={() => t(picker() === "buffer" ? "settings.buffer.title" : "settings.language.title")}
          choices={choices}
          focusedAt={pickAt}
          onPick={pick}
          onClose={() => picker.set(null)}
        />
      </If>
    </View>
  );
}
