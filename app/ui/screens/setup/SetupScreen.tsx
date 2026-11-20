// The first-run setup (design/setup-and-settings.md): the language of titles, the playback
// buffer, the search source, one step at a time, each with an answer OK accepts. Beside the first
// two steps, where the device serves its settings page (a TV), its QR code: doing it from a phone,
// which the screen follows (a source saved there finishes the setup). The source step does not
// repeat it: under the fields it would push Skip off a TV's screen. Up/down move the focus, OK chooses
// or goes on, Back goes to the previous step: a remote's, Android's, iOS's swipe (each step is a
// page of a native stack on touch) and, with a pointer or a finger, ‹ in the logo's place.
import { effect, keymap, signal, Text, View, type JSX, type ViewStyle } from "nsh";
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
import { footPinned, PageFrame } from "../../layout/PageFrame";
import { scroller } from "../../layout/Scroller";
import { StepStack } from "../../layout/StepStack";
import { BackDisc } from "../../layout/TouchNav";
import { onBack } from "../../nav";
import { caps } from "../../platform";
import { bufferChoices, chooseBuffer, chooseContentLanguage, finishSetup, source } from "../../preferences";
import { colors, cs, density, safe, u } from "../../theme";
import { bufferChoiceList, languageChoices } from "../settings/choices";
import { formWidth } from "../../kit/form";
import { PhoneCard } from "../source/PhoneCard";
import { partner } from "../../hosted";
import { SourceForm } from "../source/SourceForm";
import { linkedSource, sourceForm } from "../source/sourceState";
import { PartnerSource } from "../source/PartnerSource";
import { Pressable } from "../../kit/Pressable";

/** How many languages the step lists before "More languages". */
const SHOWN_LANGUAGES = 5;
/** The steps: the language of titles, the buffer, the source. */
const SOURCE_STEP = 2;

/** The steps and, beside them, the phone's card centred on their height. */
const layoutStyle = (): ViewStyle => ({ ...row(u(96), "center"), paddingHorizontal: safe().x, paddingTop: u(40) });
const stepStyle = (wide: boolean): ViewStyle => ({ flex: 1, maxWidth: wide ? formWidth() * 2 + u(120) : formWidth(), gap: u(16) });
/** The logo, or Back in its place, as tall on every step. */
const headStyle = (): ViewStyle => ({ ...row(0), minHeight: cs(44) });
/** The source step's two ways side by side (one above the other on a phone): a ready source,
 * then your own (the order of Settings' source drawer). */
const waysStyle = (): ViewStyle => ({ flexDirection: density() === "compact" ? "column" : "row", alignItems: "flex-start", gap: u(64), marginTop: u(28) });
const wayStyle = (): ViewStyle => ({ flex: density() === "compact" ? undefined : 1, alignSelf: "stretch", gap: u(14) });
const wayRule = (): ViewStyle => (density() === "compact" ? { height: 1, alignSelf: "stretch" } : { width: 1, alignSelf: "stretch" });
const optionsStyle = (): ViewStyle => ({ gap: u(12), marginTop: u(30) });
const optionStyle = (selected: boolean, focused: boolean): ViewStyle => ({
  ...rowStyle(selected, focused),
  justifyContent: "space-between",
  height: cs(72),
  paddingHorizontal: cs(28),
});
const actionsStyle = (): ViewStyle => ({ ...row(u(20)), marginTop: u(36), flexWrap: "wrap" });
/** Skip, centred under both ways. */
const skipStyle = (): ViewStyle => ({ ...actionsStyle(), alignSelf: "stretch", justifyContent: "center", marginTop: u(56) });

/** A choice as a row: its text, a check when it is the one in effect. */
function Option(props: { choice: () => Choice; focused: () => boolean; onPress: () => void }) {
  const c = props.choice;
  return (
    <Pressable feedback="row" haptic={!c().selected}
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
    </Pressable>
  );
}

