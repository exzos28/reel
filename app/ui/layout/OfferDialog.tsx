// A source a phone offers (design/partner-source.md): a partner's link opened the settings page
// with it, and nothing is saved until the viewer says yes here. Over whatever screen is open,
// the setup's included. Use saves and checks it (the screens under it follow the source); Not
// now or Back drops it.
import { keymap, signal, Text, View, type TextStyle, type ViewStyle } from "nsh";
import { Dialog } from "nsh/base";
import { t } from "nsh/i18n";
import { Button } from "../kit/Button";
import { row } from "../kit/shape";
import { answerOffer, offeredHost } from "../hosted";
import { onBack } from "../nav";
import { alpha, colors, font, ts, u } from "../theme";

const cardStyle = (): ViewStyle => ({
  width: u(760),
  padding: u(48),
  borderRadius: u(28),
  borderCurve: "continuous",
  backgroundColor: colors.card(),
});
const backdropStyle = (): ViewStyle => ({ backgroundColor: alpha(colors.ink(), 0.72) });
const dialogStyle: ViewStyle = { flex: 1, alignItems: "center", justifyContent: "center" };
const titleStyle = (): TextStyle => ({ fontFamily: font, fontSize: ts(44), fontWeight: 600, color: colors.snow() });
const aboutStyle = (): TextStyle => ({ fontFamily: font, fontSize: ts(26), lineHeight: ts(36), color: colors.ash(), marginTop: u(14) });
const hostStyle = (): TextStyle => ({ fontFamily: font, fontSize: ts(34), fontWeight: 600, color: colors.snow(), marginTop: u(28) });

function OfferCard() {
  /** 0: Use, 1: Not now. Use first: the viewer just sent it. */
  const at = signal(0);
  // Newer than the page's bindings, so the page under it does not move.
  keymap.bind({
    left: () => at.set(0),
    right: () => at.set(1),
    up: () => {},
    down: () => {},
    enter: () => answerOffer(at() === 0),
  });
  onBack(() => (answerOffer(false), true));
  return (
    <View style={cardStyle()}>
      <Text style={titleStyle()}>{t("hosted.offer_title")}</Text>
      <Text testID="offer-host" style={hostStyle()}>{offeredHost() ?? ""}</Text>
      <Text style={aboutStyle()}>{t("hosted.offer_about")}</Text>
      <View style={{ ...row(u(16)), marginTop: u(40) }}>
        <Button kind="primary" label={() => t("hosted.offer_use")} focused={() => at() === 0} onPress={() => answerOffer(true)} />
        <Button kind="secondary" label={() => t("hosted.offer_not_now")} focused={() => at() === 1} onPress={() => answerOffer(false)} />
      </View>
    </View>
  );
}

export function OfferDialog() {
  return (
    <If when={offeredHost()}>
      <Dialog
        testID="offer-dialog"
        role="alertdialog"
        accessibilityLabel={t("hosted.offer_title")}
        accessibilityDescription={t("hosted.offer_about")}
        animation="fade"
        closeOnEscape
        onOpenChange={(e) => !e.open && answerOffer(false)}
        style={dialogStyle}
        backdropStyle={backdropStyle()}
      >
        <OfferCard />
      </Dialog>
    </If>
  );
}
