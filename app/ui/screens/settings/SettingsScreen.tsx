// Settings, a nav destination: one list of rows, each a setting's name and the value in effect
// (design/setup-and-settings.md): Language, Audio language, Playback buffer, Search source, Stream details,
// Interface (a page of its own: Menu position, Loading animation; on touch, which has no menu to
// move, Loading animation is a row here instead), About reel. Up/down move the
// focus (Up from the first: the nav); OK opens a row's choices (a drawer with one line on what
// the setting does), the source drawer, flips the switch or opens Interface or About. Back takes the focus to the nav, then Home. Beside the list, where the device serves its
// settings page (a TV), its QR code: changing them from a phone.
import { keymap, signal, View, type ViewRef, type ViewStyle } from "nsh";
import { Engine } from "../../native";
import { t } from "nsh/i18n";
import { byKeys } from "../../focus/keys";
import { clamp } from "../../focus/memory";
import { useRootBack } from "../../focus/rootBack";
import { caps } from "../../platform";
import { NAV } from "../../layout/navItems";
import { showNav } from "../../layout/navState";
import { PageFrame } from "../../layout/PageFrame";
import { scroller } from "../../layout/Scroller";
import { go, goFromNav, onBack, openAbout, openInterface } from "../../nav";
import {
  audioLanguages, bufferChoices, bufferMB, chooseAudioLanguage, chooseBuffer, chooseContentLanguage, chooseLoader, contentLanguages, LOADERS,
  source, streamDetails, toggleStreamDetails,
} from "../../preferences";
import { row } from "../../kit/shape";
import { formWidth } from "../../kit/form";
import { centredForm } from "../../layout/wide";
import { Fmt } from "../../native";
import { safe, u } from "../../theme";
import { audioLanguageChoices, audioLanguageName, bufferChoiceList, languageChoices, languageName, loaderChoices, loaderName, sizeText } from "./choices";
import { SettingRow } from "./SettingRow";
import { PhoneCard } from "../source/PhoneCard";
import { openSourceDrawer } from "../source/SourceDrawer";
import { ChoicePanel } from "../../layout/ChoicePanel";

/** The rows under the page's title (the frame's), the phone card beside them; on a tablet held
 * wide a column in the middle (not 650 points at the left of 1100). */
const pageStyle = (): ViewStyle => ({ ...row(u(96), "flex-start"), paddingHorizontal: safe().x, paddingTop: u(40), ...(centredForm() ? { justifyContent: "center" } : null) });
const rowsStyle = (): ViewStyle => (centredForm() ? { width: formWidth(), gap: u(12) } : { flex: 1, gap: u(12) });
const SETTINGS_AT = NAV.findIndex((n) => n.id === "settings");

type Picker = "language" | "audio_language" | "buffer" | "loader";

/** Interface's one setting on touch (its Menu position moves no tab bar): a row here, no page. */
const LOADER_HERE = caps.touch;

