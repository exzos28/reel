// The search source: the address of the user's Jackett (Torznab) and its key.
import { Input } from "nsh/base";
import { Image, Text, View, type TextStyle, type ViewStyle, type InputStyle } from "nsh";
import { t } from "nsh/i18n";
import { rounded, row } from "../../kit/shape";
import { bodyText, labelText, metaText, sectionTitle } from "../../kit/text";
import { hostedQr, hostedUrl } from "../../hosted";
import { source } from "../../preferences";
import { colors, type, u } from "../../theme";
import { sourceForm } from "./sourceForm";

const fieldStyle = (): InputStyle => ({
  height: u(64),
  paddingHorizontal: u(22),
  ...rounded(),
  backgroundColor: colors.card(),
  color: colors.snow(),
  placeholderColor: colors.ash(),
  ...type.body(),
});
const saveStyle = (): ViewStyle => ({ height: u(60), paddingHorizontal: u(30), justifyContent: "center", ...rounded(), backgroundColor: colors.snow() });
const resultStyle = (bad: boolean): TextStyle => ({ ...metaText(bad ? colors.red() : colors.ash()), flexShrink: 1 });

export function SourceSection() {
  const form = sourceForm();
  return (
    <View style={{ gap: u(14), maxWidth: u(980) }}>
      <Text style={sectionTitle()}>{t("settings.source.title")}</Text>
      <Text style={bodyText(colors.soft())}>{t("settings.source.about")}</Text>
      {/* Where the TV serves the settings page: typing an address with a remote is slow. */}
      <If when={hostedUrl()}>
        {(url) => (
          <View style={{ ...row(u(28)), alignItems: "center" }}>
            {/* Scanned with a phone's camera, it opens the settings page there. */}
            <If when={hostedQr()}>
              {(qr) => <Image testID="hosted-qr" src={qr()} style={{ width: u(200), height: u(200), ...rounded() }} />}
            </If>
            <Text testID="hosted-address" style={{ ...bodyText(colors.snow()), flexShrink: 1 }}>{t("settings.source.phone", { url: url() })}</Text>
          </View>
        )}
      </If>
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
        <View role="button" onPress={form.save} hoverStyle={{ backgroundColor: colors.dim() }} style={saveStyle()}>
          <Text style={labelText(colors.ink())}>{t("settings.source.save")}</Text>
        </View>
        <If when={form.result()}>{(r) => <Text style={resultStyle(r().bad)}>{r().text}</Text>}</If>
      </View>
    </View>
  );
}
