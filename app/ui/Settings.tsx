// Settings: for now one section, Playback, with the buffer size.
// Up/down move the focus, OK chooses, Back closes. A click chooses too.
import { keymap, signal, Text, View } from "nsh";
import { t } from "nsh/i18n";
import { Fmt } from "app/native";
import { bufferChoices, bufferMB, chooseBuffer } from "./preferences";
import { colors, fonts, safe, type, u } from "./theme";

export function Settings(props: { freeBytes: () => number | null; onClose: () => void }) {
  const focus = signal(Math.max(0, bufferChoices().findIndex((c) => c.mb === bufferMB())));
  const move = (d: number) => focus.set(Math.min(Math.max(focus() + d, 0), bufferChoices().length - 1));

  keymap.bind({ up: () => move(-1), down: () => move(1) }, { repeat: true });
  keymap.bind({
    enter: () => chooseBuffer(bufferChoices()[focus()].mb),
    escape: props.onClose,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.hall(), paddingHorizontal: safe().x, paddingVertical: safe().y, gap: u(32) }}>
      <Text style={{ ...type.title(), color: colors.screen() }}>{t("settings.title")}</Text>
      <View style={{ gap: u(12), maxWidth: u(900) }}>
        <Text style={{ ...type.subtitle(), color: colors.screen() }}>{t("settings.buffer.title")}</Text>
        <Text style={{ ...type.caption(), color: colors.dim() }}>{t("settings.buffer.about")}</Text>
        <Text style={{ ...type.caption(), color: colors.dim() }}>
          {props.freeBytes() == null ? "" : t("settings.buffer.free", { free: Fmt.size(props.freeBytes()!) })}
        </Text>
      </View>
      <View style={{ gap: u(10), maxWidth: u(700) }}>
        <Each of={bufferChoices()} key={(c) => c.mb}>
          {(mb, i) => (
            <View
              role="button"
              onPress={() => {
                focus.set(i());
                chooseBuffer(mb().mb);
              }}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingHorizontal: u(28),
                paddingVertical: u(18),
                borderRadius: 12,
                backgroundColor: focus() === i() ? colors.screen() : colors.seat(),
              }}
            >
              <Text style={{ fontFamily: fonts.body, fontSize: u(32), color: focus() === i() ? colors.hall() : colors.screen() }}>
                {Fmt.size(mb().mb * 1024 * 1024)}
                {mb().default ? `  ${t("settings.buffer.default")}` : ""}
              </Text>
              {/* Selected is the lamp check, never the focus fill. */}
              <Text style={{ fontFamily: fonts.body, fontSize: u(32), color: colors.beam() }}>{bufferMB() === mb().mb ? "✓" : ""}</Text>
            </View>
          )}
        </Each>
      </View>
      <Text style={{ ...type.caption(), color: colors.dim() }}>{t("settings.hint")}</Text>
    </View>
  );
}