export function SetupScreen() {
  const step = signal(0);
  /** The focused item of the step: its options, then its actions. */
  const at = signal(0);
  /** The drawer of the other languages open (as Settings' pickers are), its focus on `pickAt`. */
  const allLanguages = signal(false);
  const pickAt = signal(0);
  const form = sourceForm();

  /** The languages the step lists: the first few, and the one in effect if it is not among them. */
  const shownLanguages = (): Choice[] => {
    const all = languageChoices();
    const first = all.slice(0, SHOWN_LANGUAGES);
    const current = all.find((c) => c.selected);
    return current && !first.includes(current) ? [...first.slice(0, SHOWN_LANGUAGES - 1), current] : first;
  };
  /** The languages "More languages" lists: those the step does not show already. */
  const moreLanguages = (): Choice[] => {
    const shown = new Set(shownLanguages().map((c) => c.key));
    return languageChoices().filter((c) => !shown.has(c.key));
  };
  const openLanguages = () => {
    pickAt.set(0);
    allLanguages.set(true);
  };
  const pickLanguage = (i: number) => {
    const l = moreLanguages()[i];
    if (l) chooseContentLanguage(l.key);
    allLanguages.set(false);
  };
  /** A step's options: languages and "More languages" (while there are more), the buffer sizes,
   * none for the source. */
  const optionsOf = (n: number): Choice[] =>
    n === 0
      ? [...shownLanguages(), ...(moreLanguages().length ? [{ key: "more", text: `${t("setup.language.more")}  ›`, selected: false }] : [])]
      : n === 1
        ? bufferChoiceList()
        : [];
  const options = () => optionsOf(step());
  /** The step's actions: Next; the source's Check and Skip, or Finish alone once it answered. */
  const actions = () => (step() === SOURCE_STEP && !form.connected() ? 2 : 1);
  const count = () => options().length + actions();
  // Fewer actions (connected: Skip went away) take the focus with them.
  effect(() => {
    const last = count() - 1;
    if (at() > last) at.set(last);
  });

  const go = (next: number) => {
    step.set(next);
    at.set(0);
  };
  const finish = () => finishSetup();
  /** The source's one button: Check until the source answered, then Finish (an edit of the
   * fields makes it Check again); nothing while it checks. */
  const sourceAction = () => {
    if (form.busy()) return;
    if (form.connected()) return finish();
    if (form.url().trim()) form.save();
  };
  const choose = (i: number) => {
    const c = options()[i];
    if (!c) return;
    if (step() === 0) {
      if (c.key === "more") return openLanguages();
      chooseContentLanguage(c.key);
    } else if (step() === 1) {
      const b = bufferChoices().find((x) => String(x.mb) === c.key);
      if (b) chooseBuffer(b.mb);
    }
  };
  const act = (i: number) => {
    const n = options().length;
    if (i < n) return choose(i);
    if (step() < SOURCE_STEP) return go(step() + 1);
    // The source: Check (then Finish once it answered); Skip leaves it for later.
    if (i === n) sourceAction();
    else finish();
  };
  // A link that opened the app with a source (reel://s?…) goes to the source step, its fields filled.
  effect(() => {
    if (linkedSource() && step() !== SOURCE_STEP) go(SOURCE_STEP);
  });
  // A source saved from a phone (the settings page) is checked here too: Finish once it answers.
  let seenUrl = source().url;
  effect(() => {
    const url = source().url;
    if (url === seenUrl) return;
    seenUrl = url;
    if (step() === SOURCE_STEP) form.recheck();
  });

  keymap.bind(
    byKeys({
      // The drawer, while it is open, takes the arrows and OK.
      up: () => (allLanguages() ? pickAt.set(Math.max(pickAt() - 1, 0)) : at.set(Math.max(at() - 1, 0))),
      down: () =>
        allLanguages()
          ? pickAt.set(Math.min(pickAt() + 1, moreLanguages().length - 1))
          : at.set(Math.min(at() + 1, count() - 1)),
    }),
    { repeat: true },
  );
  keymap.bind({ enter: () => (allLanguages() ? pickLanguage(pickAt()) : act(at())) });
  // Back: the languages' drawer first, then the previous step. On the first step a TV stays (setup
  // is not skippable as a whole); a phone's system back leaves the app, as on any first page.
  onBack(() => {
    if (allLanguages()) return allLanguages.set(false), true;
    if (step() > 0) return go(step() - 1), true;
    return !caps.touch;
  });

  /** Item `i` of step `n` has the focus (a page under the top one has none). */
  const focusedIn = (n: number, i: number) => () => !allLanguages() && step() === n && at() === i;
  const s: Setup = { step, at, form, optionsOf, choose, go, finish, sourceAction, focusedIn };

  return (
    <View style={{ flex: 1 }}>
      <StepStack step={step} onStep={go} page={(n) => <StepPage s={s} n={n} />} />
      <If when={allLanguages()}>
        <ChoicePanel
          title={() => t("settings.language.title")}
          choices={moreLanguages}
          focusedAt={pickAt}
          onPick={pickLanguage}
          onClose={() => allLanguages.set(false)}
        />
      </If>
    </View>
  );
}

/** What a step's page needs of the setup. */
type Setup = {
  step: () => number;
  at: { set: (i: number) => void };
  form: ReturnType<typeof sourceForm>;
  optionsOf: (n: number) => Choice[];
  choose: (i: number) => void;
  go: (n: number) => void;
  finish: () => void;
  sourceAction: () => void;
  focusedIn: (n: number, i: number) => () => boolean;
};

/** Step `n`'s page: the logo (Back in its place past the first step where there is a pointer
 * or a finger; a remote has its Back), the step, its question and help, then its options or the
 * source's two ways; its main action pinned at the bottom on a phone. */
