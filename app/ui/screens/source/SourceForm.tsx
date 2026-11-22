// The search source's fields: its address, its key, Save and check, and the line that says how
// it went. Settings shows them in its Search source section, the source drawer on its own.
// With a remote each field and button is a stop of the place showing them (`focus`): the ring
// shows on it, OK on a field brings the system's keyboard (`sourceFields`), and the focus going
// on takes the keyboard away.
import { Input } from "nsh/base";
import { effect, Image, signal, Text, untracked, View, type InputRef, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { fieldStyle } from "../../kit/form";
import { rounded, row } from "../../kit/shape";
import { bodyText, labelText, metaText } from "../../kit/text";
import { hostedQr, hostedUrl } from "../../hosted";
import { source } from "../../preferences";
import { colors, cs, focusRing, targetSlop, ts, u } from "../../theme";
import checkIcon from "../../icons/check.svg";
import { Icon } from "../../kit/Icon";
import { sourceForm } from "./sourceState";
import { Pressable } from "../../kit/Pressable";

const saveStyle = (focused: boolean): ViewStyle => ({ height: cs(60), paddingHorizontal: cs(30), justifyContent: "center", ...rounded(), backgroundColor: colors.snow(), ...focusRing(focused) });
const removeStyle = (focused: boolean): ViewStyle => ({ height: cs(60), paddingHorizontal: cs(30), justifyContent: "center", ...rounded(), backgroundColor: colors.raise(), ...focusRing(focused) });
/** A field's box: the ring of a remote's focus around it. */
const fieldBox = (focused: boolean): ViewStyle => ({ ...rounded(), ...focusRing(focused, "row") });

/** The form's stops for a remote: the two fields, Save and Remove. */
export type SourceStop = "url" | "key" | "save" | "remove";
export type SourceField = "url" | "key";

/** A remote's way into the fields: `type` focuses one (the system's keyboard comes up); the focus
 * leaving it (`at`) takes the keyboard away, so OK and the arrows act on the ring again.
 * `typing`: one of them has the input's focus. */
export function sourceFields(at: () => string | null) {
  const refs: Partial<Record<SourceField, InputRef>> = {};
  const typing = signal<SourceField | null>(null);
  effect(() => {
    const now = at();
    untracked(() => {
      const t = typing();
      if (t && now !== t) blur();
    });
  });
  function blur() {
    const t = typing();
    if (t) refs[t]?.blur();
    typing.set(null);
  }
  return {
    ref: (which: SourceField, r: InputRef) => (refs[which] = r),
    type(which: SourceField) {
      typing.set(which);
      refs[which]?.focus();
    },
    /** The input has the focus (`onFocus`) or lost it (`onBlur`). */
    focused: (which: SourceField, on: boolean) => (on ? typing.set(which) : typing() === which && typing.set(null)),
    typing,
    blur,
  };
}
export type SourceFields = ReturnType<typeof sourceFields>;
/** What went wrong reads in white (red is the logo's and the star's), the rest in grey. */
const resultStyle = (bad: boolean, ok: boolean): TextStyle => ({ ...metaText(bad || ok ? colors.snow() : colors.ash()), flexShrink: 1 });
/** The line's row: a check mark before "Connected"; `reserve`: its room held from the start, so
 * the actions under it do not move when it shows. */
const resultRow = (reserve: boolean): ViewStyle => ({ ...row(u(10)), alignItems: "flex-start", minHeight: reserve ? ts(30) : 0 });

/** How the save and the check went: grey while it works, white with a check mark once the
 * source answered, white when it did not. */
function ResultLine(props: { form: ReturnType<typeof sourceForm>; reserve: boolean }) {
  return (
    <View testID="source-result" style={resultRow(props.reserve)}>
      <If when={props.form.result()}>
        {(r) => (
          <View style={{ ...row(u(10)), flexShrink: 1 }}>
            <If when={r().ok}>
              <Icon src={() => checkIcon} size={22} />
            </If>
            <Text style={resultStyle(r().bad, !!r().ok)}>{r().text}</Text>
          </View>
        )}
      </If>
    </View>
  );
}

/** `form`: its state (`sourceForm()`), so the place showing it can follow it (the drawer closes
 * once connected). `ownButton`: false where the place has its own actions (the setup's Check).
 * `focus`: the stop a remote's focus is on (null: elsewhere); `fields`: its way into the inputs. */
export function SourceForm(props: { form: ReturnType<typeof sourceForm>; ownButton?: boolean; focus?: () => string | null; fields?: SourceFields }) {
  const form = props.form;
  const on = (stop: SourceStop) => props.focus?.() === stop;
  return (
    <View style={{ gap: u(14) }}>
      <Text style={metaText()}>{t("settings.source.url")}</Text>
      <View style={fieldBox(on("url"))}>
        <Input
          ref={(r) => props.fields?.ref("url", r)}
          testID="source-url"
          value={form.url()}
          onChange={(e) => form.edit(e.value, form.key())}
          onSubmit={form.save}
          onFocus={() => props.fields?.focused("url", true)}
          onBlur={() => props.fields?.focused("url", false)}
          placeholder={t("settings.source.url_placeholder")}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          style={fieldStyle()}
        />
      </View>
      <Text style={metaText()}>{t("settings.source.key")}</Text>
      <View style={fieldBox(on("key"))}>
        <Input
          ref={(r) => props.fields?.ref("key", r)}
          testID="source-key"
          value={form.key()}
          onChange={(e) => form.edit(form.url(), e.value)}
          onSubmit={form.save}
          onFocus={() => props.fields?.focused("key", true)}
          onBlur={() => props.fields?.focused("key", false)}
          masked
          placeholder={source().hasKey ? t("settings.source.key_saved") : t("settings.source.key_placeholder")}
          autoCapitalize="none"
          autoCorrect={false}
          style={fieldStyle()}
        />
      </View>
      <If when={props.ownButton ?? true} else={<ResultLine form={form} reserve />}>
        <View style={{ ...row(u(20)), marginTop: u(6) }}>
          <Pressable role="button" accessibilityLabel={t("settings.source.save")} hitSlop={targetSlop(cs(60))} onPress={form.save} hoverStyle={{ backgroundColor: colors.dim() }} style={saveStyle(on("save"))}>
            <Text style={labelText(colors.ink())}>{t("settings.source.save")}</Text>
          </Pressable>
          {/* A source set can be taken away (Save with an empty address did nothing visible). */}
          <If when={source().url}>
            <Pressable role="button" accessibilityLabel={t("settings.source.remove")} hitSlop={targetSlop(cs(60))} onPress={form.remove} hoverStyle={{ backgroundColor: colors.raise() }} style={removeStyle(on("remove"))}>
              <Text style={labelText(colors.snow())}>{t("settings.source.remove")}</Text>
            </Pressable>
          </If>
        </View>
        {/* Under the buttons, the form's full width: beside them it was squeezed into a column. */}
        <If when={form.result()}>
          <ResultLine form={form} reserve={false} />
        </If>
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
