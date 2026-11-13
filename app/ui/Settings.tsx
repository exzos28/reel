// Settings: Playback (buffer size) and Search source (the user's Jackett).
// Up/down move the focus in the buffer list, OK chooses, Back closes. A click
// chooses too; the source fields take text (on a TV, entering it from a phone
// comes later).
import { Input } from "nsh/base";
import { keymap, Scroll, signal, Text, View } from "nsh";
import { t } from "nsh/i18n";
import { Fmt } from "app/native";
import { BackButton, Icon } from "./components";
import { bufferChoices, bufferMB, checkSource, chooseBuffer, saveSource, source, type CheckResult } from "./preferences";
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
        <SourceSection />
        <Text style={{ ...type.meta(), color: colors.ash() }}>{t("settings.hint")}</Text>
      </View>
    </Scroll>
  );
}

/** The search source: the address of the user's Jackett (Torznab) and its key. */
function SourceSection() {
  const url = signal(source().url);
  const key = signal("");
  const state = signal<"idle" | "saving" | "saved" | "checking">("idle");
  const error = signal<string | null>(null);
  const check = signal<CheckResult | null>(null);

  const save = async () => {
    state.set("saving");
    error.set(null);
    check.set(null);
    const message = await saveSource(url(), key());
    if (message != null) {
      error.set(message);
      state.set("idle");
      return;
    }
    key.set("");
    if (!source().url) {
      state.set("saved");
      return;
    }
    state.set("checking");
    check.set(await checkSource());
    state.set("saved");
  };

  const result = () => {
    const c = check();
    if (error()) return { text: error()!, bad: true };
    if (state() === "saving") return { text: t("settings.source.saving"), bad: false };
    if (state() === "checking") return { text: t("settings.source.checking"), bad: false };
    if (!c) return state() === "saved" && !source().url ? { text: t("settings.source.removed"), bad: false } : null;
    if (c.state === "failed") return { text: t("settings.source.failed", { message: c.message }), bad: true };
    return { text: c.movieImdb ? t("settings.source.ok_imdb") : t("settings.source.ok_text"), bad: false };
  };

  const field = { height: u(64), paddingHorizontal: u(22), borderRadius: radius(), borderCurve: "continuous" as const, backgroundColor: colors.card(), color: colors.snow(), ...type.body() };

  return (
    <View style={{ gap: u(14), maxWidth: u(980) }}>
      <Text style={{ ...type.section(), color: colors.snow() }}>{t("settings.source.title")}</Text>
      <Text style={{ ...type.body(), color: colors.soft() }}>{t("settings.source.about")}</Text>
      <Text style={{ ...type.meta(), color: colors.ash() }}>{t("settings.source.url")}</Text>
      <Input
        value={url()}
        onChange={(e) => url.set(e.value)}
        onSubmit={save}
        placeholder={t("settings.source.url_placeholder")}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        style={field}
      />
      <Text style={{ ...type.meta(), color: colors.ash() }}>{t("settings.source.key")}</Text>
      <Input
        value={key()}
        onChange={(e) => key.set(e.value)}
        onSubmit={save}
        masked
        placeholder={source().hasKey ? t("settings.source.key_saved") : t("settings.source.key_placeholder")}
        autoCapitalize="none"
        autoCorrect={false}
        style={field}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: u(20), marginTop: u(6) }}>
        <View
          role="button"
          onPress={save}
          hoverStyle={{ backgroundColor: colors.dim() }}
          style={{ height: u(60), paddingHorizontal: u(30), justifyContent: "center", borderRadius: radius(), borderCurve: "continuous", backgroundColor: colors.snow() }}
        >
          <Text style={{ ...type.label(), color: colors.ink() }}>{t("settings.source.save")}</Text>
        </View>
        <If when={result()}>
          {(r) => <Text style={{ ...type.meta(), color: r().bad ? colors.red() : colors.ash(), flexShrink: 1 }}>{r().text}</Text>}
        </If>
      </View>
    </View>
  );
}
