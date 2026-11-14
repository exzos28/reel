// Settings: Playback (buffer size) and Search source (the user's Jackett).
// Up/down move the focus in the buffer list, OK chooses, Back closes. A click
// chooses too; the source fields take text (on a TV, entering it from a phone
// comes later).
import { keymap, Scroll, signal, Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { clamp } from "../../focus/memory";
import { metaText } from "../../kit/text";
import { PageHeader } from "../../layout/TopBar";
import { bufferChoices, bufferMB, chooseBuffer } from "../../preferences";
import { colors, safe, u } from "../../theme";
import { BufferSection } from "./BufferSection";
import { SourceSection } from "./SourceSection";

const pageStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, paddingVertical: safe().y, gap: u(32) });

export function SettingsScreen(props: { freeBytes: () => number | null; onClose: () => void }) {
  const focus = signal(Math.max(0, bufferChoices().findIndex((c) => c.mb === bufferMB())));
  const move = (d: number) => focus.set(clamp(focus() + d, bufferChoices().length - 1));

  keymap.bind({ up: () => move(-1), down: () => move(1) }, { repeat: true });
  keymap.bind({
    enter: () => chooseBuffer(bufferChoices()[focus()].mb),
    escape: props.onClose,
  });

  return (
    <Scroll style={{ flex: 1, backgroundColor: colors.ink() }}>
      <View style={pageStyle()}>
        <PageHeader title={() => t("settings.title")} focused={() => false} onBack={props.onClose} />
        <BufferSection freeBytes={props.freeBytes} focusedAt={focus} onFocus={(i) => focus.set(i)} />
        <SourceSection />
        <Text style={metaText()}>{t("settings.hint")}</Text>
      </View>
    </Scroll>
  );
}
