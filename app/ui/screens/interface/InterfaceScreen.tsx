// Interface, over Settings (its row): how the app itself looks, not what it plays. Menu position
// (not on touch, whose tab bar it does not move) and Loading animation, each a row with the value
// in effect; OK opens its choices in a drawer, as Settings' rows do. Back closes the drawer, then
// goes back to Settings.
import { keymap, signal, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { byKeys } from "../../focus/keys";
import { clamp } from "../../focus/memory";
import { ChoicePanel } from "../../layout/ChoicePanel";
import { PageFrame } from "../../layout/PageFrame";
import { scroller } from "../../layout/Scroller";
import { onBack } from "../../nav";
import { caps } from "../../platform";
import { chooseLoader, chooseNavPosition, LOADERS, NAV_POSITIONS } from "../../preferences";
import { safe, u } from "../../theme";
import { loaderChoices, loaderName, navPositionChoices, navPositionName } from "../settings/choices";
import { SettingRow } from "../settings/SettingRow";

const pageStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, paddingTop: u(40), gap: u(12), maxWidth: u(1200) });

/** The menu's position moves a TV's or a desktop's top nav; touch has a tab bar instead. */
const HAS_NAV_POSITION = !caps.touch;

type Picker = "nav" | "loader";
const PICKER_TEXT: Record<Picker, string> = { nav: "nav_position", loader: "loader" };

export function InterfaceScreen() {
  const rows: Picker[] = HAS_NAV_POSITION ? ["nav", "loader"] : ["loader"];
  const focus = signal(0);
  const picker = signal<Picker | null>(null);
  const pickAt = signal(0);
  const choices = () => (picker() === "nav" ? navPositionChoices() : loaderChoices());
  const open = (which: Picker) => {
    focus.set(rows.indexOf(which));
    picker.set(which);
    pickAt.set(Math.max(0, choices().findIndex((c) => c.selected)));
  };
  const pick = (i: number) => {
    if (picker() === "nav") {
      const p = NAV_POSITIONS[i];
      if (p) chooseNavPosition(p);
    } else {
      const l = LOADERS[i];
      if (l) chooseLoader(l);
    }
    picker.set(null);
  };
  // Back closes the drawer first.
  onBack(() => (picker() ? (picker.set(null), true) : false));
  keymap.bind(
    byKeys({
      up: () => (picker() ? pickAt.set(Math.max(pickAt() - 1, 0)) : focus.set(clamp(focus() - 1, rows.length - 1))),
      down: () => (picker() ? pickAt.set(Math.min(pickAt() + 1, choices().length - 1)) : focus.set(clamp(focus() + 1, rows.length - 1))),
    }),
    { repeat: true },
  );
  keymap.bind({ enter: () => (picker() ? pick(pickAt()) : open(rows[focus()])) });

  const page = scroller({ anchor: () => 0 });
  const at = (which: Picker) => () => rows[focus()] === which && !picker();
  return (
    <View style={{ flex: 1 }}>
      <PageFrame ctl={page} kind="deep" title={() => t("settings.interface.title")}>
        <View style={pageStyle()}>
          <If when={HAS_NAV_POSITION}>
            <SettingRow label={t("settings.nav_position.title")} value={navPositionName} focused={at("nav")} viewRef={page.follow(at("nav"))} onPress={() => open("nav")} />
          </If>
          <SettingRow label={t("settings.loader.title")} value={loaderName} focused={at("loader")} viewRef={page.follow(at("loader"))} onPress={() => open("loader")} />
        </View>
      </PageFrame>
      <If when={picker()}>
        <ChoicePanel
          title={() => t(`settings.${PICKER_TEXT[picker() ?? "loader"]}.title`)}
          note={() => t(`settings.${PICKER_TEXT[picker() ?? "loader"]}.about`)}
          choices={choices}
          focusedAt={pickAt}
          onPick={pick}
          onClose={() => picker.set(null)}
        />
      </If>
    </View>
  );
}
