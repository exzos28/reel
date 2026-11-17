// A ready source from the partner (design/partner-source.md), in a build that names one: its
// Telegram bot rents a source and sends it back. Where this device serves its settings page (a
// TV), the bot's QR code: the phone scans it, pays there, and the source comes back here for a
// yes on the screen. Elsewhere (a phone, a desktop), a button that opens the bot; it sends a
// link that fills the source's fields in this app. Nothing in a build without a partner.
import { Image, openUrl, Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Button } from "../../kit/Button";
import { rounded, row } from "../../kit/shape";
import { bodyText, labelText } from "../../kit/text";
import { partner } from "../../hosted";
import { colors, cs, u } from "../../theme";

const qrRow = (): ViewStyle => ({ ...row(u(28)), alignItems: "center" });
const qrStyle = () => ({ width: cs(200), height: cs(200), ...rounded() });

export function PartnerSource(props: { focused?: () => boolean }) {
  const open = () => {
    const link = partner()?.app;
    if (link) openUrl(link).catch((e) => console.warn(`reel: the partner's bot did not open: ${e}`));
  };
  return (
    <If when={partner()}>
      {(p) => (
        <If
          when={p().tv?.qr}
          else={
            <If when={p().app}>
              <View style={{ gap: u(10) }}>
                <View style={row(u(16))}>
                  <Button kind="secondary" label={() => t("settings.source.partner_app")} focused={props.focused ?? (() => false)} onPress={open} />
                </View>
                <Text style={bodyText(colors.ash())}>{t("settings.source.partner_app_note", { bot: p().bot })}</Text>
              </View>
            </If>
          }
        >
          {(qr) => (
            <View testID="partner-qr" style={qrRow()}>
              <Image src={qr()} style={qrStyle()} />
              <View style={{ flexShrink: 1, gap: u(8) }}>
                <Text style={labelText(colors.snow())}>{t("settings.source.partner_tv_title")}</Text>
                <Text style={bodyText(colors.ash())}>{t("settings.source.partner_tv_text", { bot: p().bot })}</Text>
              </View>
            </View>
          )}
        </If>
      )}
    </If>
  );
}
