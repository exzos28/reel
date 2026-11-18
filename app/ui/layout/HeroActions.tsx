// A hero's actions: the white Play, the grey list toggle and Trailer, and
// the release button on its own line under them.
import { Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Button } from "../kit/Button";
import { row } from "../kit/shape";
import { cs, targetSlop, ts, u } from "../theme";
import playIcon from "../icons/play.svg";
import plusIcon from "../icons/plus.svg";
import checkIcon from "../icons/check.svg";
import chevronIcon from "../icons/chevron.svg";
import trailerIcon from "../icons/trailer.svg";
import savedIcon from "../icons/saved.svg";
import type { SaveState } from "../library";
import { Icon } from "../kit/Icon";
import { rounded } from "../kit/shape";
import { alpha, colors, focusRing } from "../theme";

/** The row they sit in; `wrap`: with the release line beside them. */
export const actionsRow = (wrap: boolean): ViewStyle =>
  wrap ? { ...row(u(16)), flexWrap: "wrap", marginTop: u(12) } : { flexDirection: "row", gap: u(16), marginTop: u(12) };

export function PlayButton(props: { label: () => string; focused: () => boolean; onPress: () => void; disabled?: () => boolean }) {
  return <Button kind="primary" icon={() => playIcon} label={props.label} focused={props.focused} onPress={props.onPress} disabled={props.disabled} />;
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
  ...row(u(14)),
  height: cs(60),
  marginTop: u(16),
  paddingHorizontal: cs(24),
  ...rounded(),
  backgroundColor: alpha(colors.raise(), 0.7),
  ...focusRing(focused, "row"),
});

/** The release Play uses, as a button that opens the list of the others:
 * "1080p WEB · 4.7 GB · 125 sharing ▾" (`name` bold, then `rest`). */
export function ReleaseButton(props: { name: () => string; rest: () => string; focused: () => boolean; onPress: () => void }) {
  return (
    <View role="button" hitSlop={targetSlop(cs(60))} onPress={props.onPress} hoverStyle={{ backgroundColor: colors.raise() }} style={releaseButtonStyle(props.focused())}>
      <Text style={{ fontSize: ts(24), color: colors.ash() }}>
        <Text style={{ fontWeight: 600, color: colors.snow() }}>{props.name()}</Text>
        {props.rest() ? ` · ${props.rest()}` : ""}
      </Text>
      <Icon src={() => chevronIcon} size={22} color={() => colors.snow()} />
    </View>
  );
}

/** Save (design/offline-downloads.md): "Save", then what is saved of the title: "Saving 34%",
 * a show's "Saving 2 of 5", "Paused", "Saved" with a check. */
export function SaveButton(props: { state: () => SaveState; show: () => boolean; focused: () => boolean; onPress: () => void; disabled?: () => boolean }) {
  const s = props.state;
  const label = () => {
    switch (s().state) {
      case "saving":
      case "searching":
      case "resolving":
      case "waiting":
        return props.show()
          ? t("title.saving_some", { count: s().saving ?? 0, total: (s().saving ?? 0) + (s().saved ?? 0) })
          : t("title.saving", { percent: Math.floor(s().progress * 100) });
      case "paused":
        return t("title.save_paused");
      case "saved":
        return t("title.saved");
      default:
        return t("title.save");
    }
  };
  return <Button kind="secondary" icon={() => (s().state === "saved" ? checkIcon : savedIcon)} label={label} focused={props.focused} onPress={props.onPress} disabled={props.disabled} />;
}
