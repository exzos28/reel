// A hero's actions: the white Play and the grey list toggle.
import { Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Button } from "../kit/Button";
import { row } from "../kit/shape";
import { u } from "../theme";
import playIcon from "../icons/play.svg";
import plusIcon from "../icons/plus.svg";
import checkIcon from "../icons/check.svg";
import chevronIcon from "../icons/chevron.svg";
import trailerIcon from "../icons/trailer.svg";
import { Icon } from "../kit/Icon";
import { rounded } from "../kit/shape";
import { colors, focusRing } from "../theme";

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

/** "Trailer": opens the title's trailer outside the app. */
export function TrailerButton(props: { focused: () => boolean; onPress: () => void }) {
  return <Button kind="secondary" icon={() => trailerIcon} label={() => t("title.trailer")} focused={props.focused} onPress={props.onPress} />;
}

const releaseButtonStyle = (focused: boolean): ViewStyle => ({
  ...row(u(12)),
  height: u(60),
  paddingHorizontal: u(24),
  ...rounded(),
  backgroundColor: colors.card(),
  ...focusRing(focused),
});

/** The release Play uses, as a button that opens the list of the others:
 * "1080p WEB · 4.7 GB · 125 sharing ▾" (`name` bold, then `rest`). */
export function ReleaseButton(props: { name: () => string; rest: () => string; focused: () => boolean; onPress: () => void }) {
  return (
    <View role="button" onPress={props.onPress} hoverStyle={{ backgroundColor: colors.raise() }} style={releaseButtonStyle(props.focused())}>
      <Text style={{ fontSize: u(22), color: colors.ash() }}>
        <Text style={{ fontWeight: 600, color: colors.snow() }}>{props.name()}</Text>
        {props.rest() ? ` · ${props.rest()}` : ""}
      </Text>
      <Icon src={() => chevronIcon} size={22} color={() => colors.soft()} />
    </View>
  );
}