/** Back from Interface or About finds the focus on its row. */
let backTo: "interface" | "about" | null = null;

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
  /** The focus goes through the rows: language, audio language, buffer, source, stream details,
   * Interface, About. */
  const LANGUAGE_AT = 0;
  const AUDIO_AT = 1;
  const BUFFER_AT = 2;
  const SOURCE_AT = 3;
  const detailsAt = () => 4;
  const INTERFACE_AT = 5;
  const aboutAt = () => 6;
  const focus = signal(backTo === "about" ? aboutAt() : backTo === "interface" ? INTERFACE_AT : 0);
  /** The drawer of choices open, its focus on `pickAt`. */
  const picker = signal<Picker | null>(null);
  const pickAt = signal(0);
  const choices = () => {
    const p = picker();
    return p === "buffer" ? bufferChoiceList() : p === "audio_language" ? audioLanguageChoices() : p === "loader" ? loaderChoices() : languageChoices();
  };
  const rowOf: Record<Picker, number> = { language: LANGUAGE_AT, audio_language: AUDIO_AT, buffer: BUFFER_AT, loader: INTERFACE_AT };
  /** The rows that open choices: a tablet's popover goes beside the one pressed. */
  const anchors: Partial<Record<Picker, ViewRef>> = {};
  /** The row's ref for the page's scroll, and kept as the choices' anchor. */
  const rowRef = (which: Picker) => {
    const follow = page.follow(() => at() === rowOf[which]);
    return (r: ViewRef) => {
      anchors[which] = r;
      follow(r);
    };
  };
  const open = (which: Picker) => {
    focus.set(rowOf[which]);
    onNav.set(false);
    picker.set(which);
    pickAt.set(Math.max(0, choices().findIndex((c) => c.selected)));
  };
  const pick = (i: number) => {
    const which = picker();
    if (which === "language") {
      const l = contentLanguages()[i];
      if (l) chooseContentLanguage(l.tag);
    } else if (which === "audio_language") {
      // The first choice is the app's language ("").
      const code = i === 0 ? "" : audioLanguages()[i - 1];
      if (code !== undefined) chooseAudioLanguage(code);
    } else if (which === "buffer") {
      const c = bufferChoices()[i];
      if (c) chooseBuffer(c.mb);
    } else if (which === "loader") {
      const l = LOADERS[i];
      if (l) chooseLoader(l);
    }
    picker.set(null);
  };
  // Back closes the drawer first.
  onBack(() => (picker() ? (picker.set(null), true) : false));
  backTo = null;
  const about = () => {
    focus.set(aboutAt());
    backTo = "about";
    openAbout();
  };
  const ui = () => {
    if (LOADER_HERE) return open("loader");
    focus.set(INTERFACE_AT);
    backTo = "interface";
    openInterface();
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
    byKeys({
      up: () =>
        picker() ? pickAt.set(Math.max(pickAt() - 1, 0)) : onNav() ? undefined : focus() === 0 ? toNav() : move(-1),
      down: () =>
        picker() ? pickAt.set(Math.min(pickAt() + 1, choices().length - 1)) : onNav() ? onNav.set(false) : move(1),
      left: () => onNav() && navAt.set(clamp(navAt() - 1, NAV.length - 1)),
      right: () => onNav() && navAt.set(clamp(navAt() + 1, NAV.length - 1)),
    }),
    { repeat: true },
  );
  keymap.bind({
    enter: () => {
      if (picker()) return pick(pickAt());
      if (onNav()) return goFromNav(NAV[navAt()].id);
      const f = focus();
      if (f === aboutAt()) about();
      else if (f === detailsAt()) toggleStreamDetails();
      else if (f === SOURCE_AT) openSourceDrawer("edit");
      else if (f === LANGUAGE_AT) open("language");
      else if (f === AUDIO_AT) open("audio_language");
      else if (f === BUFFER_AT) open("buffer");
      else if (f === INTERFACE_AT) ui();
    },
  });

  /** The page shows the focused row whole. */
  const page = scroller({ anchor: (viewport) => viewport / 3, memory: "settings" });
  showNav(() => (onNav() ? navAt() : null));
  useRootBack({ ctl: page, onNav, toNav });
  return (
    // A destination with the nav over it; on touch a page pushed on the current tab.
    <View style={{ flex: 1 }}>
    <PageFrame ctl={page} kind={caps.touch && !caps.settingsTab ? "deep" : "root"} title={() => t("settings.title")}>
      <View style={pageStyle()}>
        <View style={rowsStyle()}>
          <SettingRow
            label={t("settings.language.title")}
            value={languageName}
            focused={() => at() === LANGUAGE_AT && !picker()}
            viewRef={rowRef("language")}
            onPress={() => open("language")}
          />
          <SettingRow
            label={t("settings.audio_language.title")}
            value={audioLanguageName}
            focused={() => at() === AUDIO_AT && !picker()}
            viewRef={rowRef("audio_language")}
            onPress={() => open("audio_language")}
          />
          <SettingRow
            label={t("settings.buffer.title")}
            value={() => (freeBytes() == null ? sizeText(bufferMB()) : t("settings.rows.buffer_value", { size: sizeText(bufferMB()), free: Fmt.size(freeBytes()!) }))}
            focused={() => at() === BUFFER_AT && !picker()}
            viewRef={rowRef("buffer")}
            onPress={() => open("buffer")}
          />
          <SettingRow
            label={t("settings.source.title")}
            value={() => t(source().url ? "settings.rows.connected" : "settings.rows.not_set")}
            focused={() => at() === SOURCE_AT}
            viewRef={page.follow(() => at() === SOURCE_AT)}
            onPress={() => {
              focus.set(SOURCE_AT);
              openSourceDrawer("edit");
            }}
          />
          <SettingRow
            label={t("settings.details.title")}
            on={streamDetails}
            focused={() => at() === detailsAt()}
            viewRef={page.follow(() => at() === detailsAt())}
            onPress={() => {
              focus.set(detailsAt());
              toggleStreamDetails();
            }}
          />
          <If
            when={LOADER_HERE}
            else={<SettingRow label={t("settings.interface.title")} focused={() => at() === INTERFACE_AT} viewRef={page.follow(() => at() === INTERFACE_AT)} onPress={ui} />}
          >
            <SettingRow label={t("settings.loader.title")} value={loaderName} focused={() => at() === INTERFACE_AT && !picker()} viewRef={rowRef("loader")} onPress={ui} />
          </If>
          <View style={{ height: u(24) }} />
          <SettingRow label={t("settings.about.title")} focused={() => at() === aboutAt()} viewRef={page.follow(() => at() === aboutAt(), "nearest")} onPress={about} />
        </View>
        <PhoneCard title={() => t("settings.phone.title")} text={(url) => t("settings.phone.text", { url })} />
      </View>
    </PageFrame>
      <If when={picker()}>
        <ChoicePanel
          title={() => t(`settings.${picker() ?? "language"}.title`)}
          note={() => t(`settings.${picker() ?? "language"}.about`)}
          choices={choices}
          focusedAt={pickAt}
          onPick={pick}
          onClose={() => picker.set(null)}
          anchor={() => (picker() ? anchors[picker()!] : undefined)}
        />
      </If>
    </View>
  );
}
