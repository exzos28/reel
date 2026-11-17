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
const removeStyle = (): ViewStyle => ({ height: cs(60), paddingHorizontal: cs(30), justifyContent: "center", ...rounded(), backgroundColor: colors.raise() });
/** What went wrong reads in white (red is the logo's and the star's), the rest in grey. */
const resultStyle = (bad: boolean): TextStyle => ({ ...metaText(bad ? colors.snow() : colors.ash()), flexShrink: 1 });

/** `form`: its state (`sourceForm()`), so the place showing it can follow it (the drawer closes
 * once connected). `ownButton`: false where the place has its own actions (the setup's Check). */
export function SourceForm(props: { form: ReturnType<typeof sourceForm>; ownButton?: boolean }) {
  const form = props.form;
  return (
    <View style={{ gap: u(14) }}>
      <Text style={metaText()}>{t("settings.source.url")}</Text>
      <Input
        testID="source-url"
        value={form.url()}
        onChange={(e) => form.edit(e.value, form.key())}
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
        onChange={(e) => form.edit(form.url(), e.value)}
        onSubmit={form.save}
        masked
        placeholder={source().hasKey ? t("settings.source.key_saved") : t("settings.source.key_placeholder")}
        autoCapitalize="none"
        autoCorrect={false}
        style={fieldStyle()}
      />
      <If when={props.ownButton ?? true} else={<If when={form.result()}>{(r) => <Text style={resultStyle(r().bad)}>{r().text}</Text>}</If>}>
        <View style={{ ...row(u(20)), marginTop: u(6) }}>
          <View role="button" accessibilityLabel={t("settings.source.save")} hitSlop={targetSlop(cs(60))} onPress={form.save} hoverStyle={{ backgroundColor: colors.dim() }} style={saveStyle()}>
            <Text style={labelText(colors.ink())}>{t("settings.source.save")}</Text>
          </View>
          {/* A source set can be taken away (Save with an empty address did nothing visible). */}
          <If when={source().url}>
            <View role="button" accessibilityLabel={t("settings.source.remove")} hitSlop={targetSlop(cs(60))} onPress={form.remove} hoverStyle={{ backgroundColor: colors.raise() }} style={removeStyle()}>
              <Text style={labelText(colors.snow())}>{t("settings.source.remove")}</Text>
            </View>
          </If>
        </View>
        {/* Under the buttons, the form's full width: beside them it was squeezed into a column. */}
        <If when={form.result()}>{(r) => <Text style={resultStyle(r().bad)}>{r().text}</Text>}</If>
      </If>
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
