// Playback: how much of a film is kept around where it plays, and the free space
// for it. One row with the size in effect; the sizes open in a drawer.
import { Text, View } from "nsh";
import { t } from "nsh/i18n";
import { Fmt } from "../../native";
import { bodyText, metaText, sectionTitle } from "../../kit/text";
import type { Choice } from "../../layout/ChoicePanel";
import { bufferChoices, bufferMB } from "../../preferences";
import { colors, u } from "../../theme";
import { PickerRow } from "./PickerRow";

const MIB = 1024 * 1024;
const sizeText = (mb: number) => Fmt.size(mb * MIB);

export function BufferSection(props: { freeBytes: () => number | null; focused: () => boolean; onOpen: () => void }) {
  return [
    <View style={{ gap: u(10), maxWidth: u(980) }}>
      <Text style={sectionTitle()}>{t("settings.buffer.title")}</Text>
      <Text style={bodyText(colors.soft())}>{t("settings.buffer.about")}</Text>
      <Text style={metaText()}>
        {props.freeBytes() == null ? "" : t("settings.buffer.free", { free: Fmt.size(props.freeBytes()!) })}
      </Text>
    </View>,
    <PickerRow label={t("settings.buffer.title")} value={() => sizeText(bufferMB())} focused={props.focused} onOpen={props.onOpen} />,
  ];
}

/** The sizes this device has room for, as the drawer lists them ("256 MB (default)"). */
export const bufferChoiceList = (): Choice[] =>
  bufferChoices().map((c) => ({
    key: String(c.mb),
    text: c.default ? `${sizeText(c.mb)}  ${t("settings.buffer.default")}` : sizeText(c.mb),
    selected: c.mb === bufferMB(),
  }));
