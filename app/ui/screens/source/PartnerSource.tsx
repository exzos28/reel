// A ready source from the partner (design/partner-source.md), in a build that names one: its
// Telegram bot rents a source and sends it back. Where this device serves its settings page (a
// TV), the bot's QR code: the phone scans it, pays there, and the source comes back here for a
// yes on the screen. Elsewhere, a button that opens the bot (its link fills the source's fields
// in this app): on a phone or a tablet first, Telegram is on the device; beside it on a computer
// the same link's QR code, for Telegram on a phone. Nothing in a build without a partner.
import { Image, openUrl, Text, View, type JSX, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Button } from "../../kit/Button";
import { rounded, row } from "../../kit/shape";
import { bodyText, labelText } from "../../kit/text";
import { partner } from "../../hosted";
import { colors, cs, u } from "../../theme";
import { caps } from "../../platform";

const qrRow = (): ViewStyle => ({ ...row(u(28)), alignItems: "center" });
const qrStyle = () => ({ width: cs(200), height: cs(200), ...rounded() });

/** A QR code and what it is for; `children` (the button) under both, where it has the whole
 * width: beside the code, in half a tablet's setup, it did not fit. */
function Qr(props: { src: string; title: string | null; text: string; children?: JSX.Element }) {
  return (
    <View style={{ gap: u(16) }}>
      <View testID="partner-qr" style={qrRow()}>
        <Image src={props.src} style={qrStyle()} />
        <View style={{ flexShrink: 1, gap: u(8) }}>
          <If when={props.title}>
            <Text style={labelText(colors.snow())}>{props.title}</Text>
          </If>
          <Text style={bodyText(colors.ash())}>{props.text}</Text>
        </View>
      </View>
      {props.children}
    </View>
  );
}

/** `titled`: false where the place gives it its own heading (the setup's "Or get a ready one"). */
export function PartnerSource(props: { focused?: () => boolean; titled?: boolean }) {
  const title = () => ((props.titled ?? true) ? t("settings.source.partner_tv_title") : null);
  const open = () => {
    const link = partner()?.app?.url;
    if (link) openUrl(link).catch((e) => console.warn(`reel: the partner's bot did not open: ${e}`));
  };
  const button = () => (
    <View style={row(u(16))}>
      <Button kind="secondary" label={() => t("settings.source.partner_app")} focused={props.focused ?? (() => false)} onPress={open} />
    </View>
  );
  return (
    <If when={partner()}>
      {(p) => (
        <If
          when={p().tv?.qr}
          else={
            <If when={p().app}>
              {(app) => (
                <If
                  when={caps.touch ? null : app().qr}
                  else={
                    <View style={{ gap: u(10) }}>
                      {button()}
                      <Text style={bodyText(colors.ash())}>{t("settings.source.partner_app_note", { bot: p().bot })}</Text>
                    </View>
                  }
                >
                  {(qr) => (
                    <Qr src={qr()} title={title()} text={t("settings.source.partner_app_note", { bot: p().bot })}>
                      {button()}
                    </Qr>
                  )}
                </If>
              )}
            </If>
          }
        >
          {(qr) => <Qr src={qr()} title={title()} text={t("settings.source.partner_tv_text", { bot: p().bot })} />}
        </If>
      )}
    </If>
  );
}
