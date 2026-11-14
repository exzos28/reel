import { t } from "nsh/i18n";
import { IconButton } from "../kit/IconButton";
import backIcon from "../icons/back.svg";

/** Size of the back button; screens align what sits next to it to this. */
export const BACK_SIZE = 64;

/** A screen's top-left round back button. It always sits at the same spot,
 * the top-left corner of the safe area: put it first in a row aligned to the
 * top (`alignItems: "flex-start"`), never centred against taller text. */
export function BackButton(props: { focused: () => boolean; onPress: () => void; label?: () => string; background?: () => string }) {
  return (
    <IconButton
      icon={() => backIcon}
      label={props.label ?? (() => t("nav.back"))}
      focused={props.focused}
      onPress={props.onPress}
      size={BACK_SIZE}
      background={props.background}
    />
  );
}
