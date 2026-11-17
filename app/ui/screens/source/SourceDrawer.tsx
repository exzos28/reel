// The drawer that asks for a search source where Play needs one and there is none: on a title
// without a source, or when the engine finds none to play from. What a source is, the TV's
// QR code, the fields; once the source connects, it closes and the title searches it.
import { effect, signal, Text, View } from "nsh";
import { t } from "nsh/i18n";
import { bodyText } from "../../kit/text";
import { Drawer } from "../../layout/Drawer";
import { onBack } from "../../nav";
import { status, stop } from "../../playback";
import { colors, u } from "../../theme";
import { PartnerSource } from "./PartnerSource";
import { SourceByPhone, SourceForm } from "./SourceForm";
import { sourceForm } from "./sourceState";

/** Why it is open: there is no source, the one set did not answer, Settings, or a link
 * (`reel://s?…`) filled it. */
type Why = "missing" | "failed" | "edit" | "link";
const shown = signal(false);
const why = signal<Why>("missing");
export const openSourceDrawer = (reason: Why = "missing") => {
  why.set(reason);
  shown.set(true);
};

/** How long "Connected" shows before the drawer closes, ms. */
const CONNECTED_MS = 1200;

function Body() {
  const form = sourceForm();
  effect(() => {
    if (form.connected()) setTimeout(() => shown.set(false), CONNECTED_MS);
  });
  return (
    <View style={{ gap: u(24) }}>
      <Text style={bodyText(colors.soft())}>{t(`settings.source_drawer.${why()}_about`)}</Text>
      <SourceByPhone />
      <If when={why() !== "link"}>
        <PartnerSource />
      </If>
      <SourceForm form={form} />
    </View>
  );
}

/** Over any screen (App). */
export function SourceDrawer() {
  // Back (a remote's, Escape, Android's) closes it first.
  onBack(() => shown() && (shown.set(false), true));
  // The engine has no source to play from: no player with an error, this drawer instead.
  effect(() => {
    if (status().phase !== "no_source") return;
    stop();
    openSourceDrawer();
  });
  return (
    <Drawer id="source" open={shown} onClose={() => shown.set(false)} title={() => t(`settings.source_drawer.${why()}_title`)} tvWidth={900}>
      {() => (
        <If when={shown()}>
          <Body />
        </If>
      )}
    </Drawer>
  );
}
