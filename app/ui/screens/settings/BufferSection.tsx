// Playback: how much of a film is kept ahead, and the free space for it.
import { Text, View } from "nsh";
import { t } from "nsh/i18n";
import { Fmt } from "../../native";
import { bodyText, metaText, sectionTitle } from "../../kit/text";
import { bufferChoices, bufferMB, chooseBuffer } from "../../preferences";
import { colors, u } from "../../theme";
import { BufferRow } from "./BufferRow";

export function BufferSection(props: { freeBytes: () => number | null; focusedAt: () => number; onFocus: (i: number) => void }) {
  return [
    <View style={{ gap: u(10), maxWidth: u(980) }}>
      <Text style={sectionTitle()}>{t("settings.buffer.title")}</Text>
      <Text style={bodyText(colors.soft())}>{t("settings.buffer.about")}</Text>
      <Text style={metaText()}>
        {props.freeBytes() == null ? "" : t("settings.buffer.free", { free: Fmt.size(props.freeBytes()!) })}
      </Text>
    </View>,
    <View style={{ gap: u(12), maxWidth: u(720) }}>
      <Each of={bufferChoices()} key={(c) => c.mb}>
        {(choice, i) => (
          <BufferRow
            choice={choice}
            selected={() => bufferMB() === choice().mb}
            focused={() => props.focusedAt() === i()}
            onPress={() => {
              props.onFocus(i());
              chooseBuffer(choice().mb);
            }}
          />
        )}
      </Each>
    </View>,
  ];
}
