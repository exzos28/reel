// The search source's fields: its address, its key, Save and check, and the line that says how
// it went. Settings shows them in its Search source section, the source drawer on its own.
import { Input } from "nsh/base";
import { Image, Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { fieldStyle } from "../../kit/form";
import { rounded, row } from "../../kit/shape";
import { bodyText, labelText, metaText } from "../../kit/text";
import { hostedQr, hostedUrl } from "../../hosted";
import { source } from "../../preferences";
import { colors, cs, targetSlop, u } from "../../theme";
import { sourceForm } from "./sourceState";

const saveStyle = (): ViewStyle => ({ height: cs(60), paddingHorizontal: cs(30), justifyContent: "center", ...rounded(), backgroundColor: colors.snow() });
const resultStyle = (bad: boolean): TextStyle => ({ ...metaText(bad ? colors.red() : colors.ash()), flexShrink: 1 });

/** `form`: its state (`sourceForm()`), so the place showing it can follow it (the drawer closes once connected). */
export function SourceForm(props: { form: ReturnType<typeof sourceForm> }) {
  const form = props.form;
  return (
    <View style={{ gap: u(14) }}>
      <Text style={metaText()}>{t("settings.source.url")}</Text>
      <Input
        value={form.url()}
        onChange={(e) => form.url.set(e.value)}
        onSubmit={form.save}
        placeholder={t("settings.source.url_placeholder")}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        style={fieldStyle()}
      />
      <Text style={metaText()}>{t("settings.source.key")}</Text>
      <Input
        value={form.key()}
        onChange={(e) => form.key.set(e.value)}
        onSubmit={form.save}
        masked
        placeholder={source().hasKey ? t("settings.source.key_saved") : t("settings.source.key_placeholder")}
        autoCapitalize="none"
        autoCorrect={false}
        style={fieldStyle()}
      />
      <View style={{ ...row(u(20)), marginTop: u(6) }}>
        <View role="button" accessibilityLabel={t("settings.source.save")} hitSlop={targetSlop(cs(60))} onPress={form.save} hoverStyle={{ backgroundColor: colors.dim() }} style={saveStyle()}>
          <Text style={labelText(colors.ink())}>{t("settings.source.save")}</Text>
        </View>
        <If when={form.result()}>{(r) => <Text style={resultStyle(r().bad)}>{r().text}</Text>}</If>
      </View>
    </View>
  );
}

/** Where the TV serves the settings page: its QR code and address, since typing an address
 * with a remote is slow. Nothing elsewhere. */
export function SourceByPhone() {
  return (
    <If when={hostedUrl()}>
      {(url) => (
        <View style={{ ...row(u(28)), alignItems: "center" }}>
          {/* Scanned with a phone's camera, it opens the settings page there. */}
          <If when={hostedQr()}>
            {(qr) => <Image testID="hosted-qr" src={qr()} style={{ width: cs(200), height: cs(200), ...rounded() }} />}
          </If>
          <Text testID="hosted-address" style={{ ...bodyText(colors.snow()), flexShrink: 1 }}>{t("settings.source.phone", { url: url() })}</Text>
        </View>
      )}
    </If>
  );
}
