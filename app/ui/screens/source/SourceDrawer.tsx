// The drawer that asks for a search source where Play needs one and there is none: on a title
// without a source, or when the engine finds none to play from. What a source is, the TV's
// QR code, the fields; once the source connects, it closes and the title searches it.
// A remote's focus is the drawer's while it is open (its keys are newer than the page's): the bot's
// button where it shows, the address, the key, Save and Remove; Up and Down walk them, Left and
// Right go between Save and Remove, OK on a field brings the system's keyboard. Back closes it,
// and the page's focus is where it was (the row or the button that opened it).
import { effect, keymap, signal, Text, View } from "nsh";
import { t } from "nsh/i18n";
import { bindOnTop, byKeys } from "../../focus/keys";
import { clamp } from "../../focus/memory";
import { bodyText } from "../../kit/text";
import { Drawer } from "../../layout/Drawer";
import type { ScrollCtl } from "../../layout/Scroller";
import { handleBack, onBack } from "../../nav";
import { caps } from "../../platform";
import { status, stop } from "../../playback";
import { source } from "../../preferences";
import { colors, u } from "../../theme";
import { openPartnerApp, partnerButtonShown, PartnerSource } from "./PartnerSource";
import { SourceByPhone, sourceFields, SourceForm, type SourceStop } from "./SourceForm";
import { sourceForm } from "./sourceState";

/** Why it is open: there is no source, the one set did not answer, Settings, or a link
 * (`reel://s?…`) filled it. */
type Why = "missing" | "failed" | "edit" | "link";
const shown = signal(false);
const why = signal<Why>("missing");
/** The drawer is open: the page under it shows no focus of its own. */
export const sourceDrawerOpen = () => shown();
export const openSourceDrawer = (reason: Why = "missing") => {
  why.set(reason);
  shown.set(true);
};

/** How long "Connected" shows before the drawer closes, ms. */
const CONNECTED_MS = 1200;

/** A remote's stops in the drawer, top to bottom (Remove is right of Save). */
type Stop = "partner" | SourceStop;

function Body(props: { list: ScrollCtl }) {
  const form = sourceForm();
  effect(() => {
    if (form.connected()) setTimeout(() => shown.set(false), CONNECTED_MS);
  });
  const partnerHere = () => why() !== "link" && partnerButtonShown();
  /** The remote's focus: on the address first. */
  const at = signal<Stop>("url");
  const fields = sourceFields(() => (caps.remote ? at() : null));
  /** The stops Up and Down walk. */
  const column = (): Stop[] => [...(partnerHere() ? (["partner"] as Stop[]) : []), "url", "key", "save"];
  // A stop that goes (Remove with the source, the bot's button) takes the focus to its neighbour.
  effect(() => {
    if (at() === "remove" && !source().url) at.set("save");
    if (at() === "partner" && !partnerHere()) at.set("url");
  });
  const move = (by: number) => {
    const c = column();
    at.set(c[clamp(c.indexOf(at() === "remove" ? "save" : at()) + by, c.length - 1)]);
  };
  const press = () => {
    const s = at();
    if (s === "url" || s === "key") fields.type(s);
    else if (s === "save") void form.save();
    else if (s === "remove") void form.remove();
    else openPartnerApp();
  };
  /** Tab's order: the column, Remove after Save. */
  const order = (): Stop[] => [...column(), ...(source().url ? (["remove"] as Stop[]) : [])];
  const step = (by: number) => {
    const o = order();
    at.set(o[clamp(o.indexOf(at()) + by, o.length - 1)]);
  };
  // Back closes it, before anything of the page's.
  onBack(() => (shown.set(false), true));
  if (caps.remote) {
    bindOnTop(() => {
      const off = [
        // Up and Down (and Tab) leave a field that has the keyboard's focus too; Left and Right move
        // its caret; Back reaches a field too (a TV's web view hands it the remote's Back).
        keymap.bind(byKeys({ up: () => move(-1), down: () => move(1) }), { repeat: true, when: "always" }),
        keymap.bind({ tab: () => step(1), "shift+tab": () => step(-1), escape: handleBack }, { when: "always" }),
        keymap.bind(byKeys({ left: () => at() === "remove" && at.set("save"), right: () => at() === "save" && source().url && at.set("remove") }), { repeat: true }),
        keymap.bind({ enter: press }),
      ];
      return () => off.forEach((f) => f());
    });
  }
  const focus = () => (caps.remote ? at() : null);
  return (
    <View style={{ gap: u(24) }}>
      <Text style={bodyText(colors.soft())}>{t(`settings.source_drawer.${why()}_about`)}</Text>
      <SourceByPhone />
      <If when={why() !== "link"}>
        <View ref={props.list.follow(() => focus() === "partner", "nearest")}>
          <PartnerSource focused={() => focus() === "partner"} />
        </View>
      </If>
      <View ref={props.list.follow(() => focus() != null && focus() !== "partner", "nearest")}>
        <SourceForm form={form} focus={focus} fields={fields} />
      </View>
    </View>
  );
}

/** Over any screen (App). Back (a remote's, Escape, Android's) closes it first (its body's). */
export function SourceDrawer() {
  // The engine has no source to play from: no player with an error, this drawer instead.
  effect(() => {
    if (status().phase !== "no_source") return;
    stop();
    openSourceDrawer();
  });
  return (
    <Drawer id="source" open={shown} onClose={() => shown.set(false)} title={() => t(`settings.source_drawer.${why()}_title`)} tvWidth={900}>
      {(list) => (
        <If when={shown()}>
          <Body list={list} />
        </If>
      )}
    </Drawer>
  );
}