function StepPage(props: { s: Setup; n: number }) {
  const { s, n } = props;
  const page = scroller({ anchor: (viewport) => viewport / 3 });
  const titleKey = ["language", "buffer", "source"][n];
  const help = () => (n === SOURCE_STEP && !partner() ? "setup.source.help_own" : `setup.${titleKey}.help`);
  const options = () => s.optionsOf(n);
  return (
    <PageFrame ctl={page} kind="bare" top={() => s.step() === n} foot={footPinned() ? <Actions s={s} n={n} /> : undefined}>
      <View style={layoutStyle()}>
        <View style={stepStyle(n === SOURCE_STEP)}>
          <View style={headStyle()}>
            <If when={n > 0 && !caps.remote} else={<Logo />}>
              <BackDisc />
            </If>
          </View>
          <Text style={{ ...metaText(), marginTop: u(44) }}>{t("setup.step", { n: n + 1 })}</Text>
          <Text style={pageTitle()}>{t(`setup.${titleKey}.title`)}</Text>
          <Text style={bodyText(colors.ash())}>{t(help())}</Text>
          <If when={n < SOURCE_STEP}>
            <View style={optionsStyle()}>
              <Each of={options()} key={(c) => c.key}>
                {(c, i) => <Option choice={c} focused={s.focusedIn(n, i())} onPress={() => (s.at.set(i()), s.choose(i()))} />}
              </Each>
            </View>
          </If>
          <If when={n === SOURCE_STEP}>
            <SourceWays s={s} />
          </If>
          <If when={!footPinned()}>
            <Actions s={s} n={n} />
          </If>
        </View>
        <If when={n < SOURCE_STEP}>
          <PhoneCard title={() => t("setup.phone.title")} text={(url) => t("setup.phone.text", { url })} />
        </If>
      </View>
    </PageFrame>
  );
}

/** The source step's two ways: a ready one from the partner's bot (a build without one shows only
 * yours), then your own fields. The fields take text where a keyboard is at hand; a TV's remote
 * goes to the actions (its address is typed on the phone, from the first steps' code). */
function SourceWays(props: { s: Setup }) {
  const s = props.s;
  return (
    <View style={waysStyle()}>
      <If when={partner()}>
        <View style={wayStyle()}>
          <Text style={sectionTitle()}>{t("setup.source.rent_title")}</Text>
          <PartnerSource titled={false} />
        </View>
        <View style={{ ...wayRule(), backgroundColor: colors.raise() }} />
      </If>
      <View style={wayStyle()}>
        <If when={partner()}>
          <Text style={sectionTitle()}>{t("setup.source.own_title")}</Text>
        </If>
        <SourceForm form={s.form} ownButton={false} />
        {/* Check sits under the fields, where they are; on a phone it is the pinned foot's. */}
        <If when={!footPinned()}>
          <View style={actionsStyle()}>
            <SourceButton s={s} />
          </View>
        </If>
      </View>
    </View>
  );
}

/** Check, "Checking…" while it does (it waits), Finish once the source answered. */
function SourceButton(props: { s: Setup; grow?: boolean }) {
  const s = props.s;
  const label = () => (s.form.busy() ? "setup.source.checking" : s.form.connected() ? "setup.source.finish" : "setup.source.check");
  return (
    <Button
      kind="primary"
      grow={props.grow}
      label={() => t(label())}
      focused={s.focusedIn(SOURCE_STEP, 0)}
      disabled={() => s.form.busy() || (!s.form.connected() && !s.form.url().trim())}
      onPress={s.sourceAction}
    />
  );
}

/** A step's actions. On a phone, the pinned foot's: Next across the width; on the source step
 * Skip and Check side by side, then Finish alone. Elsewhere inline: Next under the options; on the
 * source step Skip centred under both ways (Check is under the fields), gone once connected. */
function Actions(props: { s: Setup; n: number }): JSX.Element {
  const { s, n } = props;
  const pinned = footPinned();
  const skip = () => (
    <If when={!s.form.connected()}>
      <Button kind="secondary" grow={pinned} label={() => t("setup.source.skip")} focused={s.focusedIn(SOURCE_STEP, 1)} onPress={s.finish} />
    </If>
  );
  if (n < SOURCE_STEP) {
    return (
      <View style={pinned ? row(u(16)) : actionsStyle()}>
        <Button kind="primary" grow={pinned} label={() => t("setup.next")} focused={s.focusedIn(n, s.optionsOf(n).length)} onPress={() => s.go(n + 1)} />
      </View>
    );
  }
  if (pinned) {
    return (
      <View style={row(u(16))}>
        {skip()}
        <SourceButton s={s} grow />
      </View>
    );
  }
  return <View style={skipStyle()}>{skip()}</View>;
}
