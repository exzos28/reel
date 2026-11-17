// The first-run setup (design/setup-and-settings.md): the language of titles, the playback
// buffer, the search source, one step at a time, each with an answer OK accepts. Beside the steps,
// where the device serves its settings page (a TV), its QR code: doing it from a phone, which the
// screen follows (a source saved there finishes the setup). Up/down move the focus, OK chooses
// or goes on, Back goes to the previous step.
import { effect, keymap, signal, Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import checkIcon from "../../icons/check.svg";
import { byKeys } from "../../focus/keys";
import { Button } from "../../kit/Button";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { row } from "../../kit/shape";
import { bodyText, labelText, metaText, pageTitle, sectionTitle } from "../../kit/text";
import { ChoicePanel, type Choice } from "../../layout/ChoicePanel";
import { Logo } from "../../layout/NavBar";
import { PageFrame } from "../../layout/PageFrame";
import { scroller } from "../../layout/Scroller";
import { onBack } from "../../nav";
import { bufferChoices, chooseBuffer, chooseContentLanguage, contentLanguages, finishSetup, source } from "../../preferences";
import { colors, cs, density, safe, u } from "../../theme";
import { bufferChoiceList, languageChoices } from "../settings/choices";
import { formWidth } from "../../kit/form";
import { PhoneCard } from "../source/PhoneCard";
import { partner } from "../../hosted";
import { SourceByPhone, SourceForm } from "../source/SourceForm";
import { linkedSource, sourceForm } from "../source/sourceState";
import { PartnerSource } from "../source/PartnerSource";

/** How many languages the step lists before "More languages". */
const SHOWN_LANGUAGES = 5;

const layoutStyle = (): ViewStyle => ({ ...row(u(96), "flex-start"), paddingHorizontal: safe().x, paddingTop: u(40) });
const stepStyle = (wide: boolean): ViewStyle => ({ flex: 1, maxWidth: wide ? formWidth() * 2 + u(120) : formWidth(), gap: u(16) });
/** The source step's two ways side by side (one above the other on a phone): your own source, or
 * a rented one. */
const waysStyle = (): ViewStyle => ({ flexDirection: density === "compact" ? "column" : "row", alignItems: "flex-start", gap: u(64), marginTop: u(28) });
const wayStyle = (): ViewStyle => ({ flex: density === "compact" ? undefined : 1, alignSelf: "stretch", gap: u(14) });
const wayRule = (): ViewStyle => (density === "compact" ? { height: 1, alignSelf: "stretch" } : { width: 1, alignSelf: "stretch" });
const optionsStyle = (): ViewStyle => ({ gap: u(12), marginTop: u(30) });
const optionStyle = (selected: boolean, focused: boolean): ViewStyle => ({
  ...rowStyle(selected, focused),
  justifyContent: "space-between",
  height: cs(72),
  paddingHorizontal: cs(28),
});
const actionsStyle = (): ViewStyle => ({ ...row(u(20)), marginTop: u(36), flexWrap: "wrap" });

/** A choice as a row: its text, a check when it is the one in effect. */
function Option(props: { choice: () => Choice; focused: () => boolean; onPress: () => void }) {
  const c = props.choice;
  return (
    <View
      role="button"
      accessibilityLabel={c().text}
      accessibilityState={{ selected: c().selected }}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={optionStyle(c().selected, props.focused())}
    >
      <Text style={labelText(c().selected ? colors.snow() : colors.soft())}>{c().text}</Text>
      <If when={c().selected}>
        <Icon src={() => checkIcon} size={22} />
      </If>
    </View>
  );
}

export function SetupScreen() {
  const step = signal(0);
  /** The focused item of the step: its options, then its actions. */
  const at = signal(0);
  const allLanguages = signal(false);
  const form = sourceForm();
  const page = scroller({ anchor: (viewport) => viewport / 3 });

  /** The languages the step lists: the first few, and the one in effect if it is not among them. */
  const shownLanguages = (): Choice[] => {
    const all = languageChoices();
    const first = all.slice(0, SHOWN_LANGUAGES);
    const current = all.find((c) => c.selected);
    return current && !first.includes(current) ? [...first.slice(0, SHOWN_LANGUAGES - 1), current] : first;
  };
  /** The step's options: languages and "More languages", the buffer sizes, none for the source. */
  const options = (): Choice[] =>
    step() === 0
      ? [...shownLanguages(), { key: "more", text: `${t("setup.language.more")}  ›`, selected: false }]
      : step() === 1
        ? bufferChoiceList()
        : [];
  /** The step's actions: Next, or the source's three (Check, Finish, Skip). */
  const actions = () => (step() === 2 ? 3 : 1);
  const count = () => options().length + actions();

  const go = (next: number) => {
    step.set(next);
    at.set(0);
  };
  const finish = () => finishSetup();
  const choose = (i: number) => {
    const c = options()[i];
    if (!c) return;
    if (step() === 0) {
      if (c.key === "more") return allLanguages.set(true);
      chooseContentLanguage(c.key);
    } else if (step() === 1) {
      const b = bufferChoices().find((x) => String(x.mb) === c.key);
      if (b) chooseBuffer(b.mb);
    }
  };
  const act = (i: number) => {
    const n = options().length;
    if (i < n) return choose(i);
    if (step() < 2) return go(step() + 1);
    // The source: Check saves and checks it; Finish once it connected; Skip leaves it for later.
    if (i === n) form.save();
    else if (i === n + 1) form.connected() && finish();
    else finish();
  };
  // A link that opened the app with a source (reel://s?…) goes to the source step, its fields filled.
  effect(() => {
    if (linkedSource() && step() !== 2) go(2);
  });
  // A source saved from a phone (the settings page) is checked here too: Finish once it answers.
  let seenUrl = source().url;
  effect(() => {
    const url = source().url;
    if (url === seenUrl) return;
    seenUrl = url;
    if (step() === 2) form.recheck();
  });

  keymap.bind(
    byKeys({
      up: () => !allLanguages() && at.set(Math.max(at() - 1, 0)),
      down: () => !allLanguages() && at.set(Math.min(at() + 1, count() - 1)),
    }),
    { repeat: true },
  );
  keymap.bind({ enter: () => !allLanguages() && act(at()) });
  // Back: the languages' drawer first, then the previous step.
  onBack(() => {
    if (allLanguages()) return allLanguages.set(false), true;
    if (step() > 0) return go(step() - 1), true;
    return true;
  });

  const focused = (i: number) => () => !allLanguages() && at() === i;
  const titleKey = () => ["language", "buffer", "source"][step()];

  return (
    <View style={{ flex: 1 }}>
      <PageFrame ctl={page} kind="bare">
        <View style={layoutStyle()}>
          <View style={stepStyle(step() === 2)}>
            <Logo />
            <Text style={{ ...metaText(), marginTop: u(60) }}>{t("setup.step", { n: step() + 1 })}</Text>
            <Text style={pageTitle()}>{t(`setup.${titleKey()}.title`)}</Text>
            <Text style={bodyText(colors.ash())}>{t(`setup.${titleKey()}.help`)}</Text>
            <If when={step() < 2}>
              <View style={optionsStyle()}>
                <Each of={options()} key={(c) => c.key}>
                  {(c, i) => <Option choice={c} focused={focused(i())} onPress={() => (at.set(i()), choose(i()))} />}
                </Each>
              </View>
              <View style={actionsStyle()}>
                <Button kind="primary" label={() => t("setup.next")} focused={focused(options().length)} onPress={() => go(step() + 1)} />
              </View>
            </If>
            <If when={step() === 2}>
              {/* The fields take text where a keyboard is at hand; a TV's remote goes to the actions
                  (its address is typed on the phone, beside). */}
              <View style={waysStyle()}>
                {/* Your own: the fields, Check and Finish (and, on a TV, typing it on a phone). */}
                <View style={wayStyle()}>
                  <Text style={sectionTitle()}>{t("setup.source.own_title")}</Text>
                  <SourceForm form={form} ownButton={false} />
                  <View style={actionsStyle()}>
                    <Button kind="secondary" label={() => t("setup.source.check")} focused={focused(0)} onPress={() => form.save()} />
                    <Button kind="primary" label={() => t("setup.source.finish")} focused={focused(1)} disabled={() => !form.connected()} onPress={finish} />
                  </View>
                  <SourceByPhone />
                </View>
                {/* Or a rented one, from the partner's bot (a build without one shows only yours). */}
                <If when={partner()}>
                  <View style={{ ...wayRule(), backgroundColor: colors.raise() }} />
                  <View style={wayStyle()}>
                    <Text style={sectionTitle()}>{t("setup.source.rent_title")}</Text>
                    <PartnerSource titled={false} />
                  </View>
                </If>
              </View>
              <View style={{ ...actionsStyle(), alignItems: "center" }}>
                <Button kind="secondary" label={() => t("setup.source.skip")} focused={focused(2)} onPress={finish} />
                <Text style={metaText()}>{t("setup.source.note")}</Text>
              </View>
            </If>
          </View>
          <If when={step() < 2}>
          <PhoneCard
            title={() => t(step() === 2 ? "setup.phone.source_title" : "setup.phone.title")}
            text={(url) => t(step() === 2 ? "setup.phone.source_text" : "setup.phone.text", { url })}
          />
          </If>
        </View>
      </PageFrame>
      <If when={allLanguages()}>
        <ChoicePanel
          title={() => t("settings.language.title")}
          choices={languageChoices}
          focusedAt={() => Math.max(0, languageChoices().findIndex((c) => c.selected))}
          onPick={(i) => {
            const l = contentLanguages()[i];
            if (l) chooseContentLanguage(l.tag);
            allLanguages.set(false);
          }}
          onClose={() => allLanguages.set(false)}
        />
      </If>
    </View>
  );
}
