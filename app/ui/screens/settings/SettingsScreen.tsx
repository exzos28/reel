// Settings, a nav destination: one list of rows, each a setting's name and the value in effect
// (design/setup-and-settings.md): Language, Playback buffer, Search source, Stream details,
// Interface (a page of its own: Menu position, Loading animation), About reel. Up/down move the
// focus (Up from the first: the nav); OK opens a row's choices (a drawer with one line on what
// the setting does), the source drawer, flips the switch or opens Interface or About. Back takes the focus to the nav, then Home. Beside the list, where the device serves its
// settings page (a TV), its QR code: changing them from a phone.
import { keymap, signal, View, type ViewStyle } from "nsh";
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
  bufferChoices, bufferMB, chooseBuffer, chooseContentLanguage, contentLanguages, source, streamDetails, toggleStreamDetails,
} from "../../preferences";
import { row } from "../../kit/shape";
import { Fmt } from "../../native";
import { safe, u } from "../../theme";
import { bufferChoiceList, languageChoices, languageName, sizeText } from "./choices";
import { SettingRow } from "./SettingRow";
import { PhoneCard } from "../source/PhoneCard";
import { openSourceDrawer } from "../source/SourceDrawer";
import { ChoicePanel } from "../../layout/ChoicePanel";

/** The rows under the page's title (the frame's), the phone card beside them. */
const pageStyle = (): ViewStyle => ({ ...row(u(96), "flex-start"), paddingHorizontal: safe().x, paddingTop: u(40) });
const rowsStyle = (): ViewStyle => ({ flex: 1, gap: u(12) });
const SETTINGS_AT = NAV.findIndex((n) => n.id === "settings");

type Picker = "language" | "buffer";

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
  /** The focus goes through the rows: language, buffer, source, stream details, Interface, About. */
  const LANGUAGE_AT = 0;
  const BUFFER_AT = 1;
  const SOURCE_AT = 2;
  const detailsAt = () => 3;
  const INTERFACE_AT = 4;
  const aboutAt = () => 5;
  const focus = signal(backTo === "about" ? aboutAt() : backTo === "interface" ? INTERFACE_AT : 0);
  /** The drawer of choices open, its focus on `pickAt`. */
  const picker = signal<Picker | null>(null);
  const pickAt = signal(0);
  const choices = () => {
    const p = picker();
    return p === "buffer" ? bufferChoiceList() : languageChoices();
  };
  const rowOf: Record<Picker, number> = { language: LANGUAGE_AT, buffer: BUFFER_AT };
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
    } else if (which === "buffer") {
      const c = bufferChoices()[i];
      if (c) chooseBuffer(c.mb);
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
    <PageFrame ctl={page} kind={caps.touch ? "deep" : "root"} title={() => t("settings.title")}>
      <View style={pageStyle()}>
        <View style={rowsStyle()}>
          <SettingRow
            label={t("settings.language.title")}
            value={languageName}
            focused={() => at() === LANGUAGE_AT && !picker()}
            viewRef={page.follow(() => at() === LANGUAGE_AT)}
            onPress={() => open("language")}
          />
          <SettingRow
            label={t("settings.buffer.title")}
            value={() => (freeBytes() == null ? sizeText(bufferMB()) : t("settings.rows.buffer_value", { size: sizeText(bufferMB()), free: Fmt.size(freeBytes()!) }))}
            focused={() => at() === BUFFER_AT && !picker()}
            viewRef={page.follow(() => at() === BUFFER_AT)}
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
          <SettingRow
            label={t("settings.interface.title")}
            focused={() => at() === INTERFACE_AT}
            viewRef={page.follow(() => at() === INTERFACE_AT)}
            onPress={ui}
          />
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
        />
      </If>
    </View>
  );
}
