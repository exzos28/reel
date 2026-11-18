// A question before something that cannot be undone ("Remove “Pilot”?"): Cancel is focused;
// Left and Right move between the two, OK chooses, Back or Escape cancels. Built as the exit
// dialog is.
import { keymap, signal, Text, View, type TextStyle, type ViewStyle } from "nsh";
import { Dialog } from "nsh/base";
import { t } from "nsh/i18n";
import { Button } from "../kit/Button";
import { row } from "../kit/shape";
import { onBack } from "../nav";
import { alpha, colors, font, ts, u } from "../theme";

const cardStyle = (): ViewStyle => ({ width: u(760), padding: u(48), borderRadius: u(28), borderCurve: "continuous", backgroundColor: colors.card() });
const backdropStyle = (): ViewStyle => ({ backgroundColor: alpha(colors.ink(), 0.72) });
const dialogStyle: ViewStyle = { flex: 1, alignItems: "center", justifyContent: "center" };
const titleStyle = (): TextStyle => ({ fontFamily: font, fontSize: ts(40), fontWeight: 600, color: colors.snow() });
const aboutStyle = (): TextStyle => ({ fontFamily: font, fontSize: ts(26), lineHeight: ts(36), color: colors.ash(), marginTop: u(14) });

export interface Confirm {
  title: string;
  about: string;
  /** The action's word on its button ("Remove"). */
  action: string;
  onConfirm: () => void;
}

function ConfirmCard(props: { ask: Confirm; onClose: () => void }) {
  /** 0: Cancel, 1: the action. */
  const at = signal(0);
  const choose = (i: number) => {
    props.onClose();
    if (i === 1) props.ask.onConfirm();
  };
  // Newer than the page's bindings, so the page under it does not move.
  keymap.bind({ left: () => at.set(0), right: () => at.set(1), up: () => {}, down: () => {}, enter: () => choose(at()) });
  onBack(() => (props.onClose(), true));
  return (
    <View style={cardStyle()}>
      <Text style={titleStyle()}>{props.ask.title}</Text>
      <Text style={aboutStyle()}>{props.ask.about}</Text>
      <View style={{ ...row(u(16)), marginTop: u(40) }}>
        <Button kind="primary" label={() => t("confirm.cancel")} focused={() => at() === 0} onPress={() => choose(0)} />
        <Button kind="secondary" label={() => props.ask.action} focused={() => at() === 1} onPress={() => choose(1)} />
      </View>
    </View>
  );
}

export function ConfirmDialog(props: { ask: () => Confirm | null; onClose: () => void }) {
  return (
    <If when={props.ask()}>
      <Dialog
        testID="confirm-dialog"
        role="alertdialog"
        accessibilityLabel={props.ask()!.title}
        accessibilityDescription={props.ask()!.about}
        animation="fade"
        closeOnEscape
        onOpenChange={(e) => !e.open && props.onClose()}
        style={dialogStyle}
        backdropStyle={backdropStyle()}
      >
        <ConfirmCard ask={props.ask()!} onClose={props.onClose} />
      </Dialog>
    </If>
  );
}
