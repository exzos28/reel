// "Exit reel?" (TV): Back on Home's nav asks before leaving. Stay is focused;
// Left and Right move between the two, OK chooses, Back closes it.
import { keymap, signal, Text, View, type TextStyle, type ViewStyle } from "nsh";
import { Dialog } from "nsh/base";
import { t } from "nsh/i18n";
import { Button } from "../kit/Button";
import { row } from "../kit/shape";
import { exitApp } from "../native";
import { onBack } from "../nav";
import { alpha, colors, font, u } from "../theme";

/** The dialog is up. */
export const exitAsked = signal(false);

const cardStyle = (): ViewStyle => ({
  width: u(760),
  padding: u(48),
  borderRadius: u(28),
  borderCurve: "continuous",
  backgroundColor: colors.card(),
});
const backdropStyle = (): ViewStyle => ({ backgroundColor: alpha(colors.ink(), 0.72) });
const dialogStyle: ViewStyle = { flex: 1, alignItems: "center", justifyContent: "center" };
const titleStyle = (): TextStyle => ({ fontFamily: font, fontSize: u(44), fontWeight: 600, color: colors.snow() });
const aboutStyle = (): TextStyle => ({ fontFamily: font, fontSize: u(26), lineHeight: u(36), color: colors.ash(), marginTop: u(14) });

function ExitCard() {
  /** 0: Stay, 1: Exit. */
  const at = signal(0);
  const close = () => exitAsked.set(false);
  const choose = (i: number) => (i === 0 ? close() : exitApp());
  // Newer than the page's bindings, so the page under it does not move.
  keymap.bind({ left: () => at.set(0), right: () => at.set(1), up: () => {}, down: () => {}, enter: () => choose(at()) });
  onBack(() => (close(), true));
  return (
    <View style={cardStyle()}>
      <Text style={titleStyle()}>{t("exit.title")}</Text>
      <Text style={aboutStyle()}>{t("exit.about")}</Text>
      <View style={{ ...row(u(16)), marginTop: u(40) }}>
        <Button kind="primary" label={() => t("exit.stay")} focused={() => at() === 0} onPress={close} />
        <Button kind="secondary" label={() => t("exit.exit")} focused={() => at() === 1} onPress={() => choose(1)} />
      </View>
    </View>
  );
}

export function ExitDialog() {
  return (
    <If when={exitAsked()}>
      <Dialog
        testID="exit-dialog"
        role="alertdialog"
        accessibilityLabel={t("exit.title")}
        accessibilityDescription={t("exit.about")}
        animation="fade"
        closeOnEscape
        onOpenChange={(e) => !e.open && exitAsked.set(false)}
        style={dialogStyle}
        backdropStyle={backdropStyle()}
      >
        <ExitCard />
      </Dialog>
    </If>
  );
}
