// A hero's actions: the white Play and the grey list toggle.
import type { ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Button } from "../kit/Button";
import { row } from "../kit/shape";
import { u } from "../theme";
import playIcon from "../icons/play.svg";
import plusIcon from "../icons/plus.svg";
import checkIcon from "../icons/check.svg";

/** The row they sit in; `wrap`: with the release line beside them. */
export const actionsRow = (wrap: boolean): ViewStyle =>
  wrap ? { ...row(u(16)), flexWrap: "wrap", marginTop: u(12) } : { flexDirection: "row", gap: u(16), marginTop: u(12) };

export function PlayButton(props: { label: () => string; focused: () => boolean; onPress: () => void }) {
  return <Button kind="primary" icon={() => playIcon} label={props.label} focused={props.focused} onPress={props.onPress} />;
}

/** "My list" / "Add to list" (`addKey`), "In my list" with a check once added. */
export function ListButton(props: { inList: () => boolean; addKey: string; focused: () => boolean; onPress: () => void }) {
  return (
    <Button
      kind="secondary"
      icon={() => (props.inList() ? checkIcon : plusIcon)}
      label={() => (props.inList() ? t("title.in_list") : t(props.addKey))}
      focused={props.focused}
      onPress={props.onPress}
    />
  );
}
