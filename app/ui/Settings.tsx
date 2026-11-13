// Settings: for now one section, Playback, with the buffer size.
// Up/down move the focus, OK chooses, Back closes. A click chooses too.
import { keymap, Scroll, signal, Text, View } from "nsh";
import { t } from "nsh/i18n";
import { Fmt } from "app/native";
import { BackButton, Icon } from "./components";
import { bufferChoices, bufferMB, chooseBuffer } from "./preferences";
import { colors, focusRing, radius, safe, type, u } from "./theme";
import checkIcon from "./icons/check.svg";

export function Settings(props: { freeBytes: () => number | null; onClose: () => void }) {
  const focus = signal(Math.max(0, bufferChoices().findIndex((c) => c.mb === bufferMB())));
  const move = (d: number) => focus.set(Math.min(Math.max(focus() + d, 0), bufferChoices().length - 1));

  keymap.bind({ up: () => move(-1), down: () => move(1) }, { repeat: true });
  keymap.bind({
    enter: () => chooseBuffer(bufferChoices()[focus()].mb),
    escape: props.onClose,
  });

  return (
    <Scroll style={{ flex: 1, backgroundColor: colors.ink() }}>
      <View style={{ paddingHorizontal: safe().x, paddingVertical: safe().y, gap: u(32) }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: u(24) }}>
          <BackButton focused={() => false} onPress={props.onClose} />
          <Text style={{ ...type.page(), color: colors.snow() }}>{t("settings.title")}</Text>
        </View>
        <View style={{ gap: u(10), maxWidth: u(980) }}>
          <Text style={{ ...type.section(), color: colors.snow() }}>{t("settings.buffer.title")}</Text>
          <Text style={{ ...type.body(), color: colors.soft() }}>{t("settings.buffer.about")}</Text>
          <Text style={{ ...type.meta(), color: colors.ash() }}>
            {props.freeBytes() == null ? "" : t("settings.buffer.free", { free: Fmt.size(props.freeBytes()!) })}
          </Text>
        </View>
        <View style={{ gap: u(12), maxWidth: u(720) }}>
          <Each of={bufferChoices()} key={(c) => c.mb}>
            {(mb, i) => (
              <View
                role="button"
                accessibilityState={{ selected: bufferMB() === mb().mb }}
                onPress={() => {
                  focus.set(i());
                  chooseBuffer(mb().mb);
                }}
                hoverStyle={{ backgroundColor: colors.raise() }}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  height: u(68),
                  paddingHorizontal: u(28),
                  borderRadius: radius(), borderCurve: "continuous",
                  // Selected is the lighter fill and a check; focus is the ring.
                  backgroundColor: bufferMB() === mb().mb ? colors.raise() : colors.card(),
                  ...focusRing(focus() === i(), "row"),
                }}
              >
                <Text style={{ ...type.label(), color: colors.snow() }}>
                  {Fmt.size(mb().mb * 1024 * 1024)}
                  <Text style={{ fontWeight: 400, color: colors.ash() }}>{mb().default ? `  ${t("settings.buffer.default")}` : ""}</Text>
                </Text>
                <If when={bufferMB() === mb().mb}>
                  <View accessibilityLabel={t("settings.selected")}>
                    <Icon src={() => checkIcon} size={26} />
                  </View>
                </If>
              </View>
            )}
          </Each>
        </View>
        <Text style={{ ...type.meta(), color: colors.ash() }}>{t("settings.hint")}</Text>
      </View>
    </Scroll>
  );
}
