// The code a phone pairs with (docs/hosted-settings.md): over whatever screen is open while
// a browser on the network waits for it. It goes when the code is used or expires (the core
// says so), or when the viewer presses OK on Cancel or Back.
import { keymap, Text, View, type TextStyle, type ViewStyle } from "nsh";
import { Dialog } from "nsh/base";
import { t } from "nsh/i18n";
import { Button } from "../kit/Button";
import { row } from "../kit/shape";
import { cancelPairing, pairingCode } from "../hosted";
import { onBack } from "../nav";
import { alpha, colors, font, u } from "../theme";

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
const codeStyle = (): TextStyle => ({
  fontFamily: font,
  fontSize: u(112),
  fontWeight: 700,
  letterSpacing: u(18),
  fontVariant: ["tabular-nums"],
  color: colors.snow(),
  marginTop: u(32),
});

function PairingCard() {
  // Newer than the page's bindings, so the page under it does not move.
  keymap.bind({ left: () => {}, right: () => {}, up: () => {}, down: () => {}, enter: cancelPairing });
  onBack(() => (cancelPairing(), true));
  return (
    <View style={cardStyle()}>
      <Text style={titleStyle()}>{t("hosted.pair_title")}</Text>
      <Text style={aboutStyle()}>{t("hosted.pair_about")}</Text>
      <Text testID="pairing-code" style={codeStyle()}>{pairingCode()?.code ?? ""}</Text>
      <View style={{ ...row(u(16)), marginTop: u(40) }}>
        <Button kind="secondary" label={() => t("hosted.cancel")} focused={() => true} onPress={cancelPairing} />
      </View>
    </View>
  );
}

export function PairingDialog() {
  return (
    <If when={pairingCode()}>
      <Dialog
        testID="pairing-dialog"
        role="alertdialog"
        accessibilityLabel={t("hosted.pair_title")}
        accessibilityDescription={t("hosted.pair_about")}
        animation="fade"
        closeOnEscape
        onOpenChange={(e) => !e.open && cancelPairing()}
        style={dialogStyle}
        backdropStyle={backdropStyle()}
      >
        <PairingCard />
      </Dialog>
    </If>
  );
}
